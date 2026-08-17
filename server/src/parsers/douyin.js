/**
 * 抖音解析器
 *
 * 解析策略（按优先级降序）:
 *   1. 直接调用抖音官方 API（aweme_detail，部分场景仍在用）
 *   2. 【新】Playwright 浏览器解析（绕过 JSVM 反爬，在真实浏览器中调用 API）
 *   3. Cheerio 提取页面内嵌数据（JSON-LD / SSR 场景，已基本被 JSVM 阻断）
 *   4. lux Go CLI 解析（内置 X-Bogus 签名，可绕过反爬）
 *   5. 第三方解析 API 降级
 *
 * 浏览器解析说明：
 *   - 使用 headless Chromium 加载抖音页面，执行 JSVM 挑战获取 s_v_web_id
 *   - 在已认证的浏览器上下文内调用 aweme/detail API
 *   - 需要安装 Playwright：npm install playwright && npx playwright install chromium
 *   - 浏览器实例由 browserManager 管理，全局共享单例
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { extractDouyinVideoId } = require('../utils/url');
const { parseViaThirdParty } = require('../services/thirdPartyApi');
const { parseViaLux } = require('../services/luxParser');
const { parseVideo: parseViaBrowser } = require('../services/douyinBrowserParser');

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';
const DOUYIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 模块级诊断缓存：记录最近一次解析的失败链，供 GET /api/debug/douyin 排查线上问题
let lastDiagnostics = null;

/** 返回最近一次解析的诊断信息（失败原因链） */
function getLastDiagnostics() {
  return lastDiagnostics;
}

/**
 * 解析抖音分享链接
 */
async function parse(shareUrl) {
  // 收集各步骤失败原因，用于内部诊断
  const failReasons = [];

  try {
    // 第一步：解析短链接，获取完整 URL
    const fullUrl = await resolveShortUrl(shareUrl);
    if (!fullUrl && /v\.douyin\.com/i.test(shareUrl)) {
      // 抖音对数据中心/低信誉 IP 的短链风控：302 直接跳到首页，无视频 ID
      failReasons.push('短链:抖音风控(302→首页,无视频ID)');
    }
    const targetUrl = fullUrl || shareUrl;
    let videoId = extractDouyinVideoId(targetUrl);

    // 第二步：尝试直接 API 请求
    if (videoId) {
      const apiResult = await fetchViaApi(videoId);
      if (apiResult.success) return apiResult;
      failReasons.push('API:' + (apiResult.error || '失败'));
    }

    // 第三步：浏览器解析（绕过 JSVM 反爬）
    // 使用 headless Chromium 解 JSVM 挑战后调用 API
    if (videoId || fullUrl) {
      const browserInput = videoId || targetUrl;
      const browserResult = await parseViaBrowser(browserInput);
      if (browserResult.success) {
        // 转换到标准响应格式
        return {
          success: true,
          platform: 'douyin',
          data: {
            title: browserResult.title || '',
            coverUrl: browserResult.coverUrl || '',
            videoUrl: browserResult.videoUrl || '',
            videoId: browserResult.videoId || videoId || '',
            author: { name: browserResult.author || '', avatar: browserResult.avatar || '' },
            source: 'douyin',
            type: 'video',
            duration: browserResult.duration || 0,
            statistics: {
              digg_count: browserResult.likes || 0,
              share_count: browserResult.shares || 0,
              comment_count: browserResult.comments || 0,
            },
          },
        };
      }
      // 浏览器解析失败不阻断——继续降级
      failReasons.push('浏览器:' + (browserResult.error || '失败'));
      if (browserResult.error && !browserResult.error.includes('格式')) {
        console.error('[抖音] 浏览器解析失败:', browserResult.error);
      }
    }

    // 第四步：尝试 HTML 页面解析（cheerio，基本被 JSVM 阻断）
    const pageResult = await fetchViaPage(targetUrl, videoId);
    if (pageResult.success) return pageResult;
    failReasons.push('Cheerio:' + (pageResult.error || '无数据'));

    // 第五步：lux Go CLI 解析（内置 X-Bogus 签名）
    // 构建干净 URL（去掉 tracking 参数避免 lux 混淆）
    const cleanUrl = videoId
      ? `https://www.douyin.com/video/${videoId}`
      : targetUrl.split('?')[0]; // 无 videoId 时仅保留 path
    const luxResult = await parseViaLux(cleanUrl);
    if (luxResult.success) return luxResult;
    console.error('[抖音] lux 解析失败:', luxResult.error);
    failReasons.push('lux:' + (luxResult.error || '失败'));

    // 第六步：第三方 API 降级
    // 在所有解析方式失败前，先打印完整诊断
    console.error('[抖音] 全部解析方式均失败:', failReasons.join(' → '));
    lastDiagnostics = {
      at: new Date().toISOString(),
      shareUrl,
      failReasons: failReasons.slice(),
    };
    return await fallbackToThirdParty(targetUrl, videoId, luxResult);
  } catch (err) {
    console.error('[抖音] 解析异常:', err.message, '| 诊断:', failReasons.join(' → '));
    lastDiagnostics = {
      at: new Date().toISOString(),
      shareUrl,
      exception: err.message,
      failReasons: failReasons.slice(),
    };
    return {
      success: false,
      platform: 'douyin',
      error: `解析失败: ${err.message}`,
    };
  }
}

/** 解析抖音短链接，获取完整 URL */
async function resolveShortUrl(shortUrl) {
  try {
    // maxRedirects: 0 —— 不跟随跳转，手动检查第一个 302 的 Location。
    // 抖音在数据中心/低信誉 IP 下会把短链 302 到首页（https://www.douyin.com，无视频 ID），
    // 跟随跳转只会落到首页拿不到 ID；手动取 Location 才能判断是否放行。
    const response = await axios.get(shortUrl, {
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 0,
      timeout: 10000,
    });
    return response.request.res.responseUrl || shortUrl;
  } catch (err) {
    // 3xx 重定向由 axios 抛错，Location 在 err.response.headers 里
    const location = err.response && err.response.headers && err.response.headers.location;
    if (location) {
      // 只有带视频 ID 的 Location 才有用（video/ 或 modal_id 或 share）
      if (/video\/\d{17,21}|modal_id=\d{17,21}|share\/video/i.test(location)) {
        return location;
      }
      // 被风控（Location 是首页等无 ID 地址）
      return null;
    }
    return null;
  }
}

/**
 * 直接调用抖音官方 API 获取视频信息
 *
 * 抖音 aweme API 曾需要 X-Gorgon/X-Khronos 签名，
 * 但部分场景下（合适的 UA + Cookie）仍可直连。
 */
async function fetchViaApi(videoId) {
  const apiUrls = [
    `https://www.iesdouyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}`,
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': DOUYIN_UA,
          Referer: 'https://www.douyin.com/',
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      const data = response.data;
      if (data && data.aweme_detail) {
        return extractFromAwemeDetail(data.aweme_detail, videoId);
      }
      if (data && data.aweme_details && data.aweme_details.length > 0) {
        return extractFromAwemeDetail(data.aweme_details[0], videoId);
      }
    } catch {
      // 继续尝试下一个 endpoint
    }
  }
  return { success: false };
}

/** 从 aweme_detail 对象中提取视频信息 */
function extractFromAwemeDetail(detail, videoId) {
  const video = detail.video;
  if (!video) return { success: false };

  // 无水印视频地址
  const playAddr = video.play_addr;
  let videoUrl = '';
  if (playAddr && playAddr.url_list && playAddr.url_list.length > 0) {
    videoUrl = playAddr.url_list[0]
      .replace('/playwm/', '/play/')
      .replace(/[?&]logo_name=[^&]+/, '')
      .replace(/^http:/, 'https:');
  }
  // 降级到下载地址
  if (!videoUrl) {
    const downloadAddr = video.download_addr;
    if (downloadAddr && downloadAddr.url_list && downloadAddr.url_list.length > 0) {
      videoUrl = downloadAddr.url_list[0];
    }
  }

  if (!videoUrl) return { success: false };

  const cover = video.cover;
  const coverUrl = (cover && cover.url_list && cover.url_list.length > 0) ? cover.url_list[0] : '';

  const author = detail.author || {};
  const authorAvatar = (author.avatar_thumb && author.avatar_thumb.url_list && author.avatar_thumb.url_list.length > 0)
    ? author.avatar_thumb.url_list[0] : '';

  return {
    success: true,
    platform: 'douyin',
    data: {
      title: detail.desc || '',
      coverUrl,
      videoUrl,
      videoId: detail.aweme_id || videoId,
      author: { name: author.nickname || '', avatar: authorAvatar },
      source: 'douyin',
      type: 'video',
      duration: video.duration ? Math.round(video.duration / 1000) : 0,
      statistics: detail.statistics || {},
    },
  };
}

/**
 * 通过 HTML 页面解析（cheerio + SSR 数据提取）
 *
 * 策略（按优先级降序）:
 *   1. RENDER_DATA（base64 SSR 状态数据）
 *   2. window._ROUTER_DATA
 *   3. window.__INITIAL_STATE__
 *   4. og:video / og:video:url 元标签
 *   5. JSON-LD（原有策略，最终后备）
 */
async function fetchViaPage(url, videoId) {
  try {
    // 优先请求 H5 分享页（iesdouyin.com/share）：该页面无 JSVM 反爬壳，
    // 内嵌完整 _ROUTER_DATA（含视频直链），数据中心 IP 亦可直连。
    // 原始 URL（www.douyin.com 等）作为回退候选。
    const pageCandidates = [];
    if (videoId) pageCandidates.push(`https://www.iesdouyin.com/share/video/${videoId}`);
    pageCandidates.push(url);

    let html = '';
    for (const candidate of pageCandidates) {
      try {
        const response = await axios.get(candidate, {
          headers: {
            'User-Agent': MOBILE_UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
          timeout: 15000,
        });
        html = response.data;
        // JSVM 挑战壳（无真实数据）跳过，继续下一个候选
        if (html && !html.includes('_$jsvmprt')) break;
      } catch {
        // 尝试下一个候选
      }
    }
    if (!html) return { success: false };

    const $ = cheerio.load(html);

    // ----- 策略 1: RENDER_DATA（base64 SSR） -----
    {
      const renderDataResult = extractFromRenderData(html, videoId);
      if (renderDataResult.success) return renderDataResult;
    }

    // ----- 策略 2: window._ROUTER_DATA -----
    {
      const routerDataResult = extractFromRouterData(html, videoId);
      if (routerDataResult.success) return routerDataResult;
    }

    // ----- 策略 3: window.__INITIAL_STATE__ -----
    {
      const initialStateResult = extractFromInitialState(html, videoId);
      if (initialStateResult.success) return initialStateResult;
    }

    // ----- 策略 4: og:video 元标签 -----
    {
      const ogResult = extractFromOgMeta($, videoId);
      if (ogResult.success) return ogResult;
    }

    // ----- 策略 5: JSON-LD（原有后备） -----
    {
      const ldResult = extractFromJsonLd($, videoId);
      if (ldResult.success) return ldResult;
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * 策略 1: 从 RENDER_DATA（base64 SSR 状态）提取视频信息
 *
 * 抖音 SSR 页面会在 window 上挂载 base64 编码的完整渲染状态：
 *   <script>window._RENDER_DATA_SSR = "base64字符串";</script>
 * 或
 *   <script>var RENDER_DATA = "base64字符串";</script>
 *
 * base64 解码后得到 JSON，包含 aweme 详细数据
 */
function extractFromRenderData(html, videoId) {
  try {
    // 匹配 window._RENDER_DATA_SSR 或 var RENDER_DATA
    const patterns = [
      /window\._RENDER_DATA_SSR\s*=\s*"([^"]+)"/,
      /window\._RENDER_DATA_SSR\s*=\s*'([^']+)'/,
      /RENDER_DATA\s*=\s*"([^"]+)"/,
      /RENDER_DATA\s*=\s*'([^']+)'/,
    ];

    let rawBase64 = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        rawBase64 = match[1];
        break;
      }
    }

    if (!rawBase64) return { success: false };

    // Base64 解码
    const decoded = Buffer.from(rawBase64, 'base64').toString('utf-8');
    if (!decoded) return { success: false };

    const state = JSON.parse(decoded);
    if (!state) return { success: false };

    // 递归查找 aweme detail 数据
    const videoInfo = deepFindVideoInState(state);
    if (videoInfo && videoInfo.videoUrl) {
      return {
        success: true,
        platform: 'douyin',
        data: {
          title: videoInfo.title || '',
          coverUrl: videoInfo.coverUrl || '',
          videoUrl: videoInfo.videoUrl.replace('/playwm/', '/play/').replace(/[?&]logo_name=[^&]+/, '').replace(/^http:/, 'https:'),
          videoId: videoInfo.videoId || videoId || '',
          author: { name: videoInfo.authorName || '', avatar: videoInfo.authorAvatar || '' },
          source: 'douyin',
          type: 'video',
          duration: videoInfo.duration || 0,
        },
      };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * 从 RENDER_DATA 解码后的状态树中递归查找视频信息
 */
function deepFindVideoInState(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 15) return null;
  if (depth === 0) {
    // 第一层可能是空对象包装或直接是数据
    // 尝试常见的抖动态数据路径
    const topLevel = obj;
    for (const key of Object.keys(topLevel)) {
      // 有时数据嵌套在第一层下
      const val = topLevel[key];
      if (val && typeof val === 'object') {
        const found = deepFindVideoInState(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  // 检查当前对象是否是 aweme detail
  if (obj.aweme_detail || obj.awemeDetails) {
    const detail = obj.aweme_detail || obj.awemeDetails;
    // detail 可能是数组或单个对象
    const items = Array.isArray(detail) ? detail : [detail];
    for (const item of items) {
      if (item && item.video) {
        return extractVideoFromAweme(item);
      }
    }
  }

  // 检查 aweme_list
  if (obj.aweme_list && Array.isArray(obj.aweme_list)) {
    for (const item of obj.aweme_list) {
      if (item && item.video) {
        return extractVideoFromAweme(item);
      }
    }
  }

  // 检查直接是 aweme 对象
  if (obj.video && (obj.desc !== undefined || obj.aweme_id)) {
    return extractVideoFromAweme(obj);
  }

  // 递归遍历子对象
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const found = deepFindVideoInState(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 从单个 aweme 对象中提取视频信息
 */
function extractVideoFromAweme(aweme) {
  if (!aweme || !aweme.video) return null;

  const video = aweme.video;
  const playAddr = video.play_addr;
  let videoUrl = '';
  if (playAddr && playAddr.url_list && playAddr.url_list.length > 0) {
    videoUrl = playAddr.url_list[0];
  }
  if (!videoUrl) {
    const downloadAddr = video.download_addr;
    if (downloadAddr && downloadAddr.url_list && downloadAddr.url_list.length > 0) {
      videoUrl = downloadAddr.url_list[0];
    }
  }

  if (!videoUrl) return null;

  const cover = video.cover;
  const coverUrl = (cover && cover.url_list && cover.url_list.length > 0) ? cover.url_list[0] : '';
  const author = aweme.author || {};
  const authorAvatar = (author.avatar_thumb && author.avatar_thumb.url_list && author.avatar_thumb.url_list.length > 0)
    ? author.avatar_thumb.url_list[0] : '';

  return {
    videoUrl,
    coverUrl,
    title: aweme.desc || '',
    videoId: aweme.aweme_id || '',
    authorName: author.nickname || '',
    authorAvatar,
    duration: video.duration ? Math.round(video.duration / 1000) : 0,
  };
}

/**
 * 策略 2: 从 window._ROUTER_DATA 提取
 *
 * 抖音 SPA 页面路由状态中可能包含视频详情：
 *   <script>window._ROUTER_DATA = { ... };</script>
 */
function extractFromRouterData(html, videoId) {
  try {
    // 分号可选：www.douyin.com 页面带分号，iesdouyin.com/share 分享页无分号
    const match = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/);
    if (!match || !match[1]) return { success: false };

    const routerData = JSON.parse(match[1]);
    if (!routerData || typeof routerData !== 'object') return { success: false };

    // 遍历路由状态，查找 videoList 或 detail 数据
    const videoInfo = traverseRouterData(routerData);
    if (videoInfo && videoInfo.videoUrl) {
      return {
        success: true,
        platform: 'douyin',
        data: {
          title: videoInfo.title || '',
          coverUrl: videoInfo.coverUrl || '',
          videoUrl: videoInfo.videoUrl.replace('/playwm/', '/play/').replace(/[?&]logo_name=[^&]+/, '').replace(/^http:/, 'https:'),
          videoId: videoInfo.videoId || videoId || '',
          author: { name: videoInfo.authorName || '', avatar: videoInfo.authorAvatar || '' },
          source: 'douyin',
          type: 'video',
          duration: videoInfo.duration || 0,
        },
      };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * 遍历 _ROUTER_DATA 结构查找视频数据
 * 常见结构: { route: { state: { videoList: [...] } } }
 */
function traverseRouterData(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 10) return null;

  // 直接检查有 aweme 字段的对象
  if (data.aweme_detail) {
    return extractVideoFromAweme(data.aweme_detail);
  }
  if (data.aweme_list && Array.isArray(data.aweme_list)) {
    for (const item of data.aweme_list) {
      if (item && item.video) return extractVideoFromAweme(item);
    }
  }
  if (data.videoList && Array.isArray(data.videoList)) {
    for (const item of data.videoList) {
      if (item && item.video) return extractVideoFromAweme(item);
    }
  }

  // H5 分享页结构: loaderData['video_(id)/page'].videoInfoRes.item_list[]
  if (data.videoInfoRes && Array.isArray(data.videoInfoRes.item_list)) {
    for (const item of data.videoInfoRes.item_list) {
      if (item && item.video) return extractVideoFromAweme(item);
    }
  }

  // 检查常见嵌套路径
  if (data.route && data.route.state) {
    const found = traverseRouterData(data.route.state, depth + 1);
    if (found) return found;
  }
  if (data.state) {
    const found = traverseRouterData(data.state, depth + 1);
    if (found) return found;
  }

  // 泛型递归
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      const found = traverseRouterData(data[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 策略 3: 从 window.__INITIAL_STATE__ 提取
 *
 * 老版抖音 SSR 页面可能包含 __INITIAL_STATE__：
 *   <script>window.__INITIAL_STATE__ = { ... };</script>
 */
function extractFromInitialState(html, videoId) {
  try {
    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (!match || !match[1]) return { success: false };

    const state = JSON.parse(match[1]);
    if (!state || typeof state !== 'object') return { success: false };

    // 遍历查找 aweme 数据
    const videoInfo = deepFindVideoInState(state);
    if (videoInfo && videoInfo.videoUrl) {
      return {
        success: true,
        platform: 'douyin',
        data: {
          title: videoInfo.title || '',
          coverUrl: videoInfo.coverUrl || '',
          videoUrl: videoInfo.videoUrl.replace('/playwm/', '/play/').replace(/[?&]logo_name=[^&]+/, '').replace(/^http:/, 'https:'),
          videoId: videoInfo.videoId || videoId || '',
          author: { name: videoInfo.authorName || '', avatar: videoInfo.authorAvatar || '' },
          source: 'douyin',
          type: 'video',
          duration: videoInfo.duration || 0,
        },
      };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * 策略 4: 从 og:video 元标签提取
 */
function extractFromOgMeta($, videoId) {
  try {
    const ogVideo = $('meta[property="og:video"]').attr('content') || '';
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content') || '';
    const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') || '';
    const videoUrl = ogVideo || ogVideoUrl || ogVideoSecure;

    if (!videoUrl) return { success: false };

    return {
      success: true,
      platform: 'douyin',
      data: {
        title: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
        coverUrl: $('meta[property="og:image"]').attr('content') || '',
        videoUrl: videoUrl.replace('/playwm/', '/play/').replace(/^http:/, 'https:'),
        videoId: videoId || '',
        author: { name: '', avatar: '' },
        source: 'douyin',
        type: 'video',
        duration: 0,
      },
    };
  } catch {
    return { success: false };
  }
}

/**
 * 策略 5: 从 JSON-LD（原有后备策略）提取
 */
function extractFromJsonLd($, videoId) {
  try {
    let videoData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const parsed = JSON.parse($(el).html());
        if (parsed && parsed.video) {
          videoData = parsed;
        }
      } catch { /* ignore */ }
    });

    if (videoData && videoData.video) {
      const contentUrl = videoData.video.contentUrl || '';
      if (contentUrl) {
        return {
          success: true,
          platform: 'douyin',
          data: {
            title: videoData.video.name || videoData.name || '',
            coverUrl: videoData.video.thumbnailUrl || '',
            videoUrl: contentUrl.replace('/playwm/', '/play/').replace(/^http:/, 'https:'),
            videoId: videoId || '',
            author: { name: '', avatar: '' },
            source: 'douyin',
            type: 'video',
            duration: 0,
          },
        };
      }
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

/** 降级到第三方 API（lux 已在之前尝试过） */
async function fallbackToThirdParty(pageUrl, videoId, luxResult) {
  try {
    const thirdPartyResult = await parseViaThirdParty(pageUrl, 'douyin');
    if (thirdPartyResult.success) return thirdPartyResult;
  } catch (apiErr) {
    console.error('[抖音] 第三方 API 也失败:', apiErr.message);

    // 所有解析链都失败了。lux 的错误（如 "Command failed"、"lux 未安装"）是
    // 内部实现细节，不应暴露给用户。统一返回友好提示。
    const friendlyMessage = luxResult && luxResult.error && luxResult.error.includes('未安装')
      ? '部分功能当前不可用（lux 解析工具未安装），可尝试其他视频'
      : '抖音解析暂时不可用，请稍后重试';
    return {
      success: false,
      platform: 'douyin',
      error: friendlyMessage,
    };
  }

  return {
    success: false,
    platform: 'douyin',
    error: '该视频可能需要登录或已失效，请检查链接是否正确',
  };
}

module.exports = { parse, getLastDiagnostics };

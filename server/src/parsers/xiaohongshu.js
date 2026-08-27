/**
 * 小红书解析器
 *
 * 小红书支持视频和图片两种内容类型，
 * 图片笔记返回图片列表，视频笔记返回视频地址
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { parseViaThirdParty } = require('../services/thirdPartyApi');
const { parseViaLux } = require('../services/luxParser');

/**
 * 清洗小红书图片 URL 为原图直链
 *
 * 小红书图床 URL 通常带缩略图后缀（低清 webp 压缩版）：
 *   https://sns-webpic-qc.xhscdn.com/xxx!nd_dft_wlteh_webp_3
 *   https://sns-webpic-qc.xhscdn.com/xxx!thumb
 * 去掉 "!" 及其后的后缀即得原图地址（高分辨率）。
 *
 * @param {string} url 原始图片 URL
 * @returns {string} 原图 URL（https）
 */
function cleanImageUrl(url) {
  if (!url) return '';
  let clean = url.trim();
  // 去掉缩略图后缀（! 开头的一段）
  const bangIdx = clean.indexOf('!');
  if (bangIdx > 0) {
    clean = clean.substring(0, bangIdx);
  }
  // 统一转 https
  if (clean.startsWith('http://')) {
    clean = clean.replace(/^http:\/\//, 'https://');
  }
  return clean;
}

/**
 * 从 imageList 单项中提取最高清原图 URL
 * 小红书结构: { urlDefault | url | infoList: [{ image: { url, width, height } }] }
 * infoList 按清晰度排列时取最大 width 的那一档
 */
function extractBestImageUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (img.urlDefault) return img.urlDefault;
  if (img.url) return img.url;
  if (Array.isArray(img.infoList) && img.infoList.length) {
    // 找 width 最大的版本（最高清）
    let best = null;
    let bestWidth = -1;
    for (const entry of img.infoList) {
      if (!entry || !entry.image || !entry.image.url) continue;
      const w = entry.image.width || 0;
      if (w > bestWidth) {
        bestWidth = w;
        best = entry.image.url;
      }
    }
    return best || '';
  }
  return '';
}

/**
 * 解析小红书分享链接
 * @param {string} shareUrl
 * @returns {Promise<object>}
 */
async function parse(shareUrl) {
  try {
    // 第一步：解析短链接，获取完整页面 URL
    const fullUrl = await resolveShortUrl(shareUrl);
    if (!fullUrl) {
      return {
        success: false,
        platform: 'xiaohongshu',
        error: '无法解析小红书链接',
      };
    }

    // 第二步：从页面中提取笔记内容
    const result = await scrapeNoteContent(fullUrl);
    if (result.success) return result;

    // 第三步：lux Go CLI 解析（在 Docker/CloudRun 环境中可用）
    const luxResult = await parseViaLux(fullUrl);
    if (luxResult.success) return luxResult;
    console.error('[小红书] lux 解析失败:', luxResult.error);

    // 第四步：第三方 API 降级
    try {
      const thirdPartyResult = await parseViaThirdParty(shareUrl, 'xiaohongshu');
      if (thirdPartyResult.success) return thirdPartyResult;
    } catch (apiErr) {
      console.error('[小红书] 第三方 API 也失败:', apiErr.message);

      if (apiErr.message && apiErr.message.includes('未配置')) {
        // 第三方 API 未配置，统一返回通用文案（不泄露内部错误）
        return {
          success: false,
          platform: 'xiaohongshu',
          error: '小红书解析暂时不可用，请稍后重试',
        };
      }
    }

    // 所有方式均失败
    return {
      success: false,
      platform: 'xiaohongshu',
      error: '小红书解析暂时不可用，请稍后重试',
    };
  } catch (err) {
    console.error('[小红书] 解析失败:', err.message);
    return {
      success: false,
      platform: 'xiaohongshu',
      error: '小红书解析暂时不可用，请稍后重试',
    };
  }
}

/**
 * 解析小红书短链接 (xhslink.com)
 */
async function resolveShortUrl(url) {
  try {
    // 小红书短链域名历史上用过 xhslink.com，现在是 xhslink.cn
    if (!/xhslink\.(com|cn)/i.test(url)) {
      return url;
    }

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
      maxRedirects: 5,
      timeout: 10000,
    });

    return response.request.res.responseUrl || url;
  } catch {
    return null;
  }
}

/**
 * 从小红书页面中提取笔记内容
 *
 * ⚠️ 小红书有较强的反爬机制，常见表现：
 *   - 返回空白页面或验证码页面（需 Cookie）
 *   - 请求频率过高（401/429）
 *   - window.__INITIAL_STATE__ 为空（客户端渲染）
 *
 * 优化措施：
 *   - 提取 Cookie 并在重试时复用
 *   - 检测反爬/频率限制并给出友好提示
 */
async function scrapeNoteContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.xiaohongshu.com/',
      },
      timeout: 15000,
    });

    const html = response.data;

    // 检测反爬/频率限制
    const rateLimitCheck = detectRateLimit(html, response.status);
    if (rateLimitCheck) {
      return {
        success: false,
        platform: 'xiaohongshu',
        error: rateLimitCheck,
      };
    }

    // 提取响应中的 Cookie 以备可能的 retry
    const setCookies = response.headers['set-cookie'];
    const cookieStr = setCookies ? extractCookies(setCookies) : null;

    const $ = cheerio.load(html);

    // 从页面中提取笔记标题
    const title = $('title').text().replace(' - 小红书', '') || $('meta[property="og:title"]').attr('content') || '';

    // 尝试提取 JSON-LD 数据
    let noteData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data && data.description) {
          noteData = data;
        }
      } catch (e) { /* ignore */ }
    });

    // 从页面中提取图片列表（清洗缩略图后缀，取原图）
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && src.includes('xhscdn.com') && !src.includes('avatar') && !src.includes('icon')) {
        const clean = cleanImageUrl(src);
        if (clean) images.push(clean);
      }
    });

    // 从 meta 标签提取信息
    const description = $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const ogVideo = $('meta[property="og:video"]').attr('content') || '';
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content') || '';

    // 从页面中提取 window.__INITIAL_STATE__ 数据
    // 注意：不能用正则 `{[\s\S]*?};` 匹配 —— SSR JSON 内嵌字符串（如 launchAppConfig）会截断
    // 用括号配平 + 字符串状态跟踪，并清洗 SSR 内嵌的 undefined
    let initialState = null;
    $('script').each((i, el) => {
      const text = $(el).html() || '';
      const marker = 'window.__INITIAL_STATE__=';
      const markerIdx = text.indexOf(marker);
      if (markerIdx < 0) return;
      try {
        const seg = text.slice(markerIdx + marker.length);
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let j = 0; j < seg.length; j++) {
          const c = seg[j];
          if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
          }
          if (c === '"') { inStr = true; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
        }
        if (end > 0) {
          const json = seg.slice(0, end + 1)
            .replace(/:\s*undefined\b/g, ':null')
            .replace(/,\s*undefined\b/g, ',null');
          initialState = JSON.parse(json);
        }
      } catch (e) { /* ignore */ }
    });

    // 尝试从 initialState 中提取视频/图片信息
    let videoUrl = ogVideo || ogVideoUrl;
    let noteTitle = '';
    let authorName = '';
    let coverFromState = '';
    // SSR 图片列表（原图直链）—— 优先于页面 <img> 扫描
    let stateImages = [];
    if (initialState) {
      // 遍历查找笔记对象（视频笔记取 video.stream，图片笔记取 imageList）
      try {
        const note = findNoteInState(initialState);
        if (note) {
          noteTitle = note.title || note.desc || '';
          authorName = note.user && note.user.nickName ? note.user.nickName : '';
          if (note.cover && note.cover.fileId) {
            coverFromState = cleanImageUrl(`https://sns-webpic-qc.xhscdn.com/${note.cover.fileId}`);
          }
          // 视频笔记
          if (!videoUrl && note.video && note.video.media && note.video.media.stream) {
            videoUrl = extractVideoUrl(note.video.media.stream);
          }
          // 图片笔记：从 imageList 提取原图直链
          // 小红书 2024+ 结构: note.imageList[] → { urlDefault | infoList[].image.url }
          if (Array.isArray(note.imageList)) {
            for (const img of note.imageList) {
              if (!img) continue;
              // 提取最高清版本并清洗缩略图后缀（取原图分辨率）
              const rawUrl = extractBestImageUrl(img);
              const imgUrl = cleanImageUrl(rawUrl);
              if (imgUrl) {
                stateImages.push(imgUrl);
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 微信要求 https，xhscdn 直链为 http，统一转 https
    if (videoUrl && videoUrl.startsWith('http://')) {
      videoUrl = videoUrl.replace(/^http:\/\//, 'https://');
    }

    // 如果 __INITIAL_STATE__ 提取到但无视频/图片，可能是 SSR 数据不完整
    // 尝试使用 Cookie 重新请求（若有新 Cookie）
    if (!initialState && !ogImage && !images.length && !videoUrl && cookieStr) {
      return await retryWithCookie(url, cookieStr);
    }

    // 判断类型
    const isVideo = !!videoUrl;

    if (isVideo) {
      return {
        success: true,
        platform: 'xiaohongshu',
        data: {
          title: noteTitle || title || description || '',
          coverUrl: ogImage || coverFromState || (images.length > 0 ? images[0] : ''),
          videoUrl: videoUrl,
          noteId: extractNoteId(url),
          source: 'xiaohongshu',
          type: 'video',
          description: description,
          author: authorName ? { name: authorName } : undefined,
        },
      };
    }

    // 图片笔记
    // 合并 SSR 原图列表 + 页面扫描图（去重），SSR 原图优先
    const allImages = [];
    const seenImg = new Set();
    for (const u of [...stateImages, ...images]) {
      if (u && !seenImg.has(u)) {
        seenImg.add(u);
        allImages.push(u);
      }
    }
    const finalImages = allImages.length > 0 ? allImages : (ogImage ? [cleanImageUrl(ogImage)] : []);

    return {
      success: true,
      platform: 'xiaohongshu',
      data: {
        title: title || noteTitle || description || '',
        coverUrl: ogImage || coverFromState || (finalImages.length > 0 ? finalImages[0] : ''),
        images: finalImages,
        noteId: extractNoteId(url),
        source: 'xiaohongshu',
        type: 'image',
        description: description,
        text: $('meta[property="og:description"]').attr('content') || '',
      },
    };
  } catch (err) {
    console.error('[小红书] 解析失败:', err.message);
    return {
      success: false,
      platform: 'xiaohongshu',
      error: '小红书解析暂时不可用，请稍后重试',
    };
  }
}

/**
 * 从 initialState 中查找笔记对象（深度优先）
 *
 * 小红书 SSR 结构（2024+）：noteData.data.noteData
 * 笔记对象特征：含 noteId 且有 video（视频笔记）或 imageList（图片笔记）字段
 *
 * 注意：不能用「键名含 note」匹配 —— SSR 里存在 errorNoteData 等空对象会抢先命中
 */
function findNoteInState(state) {
  if (!state || typeof state !== 'object') return null;

  // 当前节点就是笔记对象
  if (state.noteId && (state.video || state.imageList)) return state;

  if (Array.isArray(state)) {
    for (const item of state) {
      const r = findNoteInState(item);
      if (r) return r;
    }
    return null;
  }

  for (const key of Object.keys(state)) {
    const val = state[key];
    if (val && typeof val === 'object') {
      const r = findNoteInState(val);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 从视频 stream 对象中提取可播放直链
 *
 * 2024+ 结构：stream.h264[0].masterUrl（h264/h265/av1/h266 按编码分组）
 * 旧结构兜底：stream.master_url / stream[0].url
 *
 * 优先级：h264（兼容性最好）→ h265 → av1 → 旧字段
 */
function extractVideoUrl(stream) {
  if (!stream || typeof stream !== 'object') return '';

  for (const codec of ['h264', 'h265', 'av1', 'h266']) {
    const group = stream[codec];
    if (Array.isArray(group) && group.length) {
      const first = group[0];
      if (first && first.masterUrl) return first.masterUrl;
    }
  }

  if (stream.master_url) return stream.master_url;
  if (Array.isArray(stream) && stream.length && stream[0] && stream[0].url) return stream[0].url;
  return '';
}

/**
 * 从 URL 中提取笔记 ID
 */
function extractNoteId(url) {
  const match = url.match(/explore\/([a-f0-9]+)/);
  if (match) return match[1];
  const match2 = url.match(/discovery\/item\/([a-f0-9]+)/);
  return match2 ? match2[1] : '';
}

/**
 * 检测反爬/频率限制
 *
 * 小红书反爬标志：
 *   - HTTP 状态码 429（Too Many Requests）
 *   - HTTP 状态码 401（Unauthorized / 被拦截）
 *   - 页面主体包含"访问被拒绝"、"请登录"、"验证"等关键词
 *   - 返回非常短的 HTML（反爬页面）或包含大量随机 class 名
 */
function detectRateLimit(html, statusCode) {
  if (statusCode === 429) {
    return '请求频率过高，小红书拒绝了请求，请稍后再试';
  }
  if (statusCode === 401 || statusCode === 403) {
    return '小红书拒绝了访问，可能需要登录 Cookie';
  }

  if (!html || html.length < 200) {
    return '小红书页面返回空内容，可能已被反爬拦截';
  }

  // 检查中英文反爬关键词
  const lowerHtml = html.toLowerCase();
  const blockKeywords = [
    '访问被拒绝', '请登录', '验证码', '人类验证',
    'access denied', 'captcha', 'too many requests',
    'please login', '请重新验证',
  ];

  for (const keyword of blockKeywords) {
    if (lowerHtml.includes(keyword)) {
      return '小红书检测到异常访问，请求已被拦截';
    }
  }

  // 检测页面是否含有丰富的内容（SSR 正常页面应有数据结构）
  const hasNormalContent = html.includes('__INITIAL_STATE__') || html.includes('og:title') || html.includes('note');
  if (!hasNormalContent && html.length < 5000) {
    return '小红书页面未包含有效内容，可能触发了反爬机制';
  }

  return null;
}

/**
 * 从 set-cookie 数组中提取 Cookie 字符串
 */
function extractCookies(setCookieHeaders) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) {
    return null;
  }
  return setCookieHeaders
    .map(c => c.split(';')[0]) // 取每个 cookie 的 name=value 部分
    .filter(c => c.includes('='))
    .join('; ');
}

/**
 * 携带 Cookie 重新请求小红书页面
 * 某些情况下首次请求获得的 Cookie 可解锁后续请求
 */
async function retryWithCookie(url, cookieStr) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.xiaohongshu.com/',
        'Cookie': cookieStr,
      },
      timeout: 15000,
    });

    const html = response.data;

    // 再次检测反爬
    const rateLimitCheck = detectRateLimit(html, response.status);
    if (rateLimitCheck) {
      return {
        success: false,
        platform: 'xiaohongshu',
        error: rateLimitCheck,
      };
    }

    const $ = cheerio.load(html);

    // 尝试提取
    const title = $('title').text().replace(' - 小红书', '') || $('meta[property="og:title"]').attr('content') || '';
    const description = $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const ogVideo = $('meta[property="og:video"]').attr('content') || '';
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content') || '';

    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && src.includes('xhscdn.com') && !src.includes('avatar') && !src.includes('icon')) {
        images.push(src);
      }
    });

    const videoUrl = ogVideo || ogVideoUrl;

    if (videoUrl) {
      return {
        success: true,
        platform: 'xiaohongshu',
        data: {
          title: title || description || '',
          coverUrl: ogImage || (images.length > 0 ? images[0] : ''),
          videoUrl: videoUrl,
          noteId: extractNoteId(url),
          source: 'xiaohongshu',
          type: 'video',
          description: description,
        },
      };
    }

    if (images.length > 0) {
      return {
        success: true,
        platform: 'xiaohongshu',
        data: {
          title: title || description || '',
          coverUrl: ogImage || images[0],
          images: images,
          noteId: extractNoteId(url),
          source: 'xiaohongshu',
          type: 'image',
          description: description,
          text: $('meta[property="og:description"]').attr('content') || '',
        },
      };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

module.exports = { parse };

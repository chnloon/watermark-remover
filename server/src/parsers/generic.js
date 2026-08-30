/**
 * 通用网页视频提取器（增强版）
 *
 * 抓取任意网页 HTML，多层次扫描页面中可下载的视频来源：
 *   1. 结构化 meta/link：og:video 系列、twitter:player:stream、itemprop=contentUrl、
 *      <link rel=preload as=video> / prefetch 指向视频文件
 *   2. <video>/<source> 标签（含 data-src / data-url 等懒加载属性）
 *   3. <script> 内嵌数据挖矿：window.__INITIAL_STATE__ / __NEXT_DATA__ / __NUXT__ 等，
 *      以及所有含 .mp4/.m3u8 的字符串字面量 —— 覆盖 SSR/SSG 站点把真实视频地址
 *      预渲染进页面的场景，无需执行 JS
 *   4. <a> 链接指向视频文件
 *   5. <iframe> 内嵌播放器页面递归扫描一层（如 YouTube embed）
 *
 * 找到的候选会做轻量可用性探测（携带页面站域 Referer），过滤广告/失效链接；
 * m3u8 候选交由 m3u8video 解析出最高码率子流。
 *
 * 返回 data.type = 'video'（单视频）或 'list'（多视频），附 pageUrl 供反代携带 Referer。
 */
const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');

const FETCH_TIMEOUT = 15000;
const PROBE_TIMEOUT = 6000;
const IFRAME_TIMEOUT = 8000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 常见的视频文件扩展名（用于扫描 <a> 标签 / 内嵌数据）
const VIDEO_EXTENSIONS = ['.mp4', '.ts', '.m3u8', '.webm', '.mkv', '.mov', '.flv', '.wmv', '.ogg', '.ogv'];

// 广告/跟踪域名黑名单（候选 URL 命中即丢弃，避免把广告素材当视频返回）
const AD_HOSTS = [
  'googleadservices.com', 'doubleclick.net', 'googlesyndication.com',
  'amazon-adsystem.com', 'adservice.google.com', 'adsystem.com',
  'adnxs.com', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com',
  'hm.baidu.com', 'cnzz.com', 'umeng.com', 'analytics.',
  'tracking.', 'mmstat.com', 'monitor.', 'report.', 'log.',
];

/**
 * 判断 URL 是否指向视频文件
 */
function isVideoUrl(linkUrl) {
  const lower = String(linkUrl || '').toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
}

/**
 * 判断 URL 是否为 M3U8
 */
function isM3u8Url(linkUrl) {
  return /\.m3u8([?#]|$)/i.test(String(linkUrl || ''));
}

/**
 * 提取文件名（用于显示）
 */
function extractFileName(linkUrl) {
  try {
    const parsed = new URL(linkUrl);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    return pathSegments[pathSegments.length - 1] || linkUrl;
  } catch {
    return linkUrl;
  }
}

/**
 * 从 URL 推断视频格式
 */
// 嵌入播放器页面（HTML 播放器壳，不是视频流）：og:video / twitter:player
// 常指向这类地址，小程序 video 组件无法播放，直接过滤避免误报
function isEmbedPageUrl(linkUrl) {
  try {
    const u = new URL(linkUrl);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.startsWith('player.')) return true;
    if (/player\.(html|php|aspx)$/i.test(path)) return true;
    if (path === '/embed' || path.startsWith('/embed/')) return true;
    return false;
  } catch {
    return false;
  }
}

function inferFormat(linkUrl) {
  const lower = String(linkUrl || '').toLowerCase();
  if (lower.includes('.m3u8')) return 'M3U8';
  if (lower.includes('.ts')) return 'TS';
  if (lower.includes('.mp4')) return 'MP4';
  if (lower.includes('.webm')) return 'WebM';
  if (lower.includes('.mkv')) return 'MKV';
  if (lower.includes('.mov')) return 'MOV';
  if (lower.includes('.flv')) return 'FLV';
  if (lower.includes('.ogg') || lower.includes('.ogv')) return 'OGG';
  return '视频';
}

/**
 * 解析相对 URL
 * 兼容 script 内嵌数据的转义写法（https:\/\/cdn\/a.mp4、\/\/cdn\/a.mp4）
 */
function resolveUrl(baseUrl, relativePath) {
  if (!relativePath) return null;
  if (relativePath.includes('\\/')) relativePath = relativePath.replace(/\\+\//g, '/');
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  // data: URI 跳过
  if (relativePath.startsWith('data:')) return null;
  // // 开头的协议相对 URL
  if (relativePath.startsWith('//')) {
    try {
      const parsed = new URL(baseUrl);
      return parsed.protocol + relativePath;
    } catch {
      return 'https:' + relativePath;
    }
  }
  try {
    return url.resolve(baseUrl, relativePath);
  } catch {
    return null;
  }
}

/**
 * 是否广告/跟踪域名
 */
function isAdUrl(linkUrl) {
  const lower = String(linkUrl || '').toLowerCase();
  return AD_HOSTS.some((h) => lower.includes(h));
}

/**
 * 抓取网页 HTML
 */
async function fetchHtml(inputUrl, timeout, maxLen) {
  const resp = await axios.get(inputUrl, {
    timeout: timeout || FETCH_TIMEOUT,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    responseType: 'text',
    maxRedirects: 5,
    maxContentLength: maxLen || 1024 * 1024,
  });
  return resp.data;
}

const META_SELECTORS = [
  'meta[property="og:video"]',
  'meta[property="og:video:url"]',
  'meta[property="og:video:secure_url"]',
  'meta[name="og:video"]',
  'meta[name="og:video:url"]',
  'meta[name="twitter:player"]',
  'meta[name="twitter:player:stream"]',
  'meta[itemprop="contentUrl"]',
  'meta[itemprop="embedURL"]',
];

// <video>/<source> 常见的懒加载属性
const LAZY_ATTRS = ['data-src', 'data-url', 'data-video', 'data-source', 'data-sources', 'data-lazy-src', 'data-original'];

/**
 * 扫描页面（静态部分），收集视频候选
 * 返回 { items, pageTitle, coverUrl, description, hasBlobHint }
 */
async function collectCandidates(html, pageUrl) {
  const items = [];
  const seen = new Set();
  let hasBlobHint = false;

  function addItem(videoUrl, opts) {
    const o = opts || {};
    if (!videoUrl) return;
    const resolved = resolveUrl(o.base || pageUrl, videoUrl);
    if (!resolved || resolved.startsWith('data:') || resolved.startsWith('blob:') || isAdUrl(resolved) || isEmbedPageUrl(resolved)) return;
    // 去掉 hash 去重（同文件不同锚点）
    const key = resolved.split('#')[0];
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      url: resolved,
      title: o.title || extractFileName(resolved),
      format: inferFormat(resolved),
      isM3u8: isM3u8Url(resolved),
      coverUrl: o.cover || null,
      score: o.score || 50,
    });
  }

  const $ = cheerio.load(html);
  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="og:image"]').attr('content') ||
    $('link[rel="image_src"]').attr('href') ||
    '';
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const pageTitle = $('title').text().trim() || ogTitle || '';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  // 1. 结构化 meta / link
  for (const sel of META_SELECTORS) {
    $(sel).each((_, el) => {
      const c = $(el).attr('content') || $(el).attr('href');
      if (c) addItem(c, { title: pageTitle, cover: ogImage, score: 95 });
    });
  }
  $('link[rel="preload"], link[rel="prefetch"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && isVideoUrl(href)) addItem(href, { title: pageTitle, cover: ogImage, score: 88 });
  });

  // 2. <video> 标签及其 <source> 子标签（含懒加载属性）
  $('video').each((_, el) => {
    const $el = $(el);
    const poster = $el.attr('poster') || ogImage;
    for (const attr of ['src'].concat(LAZY_ATTRS)) {
      const v = $el.attr(attr);
      if (v) addItem(v, { title: pageTitle, cover: poster, score: 100 });
    }
    $el.find('source').each((__, sourceEl) => {
      const $s = $(sourceEl);
      for (const attr of ['src'].concat(LAZY_ATTRS)) {
        const v = $s.attr(attr);
        if (v) addItem(v, { title: pageTitle, cover: poster, score: 100 });
      }
    });
  });

  // 3. <script> 内嵌数据挖矿（SSR/SSG 站点常把真实视频地址预渲染进 JSON，无需执行 JS）
  const scriptParts = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html))) scriptParts.push(sm[1]);
  const corpus = scriptParts.join('\n').replace(/\\+\//g, '/');
  // blob 流检测：`blob:` 字样可能出现在 video 标签 src 或 script 中，
  // 命中后提示用户该页视频由浏览器动态生成、服务端无法抓取
  if (/blob:/i.test(html)) hasBlobHint = true;
  const litRe = /["']((?:https?:)?\/\/[^"'\s\\]+?\.(?:mp4|m3u8|webm|mkv|mov|flv|ts)(?:\?[^"'\s\\]*)?)["']/gi;
  let lm;
  while ((lm = litRe.exec(corpus))) addItem(lm[1], { title: pageTitle, cover: ogImage, score: 75 });

  // 4. <a> 标签链接到视频文件
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !isVideoUrl(href)) return;
    const linkText = $(el).text().trim();
    addItem(href, { title: linkText || extractFileName(href), cover: ogImage, score: 55 });
  });

  // 5. <iframe> 内嵌播放器递归扫描一层（限 3 个，如 YouTube embed / 各站外链播放器）
  const iframeSrcs = [];
  $('iframe[src]').each((_, el) => {
    const s = $(el).attr('src');
    if (s) iframeSrcs.push(s);
  });
  const uniqueIframes = [...new Set(iframeSrcs.map((s) => resolveUrl(pageUrl, s)).filter(Boolean))].slice(0, 3);
  for (const iframeUrl of uniqueIframes) {
    if (isAdUrl(iframeUrl)) continue;
    try {
      const iframeHtml = await fetchHtml(iframeUrl, IFRAME_TIMEOUT, 512 * 1024);
      const $2 = cheerio.load(iframeHtml);
      const iframeTitle = $2('title').text().trim() || pageTitle;

      for (const sel of META_SELECTORS) {
        $2(sel).each((_, el) => {
          const c = $2(el).attr('content') || $2(el).attr('href');
          if (c) addItem(c, { base: iframeUrl, title: iframeTitle, cover: ogImage, score: 65 });
        });
      }
      $2('video').each((_, el) => {
        const $v = $2(el);
        const poster = $v.attr('poster') || ogImage;
        for (const attr of ['src'].concat(LAZY_ATTRS)) {
          const v = $v.attr(attr);
          if (v) addItem(v, { base: iframeUrl, title: iframeTitle, cover: poster, score: 65 });
        }
        $v.find('source').each((__, se) => {
          for (const attr of ['src'].concat(LAZY_ATTRS)) {
            const s2 = $2(se).attr(attr);
            if (s2) addItem(s2, { base: iframeUrl, title: iframeTitle, cover: poster, score: 65 });
          }
        });
      });
      // iframe 页面内嵌 script 挖矿
      const iframeScripts = [];
      const isRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let ism;
      while ((ism = isRe.exec(iframeHtml))) iframeScripts.push(ism[1]);
      const iframeCorpus = iframeScripts.join('\n').replace(/\\+\//g, '/');
      let im;
      while ((im = litRe.exec(iframeCorpus))) addItem(im[1], { base: iframeUrl, title: iframeTitle, cover: ogImage, score: 60 });
    } catch {
      // iframe 抓取失败忽略，不影响主页面结果
    }
  }

  return { items, pageTitle, coverUrl: ogImage, description, hasBlobHint };
}

/**
 * 探测单个候选 URL 的可用性（携带页面站域 Referer 对抗防盗链）
 * 返回 'ok'（可访问且像视频）/ 'weak'（403 防盗链，保留降权）/ 'bad'（失效）
 */
async function probeItem(item, pageUrl) {
  try {
    const resp = await axios.get(item.url, {
      timeout: PROBE_TIMEOUT,
      headers: {
        'User-Agent': UA,
        Referer: pageUrl,
        Range: 'bytes=0-0',
        Accept: '*/*',
      },
      maxRedirects: 3,
      responseType: 'arraybuffer',
      maxContentLength: 300 * 1024,
      validateStatus: (s) => s === 200 || s === 206,
    });
    const ct = (resp.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) return 'bad'; // 重定向到页面 = 无效
    const looksVideo =
      ct.includes('video') ||
      ct.includes('mpegurl') ||
      ct.includes('octet-stream') ||
      ct.includes('mp4') ||
      ct.includes('quicktime') ||
      ct.includes('webm');
    return looksVideo || isVideoUrl(item.url) ? 'ok' : 'bad';
  } catch (err) {
    const status = err && err.response && err.response.status;
    // 403/401 多为防盗链（代理端还能补救），保留降权；其余失败丢弃
    return status === 403 || status === 401 ? 'weak' : 'bad';
  }
}

/**
 * 对候选排序、探测过滤，m3u8 解析出最高码率子流
 * @returns {Promise<Array>} 按可信度排序的最终列表（≤8 个）
 */
async function rankItems(items, pageUrl) {
  items.sort((a, b) => b.score - a.score);
  const top = items.slice(0, 12);

  const results = await Promise.all(top.map((it) => probeItem(it, pageUrl)));
  const good = [];
  const weak = [];
  top.forEach((it, i) => {
    const r = results[i];
    if (r === 'ok') good.push(it);
    else if (r === 'weak') weak.push(it);
  });

  const resolved = [];
  for (const it of good.concat(weak)) {
    if (it.isM3u8) {
      try {
        const m3 = await require('./m3u8video').parse(it.url);
        if (m3.success && m3.data && m3.data.videoUrl) {
          resolved.push({
            ...it,
            url: m3.data.videoUrl,
            title: m3.data.title || it.title,
            description: m3.data.description || '',
          });
          continue;
        }
      } catch {
        // m3u8 解析失败则保留原地址，前端 HLS 直播仍可能可用
      }
    }
    resolved.push(it);
  }
  return resolved.slice(0, 8);
}

/**
 * 主解析入口
 *
 * @param {string} inputUrl - 任意网页 URL
 * @returns {Promise<{success: boolean, platform: string, data?: object, error?: string}>}
 */
async function parse(inputUrl) {
  try {
    // 如果是直接 M3U8 URL，转给 m3u8video parser
    if (isM3u8Url(inputUrl)) {
      const m3u8Parser = require('./m3u8video');
      return await m3u8Parser.parse(inputUrl);
    }

    // 如果是直接视频文件 URL（.mp4, .ts 等），直接返回
    if (isVideoUrl(inputUrl) && !isM3u8Url(inputUrl)) {
      const fileName = extractFileName(inputUrl);
      return {
        success: true,
        platform: 'generic',
        data: {
          type: 'video',
          title: fileName,
          videoUrl: inputUrl,
          coverUrl: '',
          description: `直接视频链接: ${fileName}`,
        },
      };
    }

    // 抓取网页 HTML
    const html = await fetchHtml(inputUrl);
    if (!html) {
      return {
        success: false,
        platform: 'generic',
        error: '获取网页内容为空，请检查链接是否有效',
      };
    }

    const { items, pageTitle, coverUrl, description, hasBlobHint } = await collectCandidates(html, inputUrl);

    // 没有找到任何候选
    if (items.length === 0) {
      let reason = '在网页中未找到可下载的视频资源。\n';
      if (hasBlobHint) {
        reason +=
          '• 该页面视频由浏览器动态生成（blob 流），服务端无法直接抓取，\n' +
          '  请尝试在电脑浏览器安装 FetchV 等视频下载插件，或提供 M3U8 / .mp4 直链';
      } else {
        reason +=
          '• 视频需要登录后才能观看\n' +
          '• 视频由 JavaScript 动态加载（此工具不执行 JS）\n' +
          '• 页面中确实没有视频内容\n\n' +
          '提示：可以尝试直接粘贴 M3U8 地址或 .mp4 直链';
      }
      return { success: false, platform: 'generic', error: reason };
    }

    const finalItems = await rankItems(items, inputUrl);

    // 探测后全部失效：仍返回最高分候选，交给播放代理尽力而为
    const fallback = finalItems.length > 0 ? finalItems : items.sort((a, b) => b.score - a.score).slice(0, 1);

    // 单视频返回 type: 'video'
    if (fallback.length === 1) {
      const item = fallback[0];
      return {
        success: true,
        platform: 'generic',
        data: {
          type: 'video',
          title: item.title || pageTitle || '视频',
          videoUrl: item.url,
          coverUrl: item.coverUrl || coverUrl || '',
          description: description || pageTitle || '',
          // 供 /api/parse 构造反代 Referer 参数
          pageUrl: inputUrl,
        },
      };
    }

    // 多视频返回 type: 'list'
    return {
      success: true,
      platform: 'generic',
      data: {
        type: 'list',
        title: pageTitle || '视频列表',
        coverUrl: coverUrl || '',
        description: description || `在网页中找到 ${fallback.length} 个视频`,
        pageUrl: inputUrl,
        items: fallback.map((item, index) => ({
          id: index + 1,
          url: item.url,
          title: item.title || `视频 ${index + 1}`,
          format: item.format,
          coverUrl: item.coverUrl || coverUrl || '',
          isM3u8: item.isM3u8,
        })),
      },
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return {
        success: false,
        platform: 'generic',
        error: '获取网页超时，请检查链接或网络',
      };
    }
    if (err.response) {
      const status = err.response.status;
      if (status === 404) {
        return {
          success: false,
          platform: 'generic',
          error: '网页不存在（404），请检查链接是否正确',
        };
      }
      if (status === 403) {
        return {
          success: false,
          platform: 'generic',
          error: '该网页需要登录或权限验证，无法访问',
        };
      }
      return {
        success: false,
        platform: 'generic',
        error: `服务器返回错误 (${status})，请稍后重试`,
      };
    }
    return {
      success: false,
      platform: 'generic',
      error: '网页解析失败，请稍后重试',
    };
  }
}

module.exports = { parse };

/**
 * 通用网页视频提取器
 *
 * 抓取任意网页 HTML，用 cheerio 扫描页面中所有可下载的视频来源：
 *   - <video> 标签及其 <source> 子标签
 *   - <a> 链接指向 .mp4 / .ts / .m3u8 等视频文件
 *   - <meta property="og:video"> / <meta property="og:video:url">
 *   - 页面标题 / og:image 作为封面和标题
 *
 * 返回 data.type = 'video'（单视频）或 'list'（多视频）。
 */
const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');

const FETCH_TIMEOUT = 15000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 常见的视频文件扩展名（用于扫描 <a> 标签）
const VIDEO_EXTENSIONS = ['.mp4', '.ts', '.m3u8', '.webm', '.mkv', '.mov', '.avi', '.flv', '.wmv'];

/**
 * 判断 URL 是否指向视频文件
 */
function isVideoUrl(linkUrl) {
  const lower = linkUrl.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
}

/**
 * 判断 URL 是否为 M3U8
 */
function isM3u8Url(linkUrl) {
  return linkUrl.toLowerCase().includes('.m3u8');
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
function inferFormat(linkUrl) {
  const lower = linkUrl.toLowerCase();
  if (lower.includes('.m3u8')) return 'M3U8';
  if (lower.includes('.ts')) return 'TS';
  if (lower.includes('.mp4')) return 'MP4';
  if (lower.includes('.webm')) return 'WebM';
  if (lower.includes('.mkv')) return 'MKV';
  if (lower.includes('.mov')) return 'MOV';
  if (lower.includes('.flv')) return 'FLV';
  return '视频';
}

/**
 * 解析相对 URL
 */
function resolveUrl(baseUrl, relativePath) {
  if (!relativePath) return null;
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
 * 从 HTML 中扫描所有视频来源
 */
function scanPageForVideos($, pageUrl) {
  const items = [];
  const seenUrls = new Set();

  function addItem(videoUrl, titleHint, coverHint) {
    const resolved = resolveUrl(pageUrl, videoUrl);
    if (!resolved) return;
    // 跳过 data: URI
    if (resolved.startsWith('data:')) return;
    if (seenUrls.has(resolved)) return;
    seenUrls.add(resolved);

    items.push({
      url: resolved,
      title: titleHint || extractFileName(resolved),
      format: inferFormat(resolved),
      isM3u8: isM3u8Url(resolved),
      coverUrl: coverHint || null,
    });
  }

  // 1. <meta property="og:video"> / <meta property="og:video:url">
  const ogVideo =
    $('meta[property="og:video"]').attr('content') ||
    $('meta[property="og:video:url"]').attr('content') ||
    $('meta[name="og:video"]').attr('content') ||
    $('meta[name="og:video:url"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const pageTitle = $('title').text().trim() || ogTitle;

  if (ogVideo) {
    addItem(ogVideo, pageTitle, ogImage);
  }

  // 2. <video> 标签及其 <source> 子标签
  $('video').each((_, el) => {
    const $el = $(el);
    const poster = $el.attr('poster');

    // <video src="...">
    const videoSrc = $el.attr('src');
    if (videoSrc) {
      addItem(videoSrc, pageTitle, poster || ogImage);
    }

    // <video><source src="..."></video>
    $el.find('source').each((__, sourceEl) => {
      const src = $(sourceEl).attr('src');
      if (src) {
        addItem(src, pageTitle, poster || ogImage);
      }
    });
  });

  // 3. <a> 标签链接到视频文件
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (!isVideoUrl(href)) return;

    const linkText = $(el).text().trim();
    addItem(href, linkText || extractFileName(href), ogImage);
  });

  // 4. <source> 标签（不在 <video> 内的，如一些自定义播放器）
  $('source').each((_, el) => {
    const src = $(el).attr('src');
    if (src && isVideoUrl(src)) {
      addItem(src, pageTitle, ogImage);
    }
  });

  return {
    items,
    pageTitle: pageTitle || '',
    coverUrl: ogImage || '',
  };
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
    const response = await axios.get(inputUrl, {
      timeout: FETCH_TIMEOUT,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      responseType: 'text',
      maxRedirects: 5,
      // 只取前 1MB HTML，防止过大页面
      maxContentLength: 1024 * 1024,
    });

    const html = response.data;
    if (!html) {
      return {
        success: false,
        platform: 'generic',
        error: '获取网页内容为空，请检查链接是否有效',
      };
    }

    // 用 cheerio 解析
    const $ = cheerio.load(html);
    const { items, pageTitle, coverUrl } = scanPageForVideos($, inputUrl);

    // 没有找到任何视频
    if (items.length === 0) {
      return {
        success: false,
        platform: 'generic',
        error: '在网页中未找到可下载的视频资源。可能原因：\n' +
          '• 视频需要登录后才能观看\n' +
          '• 视频由 JavaScript 动态加载（此工具不执行 JS）\n' +
          '• 页面中确实没有视频内容\n\n' +
          '提示：可以尝试直接粘贴 M3U8 地址或 .mp4 直链',
      };
    }

    // 单视频返回 type: 'video'
    if (items.length === 1) {
      const item = items[0];
      return {
        success: true,
        platform: 'generic',
        data: {
          type: 'video',
          title: item.title || pageTitle || '视频',
          videoUrl: item.url,
          coverUrl: item.coverUrl || coverUrl || '',
          description: pageTitle || '',
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
        description: `在网页中找到 ${items.length} 个视频`,
        items: items.map((item, index) => ({
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
      error: `解析失败: ${err.message}`,
    };
  }
}

module.exports = { parse };

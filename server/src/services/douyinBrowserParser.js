/**
 * 抖音浏览器解析器
 *
 * 利用 Playwright headless Chromium 绕过 JSVM 反爬：
 * 1. 在浏览器中导航到抖音页面 → 触发 JSVM 挑战 → 获得 s_v_web_id cookie
 * 2. 在浏览器上下文内调用 aweme/detail API → 拿到完整 aweme_detail
 * 3. 提取无水印视频 URL、标题、作者、封面
 *
 * 与 browserManager 配合：复用已通过 JSVM 挑战的浏览器上下文，
 * 避免反复触发生成签名。
 */

const { fetchWithBrowser, acquirePage, shutdown } = require('./browserManager');

// ============================================================
// 常量
// ============================================================

const API_DETAIL = 'https://www.douyin.com/aweme/v1/web/aweme/detail/';
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

const DEFAULT_UA = USER_AGENTS[0];
const REQUEST_TIMEOUT = 20000;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从 URL 中提取视频 ID
 * 支持格式：
 *   - /video/7667586429506249393
 *   - /v/7667586429506249393
 *   - ?aweme_id=7667586429506249393
 *   - v.douyin.com/i2/ 重定向后的标准 URL
 */
function extractVideoId(url) {
  // /video/{数字 ID}
  const videoMatch = url.match(/\/video\/(\d{17,21})/);
  if (videoMatch) return videoMatch[1];

  // /v/{数字 ID}
  const vMatch = url.match(/\/v\/(\d{17,21})/);
  if (vMatch) return vMatch[1];

  // aweme_id= 参数
  const paramMatch = url.match(/aweme_id=(\d{17,21})/);
  if (paramMatch) return paramMatch[1];

  // 纯数字（已经是 ID）
  if (/^\d{17,21}$/.test(url)) return url;

  return null;
}

/**
 * 标准化响应格式
 */
function createResult(success, data = {}, error = '') {
  return {
    success,
    error,
    platform: 'douyin',
    ...data,
  };
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 用浏览器解析抖音视频
 *
 * @param {string} input - 抖音短链接或视频 ID
 * @returns {Promise<object>} 标准化解析结果
 */
async function parseVideo(input) {
  if (!input || typeof input !== 'string') {
    return createResult(false, {}, '请提供抖音链接或视频 ID');
  }

  let videoId = extractVideoId(input);

  // 如果无法提取视频 ID，尝试用浏览器解析短链接
  if (!videoId) {
    videoId = await resolveShortUrlWithBrowser(input);
    if (!videoId) {
      return createResult(false, {}, '无法解析抖音短链接，请检查链接格式');
    }
  }

  console.log(`[DouyinBrowserParser] 解析视频 ID: ${videoId}`);

  // 从浏览器上下文调用 API
  return parseViaBrowserApi(videoId);
}

/**
 * 用浏览器解析短链接
 * 导航到 v.douyin.com/xxx，等待重定向，提取最终 URL 中的视频 ID
 */
async function resolveShortUrlWithBrowser(shortUrl) {
  console.log(`[DouyinBrowserParser] 浏览器解析短链接: ${shortUrl}`);

  const { page, release } = await acquirePage('douyin');

  try {
    await page.goto(shortUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // 等待重定向完成
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    console.log(`[DouyinBrowserParser] 重定向到: ${finalUrl}`);

    const videoId = extractVideoId(finalUrl);
    if (videoId) {
      console.log(`[DouyinBrowserParser] 提取到视频 ID: ${videoId}`);
      return videoId;
    }

    // 尝试从页面 HTML 中提取
    const htmlVideoId = await page.evaluate(() => {
      // 查找 video 相关数据
      const match = document.body.innerHTML.match(/video[=/](\d{17,21})/);
      return match ? match[1] : null;
    });

    return htmlVideoId || null;
  } catch (err) {
    console.error(`[DouyinBrowserParser] 短链接解析失败:`, err.message);
    return null;
  } finally {
    await release();
  }
}

/**
 * 在浏览器上下文内调用抖音 API
 */
async function parseViaBrowserApi(videoId) {
  const apiUrl = `${API_DETAIL}?aweme_id=${videoId}&device_platform=webapp&aid=6383`;
  console.log(`[DouyinBrowserParser] 浏览器调用 API: ${apiUrl}`);

  let retries = 0;
  const maxRetries = 2;

  while (retries <= maxRetries) {
    try {
      const response = await fetchWithBrowser('douyin', apiUrl, {
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: `https://www.douyin.com/video/${videoId}`,
        },
      });

      if (!response) {
        console.error(`[DouyinBrowserParser] fetchWithBrowser 返回空 (retry ${retries}/${maxRetries})`);
        retries++;
        continue;
      }

      if (response._error) {
        console.error(`[DouyinBrowserParser] 浏览器内 fetch 失败: ${response._error} (retry ${retries}/${maxRetries})`);
        retries++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!response.data) {
        console.error(`[DouyinBrowserParser] API 无数据体, status=${response.status} (retry ${retries}/${maxRetries})`);
        retries++;
        continue;
      }

      const body = response.data;

      // 记录完整响应（用于诊断）
      if (body.status_code !== undefined) {
        console.log(`[DouyinBrowserParser] API 响应 status_code=${body.status_code}, status_msg=${body.status_msg || ''}, has_aweme_detail=${!!body.aweme_detail}`);
      } else {
        console.error(`[DouyinBrowserParser] API 响应异常, 键=${Object.keys(body).join(',')}, 摘要=${JSON.stringify(body).substring(0, 300)}`);
        retries++;
        continue;
      }

      if (body.status_code === 0 && body.aweme_detail) {
        return extractAndFormatResult(body.aweme_detail, videoId);
      }

      // API 返回了错误但非空
      if (body.status_code !== 0) {
        const errMsg = body.status_msg || `API 错误码: ${body.status_code}`;
        console.warn(`[DouyinBrowserParser] API 错误: ${errMsg}`);

        if (body.status_code === 403) {
          console.warn('[DouyinBrowserParser] 被风控拦截，可能需要重新触发 JSVM');
          retries++;
          continue;
        }

        return createResult(false, { videoId }, `抖音 API 返回错误: ${errMsg}`);
      }

      // status_code=0 但没有 aweme_detail
      console.warn(`[DouyinBrowserParser] status_code=0 但无 aweme_detail`);
      return createResult(false, { videoId }, '未找到视频数据');
    } catch (err) {
      retries++;
      console.error(`[DouyinBrowserParser] 请求异常 (${retries}/${maxRetries}):`, err.message);

      if (retries > maxRetries) {
        return createResult(false, { videoId }, `浏览器解析失败: ${err.message}`);
      }

      // 等待后重试
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.error(`[DouyinBrowserParser] 已达最大重试次数 ${maxRetries}，放弃`);
  return createResult(false, { videoId }, `解析失败，已重试 ${maxRetries} 次`);
}

/**
 * 从 aweme_detail 中提取标准格式数据
 */
function extractAndFormatResult(detail, videoId) {
  // 提取视频 URL（选择无水印版本）
  let videoUrl = null;
  const video = detail.video;

  if (video) {
    // play_addr 通常包含多个清晰度的 URL 列表
    const playAddr = video.play_addr || {};
    const urlList = playAddr.url_list || [];

    // 优先选择无水印的 play_addr
    if (urlList.length > 0) {
      videoUrl = urlList[0]
        .replace('/playwm/', '/play/') // 移除水印
        .replace(/^http:/, 'https:'); // 微信 wx.downloadFile 要求 https
    }

    // 如果有 bit_rate，可能有更高清的选择
    const bitRates = video.bit_rate || [];
    if (bitRates.length > 0 && !videoUrl) {
      for (const br of bitRates) {
        if (br.play_addr && br.play_addr.url_list && br.play_addr.url_list[0]) {
          videoUrl = br.play_addr.url_list[0].replace('/playwm/', '/play/').replace(/^http:/, 'https:');
          break;
        }
      }
    }

    // 兜底：download_addr
    if (!videoUrl && video.download_addr) {
      const dlUrls = video.download_addr.url_list || [];
      if (dlUrls[0]) {
        videoUrl = dlUrls[0].replace('/playwm/', '/play/').replace(/^http:/, 'https:');
      }
    }
  }

  if (!videoUrl) {
    return createResult(false, { videoId }, '未找到视频播放地址');
  }

  // 提取数据
  const result = createResult(true, {
    videoId,
    title: detail.desc || '',
    author: detail.author ? detail.author.nickname : '',
    authorId: detail.author ? detail.author.unique_id || detail.author.short_id || '' : '',
    avatar: detail.author ? detail.author.avatar_larger && detail.author.avatar_larger.url_list && detail.author.avatar_larger.url_list[0] || '' : '',
    coverUrl:
      (video && video.cover && video.cover.url_list && video.cover.url_list[0]) ||
      (video && video.origin_cover && video.origin_cover.url_list && video.origin_cover.url_list[0]) ||
      (detail.video && detail.video.dynamic_cover && detail.video.dynamic_cover.url_list && detail.video.dynamic_cover.url_list[0]) ||
      '',
    videoUrl,
    duration: video && video.duration ? Math.floor(video.duration / 1000) : 0,
    width: video && video.width || 0,
    height: video && video.height || 0,
    likes: detail.statistics ? detail.statistics.digg_count : 0,
    shares: detail.statistics ? detail.statistics.share_count : 0,
    comments: detail.statistics ? detail.statistics.comment_count : 0,
    music: detail.music ? detail.music.title : '',
    isLongVideo: detail.is_long_video || false,
    region: detail.region || '',
    createTime: detail.create_time || 0,
  });

  console.log(`[DouyinBrowserParser] 解析成功: ${result.title} | ${result.author} | ${videoUrl.substring(0, 60)}...`);
  return result;
}

/**
 * 刷新浏览器中的 JSVM 挑战（当 cookie 过期时）
 */
async function refreshChallenge() {
  // 关闭当前 douyin 上下文，下次 acquirePage 时会重新触发挑战
  try {
    const browserManager = require('./browserManager');
    const { Page, chromium } = require('playwright');

    // 获取浏览器实例，打开新页面强制刷新
    const { page, release } = await browserManager.acquirePage('douyin_force_refresh');
    try {
      await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);
    } finally {
      await release();
    }
  } catch (err) {
    console.error('[DouyinBrowserParser] 刷新挑战失败:', err.message);
  }
}

module.exports = {
  parseVideo,
  resolveShortUrlWithBrowser,
  extractVideoId,
  refreshChallenge,
};

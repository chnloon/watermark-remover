/**
 * 抖音解析器
 *
 * 解析流程:
 *   用户分享链接 → 解析短链接 → 获取视频 ID → 调用抖音 API → 返回无水印视频地址
 */

const axios = require('axios');
const { extractDouyinVideoId } = require('../utils/url');
const { parseViaThirdParty } = require('../services/thirdPartyApi');

// 模拟手机浏览器的请求头
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.douyin.com/',
  'Origin': 'https://www.douyin.com',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

/**
 * 解析抖音分享链接
 * @param {string} shareUrl - 用户粘贴的抖音分享链接
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function parse(shareUrl) {
  try {
    // 第一步：解析短链接，获取完整的视频页面 URL
    const fullUrl = await resolveShortUrl(shareUrl);
    if (!fullUrl) {
      // 如果短链接解析失败，尝试直接用原始 URL
      return await fetchVideoInfo(shareUrl);
    }

    // 第二步：从完整 URL 中提取视频 ID，并获取视频信息
    return await fetchVideoInfo(fullUrl);
  } catch (err) {
    return {
      success: false,
      platform: 'douyin',
      error: `解析失败: ${err.message}`,
    };
  }
}

/**
 * 解析抖音短链接，获取完整 URL
 */
async function resolveShortUrl(shortUrl) {
  try {
    const response = await axios.get(shortUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
      timeout: 10000,
    });

    // 获取最终重定向后的 URL
    return response.request.res.responseUrl || shortUrl;
  } catch (err) {
    // 如果短链接无法访问，返回 null
    return null;
  }
}

/**
 * 通过抖音 Web API 获取视频信息
 * 使用 iesdouyin.com 的接口（较稳定）
 */
async function fetchVideoInfo(url) {
  const videoId = extractDouyinVideoId(url);
  if (!videoId) {
    return {
      success: false,
      platform: 'douyin',
      error: '无法从链接中提取视频 ID',
    };
  }

  try {
    // 抖音 Web API - 获取视频详情
    const apiUrl = `https://www.iesdouyin.com/aweme/v1/web/aweme/detail/`;
    const params = {
      aweme_id: videoId,
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      pc_client_type: 1,
      version_code: '170400',
      version_name: '17.4.0',
      cookie_enabled: true,
      screen_width: 1920,
      screen_height: 1080,
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Chrome',
      browser_version: '116.0.0.0',
      browser_online: true,
      engine_name: 'Blink',
      engine_version: '116.0.0.0',
      os_name: 'Windows',
      os_version: '10',
      cpu_core_count: '8',
      device_memory: '8',
      platform: 'PC',
      downlink: '10',
      effective_type: '4g',
      round_trip_time: '50',
      webid: '',
      msToken: '',
    };

    const response = await axios.get(apiUrl, {
      params,
      headers: {
        ...COMMON_HEADERS,
        'Cookie': '',  // 实际使用时可能需要有效的 Cookie
      },
      timeout: 15000,
    });

    const data = response.data;
    if (!data || !data.aweme_detail) {
      return await tryAlternativeApi(videoId);
    }

    const detail = data.aweme_detail;
    const videoInfo = extractVideoInfo(detail);

    if (videoInfo) {
      return {
        success: true,
        platform: 'douyin',
        data: videoInfo,
      };
    }

    return await tryAlternativeApi(videoId);
  } catch (err) {
    // 如果 API 调用失败，尝试备用方案
    return await tryAlternativeApi(videoId);
  }
}

/**
 * 备用方案：从页面 HTML 或第三方 API 获取
 */
async function tryAlternativeApi(videoId) {
  // 尝试从移动端页面直接获取视频地址
  try {
    const pageUrl = `https://www.douyin.com/video/${videoId}`;
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 10000,
    });

    const html = response.data;

    // 尝试从页面中提取视频地址
    // 模式 1: 从 JSON-LD 结构化数据中提取
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        if (jsonData.contentUrl) {
          return {
            success: true,
            platform: 'douyin',
            data: {
              title: jsonData.name || '',
              coverUrl: jsonData.thumbnailUrl || '',
              videoUrl: jsonData.contentUrl,
              videoId: videoId,
              source: 'douyin',
              type: 'video',
            },
          };
        }
      } catch (e) { /* ignore */ }
    }

    // 模式 2: 从页面内嵌的 JSON 数据中提取 (SSR 渲染)
    const ssrMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (ssrMatch) {
      try {
        const ssrData = JSON.parse(ssrMatch[1]);
        // 尝试提取视频 URL
        const videoUrl = extractNestedUrl(ssrData, 'video_id', videoId);
        if (videoUrl) {
          return {
            success: true,
            platform: 'douyin',
            data: videoUrl,
          };
        }
      } catch (e) { /* ignore */ }
    }

    // 如果以上都失败，尝试第三方 API
    try {
      const thirdPartyResult = await parseViaThirdParty(pageUrl, 'douyin');
      if (thirdPartyResult.success) {
        return thirdPartyResult;
      }
    } catch (apiErr) {
      console.error('[抖音] 第三方 API 也失败:', apiErr.message);
    }

    // 所有方案都失败，返回提示信息
    return {
      success: false,
      platform: 'douyin',
      error: '该视频可能需要登录或已失效，请检查链接是否正确',
    };
  } catch (err) {
    return {
      success: false,
      platform: 'douyin',
      error: `解析失败: ${err.message}`,
    };
  }
}

/**
 * 从抖音 API 返回的视频详情中提取视频信息
 */
function extractVideoInfo(detail) {
  if (!detail || !detail.video) return null;

  const video = detail.video;
  const author = detail.author || {};

  // 无水印视频地址 (play_addr 通常是高清无水印)
  let videoUrl = '';
  const playAddr = video.play_addr;
  if (playAddr && playAddr.url_list && playAddr.url_list.length > 0) {
    videoUrl = playAddr.url_list[0];
  }

  // 备用：bit_rate 中的播放地址
  if (!videoUrl && video.bit_rate && video.bit_rate.length > 0) {
    for (const rate of video.bit_rate) {
      if (rate.play_addr && rate.play_addr.url_list && rate.play_addr.url_list.length > 0) {
        videoUrl = rate.play_addr.url_list[0];
        // 优先选择无水印
        if (rate.play_addr.url_list[0].includes('play_addr')) {
          break;
        }
      }
    }
  }

  if (!videoUrl) return null;

  return {
    title: detail.desc || '',
    coverUrl: (video.cover && video.cover.url_list && video.cover.url_list[0]) || '',
    videoUrl: videoUrl.replace(/^https?:\/\//, 'https://'),
    videoId: detail.aweme_id || '',
    author: {
      name: author.nickname || '',
      avatar: (author.avatar && author.avatar.url_list && author.avatar.url_list[0]) || '',
    },
    source: 'douyin',
    type: 'video',
    duration: video.duration || 0,
  };
}

/**
 * 从嵌套的 JSON 对象中递归搜索指定 key
 */
function extractNestedUrl(obj, key, value) {
  // 简化版递归搜索，实际项目中可根据需要完善
  return null;
}

module.exports = { parse };

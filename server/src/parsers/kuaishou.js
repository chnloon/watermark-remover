/**
 * 快手解析器
 *
 * 解析策略（按优先级降序）:
 *   1. 直接调用快手 GraphQL API
 *   2. Cheerio 提取 HTML 页面内嵌数据（og:video / JSON-LD / __INITIAL_STATE__）
 *   3. lux Go CLI 解析（内置反爬处理）
 *   4. 第三方解析 API 降级
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { parseViaThirdParty } = require('../services/thirdPartyApi');
const { parseViaLux } = require('../services/luxParser');

/**
 * 解析快手分享链接
 * @param {string} shareUrl
 * @returns {Promise<object>}
 */
async function parse(shareUrl, options = {}) {
  // 路由模式（备选解析方案）：auto / third-party-first / third-party-only / direct-only
  const routeMode = (options && options.routeMode) || 'auto';

  try {
    // 第一步：解析分享链接，获取视频ID
    const videoId = await resolveVideoId(shareUrl);
    // 注意: videoId 可能为 null（如未知 URL 格式），
    // 但仍可尝试 fetchViaPage 和 lux——不提前退出

    // ---- 路由模式前置分流（备选解析方案） ----
    if (routeMode === 'third-party-only') {
      // 仅第三方：直连链路故障时的快速止损，第三方结论即最终结论
      try {
        const thirdPartyResult = await parseViaThirdParty(shareUrl, 'kuaishou');
        if (thirdPartyResult.success) return thirdPartyResult;
        return thirdPartyResult;
      } catch (apiErr) {
        console.error('[快手] 第三方线路失败:', apiErr.message);
        return {
          success: false,
          platform: 'kuaishou',
          error: '第三方解析线路暂不可用，请切换回自动模式',
        };
      }
    }

    if (routeMode === 'third-party-first') {
      // 第三方优先：先走第三方，成功立即返回；失败回落直连链
      try {
        const thirdPartyResult = await parseViaThirdParty(shareUrl, 'kuaishou');
        if (thirdPartyResult.success) return thirdPartyResult;
        console.error('[快手] 第三方优先失败:', thirdPartyResult.error);
      } catch (apiErr) {
        console.error('[快手] 第三方优先失败:', apiErr.message);
      }
    }

    // 第二步：调用快手 API 获取视频信息（需要 videoId）
    if (videoId) {
      const result = await fetchVideoInfo(videoId);
      if (result.success) return result;
    }

    // 第二步半：尝试 HTML 页面解析（cheerio，无 videoId 也能跑）
    const pageResult = await fetchViaPage(shareUrl, videoId);
    if (pageResult.success) return pageResult;

    // 第三步：lux Go CLI 解析（内置快手反爬处理）
    const luxResult = await parseViaLux(shareUrl);
    if (luxResult.success) return luxResult;
    console.error('[快手] lux 解析失败:', luxResult.error);

    // 第四步：直接解析失败，尝试第三方 API 降级（仅 auto 模式；
    // third-party-first/only 已在前置分支处理，direct-only 禁用第三方）
    if (routeMode === 'auto') {
      try {
        const thirdPartyResult = await parseViaThirdParty(shareUrl, 'kuaishou');
        if (thirdPartyResult.success) return thirdPartyResult;
      } catch (apiErr) {
        console.error('[快手] 第三方 API 也失败:', apiErr.message);

        if (apiErr.message && apiErr.message.includes('未配置')) {
          // 第三方 API 未配置，统一返回通用文案（不泄露内部错误）
          return {
            success: false,
            platform: 'kuaishou',
            error: '快手解析暂时不可用，请稍后重试',
          };
        }
      }
    }

    // 所有解析方式均失败
    return {
      success: false,
      platform: 'kuaishou',
      error: '快手解析暂时不可用，请稍后重试',
    };
  } catch (err) {
    console.error('[快手] 解析失败:', err.message);
    return {
      success: false,
      platform: 'kuaishou',
      error: '快手解析暂时不可用，请稍后重试',
    };
  }
}

/**
 * 从分享链接中解析出视频ID
 */
async function resolveVideoId(url) {
  try {
    // 如果已经是短链接，先解析
    if (url.includes('v.kuaishou.com') || !url.includes('/short-video/')) {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        },
        maxRedirects: 5,
        timeout: 10000,
      });
      url = response.request.res.responseUrl || url;
    }

    // 从 URL 中提取视频 ID
    const match = url.match(/(?:short-video|photo)\/(\d+)/);
    if (match) return match[1];

    // 尝试从 URL 中提取 photoId
    const photoMatch = url.match(/photoId=(\d+)/);
    if (photoMatch) return photoMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * 通过快手 API 获取视频信息
 */
async function fetchVideoInfo(videoId) {
  try {
    // 快手视频信息 API
    const apiUrl = `https://www.kuaishou.com/graphql`;
    const payload = {
      operationName: 'visionVideoDetail',
      variables: {
        photoId: videoId,
        page: 'search',
        webid: '',
      },
      query: `
        query visionVideoDetail($photoId: String, $page: String, $webid: String) {
          visionVideoDetail(photoId: $photoId, page: $page, webid: $webid) {
            photo {
              id
              caption
              coverUrl
              duration
              photoUrl
              likeCount
              commentCount
              author {
                id
                name
                avatar
              }
              photoUrls
              manifest {
                mediaId
                token
                adaptationSet {
                  representation {
                    url
                  }
                }
              }
            }
            status
          }
        }
      `,
    };

    const response = await axios.post(apiUrl, payload, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
        'Content-Type': 'application/json',
        'Referer': `https://www.kuaishou.com/short-video/${videoId}`,
        'Origin': 'https://www.kuaishou.com',
      },
      timeout: 15000,
    });

    const result = response.data;
    if (!result || !result.data || !result.data.visionVideoDetail) {
      return {
        success: false,
        platform: 'kuaishou',
        error: '获取视频信息失败，请检查链接是否正确',
      };
    }

    const photo = result.data.visionVideoDetail.photo;
    if (!photo) {
      return {
        success: false,
        platform: 'kuaishou',
        error: '视频不存在或已被删除',
      };
    }

    // 提取视频地址
    let videoUrl = '';
    if (photo.photoUrl) {
      videoUrl = photo.photoUrl;
    } else if (photo.manifest && photo.manifest.adaptationSet) {
      // m3u8 流媒体地址
      const reps = photo.manifest.adaptationSet[0]?.representation;
      if (reps && reps.length > 0) {
        videoUrl = reps[0].url;
      }
    } else if (photo.photoUrls && photo.photoUrls.length > 0) {
      videoUrl = photo.photoUrls[0];
    }

    if (!videoUrl) {
      return {
        success: false,
        platform: 'kuaishou',
        error: '无法获取视频播放地址',
      };
    }

    return {
      success: true,
      platform: 'kuaishou',
      data: {
        title: photo.caption || '',
        coverUrl: photo.coverUrl || '',
        videoUrl: videoUrl,
        videoId: photo.id || videoId,
        author: {
          name: photo.author?.name || '',
          avatar: photo.author?.avatar || '',
        },
        source: 'kuaishou',
        type: 'video',
        duration: photo.duration || 0,
      },
    };
  } catch (err) {
    console.error('[快手] 解析失败:', err.message);
    return {
      success: false,
      platform: 'kuaishou',
      error: '快手解析暂时不可用，请稍后重试',
    };
  }
}

/**
 * 通过 HTML 页面解析（cheerio）
 *
 * 当 GraphQL API 失效时，尝试从快手分享落地页中直接提取视频信息。
 * 支持 4 种提取方式:
 *   1. og:video / og:video:url 元标签
 *   2. JSON-LD（schema.org/VideoObject）
 *   3. window.__INITIAL_STATE__ SSR 状态
 *   4. <video> 标签（兜底）
 */
async function fetchViaPage(url, videoId) {
  try {
    // 构造快手分享页的完整 URL
    // 没有 videoId 时直接用原始 URL 碰运气
    const pageUrl = url.includes('v.kuaishou.com')
      ? url
      : videoId
        ? `https://www.kuaishou.com/short-video/${videoId}`
        : url;

    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.kuaishou.com/',
      },
      timeout: 15000,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // ----- 策略 1: window.INIT_STATE（落地页 SSR，含 mainMvUrls 视频直链） -----
    // 快手分享落地页（v.m.chenzhongtech.com/fw/photo/...）在 window.INIT_STATE 中
    // 内嵌完整作品数据：mainMvUrls（mp4 直链）/ caption / userName / headUrl / duration
    {
      const initStateResult = extractFromInitState(html, videoId);
      if (initStateResult.success) return initStateResult;
    }

    // ----- 策略 2: og:video 元标签 -----
    {
      const ogVideo = $('meta[property="og:video"]').attr('content') || '';
      const ogVideoUrl = $('meta[property="og:video:url"]').attr('content') || '';
      const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content') || '';
      const videoUrl = ogVideo || ogVideoUrl || ogVideoSecure;

      if (videoUrl) {
        return {
          success: true,
          platform: 'kuaishou',
          data: {
            title: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
            coverUrl: $('meta[property="og:image"]').attr('content') || '',
            videoUrl,
            videoId: videoId || '',
            author: { name: '', avatar: '' },
            source: 'kuaishou',
            type: 'video',
            duration: 0,
          },
        };
      }
    }

    // ----- 策略 3: JSON-LD -----
    {
      let ldVideo = null;
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const parsed = JSON.parse($(el).html());
          if (parsed && (parsed['@type'] === 'VideoObject' || parsed.video)) {
            ldVideo = parsed;
          }
        } catch { /* ignore */ }
      });

      if (ldVideo) {
        const videoUrl = ldVideo.contentUrl || ldVideo.embedUrl || ldVideo.url || '';
        if (videoUrl) {
          return {
            success: true,
            platform: 'kuaishou',
            data: {
              title: ldVideo.name || ldVideo.description || '',
              coverUrl: ldVideo.thumbnailUrl || '',
              videoUrl,
              videoId: videoId || '',
              author: { name: '', avatar: '' },
              source: 'kuaishou',
              type: 'video',
              duration: ldVideo.duration ? parseInt(ldVideo.duration) || 0 : 0,
            },
          };
        }
      }
    }

    // ----- 策略 4: window.__INITIAL_STATE__ -----
    {
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (match && match[1]) {
        try {
          const state = JSON.parse(match[1]);
          if (state && typeof state === 'object') {
            // 快手 __INITIAL_STATE__ 常见路径
            const photo = state.photo || (state.videoDetail && state.videoDetail.photo);
            if (photo && photo.photoUrl) {
              return {
                success: true,
                platform: 'kuaishou',
                data: {
                  title: photo.caption || '',
                  coverUrl: photo.coverUrl || '',
                  videoUrl: photo.photoUrl,
                  videoId: photo.id || videoId,
                  author: {
                    name: (photo.author && photo.author.name) || '',
                    avatar: (photo.author && photo.author.avatar) || '',
                  },
                  source: 'kuaishou',
                  type: 'video',
                  duration: photo.duration || 0,
                },
              };
            }
          }
        } catch { /* ignore */ }
      }
    }

    // ----- 策略 5: <video> 标签（兜底） -----
    {
      const videoSrc = $('video source').attr('src') || $('video').attr('src') || '';
      if (videoSrc && !videoSrc.includes('blob:')) {
        return {
          success: true,
          platform: 'kuaishou',
          data: {
            title: $('title').text() || '',
            coverUrl: $('meta[property="og:image"]').attr('content') || '',
            videoUrl: videoSrc,
            videoId: videoId || '',
            author: { name: '', avatar: '' },
            source: 'kuaishou',
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

/**
 * 从 window.INIT_STATE（落地页 SSR 状态）中提取作品信息
 *
 * 快手分享落地页（v.m.chenzhongtech.com/fw/photo/...）在
 * window.INIT_STATE 中内嵌完整作品数据，含 mainMvUrls（mp4 直链）、
 * caption、userName、headUrl、duration、coverUrls 等字段。
 * 视频直链托管在 hwmov.a.yximgs.com，HEAD 返回 video/mp4 且无需 Referer，
 * 微信小程序 wx.downloadFile 可直接下载。
 */
function extractFromInitState(html, videoId) {
  try {
    const match = html.match(/window\.INIT_STATE\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/);
    if (!match || !match[1]) return { success: false };
    const state = JSON.parse(match[1]);
    if (!state || typeof state !== 'object') return { success: false };

    // 递归查找含 mainMvUrls 数组的 photo 对象（深度 ≤8）
    let photo = null;
    (function find(o, depth) {
      if (photo || !o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o.mainMvUrls) && o.mainMvUrls.length > 0) { photo = o; return; }
      for (const key of Object.keys(o)) find(o[key], depth + 1);
    })(state, 0);

    if (!photo) return { success: false };
    const videoUrl = (photo.mainMvUrls[0] && photo.mainMvUrls[0].url) || '';
    if (!videoUrl) return { success: false };

    // coverUrls 可能是 {cdn,url} 对象数组，也可能直接是字符串数组
    const coverArr = photo.coverUrls || photo.webpCoverUrls || [];
    const coverUrl = typeof coverArr[0] === 'string'
      ? coverArr[0]
      : (coverArr[0] && coverArr[0].url) || '';

    return {
      success: true,
      platform: 'kuaishou',
      data: {
        title: photo.caption || '',
        coverUrl,
        videoUrl,
        videoId: photo.photoId || videoId || '',
        author: { name: photo.userName || '', avatar: photo.headUrl || '' },
        source: 'kuaishou',
        type: 'video',
        duration: photo.duration ? Math.round(photo.duration / 1000) : 0,
      },
    };
  } catch {
    return { success: false };
  }
}

module.exports = { parse };

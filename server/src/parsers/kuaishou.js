/**
 * 快手解析器
 */

const axios = require('axios');
const { parseViaThirdParty } = require('../services/thirdPartyApi');

/**
 * 解析快手分享链接
 * @param {string} shareUrl
 * @returns {Promise<object>}
 */
async function parse(shareUrl) {
  try {
    // 第一步：解析分享链接，获取视频ID
    const videoId = await resolveVideoId(shareUrl);
    if (!videoId) {
      return {
        success: false,
        platform: 'kuaishou',
        error: '无法识别的快手链接格式',
      };
    }

    // 第二步：调用快手 API 获取视频信息
    const result = await fetchVideoInfo(videoId);
    if (result.success) return result;

    // 直接解析失败，尝试第三方 API 降级
    try {
      const thirdPartyResult = await parseViaThirdParty(shareUrl, 'kuaishou');
      if (thirdPartyResult.success) return thirdPartyResult;
    } catch (apiErr) {
      console.error('[快手] 第三方 API 也失败:', apiErr.message);
    }

    return result;
  } catch (err) {
    return {
      success: false,
      platform: 'kuaishou',
      error: `解析失败: ${err.message}`,
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
    return {
      success: false,
      platform: 'kuaishou',
      error: `解析失败: ${err.message}`,
    };
  }
}

module.exports = { parse };

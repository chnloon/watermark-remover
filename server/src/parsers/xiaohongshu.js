/**
 * 小红书解析器
 *
 * 小红书支持视频和图片两种内容类型，
 * 图片笔记返回图片列表，视频笔记返回视频地址
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { parseViaThirdParty } = require('../services/thirdPartyApi');

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

    // 直接解析失败，尝试第三方 API 降级
    try {
      const thirdPartyResult = await parseViaThirdParty(shareUrl, 'xiaohongshu');
      if (thirdPartyResult.success) return thirdPartyResult;
    } catch (apiErr) {
      console.error('[小红书] 第三方 API 也失败:', apiErr.message);
    }

    return result;
  } catch (err) {
    return {
      success: false,
      platform: 'xiaohongshu',
      error: `解析失败: ${err.message}`,
    };
  }
}

/**
 * 解析小红书短链接 (xhslink.com)
 */
async function resolveShortUrl(url) {
  try {
    if (!url.includes('xhslink.com')) {
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

    // 从页面中提取图片列表
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && src.includes('xhscdn.com') && !src.includes('avatar') && !src.includes('icon')) {
        images.push(src);
      }
    });

    // 从 meta 标签提取信息
    const description = $('meta[name="description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const ogVideo = $('meta[property="og:video"]').attr('content') || '';
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content') || '';

    // 从页面中提取 window.__INITIAL_STATE__ 数据
    let initialState = null;
    $('script').each((i, el) => {
      const text = $(el).html() || '';
      if (text.includes('window.__INITIAL_STATE__')) {
        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
        if (match) {
          try {
            initialState = JSON.parse(match[1]);
          } catch (e) { /* ignore */ }
        }
      }
    });

    // 尝试从 initialState 中提取视频信息
    let videoUrl = ogVideo || ogVideoUrl;
    if (!videoUrl && initialState) {
      // 遍历查找视频 URL
      try {
        const note = findNoteInState(initialState);
        if (note) {
          if (note.type === 'video' && note.video && note.video.media && note.video.media.stream) {
            const stream = note.video.media.stream;
            if (stream.master_url) {
              videoUrl = stream.master_url;
            } else if (stream[0] && stream[0].url) {
              videoUrl = stream[0].url;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 判断类型
    const isVideo = !!videoUrl;

    if (isVideo) {
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

    // 图片笔记
    return {
      success: true,
      platform: 'xiaohongshu',
      data: {
        title: title || description || '',
        coverUrl: ogImage || (images.length > 0 ? images[0] : ''),
        images: images.length > 0 ? images : (ogImage ? [ogImage] : []),
        noteId: extractNoteId(url),
        source: 'xiaohongshu',
        type: 'image',
        description: description,
        text: $('meta[property="og:description"]').attr('content') || '',
      },
    };
  } catch (err) {
    return {
      success: false,
      platform: 'xiaohongshu',
      error: `解析失败: ${err.message}`,
    };
  }
}

/**
 * 从 initialState 中递归查找笔记数据
 */
function findNoteInState(state) {
  if (!state || typeof state !== 'object') return null;

  // 常见的小红书 state 结构
  if (state.note) return state.note;
  if (state.noteDetail) return state.noteDetail;
  if (state.feed) return state.feed;

  // 递归查找
  for (const key of Object.keys(state)) {
    if (key.includes('note') || key.includes('Note')) {
      return state[key];
    }
    if (typeof state[key] === 'object') {
      const result = findNoteInState(state[key]);
      if (result) return result;
    }
  }

  return null;
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

module.exports = { parse };

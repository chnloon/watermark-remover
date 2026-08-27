/**
 * M3U8 视频解析器
 *
 * 解析 M3U8 直播/点播流地址，自动选择最高码率。
 * 支持 master playlist（多码率）和 media playlist（单码率）两种格式。
 *
 * 返回 data.type = 'video'（单视频），videoUrl 为最高码率的 M3U8 地址，
 * 微信小程序 <video> 原生支持 HLS 播放。
 */
const axios = require('axios');
const url = require('url');

// 请求超时（毫秒）
const FETCH_TIMEOUT = 15000;

// 默认 User-Agent
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 解析单个 M3U8 URL，返回最高码率的媒体 URL
 *
 * @param {string} inputUrl - M3U8 地址
 * @returns {Promise<{success: boolean, platform: string, data?: object, error?: string}>}
 */
async function parse(inputUrl) {
  try {
    // 1. 获取 M3U8 内容
    const response = await axios.get(inputUrl, {
      timeout: FETCH_TIMEOUT,
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
      },
      responseType: 'text',
    });

    const content = response.data;
    if (!content || typeof content !== 'string') {
      return {
        success: false,
        platform: 'm3u8',
        error: '获取 M3U8 内容为空，请检查链接是否有效',
      };
    }

    // 验证是否为有效的 M3U8 文件
    if (!content.startsWith('#EXTM3U')) {
      return {
        success: false,
        platform: 'm3u8',
        error: '该链接不是有效的 M3U8 流地址（文件头不符）',
      };
    }

    // 2. 判断是 master 还是 media playlist
    const isMaster = /#EXT-X-STREAM-INF/i.test(content);

    let videoUrl;
    let coverUrl = null;
    let title = null;

    if (isMaster) {
      // ---- Master Playlist：有多码率选项，选最高带宽 ----
      const result = selectHighestBitrate(inputUrl, content);
      if (!result) {
        return {
          success: false,
          platform: 'm3u8',
          error: '解析 M3U8 码率列表失败，未找到有效的子流地址',
        };
      }
      videoUrl = result.url;
      title = result.bandwidth
        ? `M3U8 流 (${formatBandwidth(result.bandwidth)})`
        : 'M3U8 流';
    } else {
      // ---- Media Playlist：直接使用 ----
      videoUrl = inputUrl;
      title = 'M3U8 流';
    }

    // 尝试从 M3U8 URL 的上下文获取封面（og:image 等在本 parser 中不做，在 generic parser 里做）
    // 有些 M3U8 地址来自某网页，这里会跳过，交由 generic parser 处理

    return {
      success: true,
      platform: 'm3u8',
      data: {
        type: 'video',
        title: title || 'M3U8 视频',
        videoUrl: videoUrl,
        coverUrl: coverUrl || '',
        description: `M3U8 视频流${isMaster ? '（已选最高码率）' : ''}`,
      },
    };
  } catch (err) {
    // 网络/超时/其他错误
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return {
        success: false,
        platform: 'm3u8',
        error: '获取 M3U8 流超时，请检查链接或网络',
      };
    }
    if (err.response && err.response.status === 404) {
      return {
        success: false,
        platform: 'm3u8',
        error: 'M3U8 链接不存在（404），请检查链接是否正确',
      };
    }
    if (err.response && err.response.status === 403) {
      return {
        success: false,
        platform: 'm3u8',
        error: 'M3U8 链接需要登录或权限验证，无法直接访问',
      };
    }
    console.error('[M3U8] 解析失败:', err.message);
    return {
      success: false,
      platform: 'm3u8',
      error: '解析 M3U8 失败，请检查链接后重试',
    };
  }
}

/**
 * 在 master playlist 中选出最高带宽的子流
 *
 * @param {string} baseUrl - 原始 M3U8 URL（用于解析相对路径）
 * @param {string} content - M3U8 文件内容
 * @returns {{ url: string, bandwidth: number } | null}
 */
function selectHighestBitrate(baseUrl, content) {
  const lines = content.split('\n');
  let best = null;
  let currentBandwidth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 匹配 #EXT-X-STREAM-INF 行，提取 BANDWIDTH
    const streamMatch = line.match(/#EXT-X-STREAM-INF:[^]*?BANDWIDTH=(\d+)/i);
    if (streamMatch) {
      currentBandwidth = parseInt(streamMatch[1], 10);

      // 下一行（如果有）就是子流 URL
      if (i + 1 < lines.length) {
        const streamUrl = lines[i + 1].trim();
        if (streamUrl && !streamUrl.startsWith('#')) {
          // 解析相对 URL
          const resolvedUrl = resolveUrl(baseUrl, streamUrl);
          if (!best || currentBandwidth > best.bandwidth) {
            best = { url: resolvedUrl, bandwidth: currentBandwidth };
          }
        }
      }
    }
  }

  return best;
}

/**
 * 解析相对 URL 为绝对 URL
 */
function resolveUrl(baseUrl, relativePath) {
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  // 使用 Node.js url 模块处理相对路径
  return url.resolve(baseUrl, relativePath);
}

/**
 * 格式化带宽显示（例如 2.5 Mbps）
 */
function formatBandwidth(bps) {
  if (bps >= 1000000) {
    return (bps / 1000000).toFixed(1) + ' Mbps';
  }
  if (bps >= 1000) {
    return (bps / 1000).toFixed(0) + ' Kbps';
  }
  return bps + ' bps';
}

module.exports = { parse };

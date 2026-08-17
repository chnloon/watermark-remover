/**
 * URL 工具函数
 */

/**
 * 判断是否为 M3U8 URL
 * @param {string} url
 * @returns {boolean}
 */
function isM3u8Url(url) {
  if (!url) return false;
  return url.toLowerCase().includes('.m3u8');
}

/**
 * 判断是否为直接视频文件 URL（.mp4, .ts 等，不含 .m3u8）
 * @param {string} url
 * @returns {boolean}
 */
function isDirectVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    (lower.includes('.mp4') ||
     lower.includes('.ts') ||
     lower.includes('.webm') ||
     lower.includes('.mkv') ||
     lower.includes('.mov') ||
     lower.includes('.flv')) &&
    !lower.includes('.m3u8')
  );
}

/**
 * 检测链接属于哪个平台
 *
 * 优先级：已知平台 > M3U8 > 直接视频 > 通用网页
 *
 * @param {string} url
 * @returns {string|null} 平台标识: douyin / kuaishou / xiaohongshu / m3u8 / generic / null
 */
function detectPlatform(url) {
  if (!url) return null;
  const u = url.toLowerCase();

  if (u.includes('douyin.com') || u.includes('iesdouyin.com') || u.includes('365yg.com')) {
    return 'douyin';
  }

  if (u.includes('kuaishou.com') || u.includes('gifshow.com')) {
    return 'kuaishou';
  }

  if (u.includes('xiaohongshu.com') || /xhslink\.(com|cn)/.test(u)) {
    return 'xiaohongshu';
  }

  // M3U8 流地址
  if (isM3u8Url(u)) {
    return 'm3u8';
  }

  // 直接视频文件链接
  if (isDirectVideoUrl(u)) {
    return 'generic';
  }

  // 其他任何 HTTP 链接，尝试通用网页提取
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return 'generic';
  }

  return null;
}

/**
 * 从抖音短链接中提取视频 ID
 * 例如: https://v.douyin.com/xxxx/ 重定向到 https://www.douyin.com/video/7661967642622781823
 * @param {string} url
 * @returns {string|null}
 */
function extractDouyinVideoId(url) {
  const match = url.match(/video\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 从快手链接中提取视频 ID
 * @param {string} url
 * @returns {string|null}
 */
function extractKuaishouVideoId(url) {
  const match = url.match(/(?:short-video|photo)\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 从小红书链接中提取笔记 ID
 * @param {string} url
 * @returns {string|null}
 */
function extractXiaohongshuNoteId(url) {
  const match = url.match(/discovery\/item\/([a-f0-9]+)/);
  if (match) return match[1];
  const match2 = url.match(/explore\/([a-f0-9]+)/);
  return match2 ? match2[1] : null;
}

/**
 * 从文本中提取第一个合法的 HTTP/HTTPS 链接
 * 用户从抖音/快手复制的内容通常包含文案+链接，需要把链接单独提取出来
 * @param {string} text
 * @returns {string}
 */
function extractUrl(text) {
  if (!text) return '';
  // 匹配 http:// 或 https:// 开头的链接，直到遇到空格或行尾
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : text;
}

module.exports = {
  detectPlatform,
  extractUrl,
  extractDouyinVideoId,
  extractKuaishouVideoId,
  extractXiaohongshuNoteId,
  isM3u8Url,
  isDirectVideoUrl,
};

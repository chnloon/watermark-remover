/**
 * URL 工具函数
 */

/**
 * 检测链接属于哪个平台
 * @param {string} url
 * @returns {string|null} 平台标识: douyin / kuaishou / xiaohongshu / null
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

  if (u.includes('xiaohongshu.com') || u.includes('xhslink.com')) {
    return 'xiaohongshu';
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
};

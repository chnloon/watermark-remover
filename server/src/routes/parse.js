/**
 * 解析路由 - 统一入口
 *
 * POST /api/parse
 *   Body: { url: string }
 *   Response: { success, platform, data }
 *
 * GET /api/platforms
 *   返回支持的平台列表
 */

const express = require('express');
const router = express.Router();
const { detectPlatform, extractUrl } = require('../utils/url');

const parsers = {
  douyin: require('../parsers/douyin'),
  kuaishou: require('../parsers/kuaishou'),
  xiaohongshu: require('../parsers/xiaohongshu'),
};

/**
 * POST /api/parse
 * 解析视频/图片链接
 */
router.post('/parse', async (req, res) => {
  const { url } = req.body;

  // 参数校验
  if (!url) {
    return res.status(400).json({
      success: false,
      error: '请提供需要解析的链接',
    });
  }

  // 从文本中提取真正的链接（用户粘贴的可能包含文案）
  const cleanUrl = extractUrl(url.trim());

  // 自动检测平台
  const platform = detectPlatform(cleanUrl);
  if (!platform) {
    return res.status(400).json({
      success: false,
      error: '暂不支持该平台的链接',
      supportedPlatforms: ['抖音', '快手', '小红书'],
    });
  }

  // 检查对应平台的解析器是否存在
  const parser = parsers[platform];
  if (!parser) {
    return res.status(500).json({
      success: false,
      platform,
      error: `该平台的解析器尚未实现: ${platform}`,
    });
  }

  try {
    const result = await parser.parse(cleanUrl);

    // 如果解析成功且是视频类型，添加代理播放地址
    if (result.success && result.data && result.data.videoUrl) {
      const protocol = req.protocol;
      const host = req.get('host');
      result.data.proxyVideoUrl = `${protocol}://${host}/proxy/video?url=${encodeURIComponent(result.data.videoUrl)}`;
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      platform,
      error: `服务器内部错误: ${err.message}`,
    });
  }
});

/**
 * GET /api/platforms
 * 获取支持的平台列表
 */
router.get('/platforms', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: 'douyin',
        name: '抖音',
        icon: '🎵',
        types: ['video'],
      },
      {
        id: 'kuaishou',
        name: '快手',
        icon: '🎬',
        types: ['video'],
      },
      {
        id: 'xiaohongshu',
        name: '小红书',
        icon: '📕',
        types: ['video', 'image'],
      },
    ],
  });
});

module.exports = router;

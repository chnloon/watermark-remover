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
const config = require('../config');
const { detectPlatform, extractUrl } = require('../utils/url');

const parsers = {
  douyin: require('../parsers/douyin'),
  kuaishou: require('../parsers/kuaishou'),
  xiaohongshu: require('../parsers/xiaohongshu'),
  m3u8: require('../parsers/m3u8video'),
  generic: require('../parsers/generic'),
};

/**
 * POST /api/parse
 * 解析视频/图片链接
 */
router.post('/parse', async (req, res) => {
  const rawUrl = req.body && req.body.url;

  // 参数校验（类型防护：url 必须是字符串）
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return res.status(400).json({
      success: false,
      error: '请提供需要解析的链接',
    });
  }

  // 从文本中提取真正的链接（用户粘贴的可能包含文案）
  const cleanUrl = extractUrl(rawUrl.trim());

  // 自动检测平台
  const platform = detectPlatform(cleanUrl);
  if (!platform) {
    return res.status(400).json({
      success: false,
      error: '暂不支持解析该链接，请粘贴正确的视频或网页地址',
      supportedPlatforms: ['抖音', '快手', '小红书', 'M3U8 流', '网页视频'],
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

	      // 如果解析成功，添加代理地址（视频播放 + 图片下载）
      if (result.success && result.data) {
        // 协议自适应：
        // - 本地开发（localhost/内网）：http，video 组件可正常播放
        // - 线上（CloudRun 网关）：对外只提供 https，但 req.protocol 恒为 http，
        //   小程序 iOS 的 video/wx.downloadFile 要求 https，因此线上必须用 https 构造
        const isLocalHost = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(req.get('host') || '');
        const protocol = isLocalHost ? 'http' : 'https';
        const host = req.get('host');
        const baseDownload = `${protocol}://${host}/api/download?url=`;
        const proxyVideoBase = `${protocol}://${host}/proxy/video?url=`;

        if (result.data.type === 'list' && Array.isArray(result.data.items)) {
          // 列表类型：为每个 item 注入代理 URL
          result.data.items = result.data.items.map((item) => {
            if (item.url) {
              item.proxyUrl = `${proxyVideoBase}${encodeURIComponent(item.url)}`;
            }
            return item;
          });
        } else {
          // 单视频
          if (result.data.videoUrl) {
            result.data.proxyVideoUrl = `${proxyVideoBase}${encodeURIComponent(result.data.videoUrl)}`;
          }

          if (result.data.images && Array.isArray(result.data.images)) {
            result.data.proxyImages = result.data.images.map((imgUrl) =>
              `${baseDownload}${encodeURIComponent(imgUrl)}`
            );
          }
        }
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
        icon: '/assets/icons/douyin.svg',
        types: ['video'],
      },
      {
        id: 'kuaishou',
        name: '快手',
        icon: '/assets/icons/kuaishou.svg',
        types: ['video'],
      },
      {
        id: 'xiaohongshu',
        name: '小红书',
        icon: '/assets/icons/xiaohongshu.svg',
        types: ['video', 'image'],
      },
      {
        id: 'm3u8',
        name: 'M3U8 流',
        icon: '',
        types: ['video'],
      },
      {
        id: 'generic',
        name: '网页视频',
        icon: '',
        types: ['video', 'list'],
      },
    ],
  });
});

/**
 * GET /api/debug/douyin
 * 返回最近一次抖音解析的诊断信息（失败原因链），用于线上排障
 */
router.get('/debug/douyin', (req, res) => {
  const getDiag = parsers.douyin.getLastDiagnostics;
  res.json({
    success: true,
    data: typeof getDiag === 'function' ? getDiag() : null,
  });
});

/**
 * GET /api/status
 * 检查服务的整体运行状态和第三方 API 配置情况
 */
router.get('/status', (req, res) => {
  const hasApi = !!config.thirdPartyApi.type;

  res.json({
    success: true,
    data: {
      service: 'watermark-remover',
      version: '1.0.0',
      thirdPartyApi: {
        configured: hasApi,
        type: config.thirdPartyApi.type,
        // 不暴露完整的 token/apiKey，仅告知是否已配置
        ready: hasApi,
      },
      platforms: ['douyin', 'kuaishou', 'xiaohongshu', 'm3u8', 'generic'],
      // 如果第三方 API 未配置，给出提示
      message: hasApi
        ? '服务正常，第三方解析 API 已就绪'
        : '第三方解析 API 未配置，解析将依赖直连/浏览器链路（抖音 H5 直连已启用）。',
    },
  });
});

module.exports = router;

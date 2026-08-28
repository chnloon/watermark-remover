/**
 * 第三方解析 API 服务
 *
 * 由于抖音、快手等平台有强反爬机制（X-Gorgon 签名等），
 * 直接调用平台 API 需要维护签名算法，成本极高。
 *
 * 生产环境中实际使用的是第三方解析服务：
 *   用户链接 → 你的后端 → 调用第三方API → 返回无水印地址 → 返回给小程序
 *
 * 使用方式:
 *   1. 在 config.js 中配置 apiKey
 *   2. 解析器优先尝试直连，失败后自动降级到第三方 API
 */

const axios = require('axios');
const qs = require('querystring');
const config = require('../config');

/**
 * 通用的第三方 API 解析入口
 * @param {string} url - 用户分享链接
 * @param {string} platform - 平台标识
 * @returns {Promise<object>}
 */
async function parseViaThirdParty(url, platform) {
  const provider = config.thirdPartyApi;
  if (!provider || !provider.type) {
    throw new Error('未配置第三方解析 API，请在 server/config.js 中设置 type');
  }

  switch (provider.type) {
    case 'media-parser':
      return await callMediaParser(url, platform, provider);
    case 'layzz':
      return await callLayzzApi(url, platform, provider);
    case 'custom':
      return await callCustomApi(url, platform, provider);
    case 'tiktokapi':
      return await callTikTokApi(url, platform, provider);
    case 'bugpk':
      return await callBugPkApi(url, platform, provider);
    default:
      throw new Error(`未知的 API 类型: ${provider.type}`);
  }
}

/**
 * 调用本地部署的 media-parser
 * POST /api/parse { text: "分享链接" }
 * 返回: { succ: true, data: { video_url, cover_url, title, author, image_list, platform } }
 */
async function callMediaParser(url, platform, provider) {
  const cfg = provider.mediaParser;
  if (!cfg || !cfg.endpoint) {
    throw new Error('media-parser 配置不完整，缺少 endpoint');
  }

  const response = await axios.post(
    cfg.endpoint,
    { text: url },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WatermarkRemover/1.0',
      },
      timeout: 30000,
    }
  );

  const data = response.data;

  if (!data.succ) {
    throw new Error(`media-parser 解析失败: ${data.retdesc || '未知错误'}`);
  }

  const result = data.data;
  const videoUrl = result.video_url || '';
  const images = result.image_list || [];

  return {
    success: true,
    data: {
      title: result.title || '',
      coverUrl: result.cover_url || '',
      videoUrl: videoUrl,
      images: images,
      author: {
        name: result.author?.nickname || '',
        avatar: result.author?.avatar || '',
      },
      type: videoUrl ? 'video' : (images.length > 0 ? 'image' : 'video'),
      duration: result.duration || 0,
    },
  };
}

/**
 * 调用 layzz.cn 解析 API
 * 接口文档: POST https://proxy.layzz.cn/lyz/platAnalyse/
 * Body: token + link (x-www-form-urlencoded)
 * 成功响应: { code: "0001", data: { playAddr, cover, desc, type, ... } }
 */
async function callLayzzApi(url, platform, provider) {
  const cfg = provider.layzz;
  if (!cfg || !cfg.token) {
    throw new Error('layzz.cn 配置不完整，缺少 token');
  }

  const response = await axios.post(
    cfg.endpoint,
    qs.stringify({
      token: cfg.token,
      link: url,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
      },
      timeout: 30000,
    }
  );

  const data = response.data;

  // 检查是否成功
  if (data.code !== '0001') {
    throw new Error(`layzz.cn 解析失败: ${data.message || data.msg || '未知错误'}`);
  }

  const result = data.data || data;
  const playAddr = result.playAddr || result.play_address || '';
  const images = result.images || result.imageList || [];
  const isVideo = !!playAddr;

  return {
    success: true,
    data: {
      title: result.desc || result.title || '',
      coverUrl: result.cover || result.coverUrl || '',
      videoUrl: isVideo ? playAddr : '',
      images: isVideo ? [] : images,
      author: {
        name: result.author || result.nickname || result.author_name || '',
        avatar: result.avatar || '',
      },
      type: isVideo ? 'video' : (images.length > 0 ? 'image' : 'video'),
    },
  };
}

/**
 * 调用自定义 API（可对接任意第三方解析服务）
 *
 * 如果你的第三方服务接口格式不同，可以在这里适配
 */
async function callCustomApi(url, platform, provider) {
  const response = await axios.post(
    provider.endpoint,
    {
      url: url,
      platform: platform,
      apikey: provider.apiKey,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WatermarkRemover/1.0',
      },
      timeout: 30000,
    }
  );

  const data = response.data;

  // 适配常见第三方 API 的返回格式
  // 如果格式不同，可以在这里做数据映射
  return {
    success: true,
    data: {
      title: data.title || data.desc || '',
      coverUrl: data.cover || data.coverUrl || '',
      videoUrl: data.url || data.videoUrl || data.playUrl || data.play_addr || '',
      images: data.images || data.pictures || [],
      author: {
        name: data.author || data.nickname || '',
        avatar: data.avatar || '',
      },
      type: data.type || (data.images ? 'image' : 'video'),
    },
  };
}

/**
 * 调用特定的第三方 API 格式
 */
async function callTikTokApi(url, platform, provider) {
  const response = await axios.get(provider.endpoint, {
    params: {
      url: url,
      token: provider.apiKey,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
    },
    timeout: 30000,
  });

  const data = response.data;

  return {
    success: true,
    data: {
      title: data.title || '',
      coverUrl: data.cover || '',
      videoUrl: data.video_url || data.url || '',
      images: data.images || [],
      author: {
        name: data.author || '',
        avatar: data.avatar || '',
      },
      type: data.type || 'video',
    },
  };
}

/**
 * 调用 BugPk API（免费抖音/快手无水印解析，无需 key）
 * 接口: GET https://api.bugpk.com/api/douyin?url=<encodeURIComponent(分享链接)>
 * 响应: { code: 200, msg: "解析成功-esa", data: { title, desc, author{name,avatar},
 *        cover, url, quality, duration, video_backup, images, video_id } }
 * ⚠️ 不支持 JSON body POST（会 400），必须 GET query 或表单
 */
async function callBugPkApi(url, platform, provider) {
  const endpoint =
    (provider.bugpk && provider.bugpk.endpoint) ||
    provider.endpoint ||
    'https://api.bugpk.com/api/douyin';
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Referer: 'https://api.bugpk.com/doc-douyin.html',
  };

  let response;
  try {
    response = await axios.get(endpoint, {
      params: { url },
      headers,
      timeout: 30000,
    });
  } catch (err) {
    // 偶发 20s 慢响应/超时，重试一次
    response = await axios.get(endpoint, {
      params: { url },
      headers,
      timeout: 30000,
    });
  }

  const data = response.data;
  if (!data || data.code !== 200) {
    throw new Error(`bugpk 解析失败: ${(data && data.msg) || '未知错误'}`);
  }

  const d = data.data || {};
  const videoUrl = d.url || d.video_backup || '';
  const images = d.images || [];
  const isVideo = !!videoUrl;

  return {
    success: true,
    data: {
      title: d.title || d.desc || '',
      coverUrl: d.cover || '',
      videoUrl: isVideo ? videoUrl : '',
      images: isVideo ? [] : images,
      author: {
        name: (d.author && d.author.name) || '',
        avatar: (d.author && d.author.avatar) || '',
      },
      type: isVideo ? 'video' : images.length > 0 ? 'image' : 'video',
      duration: d.duration || 0,
    },
  };
}

module.exports = { parseViaThirdParty };

/**
 * 服务器配置文件
 *
 * ═══════════════════════════════════════════════════════════════
 *  ✅ 解析能力：自研免费链路（无需第三方 API）
 *   - 抖音    ：H5 页面 SSR 数据 + JSON-LD 多策略提取
 *   - 快手    ：GraphQL + 页面 og:video 兜底
 *   - 小红书  ：SSR __INITIAL_STATE__ 提取无水印直链
 *   - M3U8 / 网页视频：直连提取
 *  thirdPartyApi 保留为可选付费兜底，type=null 即不启用
 * ═══════════════════════════════════════════════════════════════
 */

module.exports = {
  // 服务器端口
  port: process.env.PORT || 3001,

  // =========================================================
  // 第三方解析 API 配置（可选付费兜底，默认不启用）
  // =========================================================
  // 自研免费链路已覆盖抖音/快手/小红书/M3U8/网页视频，无需配置
  // 如需付费兜底，把 type 改为对应服务商并填写配置：
  //   'layzz' | 'media-parser' | 'custom' | 'tiktokapi' | null
  thirdPartyApi: {
    // null = 不启用（自研链路正常工作）
    type: null,

    // layzz.cn 配置（仅 type='layzz' 时需要）
    layzz: {
      endpoint: 'https://proxy.layzz.cn/lyz/platAnalyse/',
      token: '',  // ← 联系微信 Lany4567 购买
    },

    // 自部署解析器配置（仅 type='media-parser' 时需要）
    mediaParser: {
      endpoint: 'http://127.0.0.1:8051/api/parse',
    },

    // 通用配置（type='custom' 或 type='tiktokapi' 时需要）
    apiKey: '',
    endpoint: '',
  },

  // =========================================================
  // JWT 配置（用户身份认证）
  // =========================================================
  jwt: {
    secret: process.env.JWT_SECRET || 'watermark-remover-jwt-secret-2024',
    expiresIn: '30d',
  },

  // =========================================================
  // 微信小程序配置
  // =========================================================
  wechat: {
    appId: process.env.WECHAT_APP_ID || '',
    appSecret: process.env.WECHAT_APP_SECRET || '',
  },

  // (VIP 会员功能已移除 — 全部免费开放)
};

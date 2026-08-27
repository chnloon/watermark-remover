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
 *
 *  🔒 安全：所有密钥/Token 一律从环境变量读取（server/.env），
 *     不再硬编码在源码中（config.js 已被 git 跟踪，硬编码=密钥入库）。
 */

// 加载 server/.env（不存在时静默跳过，本地开发可用环境变量注入）
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  // 服务器端口
  port: process.env.PORT || 3001,

  // =========================================================
  // 第三方解析 API 配置（可选付费兜底，默认不启用）
  // =========================================================
  // 自研免费链路已覆盖抖音/快手/小红书/M3U8/网页视频，无需配置
  // 如需付费兜底，在 server/.env 中设置 THIRD_PARTY_API_TYPE：
  //   'layzz' | 'media-parser' | 'custom' | 'tiktokapi' | null
  thirdPartyApi: {
    // null = 不启用（自研链路正常工作）
    type: process.env.THIRD_PARTY_API_TYPE || null,

    // layzz.cn 配置（仅 type='layzz' 时需要）
    layzz: {
      endpoint: process.env.LAYZZ_ENDPOINT || 'https://proxy.layzz.cn/lyz/platAnalyse/',
      token: process.env.LAYZZ_TOKEN || '',
    },

    // 自部署解析器配置（仅 type='media-parser' 时需要）
    mediaParser: {
      endpoint: process.env.MEDIA_PARSER_ENDPOINT || 'http://127.0.0.1:8051/api/parse',
    },

    // 通用配置（type='custom' 或 type='tiktokapi' 时需要）
    apiKey: process.env.THIRD_PARTY_API_KEY || '',
    endpoint: process.env.THIRD_PARTY_ENDPOINT || '',
  },

  // =========================================================
  // JWT 配置（用户身份认证）
  // =========================================================
  jwt: {
    // 必须由环境变量提供，无默认值（生产环境缺失将拒绝启动）
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
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

// 生产环境强制校验：JWT_SECRET 缺失时拒绝启动，避免使用不安全默认值
if (isProduction && !config.jwt.secret) {
  console.error('✖ 生产环境必须配置 JWT_SECRET（写入 server/.env 后重启，参考 .env.example）');
  process.exit(1);
}

module.exports = config;

/**
 * 服务器配置文件
 *
 * ⚠️ 重要提示：
 *   抖音、快手等平台的直接解析需要处理复杂的反爬签名（X-Gorgon 等），
 *   生产环境中建议使用第三方解析 API 服务，按量计费，稳定可靠。
 *
 *   接口方案（任选其一）：
 *   1. 使用现有第三方解析 API（百度搜索"抖音去水印 API"可找到多家服务商）
 *   2. 自建解析器（需要定期维护签名算法，开发成本较高）
 */

module.exports = {
  // 服务器端口
  port: process.env.PORT || 3001,

  // 第三方解析 API 配置
  thirdPartyApi: {
    // 类型: 'layzz' | 'media-parser' | 'custom' | 'tiktokapi' | null
    //   - null: 不启用第三方 API
    //   - 'media-parser': 本地自部署解析服务（推荐，免费）
    //   - 'layzz': layzz.cn 解析服务
    //   - 'custom': 通用 POST JSON 格式
    //   - 'tiktokapi': TikTok API 格式
    type: 'media-parser',

    // media-parser 专用配置（本地自部署，免费）
    mediaParser: {
      endpoint: 'http://127.0.0.1:8051/api/parse',
    },

    // layzz.cn 专用配置
    layzz: {
      endpoint: 'https://proxy.layzz.cn/lyz/platAnalyse/',
      token: '',  // 联系作者微信 Lany4567 获取
    },

    // 通用配置（custom / tiktokapi 类型使用）
    apiKey: '',
    endpoint: '',
  },
};

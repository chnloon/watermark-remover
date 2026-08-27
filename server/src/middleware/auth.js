/**
 * JWT 认证中间件（宽松校验模式）
 *
 * - 请求携带 Authorization: Bearer <token>：必须签名有效，否则返回 401
 * - 未携带 Authorization：匿名放行（服务对匿名用户免费开放，防刷由限流负责）
 *
 * 作用：JWT 不再"只签发不校验"，伪造/过期 token 会被拒绝，
 * 同时不影响未登录用户的首次使用体验。
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports = function requireValidToken(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  // 未携带 token → 匿名放行
  if (!match) {
    return next();
  }

  try {
    const payload = jwt.verify(match[1], config.jwt.secret);
    req.user = { openid: payload.openid };
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: '登录状态已失效，请重新进入小程序',
    });
  }
};

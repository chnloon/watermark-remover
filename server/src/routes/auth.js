/**
 * 认证路由 - 微信小程序登录
 *
 * POST /api/auth/login    — 微信 code 换 JWT token
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const config = require('../config');

/**
 * POST /api/auth/login
 * 微信小程序登录：接收 wx.login 返回的 code，换取 openid + JWT
 */
router.post('/auth/login', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ success: false, error: '缺少微信登录 code' });
  }

  try {
    // 通过微信 API 换取 openid
    const wxResponse = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: config.wechat.appId,
        secret: config.wechat.appSecret,
        js_code: code,
        grant_type: 'authorization_code',
      },
      timeout: 10000,
    });

    const { openid, session_key, errcode, errmsg } = wxResponse.data;

    if (errcode) {
      console.error('[Auth] 微信登录失败:', errcode, errmsg);
      return res.status(401).json({ success: false, error: '微信登录失败: ' + (errmsg || '未知错误') });
    }

    if (!openid) {
      return res.status(401).json({ success: false, error: '获取用户身份失败' });
    }

    // 生成 JWT
    const token = jwt.sign(
      { openid },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      data: {
        token,
        openid,
      },
    });
  } catch (err) {
    console.error('[Auth] 登录错误:', err.message);
    res.status(500).json({ success: false, error: '登录失败，请稍后重试' });
  }
});

module.exports = router;

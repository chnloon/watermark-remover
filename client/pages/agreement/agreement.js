/**
 * 用户协议与隐私保护指引页
 */

Page({
  data: {
    // 协议版本与生效日期（更新时同步修改）
    version: 'v1.0（2026-08-27 生效）',
  },

  onLoad() {},

  onShow() {
    const app = getApp();
    if (app && app.applyBgTint) {
      app.applyBgTint(app.globalData.bgTint);
    }
  },
});

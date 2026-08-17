/**
 * 去水印助手 - 小程序入口
 */

// 后端服务地址
// 开发模式: 微信开发者工具 → 详情 → 本地设置 → 勾选"不校验合法域名"
// 生产模式: 替换为正式服务器域名
// 正式环境: 微信云托管 CloudRun 服务
const API_BASE_URL = 'https://watermark-remover-4181976-1256682929.ap-shanghai.run.tcloudbase.com/api';

App({
  // 全局数据
  globalData: {
    apiBaseUrl: API_BASE_URL,
    userToken: '',
    userOpenid: '',
    // 背景底色（2026-07-31 复刻 NEBULA 登录页）：
    // canvas #f3f4f7 近白固定、不随机换色——视觉层次完全交给两层柔光球
    // （蓝 0.22 左上出屏 / 橙 0.20 右下出屏，1640rpx 巨球模拟 blur(40px) 氛围光）
    bgTint: '#f3f4f7',
    platformNames: {
      douyin: '抖音',
      kuaishou: '快手',
      xiaohongshu: '小红书',
      m3u8: 'M3U8 流',
      generic: '网页视频',
    },
    platformIcons: {
      douyin: '🎵',
      kuaishou: '🎬',
      xiaohongshu: '📕',
      m3u8: '📺',
      generic: '🌐',
    },
  },

  onLaunch() {
    // 获取系统信息
    const sysInfo = wx.getSystemInfoSync();
    this.globalData.systemInfo = sysInfo;

    // 恢复本地缓存的 JWT Token
    const token = wx.getStorageSync('userToken');
    if (token) {
      this.globalData.userToken = token;
    }
    const openid = wx.getStorageSync('userOpenid');
    if (openid) {
      this.globalData.userOpenid = openid;
    }

    // 静默登录 — 获取 openid + JWT
    this.silentLogin();
  },

  /**
   * 取背景底色（固定近白 #f3f4f7，复刻登录页；不再随机换色）
   */
  getBgTint() {
    return this.globalData.bgTint;
  },

  /**
   * 应用背景底色：写入 globalData 并同步原生导航栏/tabBar 颜色，
   * 避免近白的系统条与彩色底色产生色差
   */
  applyBgTint(tint) {
    this.globalData.bgTint = tint;
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: tint });
    wx.setTabBarStyle({ backgroundColor: tint });
  },

  /**
   * 静默登录 — 通过 wx.login 获取 code，调用服务端换取 JWT
   */
  silentLogin() {
    // 如果已有有效 token，跳过
    if (this.globalData.userToken) return;

    wx.login({
      success: (res) => {
        if (res.code) {
          this.request('/auth/login', 'POST', { code: res.code })
            .then((result) => {
              if (result && result.token) {
                this.globalData.userToken = result.token;
                this.globalData.userOpenid = result.openid || '';
                wx.setStorageSync('userToken', result.token);
                if (result.openid) {
                  wx.setStorageSync('userOpenid', result.openid);
                }
              }
            })
            .catch((err) => {
              console.log('[登录] 静默登录失败（非关键）:', err.message);
            });
        } else {
          console.log('[登录] wx.login 失败:', res.errMsg);
        }
      },
      fail: (err) => {
        console.log('[登录] wx.login 异常:', err.errMsg);
      },
    });
  },

  /**
   * 统一的网络请求封装
   */
  request(url, method = 'GET', data = {}) {
    return new Promise((resolve, reject) => {
      const header = {
        'Content-Type': 'application/json',
      };
      // 自动附加 Authorization header
      const token = this.globalData.userToken;
      if (token) {
        header['Authorization'] = 'Bearer ' + token;
      }
      wx.request({
        url: `${API_BASE_URL}${url}`,
        method,
        data,
        header,
        timeout: 30000,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res.data);
          } else {
            reject(new Error(`请求失败: ${res.statusCode}`));
          }
        },
        fail: (err) => {
          reject(new Error(`网络错误: ${err.errMsg}`));
        },
      });
    });
  },

  /**
   * 显示提示
   */
  showToast(title, icon = 'none') {
    wx.showToast({
      title,
      icon,
      duration: 2000,
    });
  },
});

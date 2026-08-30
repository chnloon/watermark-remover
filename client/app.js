/**
 * 链接解析助手 - 小程序入口
 */

// 后端服务地址（多域名容灾：按顺序尝试，网络层失败自动切换下一个）
// 生产环境: 云川集官网域名（轻量服务器 Nginx 反向代理）
// 真机调试需在小程序后台把数组内所有域名都配为合法域名
// 未来新增备用服务器/域名时往数组加一项即可，前端零改动生效
const API_BASE_URLS = ['https://yc0717.cc/api'];

App({
  // 全局数据
  globalData: {
    // 当前生效的服务地址（请求拿到 HTTP 响应后刷新；proxy/download 地址用它拼接）
    apiBaseUrl: API_BASE_URLS[0],
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
    // 版权/合规声明统一由「用户协议与隐私保护指引」页承担，保存流程不再单独弹窗
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

    // 隐私保护指引：首次调用隐私接口（剪贴板/相册等）时弹出授权
    this.setupPrivacyListener();

    // 静默登录 — 获取 openid + JWT
    this.silentLogin();
  },

  /**
   * 隐私保护指引监听（__usePrivacyCheck__ 生效后必须实现）
   * 用户首次调用剪贴板/相册等隐私接口时，微信会触发该回调，
   * 必须调用 resolve 告知授权结果，否则接口永久挂起。
   */
  setupPrivacyListener() {
    if (!wx.onNeedPrivacyAuthorization) return; // 基础库过低，不启用弹窗

    wx.onNeedPrivacyAuthorization((resolve) => {
      wx.showModal({
        title: '隐私保护指引',
        content: '在使用本小程序前，请阅读并同意《用户协议与隐私保护指引》。\n\n我们仅在您主动点击时读取剪贴板链接，并在您确认后保存内容到相册；不会在后台收集您的任何个人信息。',
        confirmText: '同意并继续',
        cancelText: '不同意',
        success: (res) => {
          if (res.confirm) {
            wx.requirePrivacyAuthorize({
              success: () => resolve({ event: 'agree' }),
              fail: () => resolve({ event: 'disagree' }),
            });
          } else {
            resolve({ event: 'disagree' });
          }
        },
        fail: () => resolve({ event: 'disagree' }),
      });
    });
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
   * 统一的网络请求封装（带域名级容灾）
   * 网络层失败（域名不可达/DNS/超时/证书）自动尝试下一个备用域名；
   * 一旦收到 HTTP 响应（无论业务成败）就固定当前域名不再换线——
   * 服务器可达说明线路没问题，问题在业务本身。
   */
  request(url, method = 'GET', data = {}) {
    const token = this.globalData.userToken;
    return this.requestWithFailover(url, method, data, token, 0);
  },

  /**
   * 容灾递归体：第 index 个域名发起请求
   */
  requestWithFailover(url, method, data, token, index) {
    const base = API_BASE_URLS[index];
    return new Promise((resolve, reject) => {
      const header = {
        'Content-Type': 'application/json',
      };
      // 自动附加 Authorization header
      if (token) {
        header['Authorization'] = 'Bearer ' + token;
      }
      wx.request({
        url: `${base}${url}`,
        method,
        data,
        header,
        // 15s 超时兜底：解析最长等待不超过 15 秒，避免"粘贴后静默卡死"
        // （服务器抓取第三方平台正常 3-8 秒，超时即给明确提示让用户重试）
        timeout: 15000,
        success: (res) => {
          // 服务器可达 → 固定当前域名（业务失败也换线无意义）
          this.globalData.apiBaseUrl = base;
          if (res.statusCode === 200) {
            resolve(res.data);
          } else if (res.statusCode === 401 && url !== '/auth/login') {
            // token 失效/被拒 → 清除本地缓存并静默重登
            this.globalData.userToken = '';
            wx.removeStorageSync('userToken');
            this.silentLogin();
            reject(new Error('登录状态已失效，请重试'));
          } else {
            reject(new Error(`请求失败: ${res.statusCode}`));
          }
        },
        fail: (err) => {
          // 打印完整 errMsg，真机调试时方便定位（域名未配置/超时/证书等各不相同）
          console.error('[请求失败]', url, err.errMsg || err);
          if (index + 1 < API_BASE_URLS.length) {
            // 网络层不可达 → 切换下一个备用域名重试
            console.warn(`[容灾] 域名 ${base} 不可达，切换备用域名重试`);
            this.requestWithFailover(url, method, data, token, index + 1)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(`网络错误: ${err.errMsg}`));
          }
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

/**
 * 去水印助手 - 小程序入口
 */

// 后端服务地址（开发时用本地地址，生产时替换为服务器地址）
const API_BASE_URL = 'http://127.0.0.1:3001/api';

App({
  // 全局数据
  globalData: {
    apiBaseUrl: API_BASE_URL,
    platformNames: {
      douyin: '抖音',
      kuaishou: '快手',
      xiaohongshu: '小红书',
    },
    platformIcons: {
      douyin: '🎵',
      kuaishou: '🎬',
      xiaohongshu: '📕',
    },
  },

  onLaunch() {
    // 获取系统信息
    const sysInfo = wx.getSystemInfoSync();
    this.globalData.systemInfo = sysInfo;
  },

  /**
   * 统一的网络请求封装
   */
  request(url, method = 'GET', data = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${API_BASE_URL}${url}`,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
        },
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

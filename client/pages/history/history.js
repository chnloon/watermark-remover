/**
 * 历史记录页
 */

const app = getApp();

Page({
  data: {
    historyList: [],
    platformNames: {
      douyin: '抖音',
      kuaishou: '快手',
      xiaohongshu: '小红书',
    },
  },

  onShow() {
    this.loadHistory();
  },

  /**
   * 加载历史记录
   */
  loadHistory() {
    try {
      const history = wx.getStorageSync('parse_history') || [];
      this.setData({ historyList: history });
    } catch (err) {
      console.error('读取历史记录失败:', err);
    }
  },

  /**
   * 清空全部历史记录
   */
  onClearAll() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有解析记录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('parse_history', []);
          this.setData({ historyList: [] });
          app.showToast('已清空', 'success');
        }
      },
    });
  },

  /**
   * 格式化时间
   */
  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  /**
   * 重新解析（点击历史记录重新解析）
   */
  onReParse(e) {
    // 跳转到首页，后续可以扩展自动填入链接
    wx.switchTab({
      url: '/pages/index/index',
    });
  },

  /**
   * 跳转到解析页
   */
  onGoParse() {
    wx.switchTab({
      url: '/pages/index/index',
    });
  },
});

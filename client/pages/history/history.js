/**
 * 历史记录页 — Apple 「最近删除」风格
 * 按 今天 / 昨天 / 更早 分组展示
 */

const app = getApp();

Page({
  data: {
    showSkeleton: true,
    historySections: [],
    platformNames: {
      douyin: '抖音',
      kuaishou: '快手',
      xiaohongshu: '小红书',
    },
  },

  onLoad() {
    // 骨架屏展示 400ms
    setTimeout(() => {
      this.setData({ showSkeleton: false });
    }, 400);
  },

  onShow() {
    // 与主页共享同一背景底色
    app.applyBgTint(app.globalData.bgTint);
    this.setData({ bgTint: app.globalData.bgTint });
    if (!this.data.showSkeleton) {
      this.loadHistory();
    }
  },

  /**
   * 加载历史记录并分组
   */
  loadHistory() {
    try {
      const history = wx.getStorageSync('parse_history') || [];
      const sections = this.groupByTime(history);
      this.setData({ historySections: sections });
    } catch (err) {
      console.error('读取历史记录失败:', err);
    }
  },

  /**
   * 按时间分组：今天 / 昨天 / 更早
   */
  groupByTime(list) {
    if (!list || list.length === 0) return [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    const groups = { today: [], yesterday: [], earlier: [] };

    list.forEach((item) => {
      const ts = item.timestamp || 0;
      if (ts >= todayStart) {
        groups.today.push(item);
      } else if (ts >= yesterdayStart) {
        groups.yesterday.push(item);
      } else {
        groups.earlier.push(item);
      }
    });

    const sections = [];
    if (groups.today.length > 0) {
      sections.push({ label: '今天', items: groups.today });
    }
    if (groups.yesterday.length > 0) {
      sections.push({ label: '昨天', items: groups.yesterday });
    }
    if (groups.earlier.length > 0) {
      sections.push({ label: '更早', items: groups.earlier });
    }

    return sections;
  },

  /**
   * 清空全部 — 带确认弹窗
   */
  onClearAll() {
    wx.showModal({
      title: '清空全部记录？',
      content: '所有解析记录将被永久删除',
      confirmText: '清空',
      confirmColor: '#ff3b30',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('parse_history', []);
          this.setData({ historySections: [] });
          app.showToast('已清空', 'success');
        }
      },
    });
  },

  /**
   * 格式化时间 — 今天/昨天显示时间，更早显示日期
   */
  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (timestamp >= todayStart) {
      return `今天 ${hours}:${minutes}`;
    }
    if (timestamp >= yesterdayStart) {
      return `昨天 ${hours}:${minutes}`;
    }

    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  /**
   * 重新解析 — 带回链接到首页自动解析
   */
  onReParse(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      app.globalData.pendingHistoryUrl = url;
    }
    wx.switchTab({
      url: '/pages/index/index',
    });
  },

  /**
   * 跳转到解析页（空状态按钮）
   */
  onGoParse() {
    wx.switchTab({
      url: '/pages/index/index',
    });
  },

  /**
   * 右上角转发 — 分享入口
   */
  onShareAppMessage() {
    return {
      title: '短视频链接一键解析',
      path: '/pages/index/index',
    };
  },
});

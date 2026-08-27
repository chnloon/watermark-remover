/**
 * 首页 — 链接解析入口 (Apple Design)
 * 骨架屏、统一错误处理
 */

const app = getApp();

// 标记是否由粘贴按钮触发
let isPasteButtonClick = false;

Page({
  data: {
    inputUrl: '',
    isLoading: false,
    showSkeleton: false,
    autoFocus: false,

    // 平台列表 — 钢印风格 LOGO
    platforms: [
      { id: 'douyin', name: '抖音', image: '/images/douyin.svg' },
      { id: 'kuaishou', name: '快手', image: '/images/kuaishou.svg' },
      { id: 'xiaohongshu', name: '小红书', image: '/images/xiaohongshu.svg' },
    ],

    // 动态布局间距（适配异形屏/Android）
    topPadding: 0,
    bottomPadding: 0,
  },

  /**
   * 页面加载 — 计算动态布局 + 显示骨架屏
   */
  onLoad() {
    // 计算动态上下间距，适配 Android / 异形屏
    this._calcLayoutPadding();

    // 显示骨架屏 600ms（模拟优雅加载）
    this.setData({ showSkeleton: true });
    setTimeout(() => {
      this.setData({ showSkeleton: false });
    }, 600);
  },

  /**
   * 根据设备状态栏和胶囊位置计算上下间距
   */
  _calcLayoutPadding() {
    try {
      const sys = wx.getSystemInfoSync();
      const menuBtn = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;

      let topPad, bottomPad;

      if (menuBtn) {
        // 胶囊底部 + 16px 间距 = 标题起始位置
        topPad = menuBtn.top + menuBtn.height + 16;
      } else {
        // 降级：状态栏高度 + 固定值
        topPad = (sys.statusBarHeight || 44) + 20;
      }

      if (sys.safeArea) {
        // 底部安全距离
        const bottomInset = sys.screenHeight - sys.safeArea.bottom;
        bottomPad = Math.max(bottomInset, 12) + 12;
      } else {
        bottomPad = 24;
      }

      this.setData({
        topPadding: topPad,
        bottomPadding: bottomPad,
      });
    } catch (e) {
      // 降级默认值
      this.setData({ topPadding: 88, bottomPadding: 24 });
    }
  },

  /**
   * 页面显示 — 检测剪贴板（仅首次或从历史记录返回时）
   */
  onShow() {
    // 背景底色：复刻登录页近白 #f3f4f7 固定，三页共享同一背景
    const bgTint = app.getBgTint();
    app.applyBgTint(bgTint);
    this.setData({ bgTint });
    // 从历史记录返回时，自动填入并解析
    const pendingUrl = app.globalData.pendingHistoryUrl;
    if (pendingUrl) {
      app.globalData.pendingHistoryUrl = '';
      this.setData({ inputUrl: pendingUrl }, () => {
        this.doParse(pendingUrl);
      });
    }
  },

  /**
   * 输入变化 — 带节流自动解析
   */
  _parseDebounceTimer: null,

  onInputChange(e) {
    const val = e.detail.value;
    this.setData({ inputUrl: val });

    // 点击粘贴按钮填入的由 onPaste 处理
    if (isPasteButtonClick) {
      isPasteButtonClick = false;
      return;
    }

    if (this._parseDebounceTimer) {
      clearTimeout(this._parseDebounceTimer);
    }

    const trimmed = val.trim();
    if (trimmed.length > 10 && /https?:\/\//i.test(trimmed)) {
      this._parseDebounceTimer = setTimeout(() => {
        this.doParse(trimmed);
      }, 600);
    }
  },

  /**
   * 搜索栏按钮点击 — 从剪贴板粘贴 / 解析当前输入
   */
  async onSearchBarBtnTap() {
    if (this.data.inputUrl) {
      this.doParse(this.data.inputUrl.trim());
    } else {
      await this.onPaste();
    }
  },

  /**
   * 从剪贴板粘贴
   */
  async onPaste() {
    try {
      const res = await wx.getClipboardData({});
      if (res.data) {
        isPasteButtonClick = true;
        this.setData({
          inputUrl: res.data,
        }, () => {
          this.doParse(res.data.trim());
        });
      } else {
        app.showToast('剪贴板为空');
      }
    } catch (err) {
      app.showToast('读取剪贴板失败');
    }
  },

  /**
   * 键盘搜索键触发
   */
  onParseFromButton() {
    const url = this.data.inputUrl.trim();
    if (url) {
      this.doParse(url);
    }
  },

  /**
   * 统一错误处理 — 显示具体错误 + 重试
   */
  showError(title, retryUrl) {
    wx.showModal({
      title: '解析失败',
      content: title,
      confirmText: '重试',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm && retryUrl) {
          this.doParse(retryUrl);
        }
      },
    });
  },

  /**
   * 核心解析逻辑
   */
  async doParse(url) {
    this.setData({ isLoading: true });

    try {
      // 抖音短链统一交给后端解码：
      // - 前端 wx.request 请求 v.douyin.com 在真机被微信拦截（非合法域名）
      // - 后端无域名限制，可直接解码短链（302→完整链接）再解析
      const result = await app.request('/parse', 'POST', { url });

      if (!result.success) {
        this.setData({ isLoading: false });
        // 抖音解析失败：平台风控限制（服务器无法访问抖音），给出明确提示
        if (result.platform === 'douyin' || /抖音/.test(result.error || '')) {
          this.showError('抖音解析暂时不可用（平台限制），可尝试快手/小红书/网页视频', url);
        } else {
          this.showError(result.error || '解析失败，请检查链接是否有效', url);
        }
        return;
      }

      // 解析成功 — 存储并跳转
      app.globalData.lastParseResult = result;
      app.globalData.lastInputUrl = url;
      wx.navigateTo({
        url: '/pages/result/result',
      });
    } catch (err) {
      this.setData({ isLoading: false });
      const msg = err.message || '网络错误';

      if (msg.includes('timeout') || msg.includes('超时')) {
        this.showError('请求超时，请检查网络后重试', url);
      } else if (msg.includes('网络')) {
        this.showError('网络连接异常，请检查网络设置', url);
      } else {
        this.showError(msg + '，请稍后重试', url);
      }
    } finally {
      this.setData({ isLoading: false });
    }
  },

  /**
   * 打开用户协议与隐私保护指引页
   */
  onOpenAgreement() {
    wx.navigateTo({
      url: '/pages/agreement/agreement',
    });
  },
});

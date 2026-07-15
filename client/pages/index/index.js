/**
 * 首页 - 链接解析入口
 */

const app = getApp();

// 标记是否由粘贴按钮触发，用于区分手动粘贴 vs 点击粘贴按钮
let isPasteButtonClick = false;

Page({
  data: {
    inputUrl: '',
    isLoading: false,
    buttonText: '粘贴',
    platforms: [
      { id: 'douyin', name: '抖音', icon: '🎵', typesText: '视频' },
      { id: 'kuaishou', name: '快手', icon: '🎬', typesText: '视频' },
      { id: 'xiaohongshu', name: '小红书', icon: '📕', typesText: '视频/图片' },
    ],
  },

  /**
   * 输入框内容变化
   * - 点击粘贴按钮填入 → 在 onPaste 中处理，此处跳过
   * - 手动粘贴/输入 → 自动解析
   */
  onInputChange(e) {
    const val = e.detail.value;
    this.setData({ inputUrl: val });

    // 点击粘贴按钮填入的，onPaste 里会处理解析
    if (isPasteButtonClick) {
      isPasteButtonClick = false;
      return;
    }

    // 手动操作：内容看起来像链接 → 自动解析
    if (val.trim().length > 10) {
      this.doParse(val.trim());
    }
  },

  /**
   * 搜索栏按钮点击 — 始终从剪贴板粘贴并自动解析
   */
  async onSearchBarBtnTap() {
    await this.onPaste();
  },

  /**
   * 从剪贴板粘贴并立即解析
   */
  async onPaste() {
    try {
      const res = await wx.getClipboardData({});
      if (res.data) {
        isPasteButtonClick = true;
        this.setData({ inputUrl: res.data }, () => {
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
   * 核心解析逻辑
   */
  async doParse(url) {
    // 检测是否包含支持的平台域名
    const supportedDomains = ['douyin.com', 'iesdouyin.com', 'kuaishou.com', 'gifshow.com', 'xiaohongshu.com', 'xhslink.com'];
    const hasSupport = supportedDomains.some(domain => url.includes(domain));
    if (!hasSupport) {
      app.showToast('暂不支持该平台的链接');
      return;
    }

    this.setData({ isLoading: true });

    try {
      const result = await app.request('/parse', 'POST', { url });

      if (!result.success) {
        app.showToast(result.error || '解析失败，请检查链接');
        this.setData({ isLoading: false });
        return;
      }

      // 解析成功，存储结果并跳转
      app.globalData.lastParseResult = result;
      app.globalData.lastInputUrl = url;
      wx.navigateTo({
        url: '/pages/result/result',
      });
    } catch (err) {
      app.showToast(err.message || '网络错误，请稍后重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },
});

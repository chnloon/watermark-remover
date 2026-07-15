/**
 * 结果页 - 展示解析结果
 */

const app = getApp();

Page({
  data: {
    resultData: null,
    platformName: '',
    platformIcon: '',
    isSaving: false,
    currentImageIndex: 0,
    videoStatus: '正在加载视频...',
    currentUrl: '',
  },

  onLoad() {
    const result = app.globalData.lastParseResult;
    if (!result) {
      app.showToast('数据丢失，请重新解析');
      wx.navigateBack();
      return;
    }

    this.setData({
      resultData: result,
      currentUrl: app.globalData.lastInputUrl || '',
    });

    // 设置平台信息
    const platformNames = app.globalData.platformNames;
    const platformIcons = app.globalData.platformIcons;
    const platform = result.platform;
    this.setData({
      platformName: platformNames[platform] || platform,
      platformIcon: platformIcons[platform] || '🌐',
    });

    // 保存到历史记录
    this.saveToHistory(result);
  },

  /**
   * 粘贴栏输入变化
   */
  onUrlInput(e) {
    this.setData({ currentUrl: e.detail.value });
  },

  /**
   * 从剪贴板粘贴并重新解析
   */
  async onPasteUrl() {
    try {
      const res = await wx.getClipboardData({});
      if (res.data) {
        this.setData({ currentUrl: res.data }, () => {
          // 自动触发解析
          this.reParse();
        });
      } else {
        app.showToast('剪贴板为空');
      }
    } catch (err) {
      app.showToast('读取剪贴板失败');
    }
  },

  /**
   * 清空输入
   */
  onClearUrl() {
    this.setData({ currentUrl: '' });
  },

  /**
   * 用新链接重新解析
   */
  async reParse() {
    const url = this.data.currentUrl.trim();
    if (!url) {
      app.showToast('请先粘贴链接');
      return;
    }

    // 检测平台
    const supportedDomains = ['douyin.com', 'iesdouyin.com', 'kuaishou.com', 'gifshow.com', 'xiaohongshu.com', 'xhslink.com'];
    const hasSupport = supportedDomains.some(domain => url.includes(domain));
    if (!hasSupport) {
      app.showToast('暂不支持该平台的链接');
      return;
    }

    app.showToast('正在解析...', 'loading');

    try {
      const result = await app.request('/parse', 'POST', { url });

      if (!result.success) {
        app.showToast(result.error || '解析失败');
        return;
      }

      app.globalData.lastParseResult = result;
      app.globalData.lastInputUrl = url;

      // 在当前页面刷新
      this.setData({
        resultData: result,
        currentUrl: url,
      });

      // 更新平台信息
      const platformNames = app.globalData.platformNames;
      const platformIcons = app.globalData.platformIcons;
      const platform = result.platform;
      this.setData({
        platformName: platformNames[platform] || platform,
        platformIcon: platformIcons[platform] || '🌐',
        videoStatus: '正在加载视频...',
      });

      // 保存历史
      this.saveToHistory(result);
      wx.hideToast();
    } catch (err) {
      app.showToast(err.message || '网络错误');
    }
  },

  /**
   * 视频加载就绪
   */
  onVideoReady() {
    this.setData({ videoStatus: '' });
  },

  /**
   * 视频播放错误时，尝试用原地址播放
   */
  onVideoError(e) {
    console.error('视频播放失败:', e.detail);
    const resultData = this.data.resultData;
    if (resultData && resultData.data) {
      const proxyUrl = resultData.data.proxyVideoUrl;
      const directUrl = resultData.data.videoUrl;
      if (proxyUrl && directUrl) {
        resultData.data.proxyVideoUrl = '';
        this.setData({ resultData: resultData });
        app.showToast('正在切换播放源...');
      }
    }
  },

  /**
   * 复制文案
   */
  onCopyDesc() {
    const text = this.data.resultData.data.title;
    if (!text) {
      app.showToast('暂无文案内容');
      return;
    }

    wx.setClipboardData({
      data: text,
      success: () => {
        app.showToast('✅ 文案已复制', 'success');
      },
      fail: () => {
        app.showToast('复制失败');
      },
    });
  },

  /**
   * 复制链接
   */
  onCopyLink(e) {
    const link = e.currentTarget.dataset.link;
    if (!link) {
      app.showToast('链接无效');
      return;
    }

    wx.setClipboardData({
      data: link,
      success: () => {
        app.showToast('✅ 已复制到剪贴板', 'success');
      },
      fail: () => {
        app.showToast('复制失败');
      },
    });
  },

  /**
   * 保存视频到相册
   */
  async onSaveVideo() {
    const videoUrl = this.data.resultData.data.proxyVideoUrl || this.data.resultData.data.videoUrl;
    if (!videoUrl) {
      app.showToast('视频地址无效');
      return;
    }

    this.setData({ isSaving: true });

    // 通过后端下载接口中转，避免小程序域名白名单限制
    const downloadUrl = app.globalData.apiBaseUrl.replace('/api', '') + '/api/download?url=' + encodeURIComponent(videoUrl);

    try {
      const downloadRes = await wx.downloadFile({
        url: downloadUrl,
        timeout: 120000,
      });

      if (downloadRes.statusCode !== 200) {
        throw new Error('下载失败 (状态码: ' + downloadRes.statusCode + ')');
      }

      await wx.saveVideoToPhotosAlbum({
        filePath: downloadRes.tempFilePath,
      });

      app.showToast('✅ 已保存到相册', 'success');
    } catch (err) {
      console.error('保存视频失败:', err);
      if (err.errMsg && err.errMsg.includes('auth')) {
        try {
          await wx.authorize({
            scope: 'scope.writePhotosAlbum',
          });
          return this.onSaveVideo();
        } catch (authErr) {
          app.showToast('请开启相册权限');
          return;
        }
      }
      app.showToast('保存失败: ' + (err.errMsg || err.message));
    } finally {
      this.setData({ isSaving: false });
    }
  },

  /**
   * 保存图片到相册
   */
  async onSaveImages() {
    const images = this.data.resultData.data.images;
    if (!images || images.length === 0) {
      app.showToast('图片地址无效');
      return;
    }

    this.setData({ isSaving: true });

    try {
      for (let i = 0; i < images.length; i++) {
        const downloadRes = await wx.downloadFile({
          url: images[i],
          timeout: 30000,
        });

        if (downloadRes.statusCode !== 200) {
          console.error(`图片 ${i + 1} 下载失败`);
          continue;
        }

        await wx.saveImageToPhotosAlbum({
          filePath: downloadRes.tempFilePath,
        });

        app.showToast(`已保存 ${i + 1}/${images.length}`, 'success');
      }
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('auth')) {
        const authRes = await wx.authorize({
          scope: 'scope.writePhotosAlbum',
        });
        if (authRes) {
          return this.onSaveImages();
        }
      }
      app.showToast('保存失败: ' + (err.errMsg || err.message));
    } finally {
      this.setData({ isSaving: false });
    }
  },

  /**
   * 保存到历史记录
   */
  saveToHistory(result) {
    try {
      const history = wx.getStorageSync('parse_history') || [];
      const record = {
        id: Date.now().toString(36),
        platform: result.platform,
        title: result.data.title || '(无标题)',
        coverUrl: result.data.coverUrl || '',
        type: result.data.type || 'video',
        timestamp: Date.now(),
      };

      const updated = [record, ...history].slice(0, 50);
      wx.setStorageSync('parse_history', updated);
    } catch (err) {
      console.error('保存历史记录失败:', err);
    }
  },

  /**
   * 返回首页
   */
  onBack() {
    wx.navigateBack();
  },
});

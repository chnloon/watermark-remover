/**
 * 结果页 — Apple Music 风格展示
 * 视频/图片预览、保存、复制、重新解析
 */

const app = getApp();

Page({
  data: {
    resultData: null,
    isSaving: false,
	    isSavingListItem: false,
	    currentSaveIndex: -1,
	    imageSaveProgress: null,
	    currentImageIndex: 0,
    videoStatus: '正在加载视频...',
    videoError: false,
    currentUrl: '',
    autoFocus: false,
    hasVideoUrl: false,
    // 预览默认播原画直链（服务器纯反代秒开）；转码流仅作原画失败时的弱网兜底
    fallbackVideoUrl: '',
    playingFallback: false,
    selectedImages: [],
    selectedCount: 0,
    allSelected: false,
    // 图片预览：先 wx.downloadFile 下载到本地临时文件再展示（本地路径渲染无防盗链/域名限制）
    localImages: [],
    imageLoading: [],
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
      // 输入框保持空白，方便用户重新粘贴新链接解析
      currentUrl: '',
      // 视频地址缺失时渲染浅色占位，避免空 src 的 video 黑底
      hasVideoUrl: !!(result.data.proxyVideoUrl || result.data.videoUrl),
      // 图片多选：初始全部未选中
      selectedImages: result.data.type === 'image' ? (result.data.images || []).map(() => false) : [],
      selectedCount: 0,
      allSelected: false,
      localImages: result.data.type === 'image' ? (result.data.images || []).map(() => '') : [],
      imageLoading: result.data.type === 'image' ? (result.data.images || []).map(() => true) : [],
      // 预览默认播原画直链（秒开）；转码流存为兜底，仅原画播放失败时启用
      fallbackVideoUrl: this._buildLowVideoUrl(result),
      playingFallback: false,
    });

    // 保存到历史记录
    this.saveToHistory(result);

    // 预加载 — 解析成功后立即预取视频头（减少播放等待）
    this.preloadVideo(result);

    // 图片笔记：立即下载到本地供预览展示
    this.preloadImages();
  },

  /**
   * 页面显示 — 与主页共享同一背景底色
   */
  onShow() {
    // 与主页共享同一背景底色（同步原生导航栏，避免白条色差）
    app.applyBgTint(app.globalData.bgTint);
    this.setData({ bgTint: app.globalData.bgTint });
  },

  /**
   * 生成"流畅模式"转码地址（后端 ffmpeg 实时转 480p 低码率）
   * 仅作原画播放失败时的弱网兜底，不参与默认播放
   */
  _buildLowVideoUrl(result) {
    const videoUrl = result && result.data && result.data.videoUrl;
    if (!videoUrl) return '';
    return app.globalData.apiBaseUrl.replace('/api', '') + '/proxy/video_low?url=' + encodeURIComponent(videoUrl);
  },

  /**
   * 预加载视频头
   */
  preloadVideo(result) {
    if (!result || !result.data || result.data.type !== 'video') return;
    // 预览默认播原画直链，预取前 256KB 能明显减少首帧等待（避免播放器整段拉流才起播）
    const videoUrl = result.data.videoUrl;
    if (!videoUrl) return;

    // 仅请求前 256KB 预缓存
    wx.request({
      url: app.globalData.apiBaseUrl.replace('/api', '') + '/proxy/video?url=' + encodeURIComponent(videoUrl),
      header: { Range: 'bytes=0-262144' },
      method: 'GET',
      responseType: 'arraybuffer',
      success: () => {
        console.log('[预加载] 视频头预取成功');
      },
      fail: (err) => {
        console.log('[预加载] 视频头预取失败（非关键）:', err.errMsg);
      },
    });
  },

  /**
   * 图片笔记预览 — 先下载到本地临时文件再展示
   *
   * 为什么不用 <image> 直接加载远程 URL：
   * 小程序 image 组件请求不带 Referer，直连 xhscdn 图床被防盗链拒绝（403）；
   * 代理 URL 又受 downloadFile/request 合法域名与响应头限制。
   * 改为 wx.downloadFile 把图拉到本地（临时文件路径 wxfile:// 渲染无任何限制），
   * 与保存相册走同一条已验证可用的链路，预览必然出图。
   */
  preloadImages() {
    const images = this.data.resultData && this.data.resultData.data.images;
    const proxyImages = this.data.resultData && this.data.resultData.data.proxyImages;
    if (!images || !Array.isArray(images) || images.length === 0) return;

    // 页面卸载后不再 setData（下载回调是异步的）
    this._pageAlive = true;

    // 并发 3 张下载，逐张完成后增量 setData（不阻塞滚动）
    const concurrency = 3;
    let cursor = 0;
    const worker = async () => {
      while (this._pageAlive && cursor < images.length) {
        const i = cursor++;
        const directUrl = images[i];
        const proxyUrl = (proxyImages && proxyImages[i]) || '';

        let tempFilePath = '';
        // 直连优先（手机 IP 直连图床通常可访问）；域名校验/失败自动走代理
        if (directUrl) {
          try {
            const res = await wx.downloadFile({ url: directUrl, timeout: 30000 });
            if (res.statusCode === 200) tempFilePath = res.tempFilePath;
          } catch { /* 直连失败走代理 */ }
        }
        if (!tempFilePath && proxyUrl && proxyUrl !== directUrl) {
          try {
            const res = await wx.downloadFile({ url: proxyUrl, timeout: 45000 });
            if (res.statusCode === 200) tempFilePath = res.tempFilePath;
          } catch (err) {
            console.error(`图片 ${i + 1} 下载失败:`, err.errMsg || err);
          }
        }

        if (!this._pageAlive) return;
        const patch = { [`imageLoading[${i}]`]: false };
        if (tempFilePath) patch[`localImages[${i}]`] = tempFilePath;
        this.setData(patch);
      }
    };
    for (let k = 0; k < concurrency; k++) worker();
  },

  /**
   * 页面卸载 — 中止图片下载回调，避免对已销毁页面 setData
   */
  onUnload() {
    this._pageAlive = false;
  },

  /**
   * 粘贴栏输入变化
   * 手动输入时按钮随内容切换（有内容→清空，空白→粘贴）
   */
  onUrlInput(e) {
    this.setData({ currentUrl: e.detail.value });
  },

  /**
   * 底部按钮点击 — 双态:
   * - currentUrl 为空: 从剪贴板粘贴并自动解析
   * - currentUrl 非空: 一键清空输入框
   */
  onReparseBarBtn() {
    if (this.data.currentUrl) {
      // 有内容 → 清空
      this.setData({ currentUrl: '' });
      app.showToast('已清空', 'success');
    } else {
      this.onPasteUrl();
    }
  },

  /**
   * 从剪贴板粘贴并自动解析
   */
  async onPasteUrl() {
    try {
      // 主动请求隐私授权；失败不阻断——继续调 getClipboardData，
      // 由它触发隐私弹窗（后台指引生效时），或自行失败再降级
      if (wx.requirePrivacyAuthorize) {
        try {
          await new Promise((resolve, reject) => {
            wx.requirePrivacyAuthorize({ success: resolve, fail: reject });
          });
        } catch (e) {
          console.warn('[粘贴] requirePrivacyAuthorize 未通过，继续尝试读取剪贴板:', e);
        }
      }
      const res = await wx.getClipboardData({});
      if (res.data) {
        this.setData({ currentUrl: res.data }, () => {
          this.onReParse();
        });
      } else {
        app.showToast('剪贴板为空');
      }
    } catch (err) {
      // 真机调试时可在 Console 查看具体 errMsg（如隐私未授权）
      console.error('[粘贴] 读取剪贴板失败:', err);
      const msg = (err && (err.errMsg || err.message)) || '';
      let content = '请长按下方输入框，选择"粘贴"后点击解析。';
      if (/privacy|auth/i.test(msg)) {
        content = '未获得剪贴板授权：请确认小程序后台「用户隐私保护指引」已通过审核且声明了「剪贴板」，并在授权弹窗点击「同意并继续」。也可长按下方输入框手动粘贴。';
      }
      wx.showModal({
        title: '无法读取剪贴板',
        content,
        showCancel: false,
        confirmText: '好的',
        success: () => {
          // 聚焦输入框，方便用户直接长按粘贴
          this.setData({ autoFocus: true });
        },
      });
    }
  },

  /**
   * 重新解析（输入框确认 或 粘贴后自动）
   * 防"植物人"：解析期间忽略重复触发（连点不并发）；15s 超时由 app.request 兜底，
   * 失败分类提示并立即恢复可操作状态
   */
  onReParse() {
    const url = this.data.currentUrl.trim();
    if (!url) {
      app.showToast('请先粘贴链接');
      return;
    }
    if (this._reparsing) return; // 正在解析中，忽略重复触发
    this._reparsing = true;

    app.showToast('正在解析...', 'loading');

    app.request('/parse', 'POST', { url })
      .then((result) => {
        if (!result.success) {
          wx.hideToast();
          app.showToast(result.error || '解析失败');
          return;
        }

        app.globalData.lastParseResult = result;
        app.globalData.lastInputUrl = url;

        this.setData({
          resultData: result,
          // 解析成功后清空输入框，保持空白方便继续粘贴新链接
          currentUrl: '',
          videoStatus: '正在加载视频...',
          videoError: false,
          // 图片多选状态重置：初始全部未选中
          selectedImages: result.data.type === 'image' ? (result.data.images || []).map(() => false) : [],
          selectedCount: 0,
          allSelected: false,
          localImages: result.data.type === 'image' ? (result.data.images || []).map(() => '') : [],
          imageLoading: result.data.type === 'image' ? (result.data.images || []).map(() => true) : [],
          // 重新解析后重新生成"流畅"转码地址（仅作弱网兜底，默认仍播原画）
          fallbackVideoUrl: this._buildLowVideoUrl(result),
          playingFallback: false,
        });

        this.saveToHistory(result);
        this.preloadVideo(result);
        this.preloadImages();
        wx.hideToast();
      })
      .catch((err) => {
        wx.hideToast();
        // 分类提示：超时 / 网络异常给可操作的文案，避免裸抛底层 errMsg
        const msg = (err && err.message) || '网络错误';
        if (msg.includes('timeout') || msg.includes('超时')) {
          app.showToast('解析超时，请稍后重试');
        } else if (msg.includes('网络')) {
          app.showToast('网络连接异常，请检查网络设置');
        } else {
          app.showToast(msg);
        }
      })
      .then(() => {
        this._reparsing = false;
      });
  },

  /**
   * 图片轮播切换
   */
  onSwiperChange(e) {
    this.setData({ currentImageIndex: e.detail.current });
  },

  /**
   * 切换单张图片的选中状态
   * 全选状态下依然可取消单张勾选；全部取消后按钮自动回到"全选"
   */
  onToggleImage(e) {
    const index = e.currentTarget.dataset.index;
    const selected = this.data.selectedImages.slice();
    if (index >= 0 && index < selected.length) {
      selected[index] = !selected[index];
      this.setData({
        selectedImages: selected,
        selectedCount: selected.filter(Boolean).length,
        // 所有图片都选中 → 按钮显示"全不选"；否则显示"全选"
        allSelected: selected.length > 0 && selected.every(Boolean),
      });
    }
  },

  /**
   * 顶部按钮 — 单按钮切换:
   * - 当前非全选 → 全选所有图片，按钮变"全不选"
   * - 当前全选 → 取消所有勾选，按钮变"全选"
   */
  onToggleSelectAll() {
    const total = this.data.selectedImages.length;
    const allOn = this.data.allSelected;
    const selected = allOn
      ? this.data.selectedImages.map(() => false)   // 全不选
      : this.data.selectedImages.map(() => true);    // 全选

    this.setData({
      selectedImages: selected,
      selectedCount: allOn ? 0 : total,
      allSelected: !allOn,
    });
    if (!allOn) {
      app.showToast('已全选');
    }
  },

  /**
   * 视频加载就绪
   */
  onVideoReady() {
    this.setData({ videoStatus: '', videoError: false });
  },

  /**
   * 视频播放错误时，尝试切换源
   * 源优先级: 原画代理(秒开) → 流畅转码流(弱网兜底) → 直链 → 错误 UI
   */
  onVideoError(e) {
    console.error('视频播放失败:', e.detail);
    // 原画播放失败（多为弱网高码率抖动/防盗链）→ 自动回落流畅转码流
    // 页面内状态文字轻提示，不弹窗打断观看
    if (this.data.fallbackVideoUrl && !this.data.playingFallback) {
      this.setData({
        playingFallback: true,
        videoStatus: '已切换为流畅模式',
        videoError: false,
      });
      return;
    }
    const resultData = this.data.resultData;
    if (resultData && resultData.data) {
      const proxyUrl = resultData.data.proxyVideoUrl;
      const directUrl = resultData.data.videoUrl;
      if (proxyUrl && directUrl) {
        // 尝试切换到直接地址
        resultData.data.proxyVideoUrl = '';
        this.setData({ resultData: resultData, videoStatus: '切换源中...' });
        app.showToast('正在切换播放源...');
        setTimeout(() => {
          if (this.data.videoStatus !== '') {
            this.setData({ videoError: true, videoStatus: '' });
          }
        }, 5000);
      } else {
        this.setData({ videoError: true, videoStatus: '' });
      }
    }
  },

  /**
   * 视频重试
   */
  onVideoRetry() {
    const resultData = this.data.resultData;
    if (!resultData || !resultData.data) return;
    const original = app.globalData.lastParseResult;
    if (original && original.data && original.data.proxyVideoUrl) {
      resultData.data.proxyVideoUrl = original.data.proxyVideoUrl;
    }
    this.setData({
      resultData: resultData,
      videoStatus: '正在重新加载...',
      videoError: false,
      playingFallback: false,
    });
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
   * 检查并索取相册权限
   * - 已授权: 直接返回 true
   * - 未授权: 调用 wx.authorize 主动索取（弹出系统授权框）
   * - 曾被拒绝: 弹窗引导用户去设置页开启
   * @returns {Promise<boolean>} 是否获得权限
   */
  ensureAlbumPermission() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const auth = res.authSetting['scope.writePhotosAlbum'];
          if (auth === true) {
            // 已授权
            resolve(true);
          } else if (auth === false) {
            // 曾被拒绝 → 只能引导去设置
            wx.showModal({
              title: '需要相册权限',
              content: '保存视频需要相册权限，请在设置中开启「保存到相册」',
              confirmText: '去设置',
              cancelText: '取消',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.openSetting({
                    success: (settingRes) => {
                      resolve(!!settingRes.authSetting['scope.writePhotosAlbum']);
                    },
                    fail: () => resolve(false),
                  });
                } else {
                  resolve(false);
                }
              },
              fail: () => resolve(false),
            });
          } else {
            // 从未询问过 → 主动索取
            wx.authorize({
              scope: 'scope.writePhotosAlbum',
              success: () => resolve(true),
              fail: () => {
                // 用户拒绝授权 → 引导去设置
                wx.showModal({
                  title: '需要相册权限',
                  content: '保存视频需要相册权限，请在设置中开启「保存到相册」',
                  confirmText: '去设置',
                  cancelText: '取消',
                  success: (modalRes) => {
                    if (modalRes.confirm) {
                      wx.openSetting({
                        success: (settingRes) => {
                          resolve(!!settingRes.authSetting['scope.writePhotosAlbum']);
                        },
                        fail: () => resolve(false),
                      });
                    } else {
                      resolve(false);
                    }
                  },
                  fail: () => resolve(false),
                });
              },
            });
          }
        },
        fail: () => resolve(true), // 读不到设置时放行，让保存流程自己报错
      });
    });
  },

  /**
   * 保存视频到相册
   * 流程: 点击 → 主动索取相册权限 → 下载视频直链 → 存入相册
   */
  async onSaveVideo() {
    // 保存用原始 videoUrl（proxyVideoUrl 是给 video 组件播放的代理地址，
    // 再套 /api/download 会二次代理多一跳浪费流量）
    const videoUrl = this.data.resultData.data.videoUrl;
    if (!videoUrl) {
      app.showToast('视频地址无效');
      return;
    }

    // 第一步: 主动索取相册权限
    const granted = await this.ensureAlbumPermission();
    if (!granted) {
      app.showToast('未获得相册权限，无法保存');
      return;
    }

    this.setData({ isSaving: true });

    const downloadUrl = app.globalData.apiBaseUrl.replace('/api', '') + '/api/download?url=' + encodeURIComponent(videoUrl);

    try {
      const downloadRes = await wx.downloadFile({
        url: downloadUrl,
        timeout: 120000,
      });

      if (downloadRes.statusCode !== 200) {
        throw new Error('下载失败，状态码：' + downloadRes.statusCode);
      }

      await wx.saveVideoToPhotosAlbum({
        filePath: downloadRes.tempFilePath,
      });

      app.showToast('✅ 已保存到相册', 'success');
    } catch (err) {
      console.error('保存视频失败:', err);
      app.showToast('保存失败: ' + (err.errMsg || err.message));
    } finally {
      this.setData({ isSaving: false });
    }
  },

  /**
   * 保存列表中的单个视频到相册
   */
  async onSaveListItem(e) {
    const index = e.currentTarget.dataset.index;
    const items = this.data.resultData.data.items;
    if (!items || index < 0 || index >= items.length) {
      app.showToast('视频地址无效');
      return;
    }

    const item = items[index];
    // 保存用原始 url（proxyUrl 是播放代理，套 download 会二次代理）
    const videoUrl = item.url;
    if (!videoUrl) {
      app.showToast('视频地址无效');
      return;
    }

    // 主动索取相册权限
    const granted = await this.ensureAlbumPermission();
    if (!granted) {
      app.showToast('未获得相册权限，无法保存');
      return;
    }

    this.setData({ isSavingListItem: true, currentSaveIndex: index });

    const downloadUrl = app.globalData.apiBaseUrl.replace('/api', '') + '/api/download?url=' + encodeURIComponent(videoUrl);

    try {
      const downloadRes = await wx.downloadFile({
        url: downloadUrl,
        timeout: 120000,
      });

      if (downloadRes.statusCode !== 200) {
        throw new Error('下载失败，状态码：' + downloadRes.statusCode);
      }

      await wx.saveVideoToPhotosAlbum({
        filePath: downloadRes.tempFilePath,
      });

      app.showToast('✅ 已保存到相册', 'success');
    } catch (err) {
      console.error('保存视频失败:', err);
      app.showToast('保存失败: ' + (err.errMsg || err.message));
    } finally {
      this.setData({ isSavingListItem: false, currentSaveIndex: -1 });
    }
  },

  /**
   * 保存图片到相册 — 只保存用户选中的图片
   * 优先直连原始 URL（用户手机 IP 可信，图床不风控），失败再走代理兜底
   */
  async onSaveImages() {
    const images = this.data.resultData.data.images;
    // 预览用 /proxy/image（下载到本地展示）；保存专用 /api/download（原图 + 多线程 + 签名自愈）
    const downloadProxyBase = app.globalData.apiBaseUrl.replace('/api', '') + '/api/download?url=';
    if (!images || images.length === 0) {
      app.showToast('图片地址无效');
      return;
    }

    // 收集选中的图片索引
    const selected = this.data.selectedImages || [];
    const selectedIndexes = [];
    for (let i = 0; i < selected.length; i++) {
      if (selected[i]) selectedIndexes.push(i);
    }

    if (selectedIndexes.length === 0) {
      app.showToast('请先选择要保存的图片');
      return;
    }

    // 主动索取相册权限
    const granted = await this.ensureAlbumPermission();
    if (!granted) {
      app.showToast('未获得相册权限，无法保存');
      return;
    }

    this.setData({
      isSaving: true,
      imageSaveProgress: { current: 0, total: selectedIndexes.length },
    });

    let savedCount = 0;
    try {
      for (let k = 0; k < selectedIndexes.length; k++) {
        const i = selectedIndexes[k];
        // 优先直连原始图片 URL（手机 IP 可访问图床）
        const directUrl = images[i];
        const proxyUrl = downloadProxyBase + encodeURIComponent(directUrl);

        let downloadRes = null;
        try {
          downloadRes = await wx.downloadFile({ url: directUrl, timeout: 60000 });
          if (downloadRes.statusCode !== 200) {
            // 直连失败 → 走代理兜底
            if (proxyUrl && proxyUrl !== directUrl) {
              const retryRes = await wx.downloadFile({ url: proxyUrl, timeout: 60000 });
              if (retryRes.statusCode === 200) downloadRes = retryRes;
            }
          }
        } catch (directErr) {
          // 直连异常 → 走代理兜底
          if (proxyUrl && proxyUrl !== directUrl) {
            try {
              const retryRes = await wx.downloadFile({ url: proxyUrl, timeout: 60000 });
              if (retryRes.statusCode === 200) downloadRes = retryRes;
            } catch { /* 忽略 */ }
          }
        }

        if (!downloadRes || downloadRes.statusCode !== 200) {
          console.error(`图片 ${i + 1} 下载失败`);
          continue;
        }

        try {
          await wx.saveImageToPhotosAlbum({ filePath: downloadRes.tempFilePath });
          savedCount++;
        } catch (saveErr) {
          console.error(`图片 ${i + 1} 保存失败:`, saveErr);
        }

        this.setData({ 'imageSaveProgress.current': k + 1 });
      }

      if (savedCount > 0) {
        app.showToast(`✅ 已保存 ${savedCount}/${selectedIndexes.length}`, 'success');
      } else {
        app.showToast('保存失败，请重试');
      }
    } catch (err) {
      console.error('保存图片失败:', err);
      app.showToast('保存失败: ' + (err.errMsg || err.message));
    } finally {
      this.setData({ isSaving: false, imageSaveProgress: null });
    }
  },

  /**
   * 保存到历史记录
   */
  saveToHistory(result) {
    try {
      const history = wx.getStorageSync('parse_history') || [];

      let record;
      if (result.data.type === 'list') {
        const items = result.data.items || [];
        record = {
          id: Date.now().toString(36),
          platform: result.platform,
          title: result.data.title || `找到 ${items.length} 个视频`,
          coverUrl: result.data.coverUrl || (items[0] ? items[0].coverUrl : '') || '',
          url: result.url || app.globalData.lastInputUrl || '',
          type: 'list',
          count: items.length,
          timestamp: Date.now(),
        };
      } else {
        record = {
          id: Date.now().toString(36),
          platform: result.platform,
          title: result.data.title || '(无标题)',
          coverUrl: result.data.coverUrl || '',
          url: result.url || app.globalData.lastInputUrl || '',
          type: result.data.type || 'video',
          timestamp: Date.now(),
        };
      }

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

  /**
   * 直接回首页 tab
   */
  onGoHome() {
    wx.switchTab({
      url: '/pages/index/index',
    });
  },
});

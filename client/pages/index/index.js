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
    // 输入框右侧按钮文字：粘贴 | 解析中 | 清空 | 解析（状态机见 onSearchBarBtnTap 注释）
    btnText: '粘贴',
    showSkeleton: false,
    autoFocus: false,

    // 动态布局间距（适配异形屏/Android）
    topPadding: 0,
    bottomPadding: 0,
  },

  // 最近一次解析成功的链接（trim 后）；当前输入等于它 → 按钮显示"清空"
  _parsedUrl: '',

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
      return;
    }
    // 从解析页返回：解析成功的链接恢复"清空"态；内容被修改过 → "解析"（点击解析当前内容）；空 → "粘贴"
    const trimmed = (this.data.inputUrl || '').trim();
    let btnText = '粘贴';
    if (trimmed) {
      btnText = trimmed === this._parsedUrl ? '清空' : '解析';
    }
    this.setData({ btnText });
  },

  /**
   * 输入变化 — 带节流自动解析
   * 按钮状态机：空→粘贴；输入链接→自动解析（解析中）；已解析内容被手动修改→"解析"
   * （点击直接解析当前内容，不再自动解析，避免和用户编辑打架）
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

    // 已解析内容被手动修改 → 取消"已解析"标记，按钮变"解析"，点击直接解析当前内容
    if (this._parsedUrl && trimmed !== this._parsedUrl) {
      this._parsedUrl = '';
      this.setData({ btnText: trimmed ? '解析' : '粘贴' });
      return;
    }

    // 输入框清空 → 回"粘贴"（读剪贴板）
    if (!trimmed) {
      this._parsedUrl = '';
      this.setData({ btnText: '粘贴' });
      return;
    }

    // 与已解析内容一致 → "清空"
    if (trimmed === this._parsedUrl) {
      this.setData({ btnText: '清空' });
      return;
    }

    // 新输入链接 → 自动解析，按钮立即变"解析中"
    const isLink = trimmed.length > 10 && /https?:\/\//i.test(trimmed);
    if (isLink) {
      this.setData({ btnText: '解析中' });
      this._parseDebounceTimer = setTimeout(() => {
        this.doParse(trimmed);
      }, 600);
    } else {
      this.setData({ btnText: '解析' });
    }
  },

  /**
   * 搜索栏按钮点击 — 四态状态机
   * 粘贴（空输入）→ 读剪贴板并解析
   * 解析中 → 忽略
   * 清空（输入===已解析链接）→ 清空输入框，按钮回"粘贴"
   * 解析（输入非空且非已解析内容，含手动修改后）→ 解析当前内容
   */
  async onSearchBarBtnTap() {
    if (this.data.isLoading) return; // 解析中忽略重复点击
    const trimmed = (this.data.inputUrl || '').trim();
    if (!trimmed) {
      await this.onPaste();
    } else if (trimmed === this._parsedUrl) {
      // 点击"清空"：清空输入框内容，按钮变回"粘贴"
      this._parsedUrl = '';
      this.setData({ inputUrl: '', btnText: '粘贴' });
    } else {
      this.doParse(trimmed);
    }
  },

  /**
   * 从剪贴板粘贴
   */
  async onPaste() {
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
      // 真机调试时可在 Console 查看具体 errMsg（如隐私未授权）
      console.error('[粘贴] 读取剪贴板失败:', err);
      this.showClipboardFallback(err);
    }
  },

  /**
   * 剪贴板读取失败降级 — 聚焦输入框，引导用户长按手动粘贴
   * 隐私未授权时直接给出根因与解法，避免用户反复试错
   */
  showClipboardFallback(err) {
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
  },

  /**
   * 键盘搜索键触发
   */
  onParseFromButton() {
    if (this.data.isLoading) return; // 解析中忽略重复触发
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
   * 防"植物人"三件套：
   * 1. 解析中页面有明确的状态条反馈（wxml 里 isLoading 驱动）
   * 2. 请求 15s 超时兜底（app.js request 封装），超时立即弹窗可重试
   * 3. 请求序号只认最后一次：解析中又粘贴/输入新链接时，旧请求返回直接丢弃，
   *    不会用旧结果覆盖新链接，也不会出现两个请求并发互相打架
   */
  _parseSeq: 0,

  async doParse(url) {
    const urlText = (url || '').trim();
    if (!urlText) return;

    const seq = ++this._parseSeq;
    // 新解析开始：取消旧的"已解析"标记（按钮文字由下方按结果设置）
    this._parsedUrl = '';
    this.setData({ isLoading: true, btnText: '解析中' });

    try {
      // 抖音短链统一交给后端解码：
      // - 前端 wx.request 请求 v.douyin.com 在真机被微信拦截（非合法域名）
      // - 后端无域名限制，可直接解码短链（302→完整链接）再解析
      const result = await app.request('/parse', 'POST', { url: urlText });

      // 期间用户又发起了新解析 → 本次结果过期，直接丢弃（按钮状态交给最新那次管）
      if (seq !== this._parseSeq) return;

      if (!result.success) {
        this.setData({ isLoading: false, btnText: '解析' });
        // 短视频解析失败：平台风控限制（服务器无法访问该平台），给出明确提示
        if (result.platform === 'douyin' || /抖音/.test(result.error || '')) {
          this.showError('短视频解析暂时不可用（平台限制），可尝试其他链接', urlText);
        } else {
          this.showError(result.error || '解析失败，请检查链接是否有效', urlText);
        }
        return;
      }

      // 解析成功 — 记录已解析链接（返回本页时按钮据此显示"清空"）并跳转
      this._parsedUrl = urlText;
      this.setData({ isLoading: false, btnText: '清空' });
      app.globalData.lastParseResult = result;
      app.globalData.lastInputUrl = urlText;
      wx.navigateTo({
        url: '/pages/result/result',
      });
    } catch (err) {
      if (seq !== this._parseSeq) return;
      this.setData({ isLoading: false, btnText: '解析' });
      const msg = err.message || '网络错误';

      if (msg.includes('timeout') || msg.includes('超时')) {
        this.showError('解析超时（服务器响应慢），请稍后重试', urlText);
      } else if (msg.includes('网络')) {
        // 真机最常见的根因：后台未配置服务器域名（request/downloadFile），
        // 微信拦截后 errMsg 为 "url not in domain list"
        const hint = msg.includes('domain') ? '（未配置合法域名，请在小程序后台添加 https://yc0717.cc）' : '';
        this.showError('网络连接异常，请检查网络设置' + hint, urlText);
      } else {
        this.showError(msg + '，请稍后重试', urlText);
      }
    } finally {
      // 只复位"最新一次"解析的加载态，防止被丢弃的旧请求把状态搞乱
      if (seq === this._parseSeq) this.setData({ isLoading: false });
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

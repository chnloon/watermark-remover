/**
 * Playwright 浏览器管理器
 *
 * 管理持久化的 headless Chromium 实例，用于需要真实浏览器环境
 * 绕过 JSVM 反爬的平台（如抖音）。
 *
 * 设计原则：
 * - 单例模式：全局共享一个浏览器实例
 * - 惰性初始化：首次需要时启动
 * - 平台隔离：每个平台有独立浏览器上下文（cookie 隔离）
 * - 自动恢复：崩溃后自动重建
 * - 健康检查：定期检查浏览器是否可用
 */

const { chromium } = require('playwright');

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  // 浏览器启动选项
  launchOptions: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  },
  // 平台对应的起始 URL（用于触发反爬验证）
  platformEntries: {
    douyin: 'https://www.douyin.com/',
    kuaishou: 'https://www.kuaishou.com/',
  },
  // JSVM 挑战等待时间（秒）
  challengeTimeout: 15000,
  // 健康检查间隔（毫秒）
  healthCheckInterval: 60000,
  // 浏览器空闲超时后自动关闭（毫秒，0=不关闭）
  idleTimeout: 5 * 60 * 1000, // 5 分钟
};

// ============================================================
// 状态
// ============================================================
let browserInstance = null;
let platformContexts = {}; // { platform: { context, lastUsed, ready } }
let lastActivityTime = Date.now();
let healthTimer = null;
let idleTimer = null;
let startupPromise = null;

// ============================================================
// 内部方法
// ============================================================

/**
 * 启动或获取浏览器实例
 */
async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  // 如果正在启动中，等待它完成
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    console.log('[BrowserManager] 启动 headless Chromium...');
    try {
      browserInstance = await chromium.launch(CONFIG.launchOptions);
      console.log('[BrowserManager] Chromium 已启动');
      startHealthCheck();
      resetIdleTimer();
      return browserInstance;
    } catch (err) {
      console.error('[BrowserManager] 启动失败:', err.message);
      browserInstance = null;
      throw err;
    } finally {
      startupPromise = null;
    }
  })();

  return startupPromise;
}

/**
 * 定期健康检查
 */
function startHealthCheck() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(async () => {
    try {
      if (browserInstance && browserInstance.isConnected()) {
        // 快速检查——新建一个临时页面确认可用
        const context = await browserInstance.newContext();
        await context.close();
      } else {
        console.warn('[BrowserManager] 浏览器已断开，将在下次请求时重建');
      }
    } catch {
      console.warn('[BrowserManager] 健康检查失败，将在下次请求时重建');
      browserInstance = null;
    }
  }, CONFIG.healthCheckInterval);
}

/**
 * 重置空闲计时器
 */
function resetIdleTimer() {
  lastActivityTime = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  if (CONFIG.idleTimeout > 0) {
    idleTimer = setTimeout(async () => {
      const inactive = Date.now() - lastActivityTime;
      if (inactive >= CONFIG.idleTimeout) {
        console.log('[BrowserManager] 浏览器空闲超时，关闭释放内存');
        await shutdown();
      }
    }, CONFIG.idleTimeout);
  }
}

/**
 * 为指定平台创建/获取浏览器上下文
 */
async function getOrCreateContext(platform) {
  if (platformContexts[platform]) {
    const ctx = platformContexts[platform];
    ctx.lastUsed = Date.now();
    resetIdleTimer();
    return ctx.context;
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
    // 允许第三方 cookie（反爬验证需要）
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  platformContexts[platform] = {
    context,
    lastUsed: Date.now(),
    ready: false, // 尚未激活（需要先触发反爬验证）
  };

  resetIdleTimer();
  return context;
}

/**
 * 触发平台的反爬验证（如抖音 JSVM）
 * 导航到该平台首页，等待挑战完成
 *
 * 注意：在云服务商数据中心（如 Tencent Cloud），抖音 JSVM 可能识别
 * 到数据中心 IP 并发送不可能的挑战或不发送 cookie。
 * 这种情况下我们会降级处理——标记为"已就绪"但记录警告，
 * 后续 API 调用可能不带 s_v_web_id，但仍可能成功。
 */
async function ensureChallengeSolved(platform) {
  const entry = platformContexts[platform];
  if (!entry) throw new Error(`平台 ${platform} 未初始化`);

  // 如果已完成挑战，直接返回
  if (entry.ready) return;

  const context = entry.context;
  const page = await context.newPage();

  try {
    const entryUrl = CONFIG.platformEntries[platform];
    if (!entryUrl) {
      console.warn(`[BrowserManager] 平台 ${platform} 无起始 URL，跳过挑战`);
      entry.ready = true;
      return;
    }

    console.log(`[BrowserManager] 触发 ${platform} 反爬验证...`);

    // 导航到平台首页，触发 JSVM/反爬挑战
    await page.goto(entryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // 等待挑战完成（等待关键 cookie 出现或等待网络静默）
    if (platform === 'douyin') {
      await waitForDouyinChallenge(page);
    } else {
      // 通用等待
      await page.waitForTimeout(5000);
    }

    entry.ready = true;
    console.log(`[BrowserManager] ${platform} 反爬验证通过`);
  } catch (err) {
    // ⚠️ 不抛出异常：云环境 IP 可能被抖音封锁导致 JSVM 失败
    // 标记为 ready 并尝试继续——浏览器上下文即使没有 s_v_web_id
    // 也可能通过 fetch API 获取到数据
    console.warn(`[BrowserManager] ${platform} 反爬验证失败（降级继续）: ${err.message}`);
    entry.ready = true;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 等待抖音 JSVM 挑战完成
 * 通过检测 s_v_web_id cookie 是否存在来判断
 */
async function waitForDouyinChallenge(page) {
  const timeout = CONFIG.challengeTimeout;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const cookies = await page.context().cookies();
    const hasSvWebId = cookies.some((c) => c.name === 's_v_web_id');
    const hasAcSignature = cookies.some((c) => c.name === '__ac_signature');

    if (hasSvWebId && hasAcSignature) {
      console.log('[BrowserManager] JSVM 挑战完成');
      return;
    }

    // 等待 500ms 再检查
    await page.waitForTimeout(500);
  }

  // 超时——检查部分完成情况
  const cookies = await page.context().cookies();
  const cookieNames = cookies.map((c) => c.name);
  console.warn('[BrowserManager] JSVM 挑战可能未完全完成，可用 cookie:', cookieNames.join(', '));

  // 即使超时，只要有部分 cookie 也可能可用
  const hasSvWebId = cookies.some((c) => c.name === 's_v_web_id');
  if (!hasSvWebId) {
    throw new Error('JSVM 挑战超时且未获取到 s_v_web_id cookie');
  }
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 获取平台的 API 页面（可用于在该平台内执行 fetch 等操作）
 *
 * 页面会自动带上平台 cookies（含反爬验证 token），
 * 在页面内执行 API 调用可绕过 X-Gorgon 等签名校验。
 *
 * @param {string} platform - 平台名（'douyin'、'kuaishou' 等）
 * @returns {Promise<{page: Page, context: BrowserContext, release: Function}>}
 */
async function acquirePage(platform) {
  await getOrCreateContext(platform);
  await ensureChallengeSolved(platform);

  const entry = platformContexts[platform];
  const page = await entry.context.newPage();

  // 导航到平台起始页面，确保 fetch 调用在同源上下文内执行
  // 避免 about:blank → douyin.com 的跨域问题
  const entryUrl = CONFIG.platformEntries[platform];
  if (entryUrl) {
    await page.goto(entryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    }).catch((err) => {
      console.warn(`[BrowserManager] 导航到 ${platform} 起始页失败（可恢复）:`, err.message);
    });
  }

  let released = false;

  const release = async () => {
    if (released) return;
    released = true;
    await page.close().catch(() => {});
    entry.lastUsed = Date.now();
    resetIdleTimer();
  };

  return { page, context: entry.context, release };
}

/**
 * 在平台上下文内执行 API 调用（自动携带 cookies + 反爬 token）
 *
 * @param {string} platform - 平台名
 * @param {string} url - API URL
 * @param {object} [fetchOptions] - fetch 选项
 * @returns {Promise<any>} API 响应数据
 */
async function fetchWithBrowser(platform, url, fetchOptions = {}) {
  console.log(`[BrowserManager] fetchWithBrowser platform=${platform}, url=${url.substring(0, 120)}`);
  const { page, release } = await acquirePage(platform);

  try {
    const result = await page.evaluate(
      async ({ apiUrl, options }) => {
        try {
          const response = await fetch(apiUrl, {
            method: options.method || 'GET',
            credentials: 'include',
            headers: Object.assign({
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9',
              'Referer': 'https://www.douyin.com/',
            }, options.headers || {}),
            body: options.body || undefined,
          });

          const text = await response.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { _rawText: text.substring(0, 500) };
          }

          return {
            status: response.status,
            ok: response.ok,
            data: parsed,
          };
        } catch (fetchErr) {
          return {
            status: 0,
            ok: false,
            data: null,
            _error: fetchErr.message,
          };
        }
      },
      { apiUrl: url, options: fetchOptions }
    );

    if (result._error) {
      console.error(`[BrowserManager] fetch 内部失败: ${result._error}`);
    } else {
      console.log(`[BrowserManager] fetch 结果 status=${result.status}, ok=${result.ok}, hasData=${!!result.data}`);
    }

    return result;
  } catch (err) {
    console.error(`[BrowserManager] page.evaluate 异常:`, err.message);
    throw err;
  } finally {
    await release();
  }
}

/**
 * 清理浏览器资源
 */
async function shutdown() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // 关闭所有上下文
  for (const platform of Object.keys(platformContexts)) {
    try {
      await platformContexts[platform].context.close();
    } catch {
      // ignore
    }
  }
  platformContexts = {};

  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // ignore
    }
    browserInstance = null;
  }

  console.log('[BrowserManager] 浏览器已关闭');
}

/**
 * 获取管理器状态（用于诊断）
 */
function getStatus() {
  const platforms = {};
  for (const [platform, entry] of Object.entries(platformContexts)) {
    platforms[platform] = {
      ready: entry.ready,
      lastUsed: new Date(entry.lastUsed).toISOString(),
    };
  }
  return {
    running: !!(browserInstance && browserInstance.isConnected()),
    platforms,
    lastActivity: new Date(lastActivityTime).toISOString(),
  };
}

// 进程退出时清理
process.on('exit', () => shutdown().catch(() => {}));
process.on('SIGINT', () => { shutdown().catch(() => {}); process.exit(); });
process.on('SIGTERM', () => { shutdown().catch(() => {}); process.exit(); });

module.exports = {
  acquirePage,
  fetchWithBrowser,
  shutdown,
  getStatus,
};

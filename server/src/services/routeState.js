/**
 * 解析路由状态控制器（备选解析方案核心）
 *
 * 背景：抖音/快手等平台反爬严格，任何单条解析线路都可能随时失效，
 * 需要"运行时可一键切换抓取路由"的能力，避免改配置重启才生效。
 *
 * 支持的路由模式：
 *   mode                行为
 *   ─────────────────────────────────────────────────────────────
 *   auto                直连优先（现状）：直连失败自动降级第三方 API
 *   third-party-first   第三方优先：先走第三方线路，失败回落直连
 *   third-party-only    仅第三方：直连链路故障时快速止损
 *   direct-only         仅直连：第三方 API 故障时禁用降级
 *
 * 状态持久化在 server/route-state.json（脚本直接写文件，进程轮询 mtime 感知），
 * 因此：切换立即生效、无需重启、重启后保持、脚本与管理接口两种途径一致。
 *
 * 同时维护进程内解析统计（成功/失败/最近错误），供 /api/status 展示，
 * 报错后跑 scripts/switch-route.sh diagnose 即可定位当前线路健康度。
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../route-state.json');
const MODES = ['auto', 'third-party-first', 'third-party-only', 'direct-only'];

let cached = { mtimeMs: -1, mode: null, info: null };

/**
 * 读取当前路由状态（带 mtime 缓存，避免每次 stat 同一文件）
 * @returns {{ mode: string, info: object|null }}
 */
function loadState() {
  try {
    const st = fs.statSync(STATE_FILE);
    if (st.mtimeMs === cached.mtimeMs && cached.mode) {
      return cached;
    }
    const info = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    cached = {
      mtimeMs: st.mtimeMs,
      mode: MODES.includes(info.mode) ? info.mode : 'auto',
      info,
    };
  } catch (err) {
    // 文件不存在/损坏 → 默认 auto（直连优先），不阻塞解析
    if (!cached.mode) {
      cached = { mtimeMs: -1, mode: 'auto', info: null };
    }
  }
  return cached;
}

/**
 * 获取当前路由模式
 * @returns {string} 'auto' | 'third-party-first' | 'third-party-only' | 'direct-only'
 */
function getMode() {
  return loadState().mode;
}

/**
 * 获取当前路由状态（含更新时间/操作人/原因）
 * @returns {object}
 */
function getState() {
  const c = loadState();
  return Object.assign({ mode: c.mode }, c.info || {});
}

/**
 * 切换路由模式（持久化到 route-state.json，供脚本与管理接口共用）
 * @param {string} mode
 * @param {string} [by] 操作人标识（shell / admin-api / 昵称）
 * @param {string} [reason] 切换原因
 * @returns {object} 写入后的状态
 */
function setMode(mode, by, reason) {
  if (!MODES.includes(mode)) {
    throw new Error(`无效路由模式: ${mode}（可选: ${MODES.join(' / ')}）`);
  }
  const state = {
    mode,
    by: by || 'unknown',
    reason: reason || '',
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    // 磁盘只读等场景：本次进程内仍生效（重启回默认 auto），但需告警
    console.error('[路由] route-state.json 写入失败，本次切换仅内存生效:', err.message);
  }
  try {
    cached = { mtimeMs: fs.statSync(STATE_FILE).mtimeMs, mode, info: state };
  } catch (err) {
    cached = { mtimeMs: -1, mode, info: state };
  }
  return state;
}

// ─────────────────────────────────────────────────────────────
// 解析统计（进程内，重启清零；用于诊断当前线路健康度）
// ─────────────────────────────────────────────────────────────
const stats = { total: 0, success: 0, fail: 0, byPlatform: {}, recentErrors: [] };

/**
 * 记录一次解析结果
 * @param {string} platform
 * @param {boolean} ok
 * @param {string} [error] 失败原因（截断保存）
 */
function recordParse(platform, ok, error) {
  stats.total += 1;
  if (ok) {
    stats.success += 1;
  } else {
    stats.fail += 1;
  }
  const p = (stats.byPlatform[platform] = stats.byPlatform[platform] || {
    success: 0,
    fail: 0,
    lastError: '',
    lastErrorAt: '',
  });
  if (ok) {
    p.success += 1;
  } else {
    p.fail += 1;
    const errText = String(error || '').slice(0, 200);
    p.lastError = errText;
    p.lastErrorAt = new Date().toISOString();
    stats.recentErrors.unshift({
      at: p.lastErrorAt,
      platform,
      error: errText,
    });
    if (stats.recentErrors.length > 20) stats.recentErrors.pop();
  }
}

/**
 * 获取解析统计快照
 * @returns {object}
 */
function getStats() {
  return {
    total: stats.total,
    success: stats.success,
    fail: stats.fail,
    successRate: stats.total ? Math.round((stats.success / stats.total) * 1000) / 10 : 100,
    byPlatform: stats.byPlatform,
    recentErrors: stats.recentErrors,
  };
}

module.exports = {
  MODES,
  getMode,
  getState,
  setMode,
  recordParse,
  getStats,
};

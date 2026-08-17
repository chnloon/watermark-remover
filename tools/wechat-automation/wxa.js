#!/usr/bin/env node
/**
 * 微信小程序自动化操作工具（基于官方 miniprogram-automator + DevTools CLI）
 *
 * 用法:
 *   node wxa.js open                    # 打开 client 项目（启动 DevTools）
 *   node wxa.js snapshot                # 截取当前页面快照（WXML 结构 + 数据）
 *   node wxa.js screenshot <file>       # 页面截图保存到文件
 *   node wxa.js tap <selector>          # 点击元素（支持 .class / #id / text="xx"）
 *   node wxa.js input <selector> <text> # 输入文字
 *   node wxa.js call <page-js-method> [json-args]  # 调用页面方法
 *   node wxa.js eval <js-expr>          # 在当前页面上下文执行表达式
 *   node wxa.js replaunch <path>        # 重新打开指定页面
 *   node wxa.js close                   # 关闭项目
 *
 * 依赖:
 *   - 微信开发者工具安装于 F:\微信web开发者工具（CLI 可用）
 *   - npm install miniprogram-automator
 *
 * 注意: 首次使用需要在开发者工具「设置→安全设置」开启「服务端口」，
 *       否则自动化连接会被拒绝。CLI 启动时若端口未开会报错。
 */

const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

// ===== 配置 =====
const CLI_PATH = 'F:/微信web开发者工具/cli.bat';
const PROJECT_PATH = 'E:/watermark-remover/client';
const AUTOMATOR_PORT = 9420; // 自动化服务端口

// ===== 全局连接 =====
let miniProgram = null;

/** 确保开发者工具已打开项目且自动化服务可用 */
async function ensureDevToolsAuto() {
  // 探测 9420 端口是否有自动化服务在监听
  const { execFileSync } = require('child_process');
  const net = require('net');
  const canConnect = await new Promise((resolve) => {
    const sock = net.connect({ port: AUTOMATOR_PORT, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
  if (canConnect) return;

  // 未监听：通过 CLI 启动自动化（幂等）
  console.log(`[wxa] 自动化服务未运行，通过 CLI 启动 (port ${AUTOMATOR_PORT}) ...`);
  try {
    const cliAutoArgs = ['auto', '--project', PROJECT_PATH, '--auto-port', String(AUTOMATOR_PORT)];
    execFileSync(CLI_PATH, cliAutoArgs, { stdio: 'ignore', timeout: 90000, encoding: 'utf-8' });
    // 等待服务就绪
    for (let i = 0; i < 30; i++) {
      const ok = await new Promise((resolve2) => {
        const s = net.connect({ port: AUTOMATOR_PORT, host: '127.0.0.1' });
        s.once('connect', () => { s.destroy(); resolve2(true); });
        s.once('error', () => resolve2(false));
      });
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    // CLI 可能已经由外部（如开发者工具 GUI）启动，继续尝试连接
    console.log('[wxa] CLI 启动提示（可能已运行）:', (err.message || '').split('\n')[0]);
  }
}

async function ensureConnected() {
  if (miniProgram) return miniProgram;
  await ensureDevToolsAuto();
  console.log(`[wxa] 连接自动化服务 ws://127.0.0.1:${AUTOMATOR_PORT} ...`);
  miniProgram = await automator.connect({
    wsEndpoint: `ws://127.0.0.1:${AUTOMATOR_PORT}`,
  });
  console.log('[wxa] ✅ 已连接。AppID:', miniProgram.appid);
  return miniProgram;
}

async function getPage() {
  const mp = await ensureConnected();
  const page = await mp.currentPage();
  if (!page) throw new Error('当前没有打开的小程序页面');
  return page;
}

/** 解析选择器: ".class" | "#id" | "text=xx" | "tag" */
function parseSelector(selector) {
  const s = String(selector || '').trim();
  if (!s) throw new Error('缺少选择器');
  if (s.startsWith('text=')) return { text: s.slice(5) };
  if (s.startsWith('.')) return { selector: s };
  if (s.startsWith('#')) return { selector: s };
  // 默认当 class 处理
  return { selector: s };
}

// ===== 命令实现 =====

async function cmdOpen() {
  const mp = await ensureConnected();
  console.log('[wxa] ✅ 项目已打开, AppID:', mp.appid);
}

async function cmdClose() {
  if (!miniProgram) {
    console.log('[wxa] 未连接，无需关闭');
    return;
  }
  await miniProgram.close();
  miniProgram = null;
  console.log('[wxa] ✅ 项目已关闭');
}

async function cmdReLaunch(pagePath) {
  const mp = await ensureConnected();
  const target = pagePath || 'pages/index/index';
  const page = await mp.reLaunch(`/${target}`);
  await page.waitFor(800);
  console.log(`[wxa] ✅ 已打开页面: ${target}`);
}

async function cmdSnapshot() {
  const mp = await ensureConnected();
  const page = await mp.currentPage();
  console.log('[wxa] 页面路径:', page ? page.path : '(未知)');
  console.log('[wxa] ===== 页面数据 (page.data) =====');
  try {
    const data = await mp.evaluate(() => {
      const pages = getCurrentPages();
      const inst = pages[pages.length - 1];
      return inst ? inst.data : null;
    });
    console.log(JSON.stringify(data, null, 2).substring(0, 4000));
  } catch (err) {
    console.error('[wxa] 读取数据失败:', err.message);
  }
}

async function cmdScreenshot(file) {
  const mp = await ensureConnected();
  const target = file || path.join(process.cwd(), 'wxa_screenshot.png');
  await mp.screenshot({ path: target });
  console.log(`[wxa] ✅ 截图已保存: ${target}`);
}

async function cmdTap(selector) {
  const page = await getPage();
  // 通过页面方法触发点击（小程序点击通常绑定 bindtap 方法）
  // 兼容两种调用: 直接传方法名，或传 data 字段名映射
  console.log(`[wxa] ⚠️ 新版 API 无 DOM 点击，尝试调用页面方法: ${selector}`);
  try {
    const result = await page.callMethod(selector);
    console.log(`[wxa] ✅ 已调用页面方法 ${selector}():`, JSON.stringify(result));
  } catch (err) {
    console.error(`[wxa] ❌ 调用失败: ${err.message}`);
    console.error('[wxa] 提示: 请使用 `call <方法名> [json参数]` 调用页面方法');
    process.exitCode = 1;
  }
  await page.waitFor(600);
}

async function cmdInput(selector, text) {
  const page = await getPage();
  // 新版 API: 用 setData 直接设置输入框绑定的 data 字段
  console.log(`[wxa] ⚠️ 新版 API 无 DOM 输入，尝试 setData(${selector})`);
  try {
    await page.setData(selector, text);
    console.log(`[wxa] ✅ 已 setData(${selector}) = "${String(text).substring(0, 50)}"`);
  } catch (err) {
    console.error(`[wxa] ❌ setData 失败: ${err.message}`);
    console.error('[wxa] 提示: 用法 `input <data字段名> <文本>`，如 `input inputUrl 抖音链接`');
    process.exitCode = 1;
  }
  await page.waitFor(300);
}

async function cmdCall(method, argsJson) {
  const mp = await ensureConnected();
  const page = await mp.currentPage();
  if (!page) throw new Error('当前没有页面');
  let args = [];
  if (argsJson) {
    try { args = JSON.parse(argsJson); } catch { args = [argsJson]; }
  }
  const result = await page.callMethod(method, ...args);
  console.log(`[wxa] ✅ 调用 ${method}() 返回:`, JSON.stringify(result, null, 2));
}

async function cmdEval(expr) {
  const mp = await ensureConnected();
  const result = await mp.evaluate((code) => {
    try {
      const pages = getCurrentPages();
      const inst = pages[pages.length - 1];
      return { ok: true, value: eval(code) };
    } catch (e) { return { ok: false, error: e.message }; }
  }, expr);
  console.log('[wxa] ✅ 表达式结果:', JSON.stringify(result, null, 2));
}

// ===== 入口 =====

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('* 用法:')[1].split('*')[0]);
    return;
  }

  try {
    switch (cmd) {
      case 'open': await cmdOpen(); break;
      case 'close': await cmdClose(); break;
      case 'snapshot': await cmdSnapshot(); break;
      case 'screenshot': await cmdScreenshot(rest[0]); break;
      case 'tap': await cmdTap(rest[0]); break;
      case 'input': await cmdInput(rest[0], rest.slice(1).join(' ')); break;
      case 'call': await cmdCall(rest[0], rest[1]); break;
      case 'eval': await cmdEval(rest.join(' ')); break;
      case 'replaunch': await cmdReLaunch(rest[0]); break;
      default:
        console.error(`未知命令: ${cmd}（运行 wxa.js --help 查看用法）`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`[wxa] ❌ ${err.message}`);
    if (err.message && err.message.includes('服务端口')) {
      console.error('[wxa] 提示: 请在微信开发者工具 → 设置 → 安全设置 中开启「服务端口」');
    }
    process.exit(1);
  } finally {
    // 命令执行完毕后主动断开连接并退出（WebSocket 会阻止进程自然退出）
    if (miniProgram && typeof miniProgram.disconnect === 'function') {
      try { await miniProgram.disconnect(); } catch { /* ignore */ }
    }
    miniProgram = null;
    process.exit(process.exitCode || 0);
  }
}

main();

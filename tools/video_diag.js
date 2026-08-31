// 诊断页面视频背景：加载页面，检查视频状态和 JS 错误
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 捕获 console 和错误
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));

  await page.goto('http://124.221.232.131/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // 检查视频状态
  const v = await page.evaluate(() => {
    const vid = document.getElementById('bgVideo');
    if (!vid) return { exists: false };
    return {
      exists: true,
      readyState: vid.readyState,
      paused: vid.paused,
      currentSrc: vid.currentSrc,
      error: vid.error ? vid.error.message : null,
      loadedClass: vid.classList.contains('loaded'),
      networkState: vid.networkState,
      videoWidth: vid.videoWidth,
    };
  });
  console.log('视频状态:', JSON.stringify(v, null, 2));

  // body 背景
  const bg = await page.evaluate(() => document.body.style.background || document.body.style.backgroundColor || '(无)');
  console.log('body背景:', bg);

  console.log('\nJS错误:', errors.length ? errors.join('\n') : '无');

  await page.screenshot({ path: 'E:/watermark-remover/tools/shots/video_diag.png' });
  await browser.close();
}
main().catch(e => { console.error('失败:', e.message); process.exit(1); });

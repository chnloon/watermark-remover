// 页面视觉审查：截图桌面 + 移动端，供视觉审查
const { chromium } = require('playwright');

async function main() {
  const url = process.argv[2] || 'http://124.221.232.131/';
  const outDir = 'E:/watermark-remover/tools/shots';
  const fs = require('fs');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  // 桌面端
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await desktop.waitForTimeout(1500);
  await desktop.screenshot({ path: `${outDir}/desktop_top.png` });
  await desktop.screenshot({ path: `${outDir}/desktop_full.png`, fullPage: true });
  // 滚动到作品区截图
  await desktop.evaluate(() => document.querySelector('#starList')?.scrollIntoView());
  await desktop.waitForTimeout(1500);
  await desktop.screenshot({ path: `${outDir}/desktop_works.png` });
  // 触发解压模式截图
  await desktop.evaluate(() => {
    document.querySelector('.gate__input').value = '测试想法';
    document.querySelector('.gate__btn').click();
  });
  await desktop.waitForTimeout(3000);
  await desktop.screenshot({ path: `${outDir}/desktop_zen.png` });
  await desktop.close();

  // 移动端
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: `${outDir}/mobile_top.png` });
  await mobile.screenshot({ path: `${outDir}/mobile_full.png`, fullPage: true });
  await mobile.close();

  await browser.close();
  console.log('✅ 截图完成:', fs.readdirSync(outDir).join(', '));
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });

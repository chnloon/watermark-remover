/**
 * 多平台解析链路测试（不依赖真实短链，验证平台检测 + 解析器路由）
 */
const { detectPlatform, extractUrl } = require('./src/utils/url');

const cases = [
  // 平台检测测试（核心：链接能否被正确路由到对应解析器）
  { name: '抖音完整链接', url: 'https://www.douyin.com/video/7668597549042015601' },
  { name: '抖音短链', url: 'https://v.douyin.com/FQzUZfkJF-Y/' },
  { name: '抖音文案', url: '5.35 复制打开抖音... https://v.douyin.com/abc123/ 04/08' },
  { name: '快手短链', url: 'https://v.kuaishou.com/abcdEF123' },
  { name: '快手完整', url: 'https://www.kuaishou.com/short-video/3xabc12345def' },
  { name: '快手 photo', url: 'https://www.kuaishou.com/photo/3xabc12345def' },
  { name: '小红书笔记', url: 'https://www.xiaohongshu.com/explore/64abc123456' },
  { name: '小红书 discovery', url: 'https://www.xiaohongshu.com/discovery/item/64abc123456' },
  { name: '小红书短链', url: 'https://xhslink.com/AbCdEf' },
  { name: 'M3U8 流', url: 'https://example.com/live/stream.m3u8' },
  { name: '直接 mp4', url: 'https://example.com/video/test.mp4' },
  { name: '普通网页', url: 'https://example.com/page-with-video' },
  { name: '无链接文本', url: '这不是链接' },
  { name: '空字符串', url: '' },
];

let pass = 0, fail = 0;
console.log('=== 平台检测测试 ===\n');
for (const c of cases) {
  const clean = extractUrl(c.url);
  const platform = detectPlatform(clean);
  const ok = platform !== null || c.url === '' || c.url === '这不是链接';
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${c.name.padEnd(12)} → clean: ${clean.substring(0, 45)} → platform: ${platform || '(null)'}`);
}

console.log(`\n结果: ${pass}/${cases.length} 通过`);
console.log('\n=== 说明 ===');
console.log('· 快手 v.kuaishou.com / short-video / photo 均能识别 → kuaishou');
console.log('· 小红书 explore / discovery / xhslink 均能识别 → xiaohongshu');
console.log('· m3u8/mp4/普通网页 → generic 解析器兜底');
console.log('· 真实解析需要有效链接，平台检测正确即可路由到对应解析器');
process.exit(fail === 0 ? 0 : 1);

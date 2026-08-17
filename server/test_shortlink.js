// 模拟前端 resolveDouyinShortLink 的正则提取逻辑
const patterns = [
  /share\/video\/(\d{17,21})/, // m.douyin.com/share/video/{id}
  /aweme_id["']?\s*[:=]\s*["']?(\d{17,21})/, // 内嵌 JSON 字段
  /\/video\/(\d{17,21})/, // /video/{id}
  /video[=/](\d{17,21})/, // 通用兜底
];

const samples = [
  'https://www.douyin.com/share/video/7668597549042015601?region=CN',
  'aweme_id="7668597549042015601"',
  'window._ROUTER_DATA = {"loaderData":{"video_(id)/page":{"videoInfoRes":{"item_list":[{"aweme_id":"7668597549042015601"}]}}}}',
  '<script>window.__INITIAL_STATE__={};</script>',
];

for (const s of samples) {
  let m = null;
  for (const re of patterns) {
    m = s.match(re);
    if (m) break;
  }
  console.log(m ? '匹配: ' + m[1] : '无匹配', '<-', s.substring(0, 60));
}

// 测试: 抖音短链真实响应会包含哪些特征
console.log('\n=== 真实短链测试 ===');
const https = require('https');
https.get('https://v.douyin.com/FQzUZfkJF-Y/', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  timeout: 15000,
  maxRedirects: 0,
}, (res) => {
  console.log('状态:', res.statusCode);
  console.log('Location:', res.headers.location || '(无)');
  let body = '';
  res.on('data', (d) => { body += d; });
  res.on('end', () => {
    if (body.length > 0) {
      console.log('响应长度:', body.length);
      console.log('含 video/ 数字ID:', body.match(/video\/(\d{17,21})/) ? body.match(/video\/(\d{17,21})/)[1] : '无');
      console.log('含 aweme_id:', body.match(/aweme_id["']?\s*[:=]\s*["']?(\d{17,21})/) ? '有' : '无');
    }
  });
}).on('error', (e) => {
  console.log('请求错误:', e.message);
});

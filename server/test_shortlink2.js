// 检查 resolveDouyinShortLink 可能返回的异常格式
const patterns = [
  /share\/video\/(\d{17,21})/,
  /aweme_id["']?\s*[:=]\s*["']?(\d{17,21})/,
  /\/video\/(\d{17,21})/,
  /video[=/](\d{17,21})/,
];

function extract(html) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

// 场景1: 风控页面（无真实 ID）
const badHtml = '<html><head><script>window._ROUTER_DATA={}</script></head><body>验证码页面</body></html>';
console.log('场景1 风控页:', extract(badHtml));

// 场景2: 页面里有个 17-21 位数字但不是视频 ID（时间戳/随机数）
const tricky = 'const ts = 1786972168123456789; // 时间戳';
console.log('场景2 时间戳:', extract(tricky));

// 场景3: 短链响应是 JSON（非 HTML）
const jsonResp = '{"status_code":0,"data":{"aweme_id":"7668597549042015601"}}';
console.log('场景3 JSON:', extract(jsonResp));

// 场景4: 正常分享页
const normal = '<script>window._ROUTER_DATA = {"loaderData":{"video_(id)/page":{"videoInfoRes":{"item_list":[{"aweme_id":"7668597549042015601"}]}}}}';
console.log('场景4 正常:', extract(normal));

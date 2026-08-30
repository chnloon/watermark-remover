/**
 * 小红书无水印门禁本地模拟测试（不发起真实网络请求）
 * 场景：
 *  A. 第三方返回带水印 URL + 页面可抓到 309 → 升级成功
 *  B. 第三方返回带水印 URL + 页面抓不到 309 → 拦截报错（绝不带水印进预览）
 *  C. 第三方直接返回 309 URL → 放行
 *  D. 图片笔记（第三方返回图片）→ 放行
 */
// 必须在 require config 之前注入，否则第三方线路报"未配置"
process.env.THIRD_PARTY_API_TYPE = 'bugpk';
process.env.ADMIN_TOKEN = 'test';

const axios = require('axios');

// ---- mock 页面响应 ----
const STATE_HTML = `<!DOCTYPE html><html><head>
<title>测试笔记 - 小红书</title>
<script>window.__INITIAL_STATE__={"noteData":{"data":{"noteData":{"noteId":"abc123","title":"测试视频","user":{"nickName":"作者"},"video":{"media":{"stream":{"h265":[{"streamType":309,"streamDesc":"X265_MP4_WEB_309","masterUrl":"https://sns-video-qc.xhscdn.com/stream/1/110/309/abc123_309.mp4?sign=SIG&t=123"}],"h264":[{"streamType":259,"streamDesc":"MINI_APP_259","masterUrl":"https://sns-video-qc.xhscdn.com/stream/1/110/259/abc123_259.mp4?sign=SIG&t=123"}]}}}}}}};</script>
</head><body>ok</body></html>`;

const NO_STATE_HTML = `<!DOCTYPE html><html><head><title>反爬页 - 小红书</title></head><body><p>访问被拒绝</p></body></html>`;

// 带水印源（bugpk 典型返回，H.264 259 档）
const WM_URL = 'https://sns-video-qc.xhscdn.com/stream/1/110/259/abc123_259.mp4?sign=SIG&t=123';
// 无水印源（309 档）
const NWM_URL = 'https://sns-video-qc.xhscdn.com/stream/1/110/309/abc123_309.mp4?sign=SIG&t=123';

let pageMode = 'withState'; // withState | denied
axios.get = async (url) => {
  if (url.includes('api.bugpk.com')) {
    return { status: 200, headers: {}, data: { code: 200, msg: 'ok', data: { title: '测试', url: WM_URL } } };
  }
  if (pageMode === 'withState') {
    return { status: 200, headers: {}, data: STATE_HTML };
  }
  return { status: 200, headers: {}, data: NO_STATE_HTML };
};

const { parse } = require('./src/parsers/xiaohongshu');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

(async () => {
  const url = 'https://www.xiaohongshu.com/explore/abc123';

  // A: 带水印 → 页面有 309 → 升级成功
  pageMode = 'withState';
  const rA = await parse(url, { routeMode: 'third-party-only' });
  assert(rA.success === true, 'A 升级成功');
  assert(rA.data.videoUrl === NWM_URL, 'A videoUrl 为 309 无水印档: ' + rA.data.videoUrl);
  assert(!rA.data.videoUrl.includes('_259'), 'A 不含带水印 259 档');

  // B: 带水印 → 页面反爬拿不到 309 → 拦截报错
  pageMode = 'denied';
  const rB = await parse(url, { routeMode: 'third-party-only' });
  assert(rB.success === false, 'B 拦截报错');
  assert(rB.error && rB.error.includes('带水印'), 'B 错误信息明确含"带水印": ' + rB.error);

  // C: 第三方直接返回 309 → 放行
  axios.get = async (url) => {
    if (url.includes('api.bugpk.com')) {
      return { status: 200, headers: {}, data: { code: 200, msg: 'ok', data: { title: '测试', url: NWM_URL } } };
    }
    return { status: 200, headers: {}, data: NO_STATE_HTML };
  };
  const rC = await parse(url, { routeMode: 'third-party-only' });
  assert(rC.success === true, 'C 309 直通');
  assert(rC.data.videoUrl === NWM_URL, 'C videoUrl 原样 309');

  // D: 图片笔记 → 放行
  axios.get = async (url) => {
    if (url.includes('api.bugpk.com')) {
      return { status: 200, headers: {}, data: { code: 200, msg: 'ok', data: { title: '图集', images: ['https://sns-webpic-qc.xhscdn.com/img1!nd_dft_wlteh_webp_3'] } } };
    }
    return { status: 200, headers: {}, data: NO_STATE_HTML };
  };
  const rD = await parse(url, { routeMode: 'third-party-only' });
  assert(rD.success === true, 'D 图片笔记放行');
  assert(rD.data.type === 'image' && rD.data.images.length === 1, 'D 返回图片列表');
  assert(rD.data.images[0] === 'https://sns-img-qc.xhscdn.com/img1', 'D 图片 URL 清洗为老图床公开直链');

  console.log(process.exitCode ? '\n存在失败用例' : '\n全部通过');
})();

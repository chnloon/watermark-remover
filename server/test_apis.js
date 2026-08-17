const axios = require('axios');

const testUrl = 'https://www.douyin.com/video/7426013954393746751';

async function test() {
  const tests = [
    { name: 'douyin.wtf', url: 'https://api.douyin.wtf/api', params: { url: testUrl } },
    { name: 'dy.131213.xyz', url: 'https://dy.131213.xyz/api', params: { url: testUrl } },
    { name: 'dy.fxxk.digital', url: 'https://dy.fxxk.digital/api', params: { url: testUrl } },
  ];

  for (const t of tests) {
    try {
      const res = await axios.get(t.url, { params: t.params, timeout: 10000 });
      console.log(t.name + ': STATUS=' + res.status + ' => ' + JSON.stringify(res.data).slice(0, 300));
    } catch (e) {
      console.log(t.name + ': FAILED - ' + (e.code || e.message));
    }
  }
}

test().catch(console.error);

const http = require('http');
const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
    }).on('error', reject);
  });
}

async function main() {
  const url = 'https://www.douyin.com/video/7426013954393746751';
  
  // Test direct Douyin page
  console.log('Testing Douyin page...');
  const r = await fetch(url);
  console.log('Status:', r.status);
  console.log('Has _$jsvmprt:', r.body.includes('_$jsvmprt'));
  console.log('Body[:300]:', r.body.slice(0, 300));
}

main().catch(console.error);

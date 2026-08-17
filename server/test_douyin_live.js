/**
 * 真实抖音链接端到端测试 — 验证改造后的并行解析链路
 * 运行: node test_douyin_live.js <url>
 */
const parser = require('./src/parsers/douyin');

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('用法: node test_douyin_live.js <抖音分享链接或视频URL>');
    process.exit(1);
  }

  console.log(`[测试] 解析链接: ${url}`);
  const t0 = Date.now();

  const result = await parser.parse(url);
  const elapsed = Date.now() - t0;

  console.log(`[结果] 耗时: ${elapsed}ms`);
  console.log(`[结果] success: ${result.success}`);

  if (result.success) {
    console.log(`  平台: ${result.platform}`);
    console.log(`  标题: ${result.data.title}`);
    console.log(`  视频URL: ${(result.data.videoUrl || '').substring(0, 80)}...`);
    console.log(`  封面: ${(result.data.coverUrl || '').substring(0, 60)}...`);
    if (result.data.author) {
      console.log(`  作者: ${result.data.author.name || ''}`);
    }
  } else {
    console.log(`  错误: ${result.error}`);
  }

  // 测试缓存命中（第二次解析同一链接）
  if (result.success) {
    console.log('\n[缓存测试] 再次解析同一链接...');
    const t1 = Date.now();
    const cached = await parser.parse(url);
    const elapsed2 = Date.now() - t1;
    console.log(`[缓存] 第二次耗时: ${elapsed2}ms (首次 ${elapsed}ms)`);
    console.log(`[缓存] success: ${cached.success}, 标题一致: ${cached.data.title === result.data.title}`);
    if (elapsed2 < elapsed) {
      console.log('[缓存] ✅ 缓存生效，第二次明显更快');
    } else {
      console.log('[缓存] ⚠️ 第二次未显著变快（可能都走了同一条路）');
    }
  }

  process.exit(result.success ? 0 : 2);
}

main().catch((err) => {
  console.error('测试异常:', err);
  process.exit(1);
});

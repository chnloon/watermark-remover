#!/usr/bin/env node
/**
 * 解析路由状态格式化工具（scripts/switch-route.sh 内部使用）
 *
 * 用法: node format-status.js "<status json>"
 * 输入为 GET /api/status 的完整 JSON 响应，输出人类可读的线路健康度报告
 */

const raw = process.argv[2];
if (!raw) {
  console.error('✖ 用法: node format-status.js "<status json>"');
  process.exit(1);
}

let body;
try {
  body = JSON.parse(raw);
} catch (e) {
  console.error('✖ 无法解析状态响应:', raw.slice(0, 500));
  process.exit(1);
}

if (!body.success) {
  console.error('✖ 接口异常:', body.error || raw.slice(0, 500));
  process.exit(1);
}

const d = body.data;
const line = '─'.repeat(46);

console.log(line);
console.log('  解析线路状态  (服务版本 ' + d.version + ')');
console.log(line);
console.log('  路由模式   : ' + d.routeMode + ' — ' + (d.route.desc || ''));
if (d.route.updatedAt) {
  console.log('  切换时间   : ' + d.route.updatedAt + '  (by: ' + d.route.by + (d.route.reason ? ', 原因: ' + d.route.reason : '') + ')');
}
console.log('  解析统计   : 总 ' + d.stats.total + ' 次 | 成功 ' + d.stats.success + ' (' + d.stats.successRate + '%) | 失败 ' + d.stats.fail);

const platforms = d.stats.byPlatform || {};
const platformNames = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', m3u8: 'M3U8', generic: '网页视频' };
Object.keys(platforms).forEach((p) => {
  const s = platforms[p];
  const name = platformNames[p] || p;
  console.log(
    '    ' + name.padEnd(8) +
    '成功 ' + String(s.success).padStart(3) +
    ' | 失败 ' + String(s.fail).padStart(3) +
    (s.lastError ? ' | 最近: ' + s.lastError : '')
  );
});

console.log('  第三方线路 : ' + (d.thirdPartyApi.configured ? '已启用 (' + d.thirdPartyApi.type + ')' : '未配置 (THIRD_PARTY_API_TYPE 未设置 → 第三方模式不可用)'));

const errs = d.stats.recentErrors || [];
if (errs.length) {
  console.log('  最近失败   :');
  errs.slice(0, 5).forEach((e) => {
    console.log('    ' + (e.at || '').replace('T', ' ').slice(0, 19) + ' [' + e.platform + '] ' + e.error);
  });
} else {
  console.log('  最近失败   : 无（服务启动后未记录到解析失败）');
}
console.log(line);
console.log('  切换线路   : ./switch-route.sh auto | third-party-first | third-party-only | direct-only');
console.log(line);

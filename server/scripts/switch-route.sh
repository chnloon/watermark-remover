#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  解析线路一键切换 / 诊断工具（备选解析方案体系）
#
#  用法:
#    ./switch-route.sh status               查看当前路由模式与解析健康度
#    ./switch-route.sh diagnose             完整诊断（模式 + 统计 + 最近失败 + 第三方状态 + 排查指引）
#    ./switch-route.sh auto                 自动模式（直连优先，失败自动降级第三方）【默认推荐】
#    ./switch-route.sh third-party-first    第三方线路优先（第三方挂了自动回落直连）
#    ./switch-route.sh third-party-only     仅走第三方线路（直连链路故障时快速止损）
#    ./switch-route.sh direct-only          仅走直连（第三方 API 故障时禁用降级）
#
#  特性:
#    - 切换立即生效、无需重启服务（进程轮询感知状态文件变化）
#    - 状态持久化在 server/route-state.json，重启服务后仍保持
#    - 远程调用等价管理接口（需先配置 ADMIN_TOKEN）:
#        curl -X POST http://127.0.0.1:3001/api/admin/route \
#          -H "Content-Type: application/json" -H "X-Admin-Token: <ADMIN_TOKEN>" \
#          -d '{"mode":"third-party-only","by":"ops","reason":"直连链路故障"}'
#
#  环境变量（可选）:
#    PORT          服务端口，默认 3001
#    SWITCH_BY     操作人标识，默认 shell（写入切换记录）
#    SWITCH_REASON 切换原因，默认空（写入切换记录）
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

ACTION="${1:-status}"
PORT="${PORT:-3001}"
BASE_URL="http://127.0.0.1:${PORT}"

show_status() {
  local json
  json="$(curl -s --max-time 10 "${BASE_URL}/api/status")"
  node scripts/format-status.js "$json"
}

switch_mode() {
  local mode="$1"
  node -e '
    const fs = require("fs");
    const mode = process.argv[1];
    const modes = ["auto", "third-party-first", "third-party-only", "direct-only"];
    if (!modes.includes(mode)) {
      console.error("✖ 无效模式: " + mode + "（可选: " + modes.join(" / ") + "）");
      process.exit(1);
    }
    const state = {
      mode,
      by: process.env.SWITCH_BY || "shell",
      reason: process.env.SWITCH_REASON || "",
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync("route-state.json", JSON.stringify(state, null, 2));
    console.log("✓ 已写入 route-state.json，路由模式 → " + mode + "（立即生效，无需重启）");
  ' "$mode"
  echo ""
  show_status
}

case "$ACTION" in
  status)
    show_status
    ;;
  diagnose)
    echo "── 完整诊断 ──────────────────────────────────────────────"
    show_status
    echo ""
    echo "── 运行环境 ─────────────────────────────────────────────"
    echo "服务端口   : ${PORT}"
    echo "Node       : $(node -v)"
    echo "状态文件   : $(pwd)/route-state.json"
    echo ""
    echo "── 故障场景速查 ─────────────────────────────────────────"
    echo "  1. 直连链路挂（抖音/快手反爬风控、数据中心 IP 被封）"
    echo "     → 先启用第三方线路（.env 设置 THIRD_PARTY_API_TYPE=bugpk 后重启），"
    echo "       再 ./switch-route.sh third-party-only 快速止损"
    echo "  2. 第三方 API 挂（限流 429 / 欠费 / 服务商故障）"
    echo "     → ./switch-route.sh direct-only 或 auto，切回自研直连"
    echo "  3. 线路都已恢复，想让解析走最佳策略"
    echo "     → ./switch-route.sh auto（恢复默认，直连优先 + 自动降级）"
    echo "  4. 以上都试过仍失败"
    echo "     → 把上面状态输出发给开发者（或 curl ${BASE_URL}/api/debug/douyin）"
    ;;
  auto|third-party-first|third-party-only|direct-only)
    switch_mode "$ACTION"
    ;;
  *)
    echo "用法: $0 [status|diagnose|auto|third-party-first|third-party-only|direct-only]"
    echo ""
    echo "  当前支持模式: auto / third-party-first / third-party-only / direct-only"
    exit 1
    ;;
esac

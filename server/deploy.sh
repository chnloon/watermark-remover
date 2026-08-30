#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  链接解析服务 - 一键部署（git pull + 重启 + 自检）
#
#  用法（在服务器项目目录执行一次）:
#    bash deploy.sh
#
#  说明:
#    - 自动重启服务（优先 pm2，否则 nohup 后台运行）
#    - 部署完成后自动请求一次 /proxy/image 自检，结果一目了然
# ═══════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

echo "==> [1/4] 拉取最新代码"
git pull origin

echo "==> [2/4] 安装依赖"
npm install --omit=dev

if [ ! -f .env ]; then
  echo "!! 缺少 .env，请先运行: bash setup.sh"
  exit 1
fi

echo "==> [3/4] 重启服务"
if command -v pm2 >/dev/null 2>&1; then
  if ! pm2 restart link-parser >/dev/null 2>&1; then
    pm2 start src/index.js --name link-parser
  fi
else
  pkill -f "node src/index.js" || true
  sleep 1
  nohup node src/index.js > server.log 2>&1 &
  echo "    新进程 PID: $! （日志: server.log）"
  sleep 3
fi

echo "==> [4/4] 自检 /proxy/image"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "http://localhost:3001/proxy/image?url=https%3A%2F%2Fci.xiaohongshu.com%2Fnotes_pre_post%2F1040g3k0324cir3sonk605qkbjte4s7001hk7gng%3FimageView2%2F2%2Fw%2F0%2Fformat%2Fjpg%2Fv3%26c%3Dv1")
if [ "$code" = "200" ]; then
  echo "   ✅ 本地 /proxy/image 返回 200，部署成功！"
  echo "   现在回到微信开发者工具，点击【编译】重新解析即可看到预览图。"
else
  echo "   ❌ 本地 /proxy/image 返回 HTTP $code，未部署成功，看最后 20 行日志："
  tail -20 server.log
fi

#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  去水印解析服务 - 第三方 API 配置向导
#  ⚠️ 需要先通过 CloudBase 登录才能部署
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/src/config.js"

# ---------- 颜色 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo '╔══════════════════════════════════════════════════════════════╗'
echo '║             去水印解析服务 - API 配置向导                  ║'
echo '║                                                              ║'
echo '║  本向导将帮助你选择一个第三方解析服务提供商，并完成配置     ║'
echo '║  配置完成后，抖音/快手/小红的解析将恢复正常               ║'
echo '╚══════════════════════════════════════════════════════════════╝'
echo -e "${NC}"
echo ""

# ==============================================================
# 第一步：确认是否已有 API
# ==============================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第一步：选择解析服务商${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "由于抖音/快手/小红书均有强反爬机制，你当前有以下选项："
echo ""
echo -e "  ${GREEN}1) layzz.cn${NC}        - 付费 (~50元/月)，联系微信 Lany4567 购买 Token"
echo -e "  ${GREEN}2) media-parser${NC}    - 免费（自建 Docker），需要你自己的服务器"
echo -e "  ${GREEN}3) custom${NC}          - 通用 POST JSON 格式（适配大多数付费 API）"
echo -e "  ${GREEN}4) tiktokapi${NC}       - GET 格式 API"
echo -e "  ${GREEN}5) 跳过${NC}            - 不配置，稍后手动修改 config.js"
echo ""

read -p "请输入选项编号 (1-5): " provider_choice

case "$provider_choice" in
  1)
    PROVIDER_TYPE="layzz"
    echo ""
    echo -e "${YELLOW}你选择了 layzz.cn${NC}"
    echo "需要通过微信联系 Lany4567 购买解析 Token"
    echo ""

    # 检测是否已有 token
    CURRENT_TOKEN=$(grep -oP "token: '\K[^']*'" "$CONFIG_FILE" || true)
    if [ -n "$CURRENT_TOKEN" ]; then
      echo -e "当前已配置 Token: ${GREEN}$(echo "$CURRENT_TOKEN" | head -c 8)...${NC}"
      read -p "是否使用现有 Token？(Y/n): " use_existing
      if [[ "$use_existing" =~ ^[Nn] ]]; then
        read -p "请输入新的 Token: " LAYZZ_TOKEN
      else
        LAYZZ_TOKEN="$CURRENT_TOKEN"
      fi
    else
      echo -e "${YELLOW}当前未配置 Token。${NC}"
      echo "请先联系微信 Lany4567 购买 Token。"
      echo ""
      read -p "如果你已有 Token，请输入（留空则退出）: " LAYZZ_TOKEN
      if [ -z "$LAYZZ_TOKEN" ]; then
        echo -e "${RED}未输入 Token，退出配置。${NC}"
        exit 1
      fi
    fi

    # 写入配置
    echo ""
    echo -e "${BLUE}正在写入配置...${NC}"
    # 使用 sed 替换 config.js 中的配置
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS
      sed -i '' "s/type: null/type: 'layzz'/" "$CONFIG_FILE"
      sed -i '' "s/token: ''/token: '$LAYZZ_TOKEN'/" "$CONFIG_FILE"
    else
      # Linux
      sed -i "s/type: null/type: 'layzz'/" "$CONFIG_FILE"
      sed -i "s/token: ''/token: '$LAYZZ_TOKEN'/" "$CONFIG_FILE"
    fi
    echo -e "${GREEN}✓ layzz.cn 配置完成！${NC}"
    ;;

  2)
    PROVIDER_TYPE="media-parser"
    echo ""
    echo -e "${YELLOW}你选择了自建 Docker 解析器 (media-parser)${NC}"
    echo ""
    echo "你需要在一台有 Docker 的服务器上运行："
    echo ""
    echo "  docker run -d -p 8051:8051 --name media-parser \\"
    echo "    your-registry/media-parser:latest"
    echo ""
    echo "详细部署文档请参考：https://github.com/your-repo/media-parser"
    echo ""

    read -p "请输入你的 media-parser 服务地址 (默认: http://127.0.0.1:8051/api/parse): " MP_ENDPOINT
    MP_ENDPOINT="${MP_ENDPOINT:-http://127.0.0.1:8051/api/parse}"

    # 写入配置
    echo -e "${BLUE}正在写入配置...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|type: null|type: 'media-parser'|" "$CONFIG_FILE"
      sed -i '' "s|endpoint: 'http://127.0.0.1:8051/api/parse'|endpoint: '$MP_ENDPOINT'|" "$CONFIG_FILE"
    else
      sed -i "s|type: null|type: 'media-parser'|" "$CONFIG_FILE"
      sed -i "s|endpoint: 'http://127.0.0.1:8051/api/parse'|endpoint: '$MP_ENDPOINT'|" "$CONFIG_FILE"
    fi
    echo -e "${GREEN}✓ media-parser 配置完成！${NC}"
    ;;

  3)
    PROVIDER_TYPE="custom"
    echo ""
    echo -e "${YELLOW}你选择了自定义 API (custom)${NC}"
    echo ""
    echo "这种模式适配大多数付费解析服务的通用 POST JSON 格式。"
    echo "POST 请求会发送 {\"url\": \"...\", \"platform\": \"...\", \"apikey\": \"...\"}"
    echo ""

    read -p "请输入 API 端点 URL (Endpoint): " CUSTOM_ENDPOINT
    if [ -z "$CUSTOM_ENDPOINT" ]; then
      echo -e "${RED}端点 URL 不能为空${NC}"
      exit 1
    fi
    read -p "请输入 API Key (如不需要请留空): " CUSTOM_APIKEY

    echo -e "${BLUE}正在写入配置...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/type: null/type: 'custom'/" "$CONFIG_FILE"
      sed -i '' "s|endpoint: ''|endpoint: '$CUSTOM_ENDPOINT'|" "$CONFIG_FILE"
      sed -i '' "s|apiKey: ''|apiKey: '$CUSTOM_APIKEY'|" "$CONFIG_FILE"
    else
      sed -i "s/type: null/type: 'custom'/" "$CONFIG_FILE"
      sed -i "s|endpoint: ''|endpoint: '$CUSTOM_ENDPOINT'|" "$CONFIG_FILE"
      sed -i "s|apiKey: ''|apiKey: '$CUSTOM_APIKEY'|" "$CONFIG_FILE"
    fi
    echo -e "${GREEN}✓ custom API 配置完成！${NC}"
    ;;

  4)
    PROVIDER_TYPE="tiktokapi"
    echo ""
    echo -e "${YELLOW}你选择了 TikTok API 格式 (tiktokapi)${NC}"
    echo ""

    read -p "请输入 API 端点 URL (Endpoint): " TK_ENDPOINT
    if [ -z "$TK_ENDPOINT" ]; then
      echo -e "${RED}端点 URL 不能为空${NC}"
      exit 1
    fi
    read -p "请输入 Token (如不需要请留空): " TK_TOKEN

    echo -e "${BLUE}正在写入配置...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/type: null/type: 'tiktokapi'/" "$CONFIG_FILE"
      sed -i '' "s|endpoint: ''|endpoint: '$TK_ENDPOINT'|" "$CONFIG_FILE"
      sed -i '' "s|apiKey: ''|apiKey: '$TK_TOKEN'|" "$CONFIG_FILE"
    else
      sed -i "s/type: null/type: 'tiktokapi'/" "$CONFIG_FILE"
      sed -i "s|endpoint: ''|endpoint: '$TK_ENDPOINT'|" "$CONFIG_FILE"
      sed -i "s|apiKey: ''|apiKey: '$TK_TOKEN'|" "$CONFIG_FILE"
    fi
    echo -e "${GREEN}✓ tiktokapi 配置完成！${NC}"
    ;;

  5)
    echo ""
    echo -e "${YELLOW}跳过配置。${NC}"
    echo "你可以稍后手动编辑 $CONFIG_FILE"
    echo "或者重新运行本向导。"
    exit 0
    ;;

  *)
    echo -e "${RED}无效选项，退出。${NC}"
    exit 1
    ;;
esac

echo ""
echo ""

# ==============================================================
# 第二步：测试配置
# ==============================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第二步：测试服务器${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -p "是否启动服务器测试配置？(Y/n): " test_choice

if [[ "$test_choice" =~ ^[Nn] ]]; then
  echo -e "${YELLOW}跳过测试。${NC}"
  echo ""
  echo -e "${GREEN}✅ 配置已完成！下一步：${NC}"
  echo "  1. 启动服务器: cd $SCRIPT_DIR && npm start"
  echo "  2. 测试接口: curl http://localhost:3000/api/status"
  echo "  3. 调用解析: curl -X POST http://localhost:3000/api/parse \\"
  echo "                -H 'Content-Type: application/json' \\"
  echo "                -d '{\"url\":\"https://v.douyin.com/xxxxx\"}'"
  exit 0
fi

echo -e "${YELLOW}正在启动服务器...${NC}"

# 检查 node_modules
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${YELLOW}正在安装依赖...${NC}"
  cd "$SCRIPT_DIR"
  npm install
fi

# 启动服务器
cd "$SCRIPT_DIR"
port=${PORT:-3001}

# 检测端口占用
if lsof -i ":$port" &>/dev/null 2>&1; then
  echo -e "${YELLOW}端口 $port 已被占用，尝试使用端口 3000...${NC}"
  port=3000
  if lsof -i ":$port" &>/dev/null 2>&1; then
    echo -e "${YELLOW}端口 3000 也被占用，尝试随机端口...${NC}"
    port=0
  fi
fi

echo -e "${CYAN}启动服务 (端口: $port)...${NC}"
timeout 10 node src/index.js &
SERVER_PID=$!
sleep 3

# 测试 /api/status
echo ""
echo -e "${CYAN}测试 /api/status...${NC}"
status_result=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${port}/api/status" 2>/dev/null || echo "")
if [ -n "$status_result" ]; then
  echo -e "${GREEN}✓ /api/status 响应:${NC}"
  echo "$status_result" | python3 -m json.tool 2>/dev/null || echo "$status_result"
else
  echo -e "${RED}✗ /api/status 无响应${NC}"
  echo "请检查服务器是否成功启动。"
fi

echo ""
echo -e "${CYAN}测试 /api/platforms...${NC}"
plat_result=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${port}/api/platforms" 2>/dev/null || echo "")
if [ -n "$plat_result" ]; then
  echo -e "${GREEN}✓ /api/platforms 响应:${NC}"
  echo "$plat_result" | python3 -m json.tool 2>/dev/null || echo "$plat_result"
fi

echo ""
echo -e "${CYAN}测试健康检查 /health...${NC}"
health_result=$(curl -s --connect-timeout 5 --max-time 10 "http://localhost:${port}/health" 2>/dev/null || echo "")
if [ -n "$health_result" ]; then
  echo -e "${GREEN}✓ /health 响应:${NC}"
  echo "$health_result" | python3 -m json.tool 2>/dev/null || echo "$health_result"
fi

# 关闭测试服务器
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo ""
echo ""

# ==============================================================
# 第三步：部署提示
# ==============================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第三步：部署到 CloudBase CloudRun${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${GREEN}✅ 配置完成！${NC}"
echo ""
echo "如需部署到 CloudBase CloudRun，请运行以下命令："
echo ""
echo "  cd $SCRIPT_DIR"
echo "  tcb login"
echo "  tcb framework deploy"
echo ""
echo "或者重新部署现有服务："
echo ""
echo "  tcb framework deploy --force"
echo ""
echo "部署后，在微信小程序中更新 API_BASE_URL 为："
echo "  https://你的云托管域名/api"
echo ""

echo -e "${CYAN}当前配置摘要:${NC}"
echo -e "  第三方 API 类型: ${GREEN}$(grep -oP "type: '\K[^']*" "$CONFIG_FILE" || echo "未配置")${NC}"
echo -e "  配置文件路径: ${YELLOW}$CONFIG_FILE${NC}"
echo ""

echo -e "${GREEN}感谢使用！如有问题请重新运行本向导。${NC}"

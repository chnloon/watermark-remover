#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  链接解析服务 - 环境变量配置向导
#
#  ✅ 所有密钥写入 server/.env（已被 .gitignore 忽略，不会入库）
#  ✅ 不再修改被 git 跟踪的 src/config.js
#
#  用法:  bash setup.sh
# ═══════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# ---------- 颜色 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo '╔══════════════════════════════════════════════════════════════╗'
echo '║           链接解析服务 - 环境变量配置向导                   ║'
echo '║                                                              ║'
echo '║  所有密钥将写入 server/.env（已被 .gitignore 忽略）        ║'
echo '╚══════════════════════════════════════════════════════════════╝'
echo -e "${NC}"

# 生成随机密钥（优先 openssl，回退 node）
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

# ---------- 已有 .env 检测 ----------
if [ -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}检测到已有 $ENV_FILE${NC}"
  read -p "追加/更新（保留已有项）？(Y/n): " append_choice
  if [[ "$append_choice" =~ ^[Nn] ]]; then
    mv "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
    echo -e "${GREEN}✓ 旧配置已备份，将创建全新 .env${NC}"
  fi
fi

touch "$ENV_FILE"

# ---------- 工具函数：写 key=value（不重复） ----------
write_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # 已有则替换
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# ==============================================================
# 第一步：JWT 密钥（必填）
# ==============================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第一步：JWT 密钥${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

DEFAULT_SECRET="$(generate_secret)"
echo -e "已生成随机密钥: ${GREEN}${DEFAULT_SECRET:0:8}...${NC}"
read -p "使用该随机密钥？(Y/n): " use_random
if [[ "$use_random" =~ ^[Nn] ]]; then
  read -p "请输入自定义 JWT_SECRET: " JWT_SECRET
  if [ -z "$JWT_SECRET" ]; then
    echo -e "${RED}JWT_SECRET 不能为空${NC}"
    exit 1
  fi
else
  JWT_SECRET="$DEFAULT_SECRET"
fi
write_env "JWT_SECRET" "$JWT_SECRET"
echo -e "${GREEN}✓ JWT_SECRET 已写入${NC}"

# ==============================================================
# 第二步：微信小程序配置
# ==============================================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第二步：微信小程序（登录用）${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -p "微信小程序 AppID（回车跳过）: " WX_APP_ID
read -p "微信小程序 AppSecret（回车跳过）: " WX_APP_SECRET
if [ -n "$WX_APP_ID" ]; then
  write_env "WECHAT_APP_ID" "$WX_APP_ID"
  echo -e "${GREEN}✓ WECHAT_APP_ID 已写入${NC}"
fi
if [ -n "$WX_APP_SECRET" ]; then
  write_env "WECHAT_APP_SECRET" "$WX_APP_SECRET"
  echo -e "${GREEN}✓ WECHAT_APP_SECRET 已写入${NC}"
fi
if [ -z "$WX_APP_ID" ] || [ -z "$WX_APP_SECRET" ]; then
  echo -e "${YELLOW}⚠ 未填写完整，登录接口将不可用（解析功能不受影响）${NC}"
  echo "  可稍后编辑 $ENV_FILE 补充"
fi

# ==============================================================
# 第三步：第三方解析 API（可选，自研免费链路默认可用）
# ==============================================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第三步：第三方解析 API（可选）${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "自研免费链路已覆盖抖音/快手/小红书/M3U8/网页视频，无需配置。"
echo "如遇平台加强风控，可配置付费兜底："
echo "  1) layzz        - 付费 (~50元/月)"
echo "  2) media-parser - 自建 Docker"
echo "  3) custom       - 通用 POST JSON"
echo "  4) tiktokapi    - GET 格式 API"
echo "  5) 跳过（默认）"
echo ""
read -p "请选择 (1-5, 默认5): " provider_choice
provider_choice="${provider_choice:-5}"

case "$provider_choice" in
  1)
    write_env "THIRD_PARTY_API_TYPE" "layzz"
    read -p "请输入 layzz Token: " LAYZZ_TOKEN
    if [ -n "$LAYZZ_TOKEN" ]; then
      write_env "LAYZZ_TOKEN" "$LAYZZ_TOKEN"
    fi
    echo -e "${GREEN}✓ layzz 配置完成${NC}"
    ;;
  2)
    write_env "THIRD_PARTY_API_TYPE" "media-parser"
    read -p "media-parser 地址 (默认 http://127.0.0.1:8051/api/parse): " MP_ENDPOINT
    write_env "MEDIA_PARSER_ENDPOINT" "${MP_ENDPOINT:-http://127.0.0.1:8051/api/parse}"
    echo -e "${GREEN}✓ media-parser 配置完成${NC}"
    ;;
  3)
    write_env "THIRD_PARTY_API_TYPE" "custom"
    read -p "API 端点 URL: " CUSTOM_ENDPOINT
    read -p "API Key（如不需要请留空）: " CUSTOM_APIKEY
    if [ -n "$CUSTOM_ENDPOINT" ]; then
      write_env "THIRD_PARTY_ENDPOINT" "$CUSTOM_ENDPOINT"
    fi
    if [ -n "$CUSTOM_APIKEY" ]; then
      write_env "THIRD_PARTY_API_KEY" "$CUSTOM_APIKEY"
    fi
    echo -e "${GREEN}✓ custom 配置完成${NC}"
    ;;
  4)
    write_env "THIRD_PARTY_API_TYPE" "tiktokapi"
    read -p "API 端点 URL: " TK_ENDPOINT
    read -p "Token（如不需要请留空）: " TK_TOKEN
    if [ -n "$TK_ENDPOINT" ]; then
      write_env "THIRD_PARTY_ENDPOINT" "$TK_ENDPOINT"
    fi
    if [ -n "$TK_TOKEN" ]; then
      write_env "THIRD_PARTY_API_KEY" "$TK_TOKEN"
    fi
    echo -e "${GREEN}✓ tiktokapi 配置完成${NC}"
    ;;
  *)
    echo -e "${GREEN}✓ 跳过第三方 API（使用自研免费链路）${NC}"
    ;;
esac

# ==============================================================
# 第四步：运行环境 + 依赖安装 + 本地验证
# ==============================================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  第四步：运行环境${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -p "是否标记为生产环境？(Y/n, 默认Y): " prod_choice
prod_choice="${prod_choice:-Y}"
if [[ "$prod_choice" =~ ^[Yy] ]]; then
  write_env "NODE_ENV" "production"
  echo -e "${GREEN}✓ NODE_ENV=production${NC}"
fi
write_env "PORT" "3001"

# 安装依赖
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${YELLOW}正在安装依赖...${NC}"
  cd "$SCRIPT_DIR"
  npm install
fi

# 本地快速验证（不阻塞）
echo ""
echo -e "${CYAN}快速验证配置...${NC}"
cd "$SCRIPT_DIR"
timeout 8 node src/index.js &
SERVER_PID=$!
sleep 3
HEALTH=$(curl -s --connect-timeout 3 --max-time 5 "http://localhost:3001/health" 2>/dev/null || echo "")
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

if [ -n "$HEALTH" ]; then
  echo -e "${GREEN}✓ 服务启动成功，/health 响应: ${NC}$HEALTH"
else
  echo -e "${RED}✗ 服务启动失败，请检查上方日志${NC}"
fi

# ==============================================================
# 完成提示
# ==============================================================
echo ""
echo -e "${GREEN}✅ 配置完成！配置摘要：${NC}"
echo ""
echo "  .env 位置:  $ENV_FILE"
echo ""
echo "下一步（CVM 部署）："
echo "  1. 启动: cd server && npm start"
echo "  2. 守护: pm2 start src/index.js --name watermark-api"
echo "  3. nginx: 参考仓库根目录 deploy/nginx.conf"
echo "  4. 完整部署流程: 见 DEPLOY.md"
echo ""
echo -e "${YELLOW}注意：.env 含密钥，切勿提交到 git！${NC}"
echo -e "${GREEN}感谢使用！${NC}"

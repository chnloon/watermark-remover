# 部署手册（DEPLOY.md）

> 链接解析服务 · 生产环境部署指南
> 目标环境：腾讯云 CVM `124.221.232.131`（域名 `yc0717.cc`，已 ICP 备案）
> 执行者：你自己（本手册为自助操作，不需要我登录服务器）
> 最后更新：2026-08-27

---

## 0. 前置条件（一次性确认）

| 项目 | 要求 | 检查方法 |
|---|---|---|
| 域名备案 | `yc0717.cc` 已备案 | 腾讯云备案控制台 |
| DNS 解析 | A 记录 → `124.221.232.131` | `nslookup yc0717.cc` |
| 安全组 | 放行 80 / 443（3001 不要对外开放） | 腾讯云防火墙控制台 |
| 服务器系统 | Ubuntu 20.04+ / Debian 11+ | `cat /etc/os-release` |

> ⚠️ 3001 端口只允许本机访问（nginx 反代），**切勿**加入安全组放行规则。

---

## 1. 安装基础软件（首次部署）

```bash
# Node.js 18+（推荐 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v   # 应输出 v20.x

# pm2 进程守护
npm i -g pm2

# nginx
sudo apt update && sudo apt install -y nginx
```

---

## 2. 上传代码并安装依赖

```bash
cd ~
# 二选一：git 拉取 或 本地打包上传
git clone <你的仓库地址> watermark-remover
# 或：scp -r server ubuntu@124.221.232.131:~/watermark-remover/

cd ~/watermark-remover/server
```

**安装依赖（新增了 dotenv、express-rate-limit，必须重新 install）**：

```bash
npm install --omit=dev
```

> ⚠️ `node_modules` 不要用本地 Windows 的拷贝，必须在服务器上重新安装
> （playwright 等原生依赖跨平台不通用；如果解析用不到浏览器可删除
> `douyinBrowserParser` 依赖的 playwright 安装）。

---

## 3. 配置环境变量（核心步骤）

运行交互式配置向导：

```bash
cd ~/watermark-remover/server
bash setup.sh
```

向导会：

1. 自动生成强随机 `JWT_SECRET`（也可以手动填）
2. 询问微信 AppID / AppSecret（**不填也能跑**，小程序将走"匿名解析"；填了则支持登录态）
3. 选择第三方解析 API 类型（1=layzz / 2=media-parser / 3=custom / 4=tiktokapi / 5=跳过）
4. 生成 `server/.env`（**只写入 .env，绝不写入任何 git 跟踪文件**）

检查结果：

```bash
cat .env                # 确认 JWT_SECRET 非空
chmod 600 .env          # 收紧权限
```

生产环境强制校验：`NODE_ENV=production` 且 `JWT_SECRET` 为空时服务会**拒绝启动**。

---

## 4. 启动并验证

### 本地冒烟（不经过 nginx）

```bash
cd ~/watermark-remover/server
npm start &
curl -s http://127.0.0.1:3001/health
# 期望：{"status":"ok","timestamp":"...","uptime":...}
```

### pm2 守护

```bash
cd ~/watermark-remover/server
pm2 start src/index.js --name link-parser
pm2 save                       # 保存进程列表
pm2 startup                    # 按提示执行输出的命令，实现开机自启
pm2 logs link-parser           # 查看日志
```

---

## 5. 配置 Nginx + HTTPS

```bash
sudo cp nginx-link-parser.conf /etc/nginx/sites-available/link-parser.conf
sudo ln -sf /etc/nginx/sites-available/link-parser.conf /etc/nginx/sites-enabled/
sudo nginx -t                  # 语法检查
sudo systemctl reload nginx

# HTTPS 证书（certbot）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yc0717.cc -d www.yc0717.cc
# 自动改配置 + 续期任务（certbot renew --dry-run 验证）
```

验证：

```bash
curl -s https://yc0717.cc/health
curl -sI https://yc0717.cc/health | grep -i 'x-powered-by'   # 应无输出（已隐藏）
curl -sI https://yc0717.cc/health | grep -i 'strict-transport' # 应有 HSTS 头
```

---

## 6. 微信公众平台后台配置（上线前必做）

登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 开发管理 → 开发设置 → 服务器域名：

| 配置项 | 填什么 |
|---|---|
| request 合法域名 | `https://yc0717.cc` |
| downloadFile 合法域名 | `https://yc0717.cc` |
| uploadFile / socket | 无需配置（未使用） |

> 如果配置了第三方解析 API（layzz / media-parser 等），把对应域名也加进
> **request 合法域名**，否则小程序请求会被微信拦截。

另外在"设置 → 服务内容声明 → 用户隐私保护指引"中：
- 声明收集的信息：选"相册（仅写入）"等实际使用项
- 若无需收集用户信息，可声明不收集

---

## 7. 上线自检（部署完成后逐条过）

```bash
# 1) HTTPS 正常
curl -s https://yc0717.cc/health

# 2) SSRF 防护生效（应返回 400 链接地址不可访问）
curl -s "https://yc0717.cc/api/download?url=http://127.0.0.1:3001/" -H "Authorization: Bearer xxx" -o /dev/null -w "%{http_code}\n"

# 3) 限流生效（快速请求应出现 429）
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}\n" https://yc0717.cc/api/platforms; done | sort | uniq -c

# 4) pm2 常驻
pm2 status
```

---

## 8. 常见问题（FAQ）

| 现象 | 原因 | 处理 |
|---|---|---|
| `curl https://...` 返回 502 | 后端没起 / 端口不对 | `pm2 status`；`pm2 logs link-parser` |
| 小程序请求报"url 不在合法域名列表" | 后台未配置或域名写错 | 核对第 6 节，域名**不能带路径**、必须 https |
| 报 429 | 触发限流（30 次/分钟/IP） | 属正常防护；确认不是异常爬虫 |
| 保存相册失败 | 小程序未声明 `scope.writePhotosAlbum` | 检查 app.json permission + 隐私保护指引 |
| 审核被拒"涉及视频下载" | 定位/文案太敏感 | 确认已用"链接解析"命名；在审核备注说明工具用途 |

---

## 9. 发布后监控

- `pm2 monit` 看内存/CPU；`pm2 logs` 看错误
- 错误日志已脱敏，不会暴露内部异常细节
- 若第三方解析 API 配额耗尽：在 `.env` 调整 `THIRD_PARTY_API_TYPE` 并 `pm2 restart link-parser`

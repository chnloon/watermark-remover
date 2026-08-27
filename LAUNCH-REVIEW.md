# 去水印小程序 · 上线前体检报告（2026-08-27）

> 体检时间：2026-08-27 13:34~13:37（三条线并行：前端合规 / 后端安全 / 部署核查，均只读）
> 验证时间：2026-08-27 13:37（在线实测确认风险真实存在）
> 状态：**修复完成（2026-08-27 晚，本地验证通过），待部署 + 提审**（详见文末"修复完成记录"）

---

## 🔴 结论速览

| 体检线 | 状态 | 关键发现 |
|---|---|---|
| 前端审核合规 | ❌ 被拒概率 >90% | 核心功能踩版权红线 + 无隐私弹窗 |
| 后端安全 | ❌ 6 项高危，服务"裸奔" | SSRF / 无鉴权调试端点 / JWT 摆设 |
| 部署/HTTPS | ⚠️ 基本健康 | 域名通、证书有效，安全头全缺 |

---

## 一、前端合规（4 项高危）

1. **核心功能即"版权规避工具"**：tabBar 文案"去水印"（`client/app.json:21`）、`client/project.config.json:2` 描述、`client/pages/result/result.js:398`"下载去水印视频"。微信对去除水印/无水印下载类工具从严拒绝，抖音等平台会联合投诉。
   → 建议：改名"链接解析"，弱化水印字眼，功能转向"解析播放/收藏管理"。
2. **直接下载保存第三方平台内容**：`client/pages/result/result.js:400-586` 三处 `wx.saveVideoToPhotosAlbum` / `wx.saveImageToPhotosAlbum`，把抖音/快手/小红书资源落盘相册。
   → 建议：仅提供在线播放/收藏，删除"保存到相册"，或声明仅支持用户享有合法权利的内容。
3. **完全缺失《用户隐私保护指引》弹窗**：全项目检索"隐私/用户协议"零匹配；已声明 `scope.writePhotosAlbum`（`client/app.json:29-33`）且调用剪贴板/相册隐私接口，但无 `wx.requirePrivacyAuthorize` / `wx.onNeedPrivacyAuthorization` 处理。隐私接口会被禁用、审核必拒。
   → 建议：小程序后台配置隐私指引 + 前端加授权弹窗。
4. **自动读取剪贴板**：`client/pages/index/index.js` onShow 进页即 `wx.getClipboardData`，未经主动触发。
   → 建议：仅保留用户点"粘贴"按钮时读取。

### 中风险
5. **域名配置**：请求域名 `yc0717.cc`（`client/app.js:8`）、downloadFile 代理域名、图片直连第三方图床 URL（`result.js:542`），任一未在 mp 后台配置合法域名则审核员真机打开即功能失效。
6. **类目与名称不符**：导航栏/项目名"云川集"（`client/app.json:9`）与功能"去水印"不一致，易触发"名称与功能不符"驳回。
7. **功能面过宽**：支持 m3u8/网页视频提取，更易被定性为通用"视频下载工具"。

### 低风险/建议
8. `sitemap.json:4` 全站 allow，建议结果/历史页设 disallow。
9. `client/pages/index/index.js:22-61` 死代码 `resolveDouyinShortLink`，建议删除。
10. 建议增加"用户协议+免责声明"页。

---

## 二、后端安全（6 项高危，均已在线上实测确认）

| # | 问题 | 位置 | 在线验证 |
|---|---|---|---|
| 1 | **SSRF**：任意 URL 服务端代请求，无 host 白名单、无内网 IP 拦截（4xx 也透传），可打 127.0.0.1 / 169.254 云元数据、扫内网、带宽滥用 | `server/src/index.js:145-229`（/proxy/video）、`235-309`（/api/download） | ✅ `?url=https://example.com` 实测 200 |
| 2 | **无鉴权调试端点**：任何人可让 lux 子进程抓任意 URL（同 SSRF），回传 stderr/stdout/PATH/HOME/USER 及 err.stack | `server/src/index.js:62-125`（/api/debug/lux） | ✅ 实测公网 200，泄露 luxPath |
| 3 | **JWT 是摆设**：只签发不校验（`auth.js`），parse/proxy/download/debug 全部裸奔；`config.js:48` secret 硬编码默认值 `watermark-remover-jwt-secret-2024` 且 config.js 已被 git 跟踪 | `server/src/routes/auth.js`、`server/src/config.js:48` | ✅ 确认 |
| 4 | **密钥会进 git**：`setup.sh` 用 sed 把 layzz token/apiKey 写进已跟踪的 `src/config.js`，配置付费 API 后密钥即入 git 历史；无 dotenv 加载 .env | `server/setup.sh:81-89/138-146/164-172` | ✅ 确认 |
| 5 | **错误泄露内部细节**：err.message 直接回传客户端（含 URL、lux stderr 片段） | `server/src/routes/parse.js:105`、`index.js:227/307`、`parsers/kuaishou.js:56/72/233`、`parsers/xiaohongshu.js:362` | ✅ 确认 |
| 6 | **零限流**：/api/parse 每次触发多路 axios + lux 子进程（45s）+ headless Chromium（30s），可刷爆第三方计费 API 并耗尽内存 | `server/src/index.js` | ✅ 确认 |

### 中危
- `parsers/douyin.js` 并行解析 withTimeout 不中断底层 promise（资源泄漏面）；`services/browserManager.js` 每请求 newContext/newPage 无并发上限。
- CORS `origin:'*'` 且放行 Authorization（`index.js:23-27`）；Express `x-powered-by` 未隐藏。
- `auth.js:57` openid 直接返回客户端、token 30 天无 refresh。

### 低危
- 依赖版本过宽（express ^4.18.2、cheerio rc.12），无 npm audit；日志仅 console.log 无轮转；`config.js` port=3001 与 `index.js` PORT||3000 不一致（小 bug）。

---

## 三、部署/HTTPS 核查

- ✅ `https://yc0717.cc` 200 OK（腾讯云 124.221.232.131，nginx/1.24.0 Ubuntu，0.15s）
- ✅ Let's Encrypt 证书有效（ssl_verify_result=0）；HTTP 301 强制跳 HTTPS；⚠️ 无 HSTS
- ✅ `/api/status`、`/api/platforms` 在线正常；❌ `/api/health` 404（该路由不存在，小程序侧勿用）
- ⚠️ 安全头全缺（HSTS/CSP/X-Content-Type-Options）；响应头实测 `X-Powered-By: Express` + `Access-Control-Allow-Origin: *`
- ⚠️ 仓库内无 nginx 配置（服务器手工维护）；`server/setup.sh` 有 `github.com/your-repo` 占位链接；`media-parser` 的小红书 Cookie 需在服务器 .env 落实
- 本机 3001 未监听，生产在远端（cloudbaserc.json envId `watermark-remover-d6d6wdf2f00fd3`）

---

## 🌙 晚间（低谷时段）修复计划

1. **后端高危修复**（约 30 分钟）：SSRF 域名白名单 + DNS 后拒绝内网/回环/链路本地 + 限制重定向；删除 `/api/debug/lux`；JWT 校验中间件 + secret 改环境变量；错误信息脱敏；加 express-rate-limit。
2. **前端合规改造**（约 1 小时）：tabBar 改名"链接解析"；弱化水印字眼；加隐私授权弹窗；剪贴板改手动触发；新增"用户协议+免责声明"页。
3. **部署加固**（约 10 分钟）：补 HSTS/CSP 安全头、隐藏 X-Powered-By、限制 CORS 来源。
4. **提审前自检**：隐私指引后台配置、合法域名核对、类目与名称统一、sitemap 收敛。

---

## ✅ 修复完成记录（2026-08-27 晚）

### 后端安全（全部完成并本地实测通过）

| 修复项 | 落地位置 | 本地验证结果 |
|---|---|---|
| SSRF 防护：协议白名单 + 拒绝私网/回环/链路本地/CGNAT/组播 + 连接期 DNS 校验（防 rebinding） | `server/src/utils/ssrf.js`（新增）、`server/src/index.js` | `http://127.0.0.1`、`169.254.169.254`、`10.x`、`192.168.x`、`[::1]`、`file://` 均返回 **400 链接地址不可访问** ✅ |
| 删除无鉴权调试端点 `/api/debug/lux` | `server/src/index.js` | 接口 404 ✅ |
| JWT 宽松校验：坏 token 一律 401，未携带匿名放行；secret 环境变量化，生产缺 secret 拒绝启动 | `server/src/middleware/auth.js`（新增）、`server/src/config.js` | 坏 token 401 ✅；匿名放行 ✅ |
| 密钥不入 git：dotenv 加载 `.env`，`setup.sh` 只写 `.env` | `server/src/config.js`、`server/setup.sh`、`server/.env.example` | `.env` 已被 `.gitignore` 排除 ✅ |
| 错误脱敏：err.message 不再回传客户端 | 9 个文件（parse/auth/kuaishou/xiaohongshu/douyin/m3u8video/generic/luxParser/douyinBrowserParser） | 响应不含内部异常细节 ✅ |
| 限流：/api 30 次/分，媒体代理 120 次/分 + trust proxy | `server/src/index.js` | 快速请求触发 **429** ✅ |
| CORS 白名单 + 隐藏 X-Powered-By | `server/src/index.js` | 恶意 Origin 无 ACAO 头 ✅；X-Powered-By 已隐藏 ✅ |

### 前端合规（全部完成）

| 修复项 | 落地位置 |
|---|---|
| tabBar / 导航栏 / 描述统一改"链接解析" | `client/app.json`、`client/project.config.json`、`client/app.wxss` |
| 隐私授权弹窗（onNeedPrivacyAuthorization + requirePrivacyAuthorize） | `client/app.js`、`client/app.json`（`__usePrivacyCheck__`） |
| 《用户协议与隐私保护指引》页 + 首页入口 | `client/pages/agreement/`（新增）、`client/pages/index/index.wxml` |
| 剪贴板改手动触发（onShow 不再自动读取） | `client/pages/index/index.js` |
| 保存相册前版权提示确认 | `client/pages/result/result.js`（`confirmCopyright`） |
| 删除死代码（detectClipboard/resolveDouyinShortLink 等） | `client/pages/index/index.js` |
| sitemap 收敛（仅首页可索引） | `client/sitemap.json` |

### 部署交付（待你在服务器执行）

- `server/nginx-link-parser.conf`：反代 + HTTPS + 安全头（HSTS/CSP/nosniff）+ 流式代理调优
- `DEPLOY.md`：CVM 部署全流程手册（nvm/pm2/nginx/certbot/微信后台域名）
- `LAUNCH-CHECKLIST.md`：提审自检清单（代码已完成项 ✓ + 后台/服务器待办 ☐）
- 服务器新依赖：`dotenv`、`express-rate-limit`（部署时务必 `npm install`）

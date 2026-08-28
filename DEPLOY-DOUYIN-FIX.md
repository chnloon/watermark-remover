# 抖音解析线上修复 · 一键部署指引

> 适用：CVM `124.221.232.131`（yc0717.cc），pm2 进程 `link-parser`
> 修复内容：① SSRF safeLookup 双根因（线上 proxy/download 一直超时/400 的元凶）② 多线程分段下载（IDM 模式，下载提速 ~1.85x）
> 方法：把本指引整段复制到服务器终端执行即可（不需要改任何文件）

---

## 一、确认当前状态（先跑这条）

```bash
cd ~/watermark-remover && git log --oneline -3 && pm2 describe link-parser | grep -E "script|status" 
```

- 如果第一条输出里有 `c8298c6 🐛 修复抖音解析线上失效` → 代码已在服务器，跳到**第三步重启**。
- 如果只有旧 commit → 走第二步拉取。

## 二、拉取修复代码

```bash
cd ~/watermark-remover
git pull origin master
# 若提示冲突/失败，先看状态：git status（正常情况下是快速合并）
git log --oneline -3   # 应看到 c8298c6
```

> 备选：如果 `git pull` 因网络失败，用本地仓库打包方式（见文末"备选方案"）。

## 三、重启并验证

```bash
cd ~/watermark-remover/server
pm2 restart link-parser --update-env
sleep 2
curl -s http://127.0.0.1:3001/health
# 期望：{"status":"ok",...}
```

## 四、功能验证（抖音真实链接）

```bash
# 1) 解析
curl -s -X POST http://127.0.0.1:3001/api/parse -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/oQFkA0LBqZ0/"}' | head -c 300; echo

# 2) 下载（多线程模式，应秒回且文件完整）
VIDEO_URL=$(curl -s -X POST http://127.0.0.1:3001/api/parse -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/oQFkA0LBqZ0/"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['videoUrl'])")
echo "videoUrl: ${VIDEO_URL:0:80}..."
curl -s --max-time 30 -o /tmp/dl_test.mp4 "http://127.0.0.1:3001/api/download?url=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$VIDEO_URL")"
ls -l /tmp/dl_test.mp4
file /tmp/dl_test.mp4   # 应输出 MP4
```

## 五、全站回归（可选）

```bash
# 小程序真实请求链路（走 nginx + 域名）
curl -s -X POST https://yc0717.cc/api/parse -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/oQFkA0LBqZ0/"}' | head -c 200; echo
```

---

## 修复了什么（背景，供知悉）

| 问题 | 根因 | 修复 |
|---|---|---|
| 线上 proxy/download 一直 30s 超时 | `ssrf.js` 把 `dns.promises.lookup` 当回调版调用，回调永不触发 → 永远等 DNS | 改用 `dns.promises` 正确调用（`server/src/utils/ssrf.js`） |
| 超时修复后全部 400"链接地址不可访问" | Node 传 `all:true` 时 lookup 返回**地址数组**，旧代码对数组一律判危险 | 数组逐项校验后放行 |
| 下载慢（CDN 单连接限速） | 抖音 CDN 单连接约 24MB/s | 多线程分段下载（4 并发 ~44MB/s，实测 1.85x），自动回退单连接（`server/src/utils/multiDownload.js`） |
| 偶发浏览器 GC/崩溃 | 内存不足 | 浏览器进程内存加固 + 失败重建重试一次 |
| 签名 URL 缓存过期 | 抖音签名 3-5 分钟失效 | 缓存 TTL 30min→3min |

## 备选方案（git pull 网络失败时）

在**本地电脑**执行（生成一个补丁包文件）：

```powershell
cd E:\watermark-remover
git format-patch 1e585af..HEAD --stdout > douyin-fix.patch
```

把 `douyin-fix.patch` 上传到 CVM（任意方式：宝塔文件管理/微信传文件/FTP），然后：

```bash
cd ~/watermark-remover
git apply /path/to/douyin-fix.patch
# 然后从"第三步重启"继续
```

---

## 回滚（万一需要）

```bash
cd ~/watermark-remover
git reset --hard 1e585af && cd server && pm2 restart link-parser
```

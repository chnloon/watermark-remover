# 抖音解析线上部署指引（2026-08-28 最终版）

> 适用：CVM `124.221.232.131`（yc0717.cc），**systemd** 服务 `watermark.service`（非 pm2）
> 服务目录：`/home/ubuntu/watermark-server`（git 仓库，分支 master）
> 目录结构：仓库根 = `/home/ubuntu/watermark-server`，服务代码在 `server/` 子目录（ExecStart=`/usr/bin/node src/index.js`，监听 3001）

---

## 一、当前状态确认

```bash
cd /home/ubuntu/watermark-server && git log --oneline -5
systemctl is-active watermark.service   # 期望 active
```

线上 HEAD 应为 `91e7fb3`（见下"commit 链"）。若一致且服务 active，无需任何操作。

## 二、拉取 + 重启（部署新代码）

```bash
cd /home/ubuntu/watermark-server
git pull origin master          # 若网络失败可重试或走文末备选
sudo -n systemctl restart watermark.service
sleep 8
systemctl is-active watermark.service   # 期望 active
```

> 服务器 .env 已含 `THIRD_PARTY_API_TYPE=bugpk`、`JWT_SECRET`，无需重复追加。

## 三、功能验证（走真实域名）

```bash
# 抖音（期望 success:true 且 <5s；bugpk 竞速命中）
curl -s -X POST https://yc0717.cc/api/parse -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/tX_VyPi--VA/"}' | head -c 300; echo
# 快手 / 小红书同理（v.kuaishou.com/Kn6Di5mX / xhslink.cn/o/84w7S1yfoft）
```

2026-08-28 实测：抖音 **978ms** success:true、快手 2151ms、小红书 671ms——三平台全部 <3s。

## 四、commit 链（本次部署内容）

| commit | 内容 |
|---|---|
| `c8298c6` | SSRF 双根因修复 + 多线程分段下载（IDM 模式） |
| `c4d38de` | BugPk 免费第三方 API 兜底（数据中心 IP 被抖音风控的关键兜底） |
| `bb9ca44` | bugpk 429 短时限流保护：90s 模块级冷却 + 仅非限流错误重试 |
| `59935f7` | 抖音解析改并行竞速（先行版，已废弃） |
| `4373960` | 并行改 **firstSuccess 竞速**：任一策略成功立即返回，全失败才等全部 settle（60.9s→<5s 的关键） |
| `91e7fb3` | **修复 4373960 引入的 ReferenceError**（竞速命中日志引用未定义变量 `first`） |

> ⚠️ 经验教训：`4373960` 曾因日志行残留 `first` 变量，导致**竞速命中即抛错**、线上表现为"快速失败 success:false"。`91e7fb3` 修复后竞速路径才真正可用。

## 五、已知边界（知悉即可）

- **bugpk 短时限流**：CVM IP 连打会 429（实测 5 次连发后触发），服务有 90s 冷却保护，冷却中该路快速失败走 lux/其他兜底。
- **bugpk 冷连接慢**：首次调用约 9s（DNS/握手），之后 0.2s——竞速不受影响（有 30s 超时）。
- **浏览器路在服务器 60s 超时**：数据中心 IP 反爬，正常现象，竞速保证不被它拖累。
- 无 videoId 的畸形 URL（如 `/video/` 空 ID）会快速失败返回"抖音解析暂时不可用"——真实用户场景（app 分享短链）不受影响。

---

## 回滚（万一需要）

```bash
cd /home/ubuntu/watermark-server
git reset --hard <旧commit> && sudo -n systemctl restart watermark.service
```

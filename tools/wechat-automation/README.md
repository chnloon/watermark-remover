# 微信开发者工具自动化操作

通过官方 `miniprogram-automator` + DevTools CLI 直接驱动微信开发者工具，
实现：打开项目、页面导航、读取页面数据、调用页面方法、截图、执行表达式。

## 环境

| 组件 | 位置 |
|---|---|
| 微信开发者工具 | `F:\微信web开发者工具\`（v2.01.2510290） |
| 自动化驱动 | `E:\watermark-remover\tools\wechat-automation\node_modules\miniprogram-automator` |
| 操作脚本 | `E:\watermark-remover\tools\wechat-automation\wxa.js` |

## 首次准备

1. 打开微信开发者工具 → 设置 → 安全设置 → 开启「服务端口」
2. 登录微信账号（CLI 依赖登录态，`cli.bat islogin` 可查）

## 使用

```bash
cd E:\watermark-remover\tools\wechat-automation

node wxa.js open                          # 确保自动化服务运行并连接
node wxa.js replaunch pages/index/index   # 打开首页
node wxa.js snapshot                      # 读取当前页面数据 (page.data)
node wxa.js screenshot <file.png>         # 截图
node wxa.js call <方法名> [json参数]       # 调用页面方法
node wxa.js input <data字段> <文本>        # setData 设置字段
node wxa.js eval <表达式>                 # 在当前页面上下文执行 JS
node wxa.js close                         # 关闭项目
```

## 关键机制

- `wxa.js` 启动时会探测 `9420` 端口：无服务则调 `cli.bat auto --project <client> --auto-port 9420` 拉起
- 连接方式：`automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })`（服务已在跑时不再重复 launch）
- 读取页面数据用 `mp.evaluate(() => getCurrentPages()...)`（新版 API 无 page.data()）
- 截图用 `mp.screenshot({ path })`（模拟器级截图）

## 注意事项

- 页面方法 `callMethod` 若触发真实网络请求（如 `doParse`），会等待响应，可能长时间阻塞 —— 联调时先确保后端服务已启动
- 自动化连接期间不要手动操作开发者工具 GUI，避免状态冲突
- DevTools 升级后 `cli.bat` 路径不变，但 API 可能变化（本项目针对 2.01.2510290 验证）

## 测试记录

- ✅ 连接自动化服务（ws://127.0.0.1:9420）
- ✅ 读取首页全部 data（inputUrl/platforms/topPadding/bgTint 等）
- ✅ 模拟器截图 + 视觉模型复核界面
- ⚠️ callMethod(doParse) 需后端在线，否则阻塞（预期行为）

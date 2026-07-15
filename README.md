# 去水印助手 - 小程序 + 后端

视频/图片去水印小程序，支持**抖音、快手、小红书**三大平台。
用户粘贴分享链接即可解析获取无水印原视频/图片，一键保存到手机相册。

---

## 📁 项目结构

```
watermark-remover/
├── server/                     # Node.js 后端服务
│   ├── src/
│   │   ├── index.js           # 服务入口
│   │   ├── config.js          # 配置文件（第三方 API Key 等）
│   │   ├── routes/
│   │   │   └── parse.js       # 解析路由 POST /api/parse
│   │   ├── parsers/
│   │   │   ├── douyin.js      # 抖音解析器
│   │   │   ├── kuaishou.js    # 快手解析器
│   │   │   └── xiaohongshu.js # 小红书解析器
│   │   ├── services/
│   │   │   └── thirdPartyApi.js # 第三方解析 API 通道
│   │   └── utils/
│   │       └── url.js         # URL 工具函数
│   └── package.json
│
├── client/                     # 微信小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── index/             # 首页 - 粘贴链接
│   │   ├── result/            # 结果展示页（预览+保存）
│   │   └── history/           # 解析记录页
│   ├── assets/icons/          # Tab 图标
│   └── project.config.json    # 小程序项目配置
```

---

## 🚀 快速开始

### 1️⃣ 启动后端服务

```bash
cd server
npm install
node src/index.js
```

服务默认在 `http://localhost:3001` 启动。

### 2️⃣ 配置第三方解析 API（生产环境必需）

编辑 `server/src/config.js`：

```js
thirdPartyApi: {
  type: 'custom',              // API 类型
  apiKey: 'your-api-key',      // 从服务商获取的 Key
  endpoint: 'https://...',     // 第三方 API 地址
}
```

> 💡 **为什么需要第三方 API？**
> 抖音、快手等平台的 API 有强反爬机制（X-Gorgon 签名等），无法直接调用。
> 实际生产中使用第三方解析服务（百度搜索"抖音去水印 API"可找到多家服务商）。

### 3️⃣ 打开小程序

1. 打开 **微信开发者工具**
2. 点击「导入项目」→ 选择 `client/` 目录
3. 填入你的小程序 AppID
4. 在 `app.js` 中将 `API_BASE_URL` 改为你的服务器地址

---

## 📡 API 接口

### POST `/api/parse`

解析视频/图片链接

**请求：**
```json
{ "url": "https://v.douyin.com/xxxxx/" }
```

**成功返回：**
```json
{
  "success": true,
  "platform": "douyin",
  "data": {
    "title": "视频标题",
    "coverUrl": "https://...",
    "videoUrl": "https://...",
    "author": { "name": "作者名" },
    "type": "video",
    "source": "douyin"
  }
}
```

### GET `/api/platforms`

获取支持的平台列表

### GET `/health`

健康检查

---

## ✅ 支持平台

| 平台 | 标识 | 支持类型 | 说明 |
|:---|:---:|:--------:|:----|
| 🎵 **抖音** | `douyin` | 视频 | v.douyin.com 短链接 |
| 🎬 **快手** | `kuaishou` | 视频 | kuaishou.com / gifshow.com |
| 📕 **小红书** | `xiaohongshu` | 视频+图片 | xiaohongshu.com / xhslink.com |

---

## ⚠️ 上架审核注意

微信小程序审核较严，建议：
1. **命名中性** — 用"链接解析""视频工具箱"等，避免出现"去水印"
2. **描述合规** — 功能描述写"视频链接解析""图片提取"
3. **个人主体** — 个人小程序审核相对宽松
4. **备用方案** — 如审核不通过，可考虑 H5 网页版（微信公众号菜单或网页链接）

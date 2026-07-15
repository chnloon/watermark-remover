/**
 * 去水印解析服务 - 入口文件
 *
 * 启动方式: node src/index.js
 * 监听端口: 3001 (可通过环境变量 PORT 配置)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const parseRoute = require('./routes/parse');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== 中间件 =====

// CORS 跨域 - 允许小程序访问
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// JSON 请求体解析
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ===== 路由 =====

// API 路由
app.use('/api', parseRoute);

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 根路径
app.get('/', (req, res) => {
  res.json({
    name: '去水印解析服务',
    version: '1.0.0',
    status: 'running',
    docs: {
      parse: 'POST /api/parse  { "url": "分享链接" }',
      platforms: 'GET /api/platforms',
      health: 'GET /health',
    },
  });
});

// ===== 视频代理 =====
// 抖音返回的视频地址需要特定请求头才能播放
// 小程序 video 组件不支持自定义请求头，所以通过后端中转

app.get('/proxy/video', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }

  try {
    const decodedUrl = decodeURIComponent(videoUrl);

    // 构造请求头 - 透传客户端的 Range 头用于分片请求
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
      'Referer': 'https://www.douyin.com/',
      'Accept': '*/*',
    };
    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: requestHeaders,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400 || status === 206,
    });

    // 转发所有视频相关响应头
    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'expires',
      'last-modified',
      'etag',
    ];

    for (const header of forwardHeaders) {
      const value = response.headers[header];
      if (value !== undefined) {
        res.setHeader(
          header.replace(/\b\w/g, (c) => c.toUpperCase()),
          value
        );
      }
    }

    // 设置正确的状态码
    res.status(response.status);

    // 处理流错误
    response.data.on('error', (streamErr) => {
      console.error('[代理] 视频流错误:', streamErr.message);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: '视频流错误' });
      }
    });

    response.data.pipe(res);
  } catch (err) {
    console.error('[代理] 视频获取失败:', err.message);
    res.status(502).json({ success: false, error: '视频获取失败: ' + err.message });
  }
});

// ===== 视频下载（专供小程序保存到相册） =====
// wx.downloadFile 和 wx.saveVideoToPhotosAlbum 配合使用
// 通过后端中转避免小程序域名白名单限制

app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }

  try {
    const decodedUrl = decodeURIComponent(videoUrl);

    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
      },
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    });

    // 设置下载头
    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    res.status(200);

    response.data.on('error', (streamErr) => {
      console.error('[下载] 流错误:', streamErr.message);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: '下载流错误' });
      }
    });

    response.data.pipe(res);
  } catch (err) {
    console.error('[下载] 失败:', err.message);
    res.status(502).json({ success: false, error: '下载失败: ' + err.message });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '接口不存在',
  });
});

// ===== 启动服务 =====

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  去水印解析服务  v1.0.0');
  console.log(`  监听端口: ${PORT}`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`  解析接口: POST http://localhost:${PORT}/api/parse`);
  console.log('  支持平台: 抖音 / 快手 / 小红书');
  console.log('═══════════════════════════════════════');
});

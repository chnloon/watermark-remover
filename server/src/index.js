/**
 * 去水印解析服务 - 入口文件
 *
 * 启动方式: node src/index.js
 * 监听端口: 3000 (可通过环境变量 PORT 配置，CloudRun 自动注入)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { execFile } = require('child_process');
const parseRoute = require('./routes/parse');
const authRoute = require('./routes/auth');
const { parseViaLux } = require('./services/luxParser');
const LUX_BINARY = '/usr/local/bin/lux';

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/api', authRoute);

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ===== Lux 诊断端点 =====
// 调试用：直接运行 lux -j -i <url> 并返回原始输出
// 用于排查 chrome_child 权限问题、网络问题、URL 格式问题等

app.get('/api/debug/lux', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }

  try {
    const luxPath = process.env.LUX_PATH || LUX_BINARY;

    // 先检查文件是否存在
    const fs = require('fs');
    let exists = false;
    try {
      await fs.promises.access(luxPath, fs.constants.F_OK);
      exists = true;
    } catch { /* not found */ }

    // 执行 lux
    const result = await new Promise((resolve) => {
      const child = execFile(
        luxPath,
        ['-j', '-i', url],
        {
          timeout: 45000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          resolve({ err, stdout, stderr, code: err?.code || 0 });
        }
      );
    });

    // 尝试解析 JSON 输出
    let parsedOutput = null;
    if (result.stdout && result.stdout.trim()) {
      try {
        parsedOutput = JSON.parse(result.stdout.trim());
      } catch { /* not valid JSON */ }
    }

    res.json({
      success: true,
      luxPath,
      exists,
      exitCode: result.code,
      errorMessage: result.err?.message || null,
      stderr: result.stderr?.substring(0, 2000) || '',
      stdout: result.stdout?.substring(0, 5000) || '',
      parsedOutput,
      env: {
        PATH: (process.env.PATH || '').substring(0, 500),
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
      },
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.message,
      stack: err.stack?.substring(0, 1000),
    });
  }
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

    // 按视频 CDN 域名动态选择 Referer：
    // 抖音系 CDN 需要抖音 Referer 防盗链；xhscdn（小红书）对抖音 Referer 直接 403
    let referer = '';
    try {
      const host = new URL(decodedUrl).hostname;
      if (/douyin\.com|iesdouyin\.com|douyinvod\.com|zjcdn\.com/i.test(host)) {
        referer = 'https://www.douyin.com/';
      } else if (/kuaishou\.com|gifshow\.com|yximgs\.com/i.test(host)) {
        referer = 'https://www.kuaishou.com/';
      } else if (/xiaohongshu\.com|xhscdn\.com/i.test(host)) {
        referer = 'https://www.xiaohongshu.com/';
      }
    } catch { /* 非法 URL 交由 axios 报错 */ }

    // 构造请求头 - 透传客户端的 Range 头用于分片请求
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
      'Accept': '*/*',
    };
    if (referer) {
      requestHeaders['Referer'] = referer;
    }
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
      // 4xx 透传给客户端（便于区分防盗链拒绝），5xx/其他抛错
      validateStatus: (status) => status < 500,
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

// ===== 文件下载（专供小程序保存到相册） =====
// wx.downloadFile + wx.saveVideoToPhotosAlbum / wx.saveImageToPhotosAlbum
// 通过后端中转：补 Referer/UA 请求头，避免平台防盗链拦截

app.get('/api/download', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }

  try {
    const decodedUrl = decodeURIComponent(fileUrl);

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

    // 根据 Content-Type 判断文件类型，设置正确的文件名
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    let filename = 'download';
    if (contentType.includes('video')) {
      filename = 'watermark_free_video.mp4';
    } else if (contentType.includes('image')) {
      const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : '.jpg';
      filename = `watermark_free_image${ext}`;
    } else {
      filename = 'download.bin';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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

const config = require('./config');

app.listen(PORT, () => {
  const hasApi = !!config.thirdPartyApi.type;

  console.log('═══════════════════════════════════════');
  console.log('  去水印解析服务  v1.0.0');
  console.log(`  监听端口: ${PORT}`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`  解析接口: POST http://localhost:${PORT}/api/parse`);
  console.log('  支持平台: 抖音 / 快手 / 小红书');

  if (!hasApi) {
    console.log('');
    console.log('  ℹ️  信息');
    console.log('  第三方解析 API 未配置（如需可用 layzz / media-parser 等）');
    console.log('  解析将优先使用 lux CLI + 网页提取 (cheerio)，不依赖第三方 API');
  } else {
    console.log(`  第三方 API: ${config.thirdPartyApi.type} (已就绪)`);
  }

  console.log('═══════════════════════════════════════');
});

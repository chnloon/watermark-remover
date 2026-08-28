/**
 * 链接解析服务 - 入口文件
 *
 * 启动方式: node src/index.js
 * 监听端口: 3001 (可通过环境变量 PORT 配置)
 *
 * 安全加固（2026-08-27）：
 * - 删除 /api/debug/lux 无鉴权调试端点
 * - SSRF 防护：/proxy/video 与 /api/download 校验目标地址（拒绝内网/回环），
 *   连接时经 safeLookup 实时校验 DNS 解析结果
 * - JWT 宽松校验中间件：携带无效 token 一律 401，未携带则匿名放行
 * - 接口限流：/api/* 30 次/分钟，/proxy/video 与 /api/download 120 次/分钟
 * - 错误信息脱敏：err.message 不再回传客户端
 * - CORS 来源白名单 + 隐藏 X-Powered-By
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const parseRoute = require('./routes/parse');
const authRoute = require('./routes/auth');
const requireValidToken = require('./middleware/auth');
const { assertSafeUrl, safeLookup } = require('./utils/ssrf');
const { multiThreadDownload } = require('./utils/multiDownload');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3001;

// 信任一层反向代理（nginx），使 req.ip 与限流 key 取到真实客户端 IP
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ===== 中间件 =====

// CORS 跨域 - 小程序 wx.request 不携带 Origin（非浏览器），直接放行；
// 浏览器访问仅允许官方站点来源
const ALLOWED_ORIGINS = [
  'https://yc0717.cc',
  'https://www.yc0717.cc',
  'http://localhost',
  'http://127.0.0.1',
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o + ':'))) {
      return cb(null, true);
    }
    return cb(null, false); // 拒绝：不返回 CORS 头，浏览器自行拦截
  },
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

// ===== 限流 =====

// 通用 API 限流（解析/登录/平台列表等）
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
});

// 媒体代理限流（视频播放/文件下载，频率较高）
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
});

// ===== 路由 =====

// API 路由（先限流，解析接口再叠加 JWT 宽松校验）
app.use('/api', apiLimiter);
app.use('/api/parse', requireValidToken);
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

// 根路径
app.get('/', (req, res) => {
  res.json({
    name: '链接解析服务',
    version: '1.1.0',
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

app.get('/proxy/video', mediaLimiter, requireValidToken, async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }

  try {
    const decodedUrl = decodeURIComponent(videoUrl);

    // SSRF 防护：拒绝内网/回环/链路本地地址（含 DNS 解析校验）
    await assertSafeUrl(decodedUrl);

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
    } catch { /* 非法 URL 交由 assertSafeUrl 处理 */ }

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
    } else {
      // 客户端未带 Range（部分播放器全量拉流）时主动走分片：
      // 抖音等 CDN 对全量请求可能挂起，Range: bytes=0- 等价全量但响应稳定
      requestHeaders['Range'] = 'bytes=0-';
    }

    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: requestHeaders,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      lookup: safeLookup, // 连接时实时校验 DNS 结果，防 DNS rebinding
      // 4xx 透传给客户端（便于区分防盗链拒绝），5xx/其他抛错
      validateStatus: (status) => status < 500,
    });

    // 拒绝把 HTML 页面当媒体回传（防止通过代理读取内网/第三方页面）
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    if (contentType.startsWith('text/html')) {
      response.data.resume(); // 丢弃响应体，释放连接
      return res.status(502).json({ success: false, error: '目标资源类型不受支持' });
    }

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
    // 脱敏：SSRF 拦截(400)与内部错误(502)统一为通用文案，不泄露内部信息
    const status = err && err.code === 'UNSAFE_URL' ? 400 : 502;
    console.error('[代理] 视频获取失败:', err.message);
    res.status(status).json({ success: false, error: status === 400 ? '链接地址不可访问' : '视频获取失败，请重新解析后重试' });
  }
});

// ===== 文件下载（专供小程序保存到相册） =====
// wx.downloadFile + wx.saveVideoToPhotosAlbum / wx.saveImageToPhotosAlbum
// 通过后端中转：补 Referer/UA 请求头，避免平台防盗链拦截

/**
 * 下载主体（可重试）
 * 抖音等签名 URL 过期时，若请求带 share 原始分享链接，自动重新解析一次再下载（限重试 1 次防循环）
 */
async function streamMediaDownload(req, res, fileUrl, shareUrl, attempt) {
  try {
    const decodedUrl = decodeURIComponent(fileUrl);

    // SSRF 防护：拒绝内网/回环/链路本地地址（含 DNS 解析校验）
    await assertSafeUrl(decodedUrl);

    // 按 CDN 域名动态选择 Referer（与 /proxy/video 一致）：
    // 抖音系 CDN 需要抖音 Referer；xhscdn（小红书）对抖音 Referer 直接 403；
    // 快手系 CDN 需要快手 Referer
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
    } catch { /* 非法 URL 交由 assertSafeUrl 处理 */ }

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
      'Accept': '*/*',
    };
    if (referer) {
      requestHeaders['Referer'] = referer;
    }

    let dl;
    if (req.headers.range) {
      // 客户端显式 Range（播放器分片）：单连接透传，不做多线程拆分
      requestHeaders['Range'] = req.headers.range;
      const response = await axios({
        method: 'GET',
        url: decodedUrl,
        headers: requestHeaders,
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 5,
        lookup: safeLookup, // 连接时实时校验 DNS 结果，防 DNS rebinding
        validateStatus: (status) => status < 400,
      });
      dl = {
        stream: response.data,
        totalBytes: response.headers['content-length'] ? Number(response.headers['content-length']) : null,
        contentType: response.headers['content-type'] || '',
        mode: 'single',
      };
    } else {
      // 整文件下载：多线程分段（IDM 模式），实测抖音 CDN 单连接 ~24MB/s、
      // 4 并发 ~44MB/s（约 1.85x）；目标不支持 Range 时自动回退单连接
      dl = await multiThreadDownload(decodedUrl, { headers: requestHeaders, lookup: safeLookup, threads: 4 });
    }

    // 拒绝把 HTML 页面当文件回传
    const contentType = (dl.contentType || '').toLowerCase();
    if (contentType.startsWith('text/html')) {
      dl.stream.resume();
      return res.status(502).json({ success: false, error: '目标资源类型不受支持' });
    }

    // 根据 Content-Type 判断文件类型，设置正确的文件名（中性命名）
    let filename = 'download.bin';
    if (contentType.includes('video')) {
      filename = 'video.mp4';
    } else if (contentType.includes('image')) {
      const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : '.jpg';
      filename = `image${ext}`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (dl.totalBytes) {
      res.setHeader('Content-Length', dl.totalBytes);
    }

    res.status(200);

    dl.stream.on('error', (streamErr) => {
      console.error('[下载] 流错误:', streamErr.message);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: '下载流错误' });
      }
    });

    dl.stream.pipe(res);
  } catch (err) {
    // 签名 URL 过期自愈：带原始分享链接时重新解析一次再下载（限 1 次防循环）
    if (shareUrl && attempt < 2) {
      console.log(`[下载] 失败(${err.message})，尝试基于原始链接重新解析后重试`);
      try {
        const { detectPlatform, extractUrl } = require('./utils/url');
        const parsers = {
          douyin: require('./parsers/douyin'),
          kuaishou: require('./parsers/kuaishou'),
          xiaohongshu: require('./parsers/xiaohongshu'),
        };
        const cleanUrl = extractUrl(String(shareUrl));
        const platform = detectPlatform(cleanUrl);
        const parser = parsers[platform];
        if (parser) {
          const fresh = await parser.parse(cleanUrl);
          if (fresh && fresh.success && fresh.data && fresh.data.videoUrl) {
            console.log(`[下载] 重新解析成功，使用新链接重试（第 ${attempt + 1} 次）`);
            return streamMediaDownload(req, res, fresh.data.videoUrl, shareUrl, attempt + 1);
          }
        }
      } catch (re) {
        console.error('[下载] 自动重解析失败:', re.message);
      }
    }

    // 脱敏：SSRF 拦截(400)与内部错误(502)统一为通用文案，不泄露内部信息
    const status = err && err.code === 'UNSAFE_URL' ? 400 : 502;
    console.error('[下载] 失败:', err.message);
    res.status(status).json({ success: false, error: status === 400 ? '链接地址不可访问' : '下载失败，请重新解析后重试' });
  }
}

app.get('/api/download', mediaLimiter, requireValidToken, async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) {
    return res.status(400).json({ success: false, error: '缺少 url 参数' });
  }
  const shareUrl = req.query.share || '';
  await streamMediaDownload(req, res, fileUrl, shareUrl, 1);
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
  const hasApi = !!config.thirdPartyApi.type;

  console.log('═══════════════════════════════════════');
  console.log('  链接解析服务  v1.1.0');
  console.log(`  监听端口: ${PORT}`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`  解析接口: POST http://localhost:${PORT}/api/parse`);
  console.log('  支持平台: 抖音 / 快手 / 小红书');
  console.log(`  JWT_SECRET: ${config.jwt.secret ? '已配置' : '未配置（生产环境将拒绝启动）'}`);

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

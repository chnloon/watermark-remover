/**
 * 多线程分段下载（IDM 模式）
 *
 * 背景：部分 CDN（如抖音 douyinvod）对单连接限速（实测 ~24MB/s），
 * 多连接并发 Range 分段可到 ~44MB/s（实测 2-4 并发约 1.85x，8 并发边际无增益）。
 * 本模块把"目标 URL"按 Range 切成 N 段并发拉取，按序拼接后以单流输出，
 * 调用方拿到的是与单连接完全一致的数据流（Content-Length 精确）。
 *
 * 与 /proxy/video 的关系：这里是"整文件下载"场景（小程序保存到相册），
 * 目标是尽快把完整文件拿回来；/proxy/video 是流式代理，保持原样。
 *
 * 内存说明：每段以 buffer 暂存，峰值 ≈ 文件总大小（并发段几乎同时完成时）。
 * 视频文件通常 <100MB，服务器内存可承受；超大文件场景可改为流式按序输出。
 */

const { PassThrough } = require('stream');
const axios = require('axios');

const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36';

/**
 * 探测目标是否支持 Range 分段，返回总大小。
 * @returns {{ totalBytes: number|null, supportsRange: boolean }}
 */
async function probeRange(url, { headers = {}, lookup, timeout = 30000 }) {
  const response = await axios({
    method: 'GET',
    url,
    headers: { 'User-Agent': DEFAULT_UA, ...headers, 'Range': 'bytes=0-0' },
    responseType: 'arraybuffer',
    timeout,
    maxRedirects: 5,
    lookup,
    validateStatus: (status) => status < 400,
  });

  const contentRange = response.headers['content-range'];
  const is206 = response.status === 206;
  const contentType = response.headers['content-type'] || '';
  if (is206 && contentRange) {
    const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange);
    if (match) {
      return { totalBytes: Number(match[1]), supportsRange: true, contentType };
    }
  }
  return { totalBytes: null, supportsRange: false, contentType };
}

/**
 * 单连接全量下载（回退路径），返回原始响应（stream）。
 */
async function singleStream(url, { headers = {}, lookup, timeout = 120000 }) {
  return axios({
    method: 'GET',
    url,
    headers: { 'User-Agent': DEFAULT_UA, ...headers, 'Range': 'bytes=0-' },
    responseType: 'stream',
    timeout,
    maxRedirects: 5,
    lookup,
    validateStatus: (status) => status < 400,
  });
}

/**
 * 多线程分段下载。
 *
 * @param {string} url 目标 URL（已通过 SSRF 校验）
 * @param {object} [opts]
 * @param {object} [opts.headers] 额外请求头（Referer 等；不含 Range/UA，本模块管理）
 * @param {number} [opts.threads=4] 并发段数（2-8，实测 4 已接近上限）
 * @param {number} [opts.timeout=120000] 每段超时（ms）
 * @param {Function} [opts.lookup] 自定义 DNS lookup（SSRF 实时校验）
 * @returns {Promise<{ stream: PassThrough, totalBytes: number|null, contentType: string, mode: 'multithread'|'single' }>}
 */
async function multiThreadDownload(url, opts = {}) {
  const { headers = {}, threads = 4, timeout = 120000, lookup } = opts;
  const nThreads = Math.max(2, Math.min(8, Math.floor(threads)));

  // 1. 探测 Range 支持与总大小（必须带 Referer，抖音 CDN 无 Referer 直接 403）
  let probe;
  try {
    probe = await probeRange(url, { headers, lookup, timeout: Math.min(timeout, 30000) });
  } catch (err) {
    // 探测失败（网络错误等）→ 回退单连接，由调用方按原逻辑处理
    const response = await singleStream(url, { headers, lookup, timeout });
    return { stream: response.data, totalBytes: null, contentType: response.headers['content-type'] || '', mode: 'single' };
  }

  if (!probe.supportsRange || !probe.totalBytes || probe.totalBytes <= 0) {
    // 目标不支持 Range → 回退单连接
    const response = await singleStream(url, { headers, lookup, timeout });
    return { stream: response.data, totalBytes: probe.totalBytes, contentType: response.headers['content-type'] || '', mode: 'single' };
  }

  const total = probe.totalBytes;
  const contentType = probe.contentType;
  const segmentSize = Math.ceil(total / nThreads);
  const ranges = [];
  for (let i = 0; i < nThreads; i++) {
    const start = i * segmentSize;
    if (start >= total) break;
    const end = Math.min(start + segmentSize - 1, total - 1);
    ranges.push({ start, end });
  }

  // 2. 并发拉取各段（arraybuffer 暂存）
  const fetchSegment = async (range, attempt = 1) => {
    try {
      const response = await axios({
        method: 'GET',
        url,
        headers: { 'User-Agent': DEFAULT_UA, ...headers, 'Range': `bytes=${range.start}-${range.end}` },
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        lookup,
        validateStatus: (status) => status < 400,
      });
      const body = Buffer.from(response.data);
      if (body.length !== range.end - range.start + 1) {
        throw new Error(`segment ${range.start}-${range.end} size mismatch: got ${body.length}`);
      }
      return { range, body };
    } catch (err) {
      if (attempt < 2) {
        // 单段失败重试一次（CDN 偶发抖动）
        return fetchSegment(range, attempt + 1);
      }
      throw err;
    }
  };

  let segments;
  try {
    segments = await Promise.all(ranges.map((r) => fetchSegment(r)));
  } catch (err) {
    // 分段失败（限速/超时等）→ 回退单连接，保证可用性
    console.warn('[多线程下载] 分段失败，回退单连接:', err.message);
    const response = await singleStream(url, { headers, lookup, timeout });
    return { stream: response.data, totalBytes: total, contentType: response.headers['content-type'] || '', mode: 'single' };
  }

  // 3. 按 offset 排序拼接，流式输出
  segments.sort((a, b) => a.range.start - b.range.start);
  const pass = new PassThrough();
  // 先收集全部段再输出：拼接顺序由 Range 对齐保证，避免流式按序等待的复杂度
  const whole = Buffer.concat(segments.map((s) => s.body));
  if (whole.length !== total) {
    console.warn(`[多线程下载] 拼接长度异常 ${whole.length} != ${total}，回退单连接`);
    const response = await singleStream(url, { headers, lookup, timeout });
    return { stream: response.data, totalBytes: total, contentType: response.headers['content-type'] || '', mode: 'single' };
  }
  // 同 tick 写入，避免背压；再 end
  pass.end(whole);

  // content-type 取自探测响应头（各段一致）
  return { stream: pass, totalBytes: total, contentType, mode: 'multithread' };
}

module.exports = { multiThreadDownload, probeRange, singleStream };

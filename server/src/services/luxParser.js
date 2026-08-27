/**
 * iawia002/lux 视频解析工具封装
 *
 * lux 是一个用 Go 编写的命令行视频下载工具，内置各平台（抖音/快手/B站等）
 * 反爬机制（如抖音 X-Bogus 签名），可在服务端以子进程方式调用。
 *
 * 安装方式（Dockerfile 中执行）：
 *   ADD https://github.com/iawia002/lux/releases/download/v0.24.1/lux_0.24.1_Linux_x86_64.tar.gz /tmp/lux.tar.gz
 *   RUN tar -xzf /tmp/lux.tar.gz -C /tmp/ && mv /tmp/lux /usr/local/bin/lux && chmod +x /usr/local/bin/lux
 *
 * 调用方式：
 *   lux -j -i <url>
 *
 * 输出格式（JSON 数组，每项一个 extractors.Data）：
 *   [{
 *     "url": "源视频页 URL",
 *     "site": "平台名称（如"抖音 douyin.com"）",
 *     "title": "视频标题",
 *     "type": "video | image | audio",
 *     "streams": {
 *       "default": {
 *         "id": "default",
 *         "quality": "标清",
 *         "parts": [{ "url": "...无水印.mp4", "size": 123456, "ext": "mp4" }],
 *         "size": 123456,
 *         "ext": "mp4"
 *       }
 *     },
 *     "caption": null,
 *     "err": null
 *   }]
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// lux 二进制路径（可由环境变量覆盖，方便本地开发测试）
const LUX_BINARY = process.env.LUX_PATH || '/usr/local/bin/lux';

/** 检查 lux 二进制是否真的存在（带缓存） */
function checkLuxBinary() {
  try {
    fs.accessSync(LUX_BINARY, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * lux videoData.site → 平台标识映射表
 *
 * lux 的 site 字段格式为 "平台名 域名"（如 "抖音 douyin.com"），
 * 此处通过关键词匹配将其映射到统一的平台标识。
 */
const SITE_TO_PLATFORM = [
  { keywords: ['douyin', '抖音', 'iesdouyin'], platform: 'douyin' },
  { keywords: ['kuaishou', '快手'], platform: 'kuaishou' },
  { keywords: ['bilibili', 'b站', 'B站', 'bili'], platform: 'bilibili' },
  { keywords: ['weibo', '微博'], platform: 'weibo' },
  { keywords: ['xiaohongshu', '小红书', 'xhs'], platform: 'xiaohongshu' },
  { keywords: ['instagram', 'ig'], platform: 'instagram' },
  { keywords: ['twitter', 'x.com', 'tweet'], platform: 'twitter' },
  { keywords: ['youtube', 'youtu.be'], platform: 'youtube' },
];

function detectPlatform(site) {
  if (!site) return 'unknown';
  const lower = site.toLowerCase();
  for (const entry of SITE_TO_PLATFORM) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) return entry.platform;
    }
  }
  return site.split(/\s+/)[0] || 'unknown';
}

/**
 * 调用 lux 解析视频 URL
 *
 * 使用子进程执行 `lux -j -i <url>`，解析 stdout 中的 JSON 数组，
 * 提取无水印视频 URL 或图片列表，返回标准化的解析结果格式。
 *
 * @param {string} url - 视频/分享链接
 * @param {object} [options]
 * @param {number} [options.timeout=45000] - lux 执行超时（毫秒）
 * @returns {Promise<object>} 标准化结果 { success, platform, data }
 */
async function parseViaLux(url, options = {}) {
  // 预检查：二进制不存在则快速返回，避免在 Windows 上抛出"Command failed"
  if (!checkLuxBinary()) {
    return { success: false, platform: 'lux', error: 'lux 未安装' };
  }

  const timeout = options.timeout || 45000;

  try {
    const result = await runLux(url, timeout);

    if (!result || result.length === 0) {
      return { success: false, platform: 'lux', error: '解析结果为空' };
    }

    const videoData = result[0];

    // lux 可能返回 err 字段表示内部错误（仅记日志，不回传客户端）
    if (videoData.err) {
      console.error('[LuxParser] lux 内部错误:', videoData.err);
      return {
        success: false,
        platform: 'lux',
        error: '解析器内部错误，请稍后重试',
      };
    }

    // 提取站点标识
    const site = videoData.site || '';

    // 提取最佳视频流
    const streams = videoData.streams || {};
    const streamKeys = Object.keys(streams);
    if (streamKeys.length === 0) {
      return { success: false, platform: 'lux', error: '未找到可用视频流' };
    }

    // 倾向选择 "default" 流，或最后一条（通常质量最高）
    const bestKey = streamKeys.includes('default') ? 'default' : streamKeys[streamKeys.length - 1];
    const bestStream = streams[bestKey];
    if (!bestStream || !bestStream.parts || bestStream.parts.length === 0) {
      return { success: false, platform: 'lux', error: '视频流中无可用分片' };
    }

    const isImageType = videoData.type === 'image';

    if (isImageType) {
      // ── 图片幻灯片（抖音图文等） ──
      const images = bestStream.parts.map((p) => ({
        url: p.url,
        width: 0,
        height: 0,
      }));

      return {
        success: true,
        platform: detectPlatform(site),
        data: {
          title: videoData.title || '',
          coverUrl: images[0]?.url || '',
          videoUrl: '',
          images,
          author: { name: '', avatar: '' },
          type: 'image',
          duration: 0,
          _source: 'lux',
        },
      };
    }

    // ── 普通视频 ──
    const firstPart = bestStream.parts[0];

    return {
      success: true,
      platform: detectPlatform(site),
      data: {
        title: videoData.title || '',
        coverUrl: '',
        videoUrl: firstPart.url,
        images: [],
        author: { name: '', avatar: '' },
        type: 'video',
        duration: 0,
        _source: 'lux',
      },
    };
  } catch (err) {
    console.error('[LuxParser] Error:', err.message);
    return { success: false, platform: 'lux', error: '解析器执行失败，请稍后重试' };
  }
}

/**
 * 执行 lux 子进程并解析 JSON 输出
 *
 * 注意：lux 的 `-j` 输出是 JSON 数组，
 * 每行一个 JSON 对象（json.NewEncoder 编码），
 * 最终拼起来是一个 JSON 数组。
 *
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<Array>}
 */
function runLux(url, timeout) {
	  return new Promise((resolve, reject) => {
	    let stderrBuffer = '';

	    const child = execFile(
	      LUX_BINARY,
	      ['-j', '-i', url],
	      {
	        timeout,
	        maxBuffer: 10 * 1024 * 1024, // 10 MB
	        env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
	      },
	      (error, stdout, stderr) => {
	        // 收集 stderr（用于诊断）
	        if (stderr && stderr.trim()) {
	          stderrBuffer = stderr.trim();
	        }

	        // lux 在无法解析时仍可能把 JSON 输出到 stdout 并返回非零退出码，
	        // 所以先检查 stdout 是否有有效 JSON
	        if (stdout && stdout.trim().length > 0) {
	          try {
	            const parsed = JSON.parse(stdout.trim());
	            resolve(parsed);
	            return;
	          } catch {
	            // stdout 不是有效 JSON → 说明 lux 执行失败但输出了错误信息，
	            // 提取第一行（通常包含具体原因）用于诊断
	          }
	        }

		        if (error) {
		          // ENOENT: binary not found (Linux/macOS). 某些 Windows 环境下
		          // error.code 可能不是 ENOENT，所以额外检查 error.message
		          if (error.code === 'ENOENT' || (error.message && error.message.includes('ENOENT'))) {
		            reject(new Error('lux 未安装'));
		          } else {
            // 构建详细诊断信息
            const diagnostics = [];
            // stdout 非 JSON 时包含 lux 的错误描述行
            if (stdout && stdout.trim()) {
              const lines = stdout.trim().split('\n');
              // 跳过 "Downloading ... error:" 头行和堆栈跟踪行，提取实际错误
              const errorLine = lines.find(
                (l) =>
                  l.trim() &&
                  !l.trim().startsWith('Downloading') &&
                  !l.trim().startsWith('/') &&
                  !l.trim().startsWith('github.com/') &&
                  !l.trim().startsWith('\t'),
              );
              if (errorLine) diagnostics.push(errorLine.trim());
            }
	            if (stderrBuffer) {
	              diagnostics.push(`stderr: ${stderrBuffer.substring(0, 300)}`);
	            }
	            const detail = diagnostics.length > 0 ? ` (${diagnostics.join('; ')})` : '';
	            reject(new Error(`lux 执行失败: ${error.message}${detail}`));
	          }
	          return;
	        }

	        // 没有 stdout 也没有 error（理论上不会发生）
	        const detail = stderrBuffer
	          ? ` (stderr: ${stderrBuffer.substring(0, 500)})`
	          : '';
	        reject(new Error(`lux 无有效输出${detail}`));
	      },
	    );

	    // 实时收集 stderr（回调中也会收到完整内容，双重保险）
	    child.stderr?.on('data', (data) => {
	      const chunk = data.toString();
	      if (chunk.trim()) {
	        stderrBuffer += chunk;
	        console.debug('[Lux stderr]:', chunk.trim());
	      }
	    });
	  });
	}

module.exports = { parseViaLux };

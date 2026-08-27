/**
 * SSRF 防护工具
 *
 * 防护策略：
 * 1. 仅允许 http/https 协议
 * 2. 拒绝内网 / 回环 / 链路本地 / 保留地址（IPv4 + IPv6）
 * 3. 域名先经 DNS 解析、解析结果全部通过校验才放行（防 DNS rebinding）
 * 4. safeLookup 直接替换 axios/node http 的 lookup 函数，保证"实际连接使用的 IP"
 *    与"校验过的 IP"是同一个，避免校验与连接分离造成的绕过窗口
 */

const dns = require('dns').promises;
const net = require('net');

// IPv4 私有/危险网段（含 100.64/10 CGNAT、198.18/15 基准测试网段）
const IPV4_DANGEROUS_PATTERNS = [
  [/^0\./, '未指定地址'],
  [/^10\./, 'A类私网'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'CGNAT 共享地址'],
  [/^127\./, '回环地址'],
  [/^169\.254\./, '链路本地'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'B类私网'],
  [/^192\.168\./, 'C类私网'],
  [/^198\.18\./, '基准测试网段'],
  [/^198\.19\./, '基准测试网段'],
  [/^224\./, '组播地址'],
  [/^240\./, '保留地址'],
  [/^255\./, '广播地址'],
];

/**
 * 判断 IPv4 是否为私网/危险地址
 */
function isDangerousIPv4(ip) {
  return IPV4_DANGEROUS_PATTERNS.some(([re]) => re.test(ip));
}

/**
 * 判断 IPv6 是否为私网/危险地址
 * ::1 回环 / fc00::/7 ULA / fe80::/10 链路本地 / ff00::/8 组播
 */
function isDangerousIPv6(ip) {
  const lower = ip.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('ff')
  );
}

/**
 * 判断 IP 是否为私网/危险地址
 * @param {string} ip
 * @returns {boolean}
 */
function isDangerousIp(ip) {
  if (net.isIPv4(ip)) return isDangerousIPv4(ip);
  if (net.isIPv6(ip)) return isDangerousIPv6(ip);
  return true; // 无法识别的地址一律拒绝
}

/**
 * 构造"链接不可访问"错误（统一携带 UNSAFE_URL 标记，供路由区分 400/502）
 */
function createUnsafeError(msg) {
  const err = new Error(msg);
  err.code = 'UNSAFE_URL';
  return err;
}

/**
 * 校验一个 URL 是否安全（协议 + 内网 IP），解析域名并校验全部结果
 * @param {string} rawUrl
 * @returns {Promise<URL>} 通过校验返回 URL 对象
 * @throws {Error} 不安全时抛出带 UNSAFE_URL 标记的 Error
 */
async function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw createUnsafeError('链接格式无效');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createUnsafeError('仅支持 http/https 链接');
  }

  let hostname = (parsed.hostname || '').replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw createUnsafeError('链接缺少主机名');
  }

  // 直接以 IP 形式访问
  if (net.isIP(hostname)) {
    if (isDangerousIp(hostname)) {
      throw createUnsafeError('该链接指向内网地址，已阻止访问');
    }
    return parsed;
  }

  // 域名 → DNS 解析后校验（防 DNS rebinding）
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw createUnsafeError('域名解析失败');
  }
  if (!addresses || addresses.length === 0) {
    throw createUnsafeError('域名解析失败');
  }

  for (const { address } of addresses) {
    if (isDangerousIp(address)) {
      throw createUnsafeError('该链接指向内网地址，已阻止访问');
    }
  }
  return parsed;
}

/**
 * 供 axios/node http 使用的安全 lookup 函数：
 * 连接时解析到的每个 IP 都实时校验，私网/危险地址直接拒绝
 */
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, options, (err, address, family) => {
    if (!err && address && isDangerousIp(address)) {
      const e = new Error(`SSRF 拦截：域名解析到内网地址 ${address}`);
      e.code = 'UNSAFE_URL';
      return callback(e);
    }
    callback(err, address, family);
  });
}

module.exports = {
  assertSafeUrl,
  safeLookup,
  isDangerousIp,
};

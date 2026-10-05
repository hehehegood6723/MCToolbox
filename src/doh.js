const dns = require('dns');

/**
 * DNS 被运营商劫持时的自动兜底。
 *
 * 现象：某些网络会把 modrinth.com 之类解析到劫持服务器，
 * 表现是 TLS 报错（CERT_HAS_EXPIRED / 自签名证书），请求直接失败。
 *
 * 做法：正常请求先照常走；**只有在失败且看起来像 DNS/证书问题时**，
 * 才用 DoH（加密 DNS）查一次真实 IP，然后重试。
 * 这样没被劫持的网络完全没有额外开销。
 */

const DOH_ENDPOINTS = [
  'https://dns.alidns.com/resolve',
  'https://223.5.5.5/resolve',
  'https://cloudflare-dns.com/dns-query',
];
const UA = 'MCToolbox/1.0.0';
const TTL = 10 * 60 * 1000;

const overrides = new Map(); // host -> { ip, at }
const originalLookup = dns.lookup;
let installed = false;
let wrapped = false;

/** 只对"疑似被劫持"的错误做兜底，避免误伤 */
const DNS_LIKE_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function looksLikeDnsOrTlsFailure(err) {
  let e = err;
  for (let i = 0; i < 4 && e; i++) {
    if (e.code && DNS_LIKE_CODES.has(String(e.code))) return true;
    if (e.message && /certificate|CERT_|self[- ]signed|fetch failed|TLS/i.test(String(e.message))) return true;
    e = e.cause;
  }
  return false;
}

/** 用加密 DNS（DoH）查真实 IP */
async function resolveViaDoh(hostname) {
  for (const ep of DOH_ENDPOINTS) {
    try {
      const res = await fetch(ep + '?name=' + encodeURIComponent(hostname) + '&type=A', {
        headers: { Accept: 'application/dns-json', 'User-Agent': UA },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const ips = (j.Answer || [])
        .filter((a) => a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(a.data))
        .map((a) => a.data);
      if (ips.length) return ips[0];
    } catch (e) {
      /* 换下一个 DoH 服务 */
    }
  }
  return null;
}

/** 装上 dns.lookup 补丁：命中 overrides 的域名用我们查到的真实 IP */
function install() {
  if (installed) return;
  installed = true;
  dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const opts = typeof options === 'number' ? { family: options } : options || {};
    const host = String(hostname || '').toLowerCase();
    const hit = overrides.get(host);
    if (hit && Date.now() - hit.at < TTL) {
      if (opts.all) return process.nextTick(() => callback(null, [{ address: hit.ip, family: 4 }]));
      return process.nextTick(() => callback(null, hit.ip, 4));
    }
    return originalLookup.call(dns, hostname, options, callback);
  };
}

/** 强制用 DoH 解析某个域名；成功返回 true */
async function forceResolve(hostname) {
  const ip = await resolveViaDoh(hostname);
  if (!ip) return false;
  overrides.set(String(hostname).toLowerCase(), { ip, at: Date.now() });
  if (typeof module.exports.onFallback === 'function') {
    try {
      module.exports.onFallback(hostname, ip);
    } catch (e) {
      /* ignore */
    }
  }
  return true;
}

/** 包装全局 fetch：失败且疑似被劫持时，用 DoH 重试一次 */
let inFallback = false; // 防止 DoH 请求自己又触发兜底（无限递归）

function installFetchFallback() {
  if (wrapped || typeof globalThis.fetch !== 'function') return;
  wrapped = true;
  const orig = globalThis.fetch;
  globalThis.fetch = async function (input, init) {
    try {
      return await orig(input, init);
    } catch (e) {
      if (inFallback) throw e;
      const url = typeof input === 'string' ? input : input && input.url;
      if (!url || !looksLikeDnsOrTlsFailure(e)) throw e;
      let host = null;
      try {
        host = new URL(url).hostname;
      } catch (err) {
        throw e;
      }
      inFallback = true;
      try {
        if (!overrides.has(host)) {
          const ok = await forceResolve(host);
          if (!ok) throw e;
        }
        return await orig(input, init);
      } finally {
        inFallback = false;
      }
    }
  };
}

module.exports = {
  install,
  installFetchFallback,
  forceResolve,
  resolveViaDoh,
  looksLikeDnsOrTlsFailure,
  overrides,
  onFallback: null,
};

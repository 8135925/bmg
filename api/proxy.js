import https from 'node:https';

/**
 * 接口转发代理（解决浏览器 CORS 限制）
 * 前端统一 POST 该接口，请求体为信封结构：
 * { p: "/portal/...", m: "GET" | "POST", headers: {...}, body: {...} }
 * 按需求约定：仅在进门时校验访问密码，代理本身不做校验。
 *
 * 注意：必须使用原生 https 模块而非 fetch——fetch 会自动附加
 * sec-fetch-mode / accept-language 等浏览器特征头，且 GET 也带
 * Content-Type，会被目标站 WAF 拦截（表现为 405）。
 * 这里的请求头严格对齐 Python requests 的行为。
 */
const BASE_HOST = 'www.baomi.org.cn';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';

// 允许透传给上游的业务请求头
const FORWARD_HEADERS = ['siteId', 'token', 'authToken'];

function upstreamRequest(pathWithQuery, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: BASE_HOST,
        port: 443,
        path: pathWithQuery,
        method,
        headers,
      },
      (upRes) => {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () =>
          resolve({
            status: upRes.statusCode || 502,
            contentType: upRes.headers['content-type'] || 'application/json',
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const p = payload.p;
    const method = payload.m === 'POST' ? 'POST' : 'GET';

    if (typeof p !== 'string' || !p.startsWith('/') || p.length > 4000 || p.includes('..')) {
      return res.status(400).json({ error: '非法的目标路径' });
    }

    // 严格对齐 Python requests 的请求头，避免触发目标站 WAF
    const outHeaders = {
      'User-Agent': DEFAULT_UA,
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };
    const fwd = payload.headers || {};
    for (const key of FORWARD_HEADERS) {
      if (fwd[key]) outHeaders[key] = String(fwd[key]);
    }

    let outBody = null;
    if (method === 'POST') {
      if (payload.body != null) {
        outBody = JSON.stringify(payload.body);
        outHeaders['Content-Type'] = 'application/json';
        outHeaders['Content-Length'] = Buffer.byteLength(outBody);
      } else {
        // 无 body 的 POST：对齐 requests 的行为，仅声明空长度，不带 Content-Type
        outHeaders['Content-Length'] = 0;
      }
    }

    const upstream = await upstreamRequest(p, method, outHeaders, outBody);

    // 上游报错时记录日志，便于在 Vercel Logs 中排查
    if (upstream.status >= 400) {
      console.warn(
        `[proxy] upstream ${method} ${p} -> ${upstream.status}: ${upstream.body.slice(0, 200)}`
      );
    }

    res
      .status(upstream.status)
      .setHeader('Content-Type', upstream.contentType)
      .send(upstream.body);
  } catch (err) {
    res.status(502).json({ error: '转发请求失败: ' + (err?.message || '未知错误') });
  }
}

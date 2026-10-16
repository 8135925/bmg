/**
 * 接口转发代理（解决浏览器 CORS 限制）
 * 前端统一 POST 该接口，请求体为信封结构：
 * { p: "/portal/...", m: "GET" | "POST", headers: {...}, body: {...} }
 * 按需求约定：仅在进门时校验访问密码，代理本身不做校验。
 */
const BASE = 'https://www.baomi.org.cn';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';

// 允许透传给上游的业务请求头
const FORWARD_HEADERS = ['siteId', 'token', 'authToken'];

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

    if (typeof p !== 'string' || !p.startsWith('/') || p.length > 4000) {
      return res.status(400).json({ error: '非法的目标路径' });
    }
    // 禁止跳出目标站点
    if (p.includes('..')) {
      return res.status(400).json({ error: '非法的目标路径' });
    }

    const outHeaders = {
      'User-Agent': DEFAULT_UA,
      'Content-Type': 'application/json',
    };
    const fwd = payload.headers || {};
    for (const key of FORWARD_HEADERS) {
      if (fwd[key]) outHeaders[key] = String(fwd[key]);
    }

    let outBody = null;
    if (method === 'POST' && payload.body != null) {
      outBody = JSON.stringify(payload.body);
    }

    const upstream = await fetch(BASE + p, {
      method,
      headers: outHeaders,
      body: outBody,
    });

    const text = await upstream.text();
    res
      .status(upstream.status)
      .setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
      .send(text);
  } catch (err) {
    res.status(502).json({ error: '转发请求失败: ' + (err?.message || '未知错误') });
  }
}

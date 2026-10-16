/**
 * 保密观中转服务 —— 腾讯云函数（Web 函数）专用
 *
 * 部署方式：SCF 控制台新建函数 → 函数类型选 Web 函数 → 运行环境 Node.js
 * → 在线编辑代码，用本文件内容替换示例 app.js → 监听端口 9000
 *
 * 环境变量：
 *   RELAY_KEY  转发凭证（自定义随机字符串，需与 Vercel 端一致，防止被陌生人白嫖）
 *
 * 协议：与 Vercel 端 /api/proxy 的信封一致 { p, m, headers, body }
 */
const http = require('http');
const https = require('https');

const BASE_HOST = 'www.baomi.org.cn';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';
const FORWARD_HEADERS = ['siteId', 'token', 'authToken'];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function upstreamRequest(pathWithQuery, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: BASE_HOST, port: 443, path: pathWithQuery, method, headers, timeout: 15000 },
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
    req.on('timeout', () => {
      req.destroy(new Error('连接上游超时（15秒）'));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // 转发凭证校验
  if (!process.env.RELAY_KEY || req.headers['x-relay-key'] !== process.env.RELAY_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const p = payload.p;
    const method = payload.m === 'POST' ? 'POST' : 'GET';

    if (typeof p !== 'string' || !p.startsWith('/') || p.length > 4000 || p.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '非法的目标路径' }));
      return;
    }

    // 请求头对齐 Python requests，避免触发目标站 WAF
    const outHeaders = {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
      Connection: 'keep-alive',
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
        outHeaders['Content-Length'] = 0;
      }
    }

    const upstream = await upstreamRequest(p, method, outHeaders, outBody);
    if (upstream.status >= 400) {
      console.warn(`[relay] upstream ${method} ${p} -> ${upstream.status}: ${upstream.body.slice(0, 200)}`);
    }
    res.writeHead(upstream.status, { 'Content-Type': upstream.contentType });
    res.end(upstream.body);
  } catch (err) {
    console.warn(`[relay] request failed: ${err?.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '中转请求失败: ' + (err?.message || '未知错误') }));
  }
});

// SCF Web 函数默认监听 9000 端口
const port = Number(process.env.PORT || process.env._SCF_WEB_PORT || 9000);
server.listen(port, '0.0.0.0', () => {
  console.log(`[relay] listening on ${port}`);
});

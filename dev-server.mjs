/**
 * 本地开发服务器（零依赖，纯 Node）
 * 复用 api/auth.js 与 api/proxy.js 的线上逻辑，行为与 Vercel 部署一致。
 * 启动：node dev-server.mjs
 * 访问密码取环境变量 ACCESS_PASSWORD；未设置时默认 123456（仅本地调试用）。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authHandler from './api/auth.js';
import proxyHandler from './api/proxy.js';

const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

if (!process.env.ACCESS_PASSWORD) {
  process.env.ACCESS_PASSWORD = '123456';
  console.warn('[dev] 未设置 ACCESS_PASSWORD 环境变量，本地默认使用: 123456');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 补齐 Vercel/Express 风格的 res 方法，供线上 handler 无缝复用 */
function enhance(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  res.send = (text) => res.end(text);
  return res;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  enhance(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // API 路由：与线上一致，走同一个 handler 文件
    if (pathname === '/api/auth') {
      if (req.method === 'POST') req.body = JSON.parse((await readBody(req)) || '{}');
      return authHandler(req, res);
    }
    if (pathname === '/api/proxy') {
      if (req.method === 'POST') req.body = JSON.parse((await readBody(req)) || '{}');
      return proxyHandler(req, res);
    }

    // 静态文件
    let file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (file.includes('..')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const norm = (p) => p.replace(/\\/g, '/');
    const filePath = path.join(ROOT, file);
    if (!norm(filePath).startsWith(norm(ROOT) + '/')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[dev] http://localhost:${PORT}  (访问密码: ${process.env.ACCESS_PASSWORD})`);
});

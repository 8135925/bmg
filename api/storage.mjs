import { head, put } from '@vercel/blob';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 令牌存储层
 * - 线上（配置了 BLOB_READ_WRITE_TOKEN）：存 Vercel Blob 的 tokens.json
 *   注意：@vercel/blob 1.1.1 已移除服务端读取函数 get()，
 *   改用 head() 取回 blob 的公开 URL 后用 fetch 读取内容。
 * - 本地（未配置该环境变量）：自动降级为项目根目录的 tokens.local.json 文件，
 *   无需 Vercel 即可完整测试令牌流程。
 */
const BLOB_KEY = 'tokens.json';
const LOCAL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tokens.local.json'
);

// 线上环境禁止走本地文件兜底（函数文件系统只读，会报 EROFS）
const isVercel = Boolean(process.env.VERCEL);

export async function loadTokens() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (isVercel) {
      throw new Error('未检测到 BLOB_READ_WRITE_TOKEN，请先在项目 Storage 中创建 Blob 存储');
    }
    try {
      const arr = JSON.parse(await readFile(LOCAL_FILE, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  try {
    // head 在 blob 不存在时会抛 BlobNotFoundError，统一按空处理
    const meta = await head(BLOB_KEY);
    if (!meta || !meta.url) return [];
    // 加时间戳参数绕过 CDN 缓存，确保读到最新写入的令牌数据
    const sep = meta.url.includes('?') ? '&' : '?';
    const resp = await fetch(`${meta.url}${sep}t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return [];
    const arr = await resp.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveTokens(tokens) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (isVercel) {
      throw new Error('未检测到 BLOB_READ_WRITE_TOKEN，请先在项目 Storage 中创建 Blob 存储');
    }
    await writeFile(LOCAL_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    return;
  }
  await put(BLOB_KEY, JSON.stringify(tokens), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

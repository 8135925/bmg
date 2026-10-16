import { put, list, del } from '@vercel/blob';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 令牌存储层
 * - 线上（配置了 BLOB_READ_WRITE_TOKEN）：存 Vercel Blob
 *   采用"版本化文件名"策略：每次保存写入 tokens/<时间戳>.json 的新文件，
 *   读取时取最新的一个。因为每次都是全新 URL，彻底规避 Blob CDN
 *   对同名文件的不可变缓存导致的读取旧数据问题。
 * - 本地（未配置该环境变量）：降级为项目根目录的 tokens.local.json 文件。
 */
const BLOB_DIR = 'tokens/';
const LEGACY_KEY = 'tokens.json'; // 兼容早期版本写入的单文件
const LOCAL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tokens.local.json'
);

// 线上环境禁止走本地文件兜底（函数文件系统只读，会报 EROFS）
const isVercel = Boolean(process.env.VERCEL);

function parseVersion(pathname) {
  const m = pathname.match(/(\d+)\.json$/);
  return m ? Number(m[1]) : 0;
}

async function loadFromBlob() {
  const result = await list({ prefix: BLOB_DIR, limit: 100 });
  const blobs = (result.blobs || [])
    .slice()
    .sort((a, b) => parseVersion(b.pathname) - parseVersion(a.pathname));

  for (const b of blobs) {
    try {
      const resp = await fetch(b.url, { cache: 'no-store' });
      if (!resp.ok) continue;
      const arr = await resp.json();
      if (Array.isArray(arr)) {
        // 异步清理旧版本文件（不阻塞读取）
        const stale = blobs.filter((x) => x.url !== b.url).map((x) => x.url);
        if (stale.length) del(stale).catch(() => {});
        return arr;
      }
    } catch {
      continue;
    }
  }
  return null;
}

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

  const fromVersioned = await loadFromBlob();
  if (fromVersioned) return fromVersioned;

  // 兼容早期版本写入的 tokens.json 单文件
  try {
    const { head } = await import('@vercel/blob');
    const meta = await head(LEGACY_KEY);
    if (meta && meta.url) {
      const resp = await fetch(meta.url, { cache: 'no-store' });
      if (resp.ok) {
        const arr = await resp.json();
        if (Array.isArray(arr)) return arr;
      }
    }
  } catch {
    /* 不存在则忽略 */
  }
  return [];
}

export async function saveTokens(tokens) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (isVercel) {
      throw new Error('未检测到 BLOB_READ_WRITE_TOKEN，请先在项目 Storage 中创建 Blob 存储');
    }
    await writeFile(LOCAL_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    return;
  }

  // 写入全新版本文件（全新 URL，绝无缓存问题）
  const pathname = `${BLOB_DIR}${Date.now()}.json`;
  await put(pathname, JSON.stringify(tokens), {
    access: 'public',
    contentType: 'application/json',
  });

  // 清理旧版本文件
  try {
    const result = await list({ prefix: BLOB_DIR, limit: 100 });
    const stale = (result.blobs || [])
      .filter((b) => b.pathname !== pathname)
      .map((b) => b.url);
    if (stale.length) await del(stale);
  } catch {
    /* 清理失败不影响主流程 */
  }
}

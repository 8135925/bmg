import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadTokens, saveTokens } from './storage.mjs';

/**
 * 管理接口（管理后台专用）
 * 每次请求都必须携带请求头 x-admin-key，其值等于环境变量 ADMIN_PASSWORD。
 * 按 body.action 分发：
 *   list     查询全部令牌（不含明文）
 *   generate 生成指定数量的一次性令牌（明文仅此一次返回）
 *   assign   标记分配（可填分配备注）
 *   revoke   吊销令牌
 */
function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function genToken() {
  // 形如 BMG-1A2B3C4D5E6F7A8B，16 位十六进制（64bit 熵，不可枚举）
  return 'BMG-' + randomBytes(8).toString('hex').toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
    return res.status(204).end();
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({ ok: false, error: '管理员尚未配置 ADMIN_PASSWORD 环境变量' });
  }

  const a = Buffer.from(String(req.headers['x-admin-key'] || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (!(a.length === b.length && timingSafeEqual(a, b))) {
    return res.status(401).json({ ok: false, error: '管理员密码错误' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = body.action;

  try {
    if (action === 'list') {
      return res.status(200).json({ ok: true, tokens: await loadTokens() });
    }

    if (action === 'generate') {
      let count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        return res.status(400).json({ ok: false, error: '生成数量须为 1-100 的整数' });
      }
      const tokens = await loadTokens();
      let maxId = tokens.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
      const created = [];
      const now = Date.now();
      for (let i = 0; i < count; i++) {
        const plain = genToken();
        tokens.push({
          id: ++maxId,
          hash: sha256(plain),
          createdAt: now,
          status: 'available', // available | assigned | used | revoked
          assignee: '',
          claimedAt: null,
        });
        created.push(plain);
      }
      await saveTokens(tokens);
      return res.status(200).json({ ok: true, tokens: created });
    }

    if (action === 'assign') {
      const tokens = await loadTokens();
      const record = tokens.find((t) => String(t.id) === String(body.id));
      if (!record) return res.status(404).json({ ok: false, error: '令牌不存在' });
      if (record.status === 'used' || record.status === 'revoked') {
        return res.status(400).json({ ok: false, error: '该令牌已使用或已吊销，无法标记分配' });
      }
      record.status = 'assigned';
      record.assignee = String(body.assignee || '').slice(0, 50);
      await saveTokens(tokens);
      return res.status(200).json({ ok: true });
    }

    if (action === 'revoke') {
      const tokens = await loadTokens();
      const record = tokens.find((t) => String(t.id) === String(body.id));
      if (!record) return res.status(404).json({ ok: false, error: '令牌不存在' });
      record.status = 'revoked';
      await saveTokens(tokens);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: '未知操作' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: '操作失败: ' + (err?.message || '未知错误') });
  }
}

import { createHash } from 'node:crypto';
import { loadTokens, saveTokens } from './storage.mjs';

/**
 * 用户端令牌接口，两种模式：
 * 1. 仅 { token }：门禁校验。令牌有效 → 标记 used（即焚）放行
 * 2. { token, nickname }：绑定模式。保密观登录成功后回传昵称，
 *    绑定到已使用的令牌上（仅首次绑定生效），供管理后台显示"实际使用者"
 * 按需求约定：并发场景不做严格原子控制，以简单为主。
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  let token = '';
  let nickname = '';
  if (typeof req.body === 'string') {
    try {
      const b = JSON.parse(req.body);
      token = String(b.token ?? '');
      nickname = String(b.nickname ?? '');
    } catch { /* ignore */ }
  } else if (req.body && typeof req.body === 'object') {
    token = String(req.body.token ?? '');
    nickname = String(req.body.nickname ?? '');
  }
  token = token.trim();

  if (!token) {
    return res.status(200).json({ ok: false, error: '请输入一次性令牌' });
  }

  try {
    const tokens = await loadTokens();

    // 绑定模式：把保密观昵称记录到已使用的令牌上（仅首次生效）
    if (nickname) {
      const hash = createHash('sha256').update(token, 'utf8').digest('hex');
      const record = tokens.find((t) => t.hash === hash);
      if (record && record.status === 'used' && !record.claimedName) {
        record.claimedName = nickname.trim().slice(0, 50);
        await saveTokens(tokens);
      }
      // 绑定结果不阻断用户流程，静默返回
      return res.status(200).json({ ok: true });
    }

    // 门禁校验模式
    if (!tokens.length) {
      return res.status(200).json({ ok: false, error: '管理员尚未生成任何令牌' });
    }

    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const record = tokens.find((t) => t.hash === hash);

    if (!record) {
      return res.status(200).json({
        ok: false,
        error: `令牌无效，请向管理员索取（服务端已加载 ${tokens.length} 条令牌记录）`,
      });
    }
    if (record.status === 'used') {
      return res.status(200).json({ ok: false, error: '该令牌已被使用，请向管理员索取新令牌' });
    }
    if (record.status === 'revoked') {
      return res.status(200).json({ ok: false, error: '该令牌已被吊销' });
    }

    // 即焚：标记为已使用
    record.status = 'used';
    record.claimedAt = Date.now();
    await saveTokens(tokens);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: '校验失败: ' + (err?.message || '未知错误') });
  }
}

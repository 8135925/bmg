import { timingSafeEqual } from 'node:crypto';

/**
 * 访问密码校验接口
 * 密码配置在 Vercel 环境变量 ACCESS_PASSWORD 中。
 * 后台修改环境变量后，旧密码立即失效（需重新部署生效）。
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const expected = process.env.ACCESS_PASSWORD;
  if (typeof expected !== 'string' || expected.length === 0) {
    return res
      .status(500)
      .json({ ok: false, error: '管理员尚未配置 ACCESS_PASSWORD 环境变量，请在 Vercel 项目设置中添加' });
  }

  let password = '';
  if (typeof req.body === 'string') {
    try {
      password = String(JSON.parse(req.body).password ?? '');
    } catch {
      password = '';
    }
  } else if (req.body && typeof req.body === 'object') {
    password = String(req.body.password ?? '');
  }

  // 时序安全的比较，避免逐字符猜测
  const a = Buffer.from(String(password), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const ok = a.length === b.length && timingSafeEqual(a, b);

  return res.status(200).json({ ok });
}

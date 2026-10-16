/* ================= 令牌管理控制台 ================= */
let adminKey = ''; // 仅内存保存，刷新页面需重新登录

const $ = (id) => document.getElementById(id);

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS = {
  available: { label: '未分配', cls: 'badge-blue' },
  assigned: { label: '已分配', cls: 'badge-purple' },
  used: { label: '已使用', cls: 'badge-gray' },
  revoked: { label: '已吊销', cls: 'badge-red' },
};

/** 调用管理接口 */
async function call(action, extra = {}) {
  const resp = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ action, ...extra }),
  });
  const j = await resp.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  if (!resp.ok || !j.ok) {
    throw new Error(j.error || `请求失败 (HTTP ${resp.status})`);
  }
  return j;
}

/* ---------- 门禁 ---------- */
function gateError(msg) {
  const el = $('gate-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function submitGate(e) {
  e.preventDefault();
  const key = $('admin-password').value;
  if (!key) {
    gateError('请输入管理员密码');
    return;
  }
  const btn = $('gate-submit');
  btn.disabled = true;
  btn.textContent = '验证中...';
  adminKey = key;
  try {
    await call('list');
    $('gate-error').classList.add('hidden');
    $('admin-password').value = '';
    $('screen-gate').classList.add('hidden');
    $('screen-main').classList.remove('hidden');
    await refreshList();
  } catch (err) {
    gateError(err.message);
    adminKey = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '进入控制台';
  }
}

/* ---------- 渲染 ---------- */
function renderStats(tokens) {
  const counts = { total: tokens.length, available: 0, assigned: 0, used: 0, revoked: 0 };
  for (const t of tokens) {
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  $('stat-total').textContent = counts.total;
  $('stat-available').textContent = counts.available;
  $('stat-assigned').textContent = counts.assigned;
  $('stat-used').textContent = counts.used;
  $('stat-revoked').textContent = counts.revoked;
}

function renderTable(tokens) {
  const tbody = $('token-tbody');
  tbody.innerHTML = '';
  $('empty-tip').classList.toggle('hidden', tokens.length > 0);

  const sorted = tokens.slice().reverse(); // 最新在前
  for (const t of sorted) {
    const s = STATUS[t.status] || { label: t.status, cls: 'badge-gray' };
    // 分配/使用者列：管理员备注优先，保密观昵称（用户登录后自动绑定）作为辅助行
    let nameHtml = '-';
    if (t.claimedName) {
      nameHtml = `<span class="used-name">使用者: ${escapeHtml(t.claimedName)}</span>`;
    }
    if (t.assignee) {
      nameHtml = `${escapeHtml(t.assignee)}` +
        (t.claimedName ? `<br><span class="used-name">使用者: ${escapeHtml(t.claimedName)}</span>` : '');
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.id}</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td class="name-cell">${nameHtml}</td>
      <td>${fmtDate(t.createdAt)}</td>
      <td>${t.claimedAt ? fmtDate(t.claimedAt) : '-'}</td>`;

    const td = document.createElement('td');
    td.className = 'op-cell';
    if (t.status === 'available' || t.status === 'assigned') {
      if (t.status === 'available') {
        const bAssign = document.createElement('button');
        bAssign.className = 'btn op-assign';
        bAssign.textContent = '标记分配';
        bAssign.onclick = () => doAssign(t);
        td.appendChild(bAssign);
      }
      const bRevoke = document.createElement('button');
      bRevoke.className = 'btn op-revoke';
      bRevoke.textContent = '吊销';
      bRevoke.onclick = () => doRevoke(t);
      td.appendChild(bRevoke);
    } else {
      td.textContent = '-';
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

async function refreshList() {
  const res = await call('list');
  renderStats(res.tokens);
  renderTable(res.tokens);
}

/* ---------- 操作 ---------- */
async function doAssign(record) {
  const name = prompt('分配给谁？（备注，如：张三）', record.assignee || '');
  if (name === null) return;
  await call('assign', { id: record.id, assignee: name });
  await refreshList();
}

async function doRevoke(record) {
  const sure = confirm(`确定吊销令牌 #${record.id}？吊销后该令牌立即失效。`);
  if (!sure) return;
  await call('revoke', { id: record.id });
  await refreshList();
}

let lastGenerated = [];

async function doGenerate() {
  const count = parseInt($('gen-count').value, 10);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    alert('请输入 1-100 的整数');
    return;
  }
  const btn = $('btn-generate');
  btn.disabled = true;
  btn.textContent = '生成中...';
  try {
    const res = await call('generate', { count });
    lastGenerated = res.tokens;
    const ul = $('gen-list');
    ul.innerHTML = '';
    for (const plain of res.tokens) {
      const li = document.createElement('li');
      li.textContent = plain;
      li.title = '点击复制单个令牌';
      li.onclick = () => copyText(plain, li);
      ul.appendChild(li);
    }
    $('gen-result').classList.remove('hidden');
    await refreshList();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成';
  }
}

async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    const old = el ? el.textContent : null;
    if (el) {
      el.textContent = '已复制';
      setTimeout(() => { el.textContent = old; }, 800);
    }
  } catch {
    // clipboard API 不可用时退回选中提示
    prompt('请手动复制：', text);
  }
}

/* ---------- 事件绑定 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  $('gate-form').addEventListener('submit', submitGate);
  $('btn-generate').addEventListener('click', doGenerate);
  $('btn-refresh').addEventListener('click', () => refreshList().catch((e) => alert(e.message)));
  $('btn-copy').addEventListener('click', () => copyText(lastGenerated.join('\n')));
});

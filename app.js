/* ================= 配置 ================= */
const CONFIG = {
  SITE_ID: '95',
  DEVICE_ID: 1711,
  // 2026 年度全国保密教育线上培训
  COURSE_PACKET_ID: '312bc914-8e11-421b-b9bc-e900fe1a4e50',
  DEFAULT_EXAM_ID: '8ad5bd4d9d483dde019e3e1066f60035',
};

/* ================= 全局状态（仅内存，不做任何持久化） ================= */
let token = '';            // 保密观登录 token，仅存内存
let nickname = '';
let qrTimer = null;         // 轮询 setTimeout 句柄
let qrDeadline = 0;
let qrSession = 0;          // 轮询会话号，切换场景后旧轮询自动作废
let running = false;        // 任务执行中标记

/* ================= 工具函数 ================= */
const $ = (id) => document.getElementById(id);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 将 HH:MM:SS 转为秒数 */
function timeToSeconds(str) {
  try {
    const [h, m, s] = String(str).split(':').map(Number);
    return h * 3600 + m * 60 + s;
  } catch {
    return 0;
  }
}

/** 页面运行日志 */
function log(msg, type = 'info') {
  const box = $('log');
  const p = document.createElement('p');
  p.className = `log-${type}`;
  p.innerHTML = `<span class="time">[${fmtDate(Date.now())}]</span>`;
  p.appendChild(document.createTextNode(msg));
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function setBusy(busy) {
  running = busy;
  for (const id of ['btn-all', 'btn-study', 'btn-exam']) {
    $(id).disabled = busy;
  }
}

/** 构造带 token 的业务请求头（对应 Python 版 login.build_headers） */
function buildHeaders(tok) {
  const h = { siteId: CONFIG.SITE_ID };
  if (tok) {
    h.token = tok;
    h.authToken = tok;
  }
  return h;
}

/** 统一请求入口：经 /api/proxy 中转，解决 CORS */
async function api(path, { method = 'GET', headers = {}, body = null } = {}) {
  const resp = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: path, m: method, headers, body }),
  });
  if (!resp.ok) {
    let msg = `请求失败 (HTTP ${resp.status})`;
    try {
      const j = JSON.parse(await resp.text());
      if (j.error) msg += ' - ' + j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('接口返回异常: ' + text.slice(0, 200));
  }
}

/* ================= 屏幕切换 ================= */
function showScreen(name) {
  for (const s of ['gate', 'login', 'main']) {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

/* ================= 门禁（一次性令牌） ================= */
let usedToken = ''; // 进门用掉的令牌（仅内存），登录成功后用于回传昵称

async function verifyAccess(token) {
  const resp = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  let j = {};
  try { j = await resp.json(); } catch { /* ignore */ }
  if (resp.status === 500) {
    throw new Error(j.error || '服务端配置错误');
  }
  return j;
}

function gateError(msg) {
  const el = $('gate-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function submitGate(e) {
  e.preventDefault();
  const val = $('gate-password').value.trim();
  if (!val) {
    gateError('请输入一次性令牌');
    return;
  }
  const btn = $('gate-submit');
  btn.disabled = true;
  btn.textContent = '验证中...';
  try {
    const r = await verifyAccess(val);
    if (r.ok) {
      // 令牌即焚，不做任何保存；仅在内存中留作昵称绑定凭据
      usedToken = val;
      $('gate-password').value = '';
      $('gate-error').classList.add('hidden');
      showScreen('login');
      startQrLogin();
    } else {
      gateError(r.error || '令牌无效，请向管理员索取');
    }
  } catch (err) {
    gateError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '进入';
  }
}

/* ================= 登录相关 ================= */
/** 校验 token，返回昵称或 null（对应 Python 版 check_login） */
async function checkLogin(tok) {
  try {
    const resp = await api('/portal/main-api/checkToken.do', {
      headers: buildHeaders(tok),
    });
    if (resp.result) {
      return resp.data.nickName || '未设定姓名';
    }
  } catch { /* ignore */ }
  return null;
}

/** 把保密观昵称绑定到进门用的令牌上（管理后台可见"实际使用者"），失败不影响使用 */
function bindNickname(tok, nick) {
  fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tok, nickname: nick }),
  }).catch(() => { /* 静默，不打断用户 */ });
}

/** 登录成功后进入主界面 */
async function enterMain() {
  const nick = await checkLogin(token);
  if (!nick) {
    token = '';
    showScreen('login');
    startQrLogin();
    alert('登录失败或 token 无效');
    return;
  }
  nickname = nick;
  if (usedToken) bindNickname(usedToken, nick);
  $('welcome').textContent = `登录成功，欢迎: ${nick}`;
  $('log').innerHTML = '';
  showScreen('main');
  log('登录成功！', 'success');
}

/** RSA 加密（对应 Python 版 encrypt：先取公钥再 PKCS#1 v1.5 加密） */
async function encryptText(text) {
  const keyResp = await api('/portal/main-api/getPublishKey.do');
  const pub = keyResp && keyResp.data;
  if (!pub) throw new Error('获取公钥失败');
  const pem = String(pub).trim().startsWith('-----BEGIN')
    ? pub
    : `-----BEGIN PUBLIC KEY-----\n${String(pub).trim()}\n-----END PUBLIC KEY-----`;
  const enc = new JSEncrypt();
  enc.setPublicKey(pem);
  const out = enc.encrypt(text);
  if (out === false) throw new Error('RSA 加密失败');
  return out;
}

/** 账号密码登录 */
async function accountLogin(e) {
  e.preventDefault();
  const loginName = $('login-name').value.trim();
  const passWord = $('login-pass').value;
  const errEl = $('account-error');
  errEl.classList.add('hidden');

  if (!loginName || !passWord) {
    errEl.textContent = '请输入用户名和密码';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('account-submit');
  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const payload = {
      loginName: await encryptText(loginName),
      passWord: await encryptText(passWord),
      deviceId: CONFIG.DEVICE_ID,
      deviceOs: 'pc',
      lon: 40,
      lat: 30,
      siteId: CONFIG.SITE_ID,
      sinopec: 'false',
    };
    const resp = await api('/portal/main-api/loginInNew.do', {
      method: 'POST',
      headers: { siteId: CONFIG.SITE_ID },
      body: payload,
    });
    const tok = resp.token;
    // 接口失败时也返回空 token 字段，需综合判断
    if (!tok || resp.successResult === false || String(resp.result) === '0') {
      const errMsg = resp?.error?.errorMsg || resp.message || '未知错误';
      throw new Error('登录失败: ' + errMsg);
    }
    token = tok;
    await enterMain();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

/* ================= 扫码登录 ================= */
function setQrStatus(msg, isError = false) {
  const el = $('qr-status');
  el.textContent = msg;
  el.style.color = isError ? '#f87171' : '#8fa3bd';
}

function renderQr(text) {
  const el = $('qrcode');
  el.innerHTML = '';
  try {
    // 与 Python qrcode 库一致，使用 UTF-8 编码（默认的 charCode 截断会导致内容乱码）
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }
    const qr = qrcode(0, 'M'); // 0 = 自动适配版本（最高 40）
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;  // QR 规范要求的白色静区
    const cell = 2;     // 每模块像素，canvas 1:1 显示，避免缩放模糊
    const size = (count + margin * 2) * cell;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect((margin + col) * cell, (margin + row) * cell, cell, cell);
        }
      }
    }
    el.appendChild(canvas);
  } catch (err) {
    setQrStatus('二维码渲染失败: ' + err.message, true);
  }
}

function stopQrPolling() {
  qrSession++;
  if (qrTimer) {
    clearTimeout(qrTimer);
    qrTimer = null;
  }
}

/** 获取并展示二维码，开启轮询 */
async function startQrLogin() {
  stopQrPolling();
  const session = qrSession;
  qrDeadline = Date.now() + 300 * 1000;
  setQrStatus('正在获取二维码...');
  try {
    const resp = await api('/portal/main-api/v2/spc/getQrToken.do', {
      method: 'POST',
      headers: { siteId: CONFIG.SITE_ID },
    });
    if (session !== qrSession) return; // 已切换到其他场景，作废本次轮询
    const qrContent = resp?.data?.data;
    if (!qrContent) throw new Error('二维码接口返回格式异常');
    const qrToken = JSON.parse(qrContent).params.qrToken;
    if (!qrToken) throw new Error('二维码内容缺少 qrToken');
    renderQr(qrContent);
    setQrStatus('请使用保密观 APP 扫描二维码登录');
    pollQr(qrToken, session);
  } catch (err) {
    if (session === qrSession) {
      setQrStatus('获取二维码失败: ' + err.message, true);
    }
  }
}

async function pollQr(qrToken, session) {
  if (session !== qrSession) return;
  if (Date.now() >= qrDeadline) {
    stopQrPolling();
    setQrStatus('扫码登录超时（300 秒未确认），请刷新重试', true);
    return;
  }
  try {
    const resp = await api(
      `/portal/api/v2/spc/checkQrToken.do?qrToken=${encodeURIComponent(qrToken)}`,
      { method: 'POST' }
    );
    if (session !== qrSession) return;
    const status = parseInt(resp?.data?.data, 10);
    if (status === 1) {
      stopQrPolling();
      setQrStatus('扫码登录成功');
      token = qrToken;
      await enterMain();
      return;
    }
    if (status === -1) {
      setQrStatus('二维码已失效，正在刷新...');
      await sleep(500);
      startQrLogin();
      return;
    }
  } catch { /* 网络抖动，下个周期继续 */ }
  if (session !== qrSession) return;
  qrTimer = setTimeout(() => pollQr(qrToken, session), 3000);
}

/* ================= 课程学习 ================= */
/** 检查单节课程是否已完成（防御性判断，对应 _is_resource_finished） */
async function isResourceFinished(resourceDirectoryId, resourceLength) {
  try {
    const resp = await api(
      `/portal/main-api/v2/coursePacket/getResourceUserStatistic?coursePacketId=${CONFIG.COURSE_PACKET_ID}` +
      `&resourceDirectoryId=${resourceDirectoryId}&token=${token}`,
      { headers: buildHeaders(token) }
    );
    const data = resp && resp.data;
    if (!data) return false;

    for (const key of ['isFinish', 'finishStatus', 'finished', 'completeStatus']) {
      if ([true, 1, '1', 'true', 'True'].includes(data[key])) return true;
    }
    const study = data.studyLength ?? data.studyTime ?? 0;
    const total = data.resourceLength ?? data.timeLength ?? resourceLength;
    if (total && Number(study) >= Number(total)) return true;
  } catch { /* ignore */ }
  return false;
}

/** 自动学习课程（对应 study_course） */
async function studyCourse() {
  const dirResp = await api(
    `/portal/main-api/v2/coursePacket/getCourseDirectoryList?scale=1&coursePacketId=${CONFIG.COURSE_PACKET_ID}`,
    { headers: buildHeaders(token) }
  );
  if (!dirResp || !dirResp.data || !dirResp.data.length) {
    throw new Error('获取课程目录失败');
  }

  for (const section of dirResp.data) {
    log(`开始学习章节: ${section.name}`, 'warn');
    for (const sub of section.subDirectory || []) {
      log(`正在学习: ${sub.name}`, 'info');
      const resResp = await api(
        `/portal/main-api/v2/coursePacket/getCourseResourceList?coursePacketId=${CONFIG.COURSE_PACKET_ID}` +
        `&directoryId=${sub.SYS_UUID}&token=${token}`,
        { headers: buildHeaders(token) }
      );
      const list = resResp?.data?.listdata || [];

      for (const r of list) {
        const resourceLength = timeToSeconds(r.timeLength);
        const rdi = r.SYS_UUID;

        if (await isResourceFinished(rdi, resourceLength)) {
          log(`已学习，跳过: ${r.name}`, 'warn');
          continue;
        }

        // 与 Python 版一致：requests 会对参数值再编码一次，这里做双重编码
        const nameEnc = encodeURIComponent(encodeURIComponent(r.name));
        const p =
          `/portal/main-api/v2/studyTime/saveCoursePackage.do` +
          `?courseId=${CONFIG.COURSE_PACKET_ID}` +
          `&resourceId=${r.resourceID}` +
          `&resourceDirectoryId=${rdi}` +
          `&resourceLength=${resourceLength}` +
          `&studyLength=${resourceLength}` +
          `&studyTime=${resourceLength}` +
          `&startTime=${Date.now()}` +
          `&resourceName=${nameEnc}` +
          `&resourceType=1&resourceLibId=3&token=${token}`;

        try {
          const result = await api(p, { headers: buildHeaders(token) });
          if (result && result.status === 0) {
            log(`完成学习: ${r.name}`, 'success');
          } else {
            log(`学习失败: ${r.name}`, 'error');
          }
        } catch (err) {
          log(`学习失败: ${r.name} - ${err.message}`, 'error');
        }
      }
    }
  }
  return true;
}

/* ================= 考试 ================= */
/** 优先动态获取考试 ID，失败回退默认（对应 _resolve_exam_id） */
async function resolveExamId() {
  try {
    const resp = await api(
      `/portal/main-api/v2/coursePacket/getCourseRelateExam?coursePacketId=${CONFIG.COURSE_PACKET_ID}&token=${token}`,
      { headers: buildHeaders(token) }
    );
    const examId = resp?.data?.[0]?.examId;
    if (examId) {
      log(`已动态获取考试ID: ${examId}`, 'success');
      return examId;
    }
  } catch { /* ignore */ }
  log(`未能动态获取考试ID，使用默认考试ID: ${CONFIG.DEFAULT_EXAM_ID}`, 'warn');
  return CONFIG.DEFAULT_EXAM_ID;
}

/** 更新考试完成状态（对应 finish_exam） */
async function finishExam(score) {
  try {
    const resp = await api(
      `/portal/main-api/v2/studyTime/updateCoursePackageExamInfo.do` +
      `?courseId=${CONFIG.COURSE_PACKET_ID}&orgId=&isExam=1&isCertificate=0` +
      `&examResult=${score}&token=${token}`,
      { headers: buildHeaders(token) }
    );
    if (resp && resp.status === 0) {
      log('考试状态更新成功！', 'success');
    } else {
      log('考试状态更新失败！' + (resp?.message || ''), 'error');
    }
  } catch (err) {
    log('更新考试状态失败: ' + err.message, 'error');
  }
}

/** 自动完成考试（对应 complete_exam） */
async function completeExam() {
  const examId = await resolveExamId();
  const randomId = SparkMD5.hash('founder' + Math.floor(Math.random() * 500 + 1));

  const paper = await api(
    `/portal/main-api/v2/activity/exam/getExamContentData.do?examId=${examId}&randomId=${randomId}`,
    { headers: buildHeaders(token) }
  );
  if (!paper || !paper.data) throw new Error('获取试卷答案失败');
  log('获取试卷答案成功', 'success');

  const newRandomId = paper.data.randomId;
  if (!newRandomId) throw new Error('获取 randomId 失败');

  const answers = [];
  for (const typeItem of paper.data.typeList || []) {
    for (const q of typeItem.questionList || []) {
      answers.push({
        parentId: '0',
        qstId: q.id,
        resultFlag: 0,
        standardAnswer: q.answer,
        subCount: 0,
        tqId: q.tqId,
        userAnswer: q.answer,
        userScoreRate: '100%',
        viewTypeId: typeItem.type ?? 1,
      });
    }
  }

  const result = await api('/portal/main-api/v2/activity/exam/saveExamResultJc.do', {
    method: 'POST',
    headers: buildHeaders(token),
    body: {
      examId,
      examResult: JSON.stringify(answers),
      randomId: newRandomId,
      startDate: fmtDate(Date.now()),
    },
  });
  if (!result || result.status !== 0) {
    throw new Error('答案提交失败！' + (result?.message || ''));
  }
  log('答案提交成功！', 'success');

  log('正在查询考试成绩...', 'info');
  await sleep(2000);
  const examResult = await api(
    `/portal/main-api/v2/activity/exam/getExamResultMaxScore.do?examId=${examId}&token=${token}`,
    { headers: buildHeaders(token) }
  );

  if (examResult && examResult.status === 0 && examResult.data) {
    const d = examResult.data;
    log(`考试名称: ${d.exam_name ?? '未知'}`, 'info');
    log(`考试成绩: ${d.score ?? '未知'} 分`, 'success');
    log(`答题次数: ${d.answerCount ?? '未知'} 次`, 'info');
    log(`提交时间: ${fmtDate(Number(d.submit_date || 0))}`, 'info');
    await finishExam(d.score ?? 100);
  } else {
    log('考试成绩查询失败或暂未生成，使用默认分数更新考试状态', 'warn');
    await finishExam(100);
  }
  return true;
}

/* ================= 任务入口 ================= */
async function runTask(fn) {
  if (running) return;
  setBusy(true);
  try {
    await fn();
  } catch (err) {
    log(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

/* ================= 事件绑定 ================= */
window.addEventListener('DOMContentLoaded', () => {
  // 门禁：每次打开页面都必须输入
  $('gate-form').addEventListener('submit', submitGate);

  // 登录页 Tab 切换
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      const target = tab.dataset.tab;
      $('panel-qr').classList.toggle('hidden', target !== 'qr');
      $('panel-account').classList.toggle('hidden', target !== 'account');
      if (target === 'qr') {
        startQrLogin();
      } else {
        stopQrPolling();
      }
    });
  }

  $('qr-refresh').addEventListener('click', startQrLogin);
  $('account-form').addEventListener('submit', accountLogin);

  // 主界面
  $('btn-all').addEventListener('click', () => runTask(async () => {
    log('开始一键完成学习与考试...', 'info');
    await studyCourse();
    log('课程学习流程执行完毕', 'success');
    log('开始自动完成考试...', 'info');
    await completeExam();
    log('考试流程执行完毕', 'success');
  }));

  $('btn-study').addEventListener('click', () => runTask(async () => {
    log('开始自动学习课程...', 'info');
    await studyCourse();
    log('课程学习流程执行完毕', 'success');
  }));

  $('btn-exam').addEventListener('click', () => runTask(async () => {
    log('开始自动完成考试...', 'info');
    await completeExam();
    log('考试流程执行完毕', 'success');
  }));

  $('btn-logout').addEventListener('click', () => {
    token = '';
    nickname = '';
    stopQrPolling();
    showScreen('login');
    startQrLogin();
  });
});

// Grub Rider 관리자 페이지
// - 로그인: 게임과 같은 계정(아이디@도메인). 관리자(player_data.is_admin)만 통과
// - 데이터는 Supabase 관리자 전용 RPC(009_ops.sql)로만 읽고 씀 → 공개 키만 사용, 비밀 키 없음
// - 번역: 기본은 온라인 번역(js/mt.js, 빠르고 휴대폰에서도 됨). 선택하면 오픈소스 M2M100 을 브라우저 워커에서 실행 (js/admin-mt-worker.js)
// - 실시간: 문의·공지는 몇 초마다 서버를 다시 확인해 새로고침 없이 갱신
import { SUPABASE_URL, SUPABASE_ANON_KEY, ID_EMAIL_DOMAIN, ECON, DEFAULT_NOTICES, BIKES, BOXES, OUTFITS, HELMETS, PAINTS, BOOSTS, FLAG_SHOP_CODES } from './config.js';
import { THEMES, countryName } from './themes.js';
import { machineTranslate } from './mt.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? `<img class="flag" src="assets/flags/${cc}.svg" alt="">` : '');
const ctry = (cc) => (cc ? `${flag(cc)}${esc(countryName(cc) || cc)}` : '-');

const LANGS = { en: 'English', ko: '한국어', vi: 'Tiếng Việt', id: 'Bahasa Indonesia', th: 'ไทย', ms: 'Bahasa Melayu', tl: 'Filipino', km: 'ខ្មែរ', my: 'မြန်မာ' };
const ADMIN_LANG = 'ko';
const CATS = { payment: '결제/코인', bug: '오류/멈춤', account: '계정/로그인', suggestion: '건의', other: '기타' };
const STATUS = { open: '답변 대기', answered: '답변 완료', closed: '종료' };
const SEA = THEMES.map((t) => t.code);

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- 서버
const SKEY = 'gr.admin.session';
let session = null;
try { session = JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { session = null; }
const saveSession = (s) => { session = s; try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ } };

async function http(path, { method = 'GET', body, auth = true } = {}) {
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (auth && session) h.Authorization = `Bearer ${session.token}`;
  const res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    let msg = json?.message || json?.msg || json?.error_description || `HTTP ${res.status}`;
    // 테이블·함수가 아직 없을 때 (SQL 미실행) → 무엇을 실행해야 하는지 안내
    const miss = /Could not find the (table|function) '?public\.(\w+)/.exec(msg);
    if (miss) {
      const v010 = ['admin_list_runs', 'admin_update_run', 'admin_delete_run', 'admin_set_record', 'admin_update_player', 'admin_set_ban', 'admin_player_extra', 'admin_list_actions'];
      const file = { app_config: '008_app_config.sql', admin_set_config: '008_app_config.sql' }[miss[2]] || (v010.includes(miss[2]) ? '010_admin_power.sql' : '009_ops.sql');
      msg = `서버에 '${miss[2]}' ${miss[1] === 'table' ? '테이블' : '함수'}이 없어요. Supabase SQL Editor에서 supabase/migrations/${file} (또는 setup_all.sql) 를 실행한 뒤 새로고침하세요.`;
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json;
}
async function refresh() {
  const t = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh } });
  saveSession({ ...session, token: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
}
async function api(path, opts) {
  if (session && Date.now() > session.exp - 60000) await refresh().catch(() => {});
  try {
    return await http(path, opts);
  } catch (e) {
    if (e.status === 401 && session) { await refresh(); return http(path, opts); }
    throw e;
  }
}
const rpc = (name, body = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', body });
async function getConfig(key) {
  const rows = await api(`/rest/v1/app_config?key=eq.${key}&select=value`);
  return rows?.[0]?.value ?? null;
}

// ---------------------------------------------------------------- 번역 엔진 (M2M100, 브라우저 워커)
let worker = null, mtReady = false, mtSeq = 0;
const mtWait = new Map();
const mtFiles = {};
function mtStatus(html) { $('mtStatus').innerHTML = html; }
function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL('./admin-mt-worker.js', import.meta.url), { type: 'module' });
  mtStatus('번역 엔진: 모델 받는 중… (처음 한 번, 약 630MB)');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      mtFiles[m.file] = [m.loaded, m.total];
      const [a, b] = Object.values(mtFiles).reduce(([x, y], [l, t]) => [x + l, y + t], [0, 0]);
      mtStatus(`번역 엔진 받는 중 ${Math.round((a / b) * 100)}%<progress max="${b}" value="${a}"></progress>`);
    } else if (m.type === 'ready') {
      mtReady = true;
      mtStatus('번역 엔진: 준비됨 ✓ (M2M100, 오픈소스)');
    } else {
      const w = mtWait.get(m.id);
      if (!w) return;
      mtWait.delete(m.id);
      m.type === 'result' ? w.resolve(m.text) : w.reject(new Error(m.error));
    }
  };
  worker.onerror = (e) => mtStatus(`번역 엔진 오류: ${esc(e.message || '')}`);
}
// 번역 엔진 선택 (기기에 저장). 온라인 번역이 기본: 수 초 안에 끝나고 휴대폰에서도 됨
const ENGINE_KEY = 'gr.admin.mt';
let engine = 'online';
try { engine = localStorage.getItem(ENGINE_KEY) || 'online'; } catch (e) { /* ignore */ }
$('mtEngine').value = engine;
$('mtEngine').addEventListener('change', (e) => {
  engine = e.target.value;
  try { localStorage.setItem(ENGINE_KEY, engine); } catch (err) { /* ignore */ }
  mtStatus(engine === 'm2m' ? (mtReady ? '번역 엔진: M2M100 준비됨 ✓' : '번역 엔진: M2M100 (처음 쓸 때 약 630MB 받음)') : '번역: 온라인 번역 사용');
});
if (engine === 'm2m') mtStatus('번역 엔진: M2M100 (처음 쓸 때 약 630MB 받음)');
async function translate(text, src, tgt) {
  if (!text || !text.trim() || src === tgt) return text;
  if (engine !== 'm2m') {
    try { return await machineTranslate(text, src, tgt); } catch (e) { throw new Error(`온라인 번역 실패 (${e.message}). 인터넷 연결을 확인하거나 번역 엔진을 바꿔 보세요.`); }
  }
  return m2mTranslate(text, src, tgt);
}
function m2mTranslate(text, src, tgt) {
  ensureWorker();
  const id = ++mtSeq;
  return new Promise((resolve, reject) => {
    mtWait.set(id, { resolve, reject });
    worker.postMessage({ id, text, src: src || 'en', tgt });
  });
}
async function withBusy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

// ---------------------------------------------------------------- 로그인
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('lgId').value.trim().toLowerCase(), pw = $('lgPw').value;
  $('lgMsg').textContent = '';
  try {
    const t = await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw } });
    saveSession({ id, token: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
    await enter();
  } catch (err) {
    $('lgMsg').textContent = /invalid/i.test(err.message) ? '아이디 또는 비밀번호가 틀렸습니다' : err.message;
  }
});
$('logout').addEventListener('click', () => { saveSession(null); location.reload(); });

async function enter() {
  let ok = false;
  try { ok = await rpc('is_admin'); } catch (e) {
    $('lgMsg').textContent = /is_admin|does not exist|404/i.test(e.message) ? '서버에 009 마이그레이션(supabase/migrations/009_ops.sql)을 먼저 실행하세요' : e.message;
    return;
  }
  if (!ok) { $('lgMsg').textContent = '관리자 계정이 아닙니다'; saveSession(null); return; }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent = `${session.id} 로 로그인`;
  go('dash');
  refreshInqBadge();
}

// ---------------------------------------------------------------- 탭
let tab = 'dash';
$('nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
function go(t) {
  tab = t;
  if (t === 'notice') notices = null; // 공지 탭을 열 때마다 서버의 최신 공지를 다시 받음
  for (const b of $('nav').children) b.classList.toggle('on', b.dataset.tab === t);
  $('nav').querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  $('app').querySelector('.side').classList.remove('open');
  window.scrollTo(0, 0);
  ({ dash: renderDash, inq: renderInq, notice: renderNotices, players: renderPlayers, runs: renderRuns, rank: renderRank, errors: renderErrors, econ: renderEcon, actions: renderActions })[t]();
}
$('moreBtn').onclick = (e) => { e.stopPropagation(); $('app').querySelector('.side').classList.toggle('open'); };
document.addEventListener('click', (e) => { if (!e.target.closest('.side-foot')) $('app').querySelector('.side').classList.remove('open'); });

// ---------------------------------------------------------------- 휴대폰: 표 → 카드 (머리줄 글자를 각 칸의 이름표로)
function labelize(root) {
  if (!root) return;
  for (const t of root.querySelectorAll('table')) {
    if (t.dataset.lz === String(t.rows.length)) continue;
    const head = t.rows[0];
    if (!head || !head.querySelector('th')) continue;
    const labels = [...head.cells].map((c) => c.textContent.trim());
    t.classList.add('rt');
    for (const r of [...t.rows].slice(1)) [...r.cells].forEach((c, i) => { if (!c.dataset.label && labels[i]) c.dataset.label = labels[i]; });
    t.dataset.lz = String(t.rows.length);
  }
}
new MutationObserver(() => { labelize($('main')); labelize($('drawerBody')); }).observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------- 입력 대화상자 (prompt 대신. 휴대폰에선 아래에서 올라오는 시트)
// fields: [{ key, label, type: text|number|checkbox|select|textarea, value, min, max, required, options: [[v, label]], hint }]
function formDialog({ title, desc = '', fields = [], ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    const f = $('dlgForm');
    const input = (x) => {
      const v = esc(x.value ?? '');
      if (x.type === 'checkbox') return `<label class="cb"><input type="checkbox" name="${x.key}" ${x.value ? 'checked' : ''}>${esc(x.label)}</label>`;
      if (x.type === 'select') return `<label>${esc(x.label)}<select name="${x.key}">${x.options.map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(x.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      if (x.type === 'textarea') return `<label>${esc(x.label)}<textarea name="${x.key}" rows="3">${v}</textarea></label>`;
      return `<label>${esc(x.label)}<input name="${x.key}" type="${x.type || 'text'}" value="${v}" ${x.min != null ? `min="${x.min}"` : ''} ${x.max != null ? `max="${x.max}"` : ''} ${x.type === 'number' ? 'inputmode="numeric"' : ''} autocomplete="off">${x.hint ? `<small class="muted">${esc(x.hint)}</small>` : ''}</label>`;
    };
    f.innerHTML = `<h3>${esc(title)}</h3>${desc ? `<div class="small muted">${desc}</div>` : ''}${fields.map(input).join('')}
      <p class="msg" id="dlgMsg"></p>
      <div class="dlg-btns"><button type="button" class="btn" data-x>취소</button><button class="btn ${danger ? 'danger-fill' : 'primary'}">${esc(ok)}</button></div>`;
    $('dlg').classList.remove('hidden');
    const close = (v) => { $('dlg').classList.add('hidden'); f.onsubmit = null; resolve(v); };
    f.querySelector('[data-x]').onclick = () => close(null);
    $('dlg').onclick = (e) => { if (e.target === $('dlg')) close(null); };
    f.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const x of fields) {
        const el = f.elements[x.key];
        let v = x.type === 'checkbox' ? el.checked : el.value.trim();
        if (x.type === 'number') {
          if (v === '' && !x.required) { out[x.key] = null; continue; }
          v = Number(v);
          if (!Number.isFinite(v) || (x.min != null && v < x.min) || (x.max != null && v > x.max)) { $('dlgMsg').textContent = `${x.label}: ${x.min ?? ''} ~ ${x.max ?? ''} 사이 숫자`; return; }
          v = Math.round(v);
        }
        if (x.required && (v === '' || v == null)) { $('dlgMsg').textContent = `${x.label}을(를) 입력하세요`; el.focus(); return; }
        out[x.key] = v;
      }
      close(out);
    };
    setTimeout(() => f.querySelector('input:not([type=checkbox]),select,textarea')?.focus(), 50);
  });
}
const confirmDialog = (title, desc, ok = '확인', danger = false) => formDialog({ title, desc, ok, danger }).then((v) => v != null);
const main = () => $('main');
const fail = (e) => { main().innerHTML += `<div class="card msg">${esc(e.message)}</div>`; };

// ---------------------------------------------------------------- 대시보드
let dashDays = 14;
async function renderDash() {
  main().innerHTML = `<div class="head"><h2>대시보드</h2><div class="row">기간
    <select id="dDays">${[7, 14, 30, 90].map((d) => `<option ${d === dashDays ? 'selected' : ''} value="${d}">최근 ${d}일</option>`).join('')}</select>
    <button class="btn small" id="dRe">새로고침</button></div></div><div class="muted">불러오는 중…</div>`;
  $('dDays').onchange = (e) => { dashDays = Number(e.target.value); renderDash(); };
  $('dRe').onclick = renderDash;
  let s;
  try { s = await rpc('admin_stats', { p_days: dashDays }); } catch (e) { main().lastChild.remove(); return fail(e); }
  main().lastChild.remove();
  const k = (label, v, alert = false) => `<div class="kpi ${alert ? 'alert' : ''}"><small>${label}</small><b>${v}</b></div>`;
  main().insertAdjacentHTML('beforeend', `
    <div class="kpis">
      ${k('전체 플레이어', fmt(s.players_total))}${k(`신규 가입 (${dashDays}일)`, fmt(s.players_new))}
      ${k('활동 플레이어', fmt(s.active_users))}${k('판 수 (로그인)', fmt(s.runs_total - s.guest_runs))}${k('판 수 (게스트)', fmt(s.guest_runs))}
      ${k('평균 거리', `${fmt(s.avg_dist)} m`)}${k('판당 평균 코인', fmt(s.avg_coins))}${k('평균 플레이 시간', `${fmt(s.avg_duration)}초`)}
      ${k('결제 건수', fmt(s.purchases))}${k('결제 코인', fmt(s.revenue_coins))}
      ${k('답변 대기 문의', fmt(s.open_inquiries), s.open_inquiries > 0)}${k('클라이언트 오류', fmt(s.errors), s.errors > 0)}
    </div>
    <div class="card"><div class="head"><h3>일별 추이</h3><div class="legend"><span><i style="background:#00b14f"></i>활동 플레이어(DAU)</span><span><i style="background:#2a6fdb"></i>판 수</span><span><i style="background:#f59f00"></i>신규 가입</span><span><i style="background:#d62828"></i>오류</span></div></div>${chart(s.daily)}</div>
    <div class="card"><h3>국가별 플레이어</h3><div class="scroll"><table><tr><th>국가</th><th class="num">플레이어</th><th class="num">판 수 (${dashDays}일)</th></tr>
      ${s.countries.map((c) => `<tr><td>${ctry(c.country === '--' ? '' : c.country) || '미정'}</td><td class="num">${fmt(c.players)}</td><td class="num">${fmt(c.runs)}</td></tr>`).join('')}</table></div></div>`);
}
function chart(days) {
  const W = 900, H = 200, P = 28;
  if (!days.length) return '<p class="muted">데이터 없음</p>';
  const series = [['dau', '#00b14f'], ['runs', '#2a6fdb'], ['new_players', '#f59f00'], ['errors', '#d62828']];
  const max = Math.max(1, ...days.flatMap((d) => series.map(([k]) => d[k])));
  const x = (i) => P + (i * (W - P * 2)) / Math.max(1, days.length - 1);
  const y = (v) => H - P - (v / max) * (H - P * 2);
  const lines = series.map(([k, c]) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${days.map((d, i) => `${x(i)},${y(d[k])}`).join(' ')}"/>`).join('');
  const labels = days.map((d, i) => (days.length <= 16 || i % Math.ceil(days.length / 14) === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${String(d.day).slice(5)}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#e1e6e3"/><text x="4" y="${P}">${fmt(max)}</text>${lines}${labels}</svg>`;
}

// ---------------------------------------------------------------- 1:1 문의
let inqFilter = 'open', inqSel = null;
const trCache = new Map();
async function refreshInqBadge() {
  try {
    const list = await rpc('admin_list_inquiries', { p_status: 'open', p_limit: 200, p_offset: 0 });
    $('navInq').textContent = list.length;
    $('navInq').classList.toggle('hidden', !list.length);
  } catch (e) { /* ignore */ }
}
async function renderInq() {
  curInq = null;
  main().innerHTML = `<div class="head"><h2>1:1 문의 <span class="small muted" style="font-weight:400"><span class="live-dot"></span>실시간</span></h2><div class="row">
    ${['open', 'answered', 'closed', ''].map((s) => `<button class="btn small ${inqFilter === s ? 'primary' : ''}" data-f="${s}">${s ? STATUS[s] : '전체'}</button>`).join('')}
    <button class="btn small" id="iRe">새로고침</button></div></div>
    <div class="inq"><div id="inqList" class="inq-list"><p class="muted">불러오는 중…</p></div><div id="inqDetail" class="card"><p class="muted">왼쪽에서 문의를 고르세요.</p></div></div>`;
  for (const b of main().querySelectorAll('[data-f]')) b.onclick = () => { inqFilter = b.dataset.f; renderInq(); };
  $('iRe').onclick = renderInq;
  try { await paintInqList(); } catch (e) { $('inqList').innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  if (inqSel) showInq(inqSel);
  refreshInqBadge();
}
let inqListSig = '';
async function paintInqList() {
  const list = await rpc('admin_list_inquiries', { p_status: inqFilter || null, p_limit: 200, p_offset: 0 });
  const box = $('inqList');
  if (!box) return;
  const sg = JSON.stringify(list.map((i) => [i.id, i.status, i.updated_at, i.message_count]));
  if (sg === inqListSig && box.dataset.painted) return; // 바뀐 게 없으면 다시 그리지 않음 (스크롤 유지)
  inqListSig = sg;
  box.dataset.painted = '1';
  box.innerHTML = list.length ? list.map((i) => `<button class="inq-item ${i.id === inqSel ? 'on' : ''}" data-id="${i.id}">
      <div class="top"><b>#${i.id} ${esc(i.subject || CATS[i.category])}</b><span class="chip ${i.status}">${STATUS[i.status]}</span></div>
      <div class="small muted">${flag(i.country_code)}${esc(i.nickname)} · ${LANGS[i.lang] || i.lang} · ${CATS[i.category]} · ${when(i.updated_at)}</div>
      <div class="last">${i.last_sender === 'admin' ? '↪ ' : ''}${esc(i.last_message)}</div></button>`).join('')
    : '<p class="muted">문의가 없습니다.</p>';
  for (const b of box.querySelectorAll('[data-id]')) b.onclick = () => { inqSel = Number(b.dataset.id); for (const x of box.children) x.classList.toggle('on', x === b); showInq(inqSel); };
}
let curInq = null; // 지금 열어 둔 문의 (실시간 갱신용)
const sig = (q) => (q ? `${q.status}|${q.messages.length}|${q.messages[q.messages.length - 1]?.id}` : '');
function threadHtml(q) {
  const lang = q.lang || 'en', needTr = lang !== ADMIN_LANG;
  return q.messages.map((m) => {
    const tr = trCache.get(m.id);
    return `<div class="bubble ${m.sender}" data-mid="${m.id}">
      <small>${m.sender === 'user' ? '플레이어' : '관리자'} · ${when(m.created_at)}${m.sender === 'user' && needTr && !tr ? ` · <a href="#" data-tr="${m.id}">한국어로 번역</a>` : ''}</small>
      <p>${esc(m.body)}</p>
      ${m.sender === 'admin' && m.translated ? `<div class="tr"><b>${LANGS[m.translated_lang] || m.translated_lang}로 보낸 번역</b><p>${esc(m.translated)}</p></div>` : ''}
      ${tr ? `<div class="tr"><b>한국어 번역 (기계 번역)</b><p>${esc(tr)}</p></div>` : ''}</div>`;
  }).join('');
}
// 대화만 다시 그림 (답변 입력칸은 그대로 → 쓰던 글이 지워지지 않음)
function paintThread(q, stick = true) {
  const th = $('qThread');
  if (!th) return;
  const atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 40;
  th.innerHTML = threadHtml(q);
  if (stick || atBottom) th.scrollTop = 1e6;
  for (const a of th.querySelectorAll('[data-tr]')) a.onclick = async (e) => {
    e.preventDefault();
    a.textContent = '번역 중…';
    const m = q.messages.find((x) => String(x.id) === a.dataset.tr);
    try { await trMsg(q, m); paintThread(q, false); } catch (err) { a.textContent = `번역 실패: ${err.message}`; }
  };
}
async function trMsg(q, m) { trCache.set(m.id, await translate(m.body, m.lang || q.lang || 'auto', ADMIN_LANG)); }
// 온라인 번역이면 플레이어 메시지를 열자마자 한국어로 자동 번역
async function autoTranslate(q) {
  if (engine === 'm2m' || (q.lang || 'en') === ADMIN_LANG) return;
  const todo = q.messages.filter((m) => m.sender === 'user' && !trCache.has(m.id));
  if (!todo.length) return;
  await Promise.all(todo.map((m) => trMsg(q, m).catch(() => {})));
  if (curInq?.id === q.id) paintThread(curInq, false);
}
async function showInq(id) {
  const box = $('inqDetail');
  box.innerHTML = '<p class="muted">불러오는 중…</p>';
  let q;
  try { q = await rpc('admin_get_inquiry', { p_id: id }); } catch (e) { box.innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  if (!q) { box.innerHTML = '<p class="msg">없는 문의</p>'; return; }
  curInq = q;
  const lang = q.lang || 'en';
  const needTr = lang !== ADMIN_LANG;
  box.innerHTML = `<div class="head"><div><h3>#${q.id} ${esc(q.subject || CATS[q.category])}</h3>
      <div class="small muted">${flag(q.country_code)}${esc(q.nickname)} · ${LANGS[lang] || lang} · ${CATS[q.category]} · ${esc(q.app_build)} · ${esc(q.device)}</div></div>
      <div class="row"><span class="chip ${q.status}" id="qChip">${STATUS[q.status]}</span><button class="btn small" id="qPlayer">플레이어 보기</button>
      <button class="btn small" id="qClose" ${q.status === 'closed' ? 'hidden' : ''}>종료</button><button class="btn small" id="qOpen" ${q.status === 'closed' ? '' : 'hidden'}>다시 열기</button></div></div>
    <div class="small muted"><span class="live-dot"></span>실시간 — 새 메시지가 오면 바로 나타납니다</div>
    <div class="thread" id="qThread"></div>
    ${needTr ? '<div class="row"><button class="btn small" id="qTrAll">플레이어 메시지 모두 한국어로 번역</button><span class="small muted">기계 번역이라 뜻 위주로 참고하세요.</span></div>' : ''}
    <div class="reply">
      <label class="full">답변 (한국어)<textarea id="rBody" rows="4" placeholder="플레이어에게 보낼 답변을 한국어로 쓰세요"></textarea></label>
      ${needTr ? `<div class="full row"><button class="btn" id="rTr">↓ ${LANGS[lang]}로 번역</button><span class="small muted">번역문은 고칠 수 있습니다. 비워 두고 보내도 보낼 때 자동으로 번역합니다.</span></div>
      <label>${LANGS[lang]} 번역 (플레이어에게 보이는 글)<textarea id="rTrText" rows="4"></textarea></label>
      <label>역번역 확인 (번역문 → 한국어)<textarea id="rBack" rows="4" readonly placeholder="번역 후 자동으로 채워집니다"></textarea></label>` : ''}
      <div class="full row"><button class="btn primary" id="rSend">답변 보내기</button><button class="btn" id="rSendClose">답변 후 종료</button>
        <button class="btn" id="rGrant">💰 코인 지급</button></div>
    </div>`;
  paintThread(q);
  autoTranslate(q);
  $('qTrAll')?.addEventListener('click', (e) => withBusy(e.target, '번역 중…', async () => {
    for (const m of curInq.messages) if (m.sender === 'user' && !trCache.has(m.id)) await trMsg(curInq, m);
    paintThread(curInq, false);
  }).catch((err) => toast(err.message)));
  const doTr = async () => {
    const ko = $('rBody').value.trim();
    if (!ko) { toast('답변을 먼저 쓰세요'); return ''; }
    $('rTrText').value = await translate(ko, ADMIN_LANG, lang);
    $('rBack').value = await translate($('rTrText').value, lang, ADMIN_LANG);
    return $('rTrText').value;
  };
  $('rTr')?.addEventListener('click', (e) => withBusy(e.target, '번역 중…', doTr).catch((err) => toast(err.message)));
  $('rTrText')?.addEventListener('change', async () => {
    $('rBack').value = '역번역 중…';
    try { $('rBack').value = await translate($('rTrText').value, lang, ADMIN_LANG); } catch (err) { $('rBack').value = err.message; }
  });
  const send = async (close, btn) => {
    const body = $('rBody').value.trim();
    if (!body) return toast('답변을 쓰세요');
    await withBusy(btn, '보내는 중…', async () => {
      let translated = needTr ? $('rTrText').value.trim() : '';
      if (needTr && !translated) {
        // 번역을 안 했으면 보낼 때 자동 번역 (실패하면 한국어로만 보낼지 물음)
        try { translated = await translate(body, ADMIN_LANG, lang); } catch (err) {
          if (!confirm(`${err.message}\n\n번역 없이 한국어로만 보낼까요?`)) return;
          translated = '';
        }
      }
      await rpc('admin_reply_inquiry', { p_id: id, p_body: body, p_translated: translated, p_translated_lang: needTr && translated ? lang : '', p_close: close });
      toast('답변을 보냈습니다');
      renderInq();
    });
  };
  $('rSend').onclick = (e) => send(false, e.target).catch((err) => toast(err.message));
  $('rSendClose').onclick = (e) => send(true, e.target).catch((err) => toast(err.message));
  $('rGrant').onclick = () => grantCoins(q.user_id, `문의 #${q.id}`);
  $('qPlayer').onclick = () => openPlayer(q.user_id);
  const setStatus = async (st) => { await rpc('admin_set_inquiry_status', { p_id: id, p_status: st }); toast(STATUS[st]); renderInq(); };
  $('qClose').addEventListener('click', () => setStatus('closed').catch((e) => toast(e.message)));
  $('qOpen').addEventListener('click', () => setStatus('open').catch((e) => toast(e.message)));
}

// ---------------------------------------------------------------- 실시간 갱신 (문의 목록·열린 대화·배지)
// 탭이 보일 때만 몇 초마다 확인. 입력 중인 답변·번역문은 건드리지 않음
let lastOpen = -1;
async function pollInq() {
  if (document.hidden || !session || $('app').classList.contains('hidden')) return;
  try {
    const open = await rpc('admin_list_inquiries', { p_status: 'open', p_limit: 200, p_offset: 0 });
    $('navInq').textContent = open.length;
    $('navInq').classList.toggle('hidden', !open.length);
    if (lastOpen >= 0 && open.length > lastOpen) toast(`새 문의·메시지 ${open.length - lastOpen}건`);
    lastOpen = open.length;
    if (tab !== 'inq') return;
    await paintInqList();
    if (curInq && $('qThread')) {
      const q = await rpc('admin_get_inquiry', { p_id: curInq.id });
      if (q && sig(q) !== sig(curInq)) {
        const statusChanged = q.status !== curInq.status;
        curInq = q;
        paintThread(q, false);
        autoTranslate(q);
        if (statusChanged) {
          $('qChip').className = `chip ${q.status}`;
          $('qChip').textContent = STATUS[q.status];
          $('qClose').hidden = q.status === 'closed';
          $('qOpen').hidden = q.status !== 'closed';
        }
      }
    }
  } catch (e) { /* 다음 주기에 다시 */ }
}
setInterval(pollInq, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollInq(); });

// ---------------------------------------------------------------- 공지
let notices = null, editIdx = -1;
const TAGS = ['UPDATE', 'EVENT', 'NOTICE', 'MAINTENANCE'];
async function renderNotices() {
  main().innerHTML = '<div class="head"><h2>공지</h2></div><p class="muted">불러오는 중…</p>';
  if (!notices) {
    try {
      const v = await getConfig('notices');
      notices = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : null;
    } catch (e) { main().lastChild.remove(); return fail(e); }
  }
  const stored = Boolean(notices);
  const list = notices || DEFAULT_NOTICES;
  main().innerHTML = `<div class="head"><h2>공지</h2><div class="row"><button class="btn primary" id="nNew">+ 새 공지</button></div></div>
    ${stored ? '' : '<div class="card small">서버에 저장된 공지가 없어 게임에 들어 있는 기본 공지를 보여 줍니다. 새로 저장하면 서버 공지로 바뀝니다.</div>'}
    <div class="card">${list.length ? list.map((n, i) => `<div class="notice-row"><div><span class="chip">${esc(n.tag)}</span> <b>${esc(n.i18n?.ko?.title || n.title)}</b> <span class="small muted">${esc(n.date)} · id ${esc(n.id)} · 번역 ${Object.keys(n.i18n || {}).length}개 언어</span>
        <div class="small muted">${esc((n.i18n?.ko?.body || n.body).slice(0, 140))}</div></div>
        <div class="row"><button class="btn small" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn small" data-ed="${i}">수정</button><button class="btn small danger" data-del="${i}">삭제</button></div></div>`).join('') : '<p class="muted">공지가 없습니다.</p>'}</div>
    <div id="nEditor"></div>`;
  $('nNew').onclick = () => editNotice(-1);
  for (const b of main().querySelectorAll('[data-ed]')) b.onclick = () => editNotice(Number(b.dataset.ed));
  for (const b of main().querySelectorAll('[data-del]')) b.onclick = async () => {
    if (!confirm('이 공지를 삭제할까요?')) return;
    const arr = [...list];
    arr.splice(Number(b.dataset.del), 1);
    await saveNotices(arr);
  };
  for (const b of main().querySelectorAll('[data-up]')) b.onclick = async () => {
    const i = Number(b.dataset.up), arr = [...list];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    await saveNotices(arr);
  };
}
async function saveNotices(arr) {
  try {
    await rpc('admin_set_config', { p_key: 'notices', p_value: arr });
    notices = arr;
    toast('공지를 게시했습니다. 게임에는 1분 안에 자동으로 나타납니다.');
    renderNotices();
  } catch (e) { toast(e.message); }
}
function editNotice(idx) {
  editIdx = idx;
  const list = notices || DEFAULT_NOTICES;
  const n = idx >= 0 ? list[idx] : null;
  const today = new Date().toISOString().slice(0, 10);
  const ko = n?.i18n?.ko || (n ? { title: n.title, body: n.body } : { title: '', body: '' });
  $('nEditor').innerHTML = `<div class="card"><h3>${n ? '공지 수정' : '새 공지'}</h3>
    <div class="notice-edit">
      <label>날짜<input id="neDate" value="${esc(n?.date || today)}"></label>
      <label>종류<select id="neTag">${TAGS.map((t) => `<option ${n?.tag === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="full">제목 (한국어로 쓰고 아래에서 번역)<input id="neTitle" maxlength="80" value="${esc(ko.title)}"></label>
      <label class="full">내용<textarea id="neBody" rows="5" maxlength="2000">${esc(ko.body)}</textarea></label>
      <div class="full row"><button class="btn" id="neTr">🌏 모든 언어로 번역</button><span class="small muted">게임은 플레이어 언어의 번역을 보여 주고, 없으면 영어를 보여 줍니다. 번역은 아래에서 고칠 수 있습니다.</span></div>
      <div class="full tr-grid" id="neTrs">${Object.keys(LANGS).filter((l) => l !== 'ko').map((l) => {
        const v = l === 'en' ? { title: n?.title || '', body: n?.body || '' } : n?.i18n?.[l] || { title: '', body: '' };
        return `<div class="card"><b>${LANGS[l]}</b><input data-l="${l}" data-f="title" maxlength="80" value="${esc(v.title)}" placeholder="제목"><textarea data-l="${l}" data-f="body" rows="3" placeholder="내용">${esc(v.body)}</textarea></div>`;
      }).join('')}</div>
      <div class="full row"><button class="btn primary" id="neSave">저장해서 게시</button><button class="btn" id="neCancel">취소</button>
        <label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" id="neBump" ${n ? '' : 'checked'}> 새 공지로 알림 (NEWS 빨간 점)</label></div>
    </div></div>`;
  $('nEditor').scrollIntoView({ behavior: 'smooth' });
  $('neCancel').onclick = () => { $('nEditor').innerHTML = ''; };
  $('neTr').onclick = (e) => withBusy(e.target, '번역 중… (언어 8개)', async () => {
    const title = $('neTitle').value.trim(), body = $('neBody').value.trim();
    if (!title) return toast('제목을 먼저 쓰세요');
    const one = async (l) => {
      const ti = $('neTrs').querySelector(`input[data-l="${l}"]`), bo = $('neTrs').querySelector(`textarea[data-l="${l}"]`);
      ti.value = await translate(title, 'ko', l);
      bo.value = body ? await translate(body, 'ko', l) : '';
    };
    const targets = Object.keys(LANGS).filter((x) => x !== 'ko');
    try {
      if (engine === 'm2m') { for (const l of targets) await one(l); } else await Promise.all(targets.map(one));
      toast('번역 완료. 고칠 부분을 확인하고 저장하세요.');
    } catch (err) { toast(err.message); }
  });
  $('neSave').onclick = async () => {
    const title = $('neTitle').value.trim(), body = $('neBody').value.trim();
    if (!title) return toast('제목을 쓰세요');
    const get = (l, f) => $('neTrs').querySelector(`[data-l="${l}"][data-f="${f}"]`).value.trim();
    const i18n = { ko: { title, body } };
    for (const l of Object.keys(LANGS)) if (l !== 'ko' && l !== 'en' && get(l, 'title')) i18n[l] = { title: get(l, 'title'), body: get(l, 'body') };
    const en = { title: get('en', 'title') || title, body: get('en', 'body') || body };
    const keepId = n && !$('neBump').checked;
    const item = { id: keepId ? n.id : `${$('neDate').value}-${Date.now().toString(36)}`, date: $('neDate').value, tag: $('neTag').value, title: en.title, body: en.body, i18n };
    const arr = [...(notices || DEFAULT_NOTICES)];
    if (editIdx >= 0) arr.splice(editIdx, 1);
    arr.unshift(item); // 새로 저장한 공지가 맨 위 (게임의 '새 공지' 점 기준)
    await saveNotices(arr);
  };
}

// ---------------------------------------------------------------- 플레이어 검색·상세
async function renderPlayers() {
  main().innerHTML = `<div class="head"><h2>플레이어</h2></div>
    <form id="pForm" class="card row"><input id="pQ" class="grow" placeholder="아이디·닉네임 일부 또는 사용자 UUID (비우면 상위 플레이어)">
      <select id="pC"><option value="">모든 국가</option>${SEA.map((c) => `<option value="${c}">${esc(countryName(c))}</option>`).join('')}</select>
      <button class="btn primary">검색</button></form><div id="pRes" class="card"><p class="muted">검색하세요.</p></div>`;
  const run = async (e) => {
    e?.preventDefault();
    $('pRes').innerHTML = '<p class="muted">검색 중…</p>';
    try {
      const rows = await rpc('admin_search_players', { p_q: $('pQ').value.trim(), p_country: $('pC').value || null, p_limit: 100 });
      $('pRes').innerHTML = rows.length ? `<div class="scroll"><table><tr><th>닉네임</th><th>아이디</th><th>국가</th><th class="num">최고 점수</th><th class="num">최고 거리</th><th class="num">코인</th><th>가입</th><th>최근 로그인</th></tr>
        ${rows.map((r) => `<tr class="click" data-u="${r.user_id}"><td><b>${esc(r.nickname)}</b>${r.is_admin ? ' <span class="chip">관리자</span>' : ''}</td><td>${esc(r.login_id)}</td><td>${ctry(r.country_code)}</td>
          <td class="num">${fmt(r.score)}</td><td class="num">${fmt(r.dist)} m</td><td class="num">${fmt(r.coins)}</td><td>${when(r.created_at)}</td><td>${when(r.last_sign_in_at)}</td></tr>`).join('')}</table></div>`
        : '<p class="muted">결과 없음</p>';
      for (const tr of $('pRes').querySelectorAll('[data-u]')) tr.onclick = () => openPlayer(tr.dataset.u);
    } catch (err) { $('pRes').innerHTML = `<p class="msg">${esc(err.message)}</p>`; }
  };
  $('pForm').onsubmit = run;
  run();
}
const itemName = (list, id) => list.find((x) => x.id === id)?.name || id || '-';
async function openPlayer(uid) {
  $('drawer').classList.remove('hidden');
  const body = $('drawerBody');
  body.innerHTML = '<p class="muted">불러오는 중…</p>';
  let p, ex = null;
  try {
    [p, ex] = await Promise.all([rpc('admin_player_detail', { p_user: uid }), rpc('admin_player_extra', { p_user: uid }).catch(() => null)]);
  } catch (e) { body.innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  if (!p) { body.innerHTML = '<p class="msg">플레이어 없음</p>'; return; }
  const d = p.data || {};
  const own = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
  const has010 = Boolean(ex);
  body.innerHTML = `<div class="card"><div class="head"><div><h2>${esc(p.nickname)} ${p.is_admin ? '<span class="chip">관리자</span>' : ''}${ex?.banned ? ' <span class="chip ban">정지됨</span>' : ''}</h2>
      <div class="small muted">${esc(p.login_id)} · ${esc(p.user_id)}</div>${ex?.banned && ex.ban_reason ? `<div class="small msg">정지 사유: ${esc(ex.ban_reason)}</div>` : ''}</div></div>
    <div class="act-row">
      <button class="btn" id="dGrant">💰 코인 지급</button>
      <button class="btn" id="dEdit" ${has010 ? '' : 'disabled'}>✏️ 재산·프로필 수정</button>
      <button class="btn" id="dRec" ${has010 ? '' : 'disabled'}>🏆 랭킹 기록 수정</button>
      <button class="btn" id="dRuns" ${has010 ? '' : 'disabled'}>🎮 플레이 기록</button>
      ${p.is_admin ? '' : `<button class="btn ${ex?.banned ? '' : 'danger'}" id="dBan" ${has010 ? '' : 'disabled'}>${ex?.banned ? '✅ 정지 해제' : '🚫 정지'}</button>`}
    </div>
    ${has010 ? '' : '<p class="small msg">수정·정지 기능은 서버에 supabase/migrations/010_admin_power.sql 을 실행하면 켜집니다.</p>'}
    <dl class="kv">
      <dt>국가</dt><dd>${ctry(p.country_code)}</dd>
      <dt>순위</dt><dd>${p.rank_country ? `국가 #${fmt(p.rank_country)} · 전 세계 #${fmt(p.rank_global)}` : '기록 없음'}</dd>
      <dt>최고 점수 / 거리</dt><dd>${fmt(p.leaderboard?.score ?? d.best)} · ${fmt(p.leaderboard?.dist ?? d.bestDist)} m</dd>
      <dt>코인</dt><dd><b>${fmt(d.coins)}</b> <span class="muted small">(받을 코인 ${fmt(p.pending_coins)} · 누적 결제 ${fmt(p.purchased_coins)})</span></dd>
      <dt>장착</dt><dd>${esc(itemName(BIKES, d.bike))} · ${esc(itemName(BOXES, d.box))} · ${esc(itemName(HELMETS, d.helmet))} · ${esc(itemName(OUTFITS, d.outfit))}${d.flag ? ` · ${flag(d.flag)}` : ''}</dd>
      <dt>보유</dt><dd>바이크 ${own('ownedBikes')} · 배달통 ${own('ownedBoxes')} · 헤드기어 ${own('ownedHelmets')} · 의상 ${own('ownedOutfits')} · 국기 ${own('ownedFlags')} · 페인트 ${own('ownedPaints')}</dd>
      <dt>부스트</dt><dd>${Object.entries(d.boosts || {}).filter(([, v]) => v).map(([k, v]) => `${esc(BOOSTS.find((b) => b.id === k)?.name || k)} ×${v}`).join(' · ') || '-'}</dd>
      <dt>통계</dt><dd>판 ${fmt(d.stats?.runs ?? p.run_count)} · 총 거리 ${fmt(d.stats?.totalDist)} m · 니어미스 ${fmt(d.stats?.totalNear)} · 출석 연속 ${fmt(d.streak)}일</dd>
      <dt>가입 / 최근 로그인</dt><dd>${when(p.created_at)} / ${when(p.last_sign_in_at)} <span class="muted small">(저장 ${when(p.save_updated_at)})</span></dd>
      ${has010 && ex.data_rev > ex.seen_rev ? '<dt>동기화</dt><dd><span class="chip warn">관리자 수정 대기</span> <span class="small muted">게임이 아직 새 값을 받지 않았어요 (다음 저장·앱 복귀 때 적용)</span></dd>' : ''}
    </dl></div>
    <div class="card"><div class="head"><h3>최근 판 (${fmt(p.run_count)}판 중 30)</h3>${has010 ? '<button class="btn small" id="dRuns2">전체 보기·수정 →</button>' : ''}</div><div class="scroll"><table><tr><th>시간</th><th>맵</th><th class="num">거리</th><th class="num">점수</th><th class="num">코인</th><th class="num">시간</th><th>바이크</th></tr>
      ${p.runs.map((r) => `<tr><td>${when(r.created_at)}</td><td>${flag(r.theme)}${esc(r.theme)}</td><td class="num">${fmt(r.dist)} m</td><td class="num">${fmt(r.score)}</td><td class="num">${fmt(r.coins)}</td><td class="num">${fmt(r.duration_s)}초</td><td>${esc(itemName(BIKES, r.bike))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">기록 없음</td></tr>'}</table></div></div>
    <div class="grid2"><div class="card"><h3>결제</h3><table><tr><th>시간</th><th>상품</th><th class="num">코인</th><th>플랫폼</th></tr>${p.purchases.map((x) => `<tr><td>${when(x.created_at)}</td><td>${esc(x.product_id)}</td><td class="num">${fmt(x.coins)}</td><td>${esc(x.platform)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">없음</td></tr>'}</table></div>
      <div class="card"><h3>문의</h3><table><tr><th>번호</th><th>제목</th><th>상태</th></tr>${p.inquiries.map((x) => `<tr class="click" data-q="${x.id}"><td>#${x.id}</td><td>${esc(x.subject || CATS[x.category])}</td><td><span class="chip ${x.status}">${STATUS[x.status]}</span></td></tr>`).join('') || '<tr><td colspan="3" class="muted">없음</td></tr>'}</table></div></div>
    <div class="card"><h3>관리자 조치 기록</h3><table><tr><th>시간</th><th>작업</th><th>내용</th></tr>${p.admin_actions.map((x) => `<tr><td>${when(x.created_at)}</td><td>${esc(ACTION_NAMES[x.action] || x.action)}</td><td>${describeAction(x.action, x.detail)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">없음</td></tr>'}</table></div>
    <details class="card"><summary>저장 데이터 원본 (JSON)</summary><pre>${esc(JSON.stringify(d, null, 1))}</pre></details>`;
  $('dGrant').onclick = () => grantCoins(uid, '', () => openPlayer(uid));
  if (!has010) return wireInq(body);
  $('dEdit').onclick = () => editAssets(p, uid);
  $('dRec').onclick = () => editRecord(p, uid);
  const toRuns = () => { $('drawer').classList.add('hidden'); Object.assign(runF, RUN_DEFAULT, { user: uid, userName: p.nickname, days: 3650 }); go('runs'); };
  $('dRuns').onclick = toRuns;
  if ($('dRuns2')) $('dRuns2').onclick = toRuns;
  if ($('dBan')) $('dBan').onclick = () => setBan(uid, p.nickname, !ex.banned);
  wireInq(body);
}
function wireInq(body) {
  for (const tr of body.querySelectorAll('[data-q]')) tr.onclick = () => { $('drawer').classList.add('hidden'); inqSel = Number(tr.dataset.q); inqFilter = ''; go('inq'); };
}
$('drawerClose').onclick = () => $('drawer').classList.add('hidden');
$('drawer').addEventListener('click', (e) => { if (e.target === $('drawer')) $('drawer').classList.add('hidden'); });

// ---------------------------------------------------------------- 재산·프로필 수정 (010 admin_update_player)
const OWN_CATS = [
  ['ownedBikes', '바이크', BIKES.filter((x) => !x.special), 'bike', ['rookie']],
  ['ownedBoxes', '배달통', BOXES.filter((x) => !x.special), 'box', ['basic']],
  ['ownedHelmets', '헤드기어', HELMETS, 'helmet', ['basic']],
  ['ownedOutfits', '의상', OUTFITS, 'outfit', ['jacket']],
  ['ownedPaints', '페인트', PAINTS, null, []],
];
const COUNTRY_CODES = [...new Set([...SEA, ...FLAG_SHOP_CODES])];
function editAssets(p, uid) {
  const body = $('drawerBody');
  const d = p.data || {};
  const arr = (k) => (Array.isArray(d[k]) ? d[k] : []);
  const chk = (k, id, label, extra = '') => `<label class="chk"><input type="checkbox" data-own="${k}" value="${esc(id)}" ${arr(k).includes(id) ? 'checked' : ''}>${extra}<span>${esc(label)}</span></label>`;
  body.innerHTML = `<div class="card"><div class="head"><h2>✏️ ${esc(p.nickname)}</h2><button class="btn small" id="eaBack">← 상세로</button></div>
      <p class="small muted">저장하면 게임이 다음 저장이나 앱 복귀 때 이 값으로 바뀌고, 플레이어 화면에 '고객지원에서 계정을 업데이트했어요'가 표시됩니다. 모든 변경은 작업 기록에 남습니다.</p>
      <div class="form-grid">
        <label>보유 코인<input id="eaCoins" type="number" inputmode="numeric" min="0" max="100000000" value="${Math.floor(d.coins || 0)}"></label>
        <label>출석 연속(일)<input id="eaStreak" type="number" inputmode="numeric" min="0" value="${d.streak || 0}"></label>
        <label>닉네임<input id="eaNick" maxlength="16" value="${esc(p.nickname)}"></label>
        <label>랭킹 국가<select id="eaCC">${COUNTRY_CODES.map((c) => `<option value="${c}" ${c === p.country_code ? 'selected' : ''}>${c} · ${esc(countryName(c) || c)}</option>`).join('')}${p.country_code ? '' : '<option value="" selected>미정</option>'}</select></label>
      </div>
      <div class="row qbtn">${[1000, 10000, 100000].map((n) => `<button type="button" class="btn small" data-addc="${n}">+${fmt(n)}</button>`).join('')}<button type="button" class="btn small" data-addc="-1000">-1,000</button><button type="button" class="btn small" data-setc="0">0으로</button></div></div>
    <div class="card"><h3>부스트 보유 개수</h3><div class="form-grid">${BOOSTS.map((b) => `<label>${esc(b.name)}<input type="number" inputmode="numeric" min="0" max="9999" data-boost="${b.id}" value="${d.boosts?.[b.id] || 0}"></label>`).join('')}</div></div>
    <div class="card"><h3>장착</h3><div class="form-grid">${OWN_CATS.filter((c) => c[3]).map(([, label, list, eq]) => `<label>${label}<select data-eq="${eq}">${list.map((it) => `<option value="${it.id}" ${it.id === d[eq] ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</select></label>`).join('')}</div>
      <p class="small muted">장착한 아이템은 저장할 때 자동으로 보유 목록에 들어갑니다.</p></div>
    ${OWN_CATS.map(([k, label, list, , def]) => `<div class="card"><div class="head"><h3>${label} 보유 <small class="muted" data-cnt="${k}"></small></h3><div class="row"><button type="button" class="btn small" data-all="${k}">전체</button><button type="button" class="btn small" data-def="${k}" data-defv="${def.join(',')}">기본만</button></div></div>
      <div class="chk-grid">${list.map((it) => chk(k, it.id, it.name)).join('')}</div></div>`).join('')}
    <div class="card"><div class="head"><h3>국기 보유 <small class="muted" data-cnt="ownedFlags"></small></h3><div class="row"><button type="button" class="btn small" data-all="ownedFlags">전체</button><button type="button" class="btn small" data-def="ownedFlags" data-defv="">없음</button></div></div>
      <div class="chk-grid flags">${FLAG_SHOP_CODES.map((c) => chk('ownedFlags', c, c, flag(c))).join('')}</div></div>
    <div class="card sticky-save"><label>사유 (필수 · 작업 기록에 남음)<input id="eaWhy" placeholder="예: 결제 오류 보상, 버그 복구"></label>
      <div class="row"><button class="btn primary" id="eaSave">변경 사항 저장</button><span id="eaMsg" class="msg"></span></div></div>`;
  $('drawer').querySelector('.drawer-panel').scrollTop = 0;
  const count = () => { for (const el of body.querySelectorAll('[data-cnt]')) el.textContent = `${body.querySelectorAll(`[data-own="${el.dataset.cnt}"]:checked`).length}개`; };
  body.onchange = count;
  count();
  for (const b of body.querySelectorAll('[data-all]')) b.onclick = () => { for (const c of body.querySelectorAll(`[data-own="${b.dataset.all}"]`)) c.checked = true; count(); };
  for (const b of body.querySelectorAll('[data-def]')) b.onclick = () => { const keep = b.dataset.defv.split(',').filter(Boolean); for (const c of body.querySelectorAll(`[data-own="${b.dataset.def}"]`)) c.checked = keep.includes(c.value); count(); };
  for (const b of body.querySelectorAll('[data-addc]')) b.onclick = () => { $('eaCoins').value = Math.max(0, Number($('eaCoins').value || 0) + Number(b.dataset.addc)); };
  for (const b of body.querySelectorAll('[data-setc]')) b.onclick = () => { $('eaCoins').value = b.dataset.setc; };
  $('eaBack').onclick = () => openPlayer(uid);
  $('eaSave').onclick = async () => {
    $('eaMsg').textContent = '';
    const patch = {}, lines = [];
    const coins = Number($('eaCoins').value);
    if (!Number.isFinite(coins) || coins < 0 || coins > 1e8) { $('eaMsg').textContent = '코인은 0 ~ 100,000,000'; return; }
    if (Math.round(coins) !== Math.floor(d.coins || 0)) { patch.coins = Math.round(coins); lines.push(`코인 ${fmt(d.coins)} → ${fmt(patch.coins)}`); }
    const streak = Math.max(0, Math.round(Number($('eaStreak').value) || 0));
    if (streak !== (d.streak || 0)) { patch.streak = streak; lines.push(`출석 연속 ${fmt(d.streak)} → ${fmt(streak)}일`); }
    const boosts = { ...(d.boosts || {}) };
    for (const el of body.querySelectorAll('[data-boost]')) boosts[el.dataset.boost] = Math.max(0, Math.round(Number(el.value) || 0));
    if (BOOSTS.some((b) => (boosts[b.id] || 0) !== (d.boosts?.[b.id] || 0))) { patch.boosts = boosts; lines.push(`부스트 ${BOOSTS.filter((b) => (boosts[b.id] || 0) !== (d.boosts?.[b.id] || 0)).map((b) => `${b.name} ${d.boosts?.[b.id] || 0} → ${boosts[b.id] || 0}`).join(', ')}`); }
    const owned = {};
    for (const [k, label, list] of [...OWN_CATS, ['ownedFlags', '국기', FLAG_SHOP_CODES.map((id) => ({ id }))]]) {
      const listed = new Set(list.map((x) => x.id));
      owned[k] = [...arr(k).filter((id) => !listed.has(id)), ...[...body.querySelectorAll(`[data-own="${k}"]:checked`)].map((c) => c.value)];
      void label;
    }
    for (const el of body.querySelectorAll('[data-eq]')) {
      const eq = el.dataset.eq, k = OWN_CATS.find((c) => c[3] === eq)[0];
      if (!owned[k].includes(el.value)) owned[k].push(el.value);
      if (el.value !== d[eq]) { patch[eq] = el.value; lines.push(`장착 ${eq}: ${d[eq] || '-'} → ${el.value}`); }
    }
    for (const [k, label] of [...OWN_CATS.map((c) => [c[0], c[1]]), ['ownedFlags', '국기']]) {
      const a = [...arr(k)].sort().join(','), b = [...owned[k]].sort().join(',');
      if (a !== b) {
        patch[k] = owned[k];
        const add = owned[k].filter((x) => !arr(k).includes(x)), del = arr(k).filter((x) => !owned[k].includes(x));
        lines.push(`${label} ${add.length ? `+${add.length}` : ''}${del.length ? ` -${del.length}` : ''} (총 ${owned[k].length}개)`);
      }
    }
    const nick = $('eaNick').value.trim();
    if (nick !== p.nickname) {
      if (nick.length < 2 || nick.length > 16) { $('eaMsg').textContent = '닉네임은 2~16자'; return; }
      patch.nickname = nick; lines.push(`닉네임 ${p.nickname} → ${nick}`);
    }
    const cc = $('eaCC').value;
    if (cc && cc !== p.country_code) { patch.country_code = cc; lines.push(`국가 ${p.country_code || '-'} → ${cc}`); }
    if (!lines.length) { $('eaMsg').textContent = '바뀐 내용이 없어요'; return; }
    const why = $('eaWhy').value.trim();
    if (!why) { $('eaMsg').textContent = '사유를 입력하세요'; $('eaWhy').focus(); return; }
    if (!(await confirmDialog('이대로 저장할까요?', `<ul class="diff">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>사유: ${esc(why)}`, '저장'))) return;
    await withBusy($('eaSave'), '저장 중…', async () => {
      try {
        await rpc('admin_update_player', { p_user: uid, p_patch: patch, p_reason: why });
        toast('저장했습니다');
        openPlayer(uid);
      } catch (e) { $('eaMsg').textContent = e.message; }
    });
  };
}

// 랭킹 최고 기록 수정 / 랭킹에서 제외
async function editRecord(p, uid) {
  const lb = p.leaderboard;
  const v = await formDialog({
    title: '🏆 랭킹 기록 수정',
    desc: `${esc(p.nickname)} · 현재 ${lb ? `${fmt(lb.score)}점 · ${fmt(lb.dist)} m` : '랭킹 기록 없음'}<br>게임 안의 최고 기록(BEST)도 같은 값으로 바뀝니다.`,
    fields: [
      { key: 'score', label: '최고 점수', type: 'number', value: lb?.score ?? 0, min: 0, max: 10000000 },
      { key: 'dist', label: '최고 거리 (m)', type: 'number', value: lb?.dist ?? 0, min: 0, max: 1000000 },
      { key: 'remove', label: '랭킹에서 완전히 제외 (최고 기록 0으로)', type: 'checkbox', value: false },
      { key: 'why', label: '사유 (필수)', required: true },
    ],
    ok: '적용',
  });
  if (!v) return;
  if (!v.remove && !lb) { toast('랭킹 기록이 없는 플레이어는 제외만 할 수 있어요'); return; }
  try {
    await rpc('admin_set_record', { p_user: uid, p_score: v.score ?? 0, p_dist: v.dist ?? 0, p_remove: v.remove, p_reason: v.why });
    toast(v.remove ? '랭킹에서 제외했습니다' : '기록을 수정했습니다');
    openPlayer(uid);
  } catch (e) { toast(e.message); }
}

async function setBan(uid, name, banned) {
  const v = await formDialog({
    title: banned ? `🚫 ${name} 정지` : `✅ ${name} 정지 해제`,
    desc: banned ? '정지하면 랭킹에서 지워지고 이후 점수가 랭킹에 올라가지 않습니다. 게임 플레이 자체는 막지 않아요.' : '다시 랭킹에 기록될 수 있습니다.',
    fields: [{ key: 'why', label: '사유 (필수)', required: true }],
    ok: banned ? '정지' : '해제', danger: banned,
  });
  if (!v) return;
  try { await rpc('admin_set_ban', { p_user: uid, p_banned: banned, p_reason: v.why }); toast(banned ? '정지했습니다' : '해제했습니다'); openPlayer(uid); } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- 플레이 기록 (run_logs) 조회·수정·삭제
const RUN_DEFAULT = { q: '', user: null, userName: '', country: '', days: 30, min: 0, sort: 'recent', page: 0 };
const runF = { ...RUN_DEFAULT };
const RUN_PAGE = 50;
const suspicious = (r) => r.duration_s > 0 && (r.dist / r.duration_s > 95 || r.score / r.duration_s > 4000); // 최고속(약 320km/h ≈ 89 m/s)보다 빠름 등
async function renderRuns() {
  main().innerHTML = `<div class="head"><h2>플레이 기록</h2><button class="btn small" id="ruRe">새로고침</button></div>
    <form id="ruForm" class="card filters">
      ${runF.user ? `<span class="pill">👤 ${esc(runF.userName)} <button type="button" class="btn small" id="ruClr">✕</button></span>` : `<input id="ruQ" placeholder="닉네임·아이디·UUID" value="${esc(runF.q)}">`}
      <select id="ruC"><option value="">모든 국가</option>${SEA.map((c) => `<option value="${c}" ${c === runF.country ? 'selected' : ''}>${esc(countryName(c))}</option>`).join('')}</select>
      <select id="ruD">${[[1, '오늘·어제'], [7, '최근 7일'], [30, '최근 30일'], [90, '최근 90일'], [365, '최근 1년'], [3650, '전체']].map(([v, l]) => `<option value="${v}" ${v === runF.days ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input id="ruMin" type="number" inputmode="numeric" min="0" placeholder="최소 점수" value="${runF.min || ''}">
      <select id="ruS">${[['recent', '최근순'], ['score', '점수 높은 순'], ['dist', '거리 긴 순'], ['coins', '코인 많은 순']].map(([v, l]) => `<option value="${v}" ${v === runF.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn primary">조회</button>
    </form>
    <div id="ruRes" class="card"><p class="muted">불러오는 중…</p></div>`;
  $('ruRe').onclick = renderRuns;
  if ($('ruClr')) $('ruClr').onclick = () => { runF.user = null; runF.userName = ''; runF.page = 0; renderRuns(); };
  $('ruForm').onsubmit = (e) => {
    e.preventDefault();
    if ($('ruQ')) runF.q = $('ruQ').value.trim();
    Object.assign(runF, { country: $('ruC').value, days: Number($('ruD').value), min: Number($('ruMin').value) || 0, sort: $('ruS').value, page: 0 });
    renderRuns();
  };
  let res;
  try {
    res = await rpc('admin_list_runs', { p_user: runF.user, p_q: runF.user ? null : runF.q || null, p_country: runF.country || null, p_days: runF.days, p_min_score: runF.min || 0, p_sort: runF.sort, p_limit: RUN_PAGE, p_offset: runF.page * RUN_PAGE });
  } catch (e) { $('ruRes').innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  const rows = res.rows || [], total = Number(res.total) || 0;
  const from = runF.page * RUN_PAGE;
  $('ruRes').innerHTML = rows.length ? `<div class="small muted">${fmt(total)}판 · ⚠ 표시는 속도·점수가 비정상적으로 높은 판</div><div class="scroll"><table><tr><th>시간</th><th>플레이어</th><th>맵</th><th class="num">점수</th><th class="num">거리</th><th class="num">코인</th><th class="num">플레이</th><th>바이크</th><th>빌드</th><th>관리</th></tr>
    ${rows.map((r) => `<tr><td>${when(r.created_at)}</td><td>${r.user_id ? `<a href="#" data-u="${r.user_id}"><b>${esc(r.nickname || r.login_id)}</b></a>` : '<span class="muted">게스트</span>'} ${flag(r.country_code)}</td>
      <td>${flag(r.theme)}${esc(r.theme)}</td><td class="num"><b>${fmt(r.score)}</b>${suspicious(r) ? ' <span class="chip warn" title="비정상적으로 빠름">⚠</span>' : ''}</td><td class="num">${fmt(r.dist)} m</td><td class="num">${fmt(r.coins)}</td>
      <td class="num">${fmt(r.duration_s)}초</td><td>${esc(itemName(BIKES, r.bike))}</td><td class="small">${esc(r.app_build)}</td>
      <td class="acts"><button class="btn small" data-edit="${r.id}">수정</button> <button class="btn small danger" data-del="${r.id}">삭제</button></td></tr>`).join('')}</table></div>
    <div class="pager"><button class="btn small" id="ruPrev" ${runF.page ? '' : 'disabled'}>← 이전</button><span class="small muted">${fmt(from + 1)}–${fmt(from + rows.length)} / ${fmt(total)}</span><button class="btn small" id="ruNext" ${from + rows.length < total ? '' : 'disabled'}>다음 →</button></div>
    <p class="small muted">플레이 기록 수정·삭제는 통계용 기록만 바꿉니다. 랭킹 최고 기록은 플레이어 상세의 <b>랭킹 기록 수정</b>에서 바꾸세요.</p>`
    : '<p class="muted">기록 없음</p>';
  if (!rows.length) return;
  $('ruPrev').onclick = () => { runF.page--; renderRuns(); };
  $('ruNext').onclick = () => { runF.page++; renderRuns(); };
  for (const a of $('ruRes').querySelectorAll('[data-u]')) a.onclick = (e) => { e.preventDefault(); openPlayer(a.dataset.u); };
  for (const b of $('ruRes').querySelectorAll('[data-edit]')) b.onclick = async () => {
    const r = rows.find((x) => String(x.id) === b.dataset.edit);
    const v = await formDialog({
      title: `플레이 기록 #${r.id} 수정`, desc: `${esc(r.nickname || '게스트')} · ${when(r.created_at)}`,
      fields: [{ key: 'score', label: '점수', type: 'number', value: r.score, min: 0, max: 10000000, required: true },
        { key: 'dist', label: '거리 (m)', type: 'number', value: r.dist, min: 0, max: 1000000, required: true },
        { key: 'coins', label: '코인', type: 'number', value: r.coins, min: 0, max: 1000000, required: true },
        { key: 'why', label: '사유 (필수)', required: true }],
      ok: '저장',
    });
    if (!v) return;
    try { await rpc('admin_update_run', { p_id: r.id, p_score: v.score, p_dist: v.dist, p_coins: v.coins, p_reason: v.why }); toast('수정했습니다'); renderRuns(); } catch (e) { toast(e.message); }
  };
  for (const b of $('ruRes').querySelectorAll('[data-del]')) b.onclick = async () => {
    const r = rows.find((x) => String(x.id) === b.dataset.del);
    const v = await formDialog({ title: `플레이 기록 #${r.id} 삭제`, desc: `${esc(r.nickname || '게스트')} · ${fmt(r.score)}점 · ${fmt(r.dist)} m<br>삭제한 기록은 작업 기록에만 남습니다.`, fields: [{ key: 'why', label: '사유 (필수)', required: true }], ok: '삭제', danger: true });
    if (!v) return;
    try { await rpc('admin_delete_run', { p_id: r.id, p_reason: v.why }); toast('삭제했습니다'); renderRuns(); } catch (e) { toast(e.message); }
  };
}

// ---------------------------------------------------------------- 관리자 작업 기록 (admin_actions)
const ACTION_NAMES = { grant_coins: '💰 코인 지급 예약', edit_run: '🎮 플레이 기록 수정', delete_run: '🗑 플레이 기록 삭제', edit_record: '🏆 랭킹 기록 수정', remove_record: '🏆 랭킹에서 제외', edit_player: '✏️ 재산·프로필 수정', ban: '🚫 정지', unban: '✅ 정지 해제' };
const KEY_NAMES = { coins: '코인', streak: '출석', boosts: '부스트', ownedBikes: '바이크', ownedBoxes: '배달통', ownedHelmets: '헤드기어', ownedOutfits: '의상', ownedPaints: '페인트', ownedFlags: '국기', bike: '장착 바이크', box: '장착 배달통', helmet: '장착 헤드기어', outfit: '장착 의상', flag: '장착 국기', nickname: '닉네임', country_code: '국가' };
function describeAction(action, d = {}) {
  const why = d.reason ? ` <span class="muted">· 사유: ${esc(d.reason)}</span>` : '';
  const sv = (v) => (Array.isArray(v) ? `${v.length}개` : v && typeof v === 'object' ? Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${k}×${n}`).join(' ') || '없음' : typeof v === 'number' ? fmt(v) : esc(v ?? '-'));
  if (action === 'grant_coins') return `+${fmt(d.amount)} 코인${why}`;
  if (action === 'edit_run') return `#${d.run_id} 점수 ${fmt(d.before?.score)}→${fmt(d.after?.score)} · 거리 ${fmt(d.before?.dist)}→${fmt(d.after?.dist)} · 코인 ${fmt(d.before?.coins)}→${fmt(d.after?.coins)}${why}`;
  if (action === 'delete_run') return `#${d.run?.id} (${fmt(d.run?.score)}점 · ${fmt(d.run?.dist)} m)${why}`;
  if (action === 'edit_record') return `${fmt(d.before?.score)}점 → ${fmt(d.after?.score)}점 · ${fmt(d.before?.dist)} → ${fmt(d.after?.dist)} m${why}`;
  if (action === 'remove_record') return `이전 ${fmt(d.before?.score)}점${why}`;
  if (action === 'edit_player') return Object.keys(d.after || {}).map((k) => `${KEY_NAMES[k] || esc(k)} ${sv(d.before?.[k])} → ${sv(d.after[k])}`).join(' · ') + why;
  return d.reason ? `사유: ${esc(d.reason)}` : `<code>${esc(JSON.stringify(d))}</code>`;
}
let actPage = 0;
async function renderActions() {
  main().innerHTML = `<div class="head"><h2>관리자 작업 기록</h2><button class="btn small" id="acRe">새로고침</button></div><div id="acRes" class="card"><p class="muted">불러오는 중…</p></div>`;
  $('acRe').onclick = renderActions;
  let rows;
  try { rows = await rpc('admin_list_actions', { p_limit: 100, p_offset: actPage * 100 }); } catch (e) { $('acRes').innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  $('acRes').innerHTML = rows.length || actPage ? `<div class="scroll"><table><tr><th>시간</th><th>관리자</th><th>대상</th><th>작업</th><th>내용</th></tr>
    ${rows.map((r) => `<tr><td>${when(r.created_at)}</td><td>${esc(r.admin_login || '-')}</td><td>${r.target_id ? `<a href="#" data-u="${r.target_id}">${esc(r.target_name || r.target_id.slice(0, 8))}</a>` : '-'}</td>
      <td>${esc(ACTION_NAMES[r.action] || r.action)}</td><td class="wide">${describeAction(r.action, r.detail)}</td></tr>`).join('')}</table></div>
    <div class="pager"><button class="btn small" id="acPrev" ${actPage ? '' : 'disabled'}>← 최근</button><span class="small muted">${actPage + 1}쪽</span><button class="btn small" id="acNext" ${rows.length === 100 ? '' : 'disabled'}>이전 기록 →</button></div>`
    : '<p class="muted">아직 기록이 없어요.</p>';
  for (const a of $('acRes').querySelectorAll('[data-u]')) a.onclick = (e) => { e.preventDefault(); openPlayer(a.dataset.u); };
  if ($('acPrev')) { $('acPrev').onclick = () => { actPage--; renderActions(); }; $('acNext').onclick = () => { actPage++; renderActions(); }; }
}

async function grantCoins(uid, reason = '', after) {
  const v = await formDialog({
    title: '💰 코인 지급 예약', desc: '플레이어가 다음 접속(또는 앱 복귀) 때 자동으로 받습니다. 지금 보유 코인을 정확한 값으로 바꾸려면 <b>재산·프로필 수정</b>을 쓰세요.',
    fields: [{ key: 'amount', label: '코인 수', type: 'number', value: 1000, min: 1, max: 1000000, required: true },
      { key: 'why', label: '사유 (작업 기록에 남음)', value: reason || '보상', required: true }],
    ok: '지급',
  });
  if (!v) return;
  try {
    await rpc('admin_grant_coins', { p_user: uid, p_amount: v.amount, p_reason: v.why });
    toast(`${fmt(v.amount)} 코인 지급 예약 완료`);
    after?.();
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- 지역별 순위
let rankCountry = '';
async function renderRank() {
  main().innerHTML = `<div class="head"><h2>지역별 순위</h2><div class="row">
    <select id="rC"><option value="">🌏 전 세계</option>${SEA.map((c) => `<option value="${c}" ${c === rankCountry ? 'selected' : ''}>${esc(countryName(c))}</option>`).join('')}</select></div></div>
    <div class="row">${SEA.map((c) => `<button class="btn small ${c === rankCountry ? 'primary' : ''}" data-c="${c}">${flag(c)}${c}</button>`).join('')}<button class="btn small ${rankCountry ? '' : 'primary'}" data-c="">전 세계</button></div>
    <div id="rRes" class="card"><p class="muted">불러오는 중…</p></div>`;
  $('rC').onchange = (e) => { rankCountry = e.target.value; renderRank(); };
  for (const b of main().querySelectorAll('[data-c]')) b.onclick = () => { rankCountry = b.dataset.c; renderRank(); };
  try {
    const rows = await rpc('admin_rankings', { p_country: rankCountry || null, p_limit: 200, p_offset: 0 });
    $('rRes').innerHTML = rows.length ? `<div class="scroll"><table><tr><th class="num">순위</th><th>닉네임</th><th>국가</th><th class="num">점수</th><th class="num">거리</th><th>바이크</th><th>기록 시각</th></tr>
      ${rows.map((r) => `<tr class="click" data-u="${r.user_id}"><td class="num"><b>${r.rank}</b>${r.rank === 1 && rankCountry ? ' 🏍️' : ''}</td><td>${esc(r.nickname)}</td><td>${ctry(r.country_code)}</td><td class="num">${fmt(r.score)}</td><td class="num">${fmt(r.dist)} m</td><td>${esc(itemName(BIKES, r.bike))}</td><td>${when(r.best_at)}</td></tr>`).join('')}</table></div>
      <p class="small muted">관리자 계정은 순위에서 빠집니다. ${rankCountry ? '국가 1위는 국가대표 바이크를 받습니다.' : ''}</p>`
      : '<p class="muted">기록 없음</p>';
    for (const tr of $('rRes').querySelectorAll('[data-u]')) tr.onclick = () => openPlayer(tr.dataset.u);
  } catch (e) { $('rRes').innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}

// ---------------------------------------------------------------- 오류
let errDays = 7;
async function renderErrors() {
  main().innerHTML = `<div class="head"><h2>클라이언트 오류</h2><div class="row"><select id="eD">${[1, 7, 30, 90].map((d) => `<option ${d === errDays ? 'selected' : ''} value="${d}">최근 ${d}일</option>`).join('')}</select><button class="btn small" id="eRe">새로고침</button></div></div>
    <div id="eRes" class="card"><p class="muted">불러오는 중…</p></div>`;
  $('eD').onchange = (e) => { errDays = Number(e.target.value); renderErrors(); };
  $('eRe').onclick = renderErrors;
  try {
    const rows = await rpc('admin_list_errors', { p_days: errDays, p_limit: 300 });
    $('eRes').innerHTML = rows.length ? `<div class="scroll"><table><tr><th>메시지</th><th class="num">횟수</th><th class="num">플레이어</th><th>마지막</th><th>빌드</th></tr>
      ${rows.map((r) => `<tr><td><details><summary>${esc(r.message)}</summary><div class="small muted">${esc(r.source)} · ${esc(r.device)} · 처음 ${when(r.first_seen)}</div><pre>${esc(r.stack || '(stack 없음)')}</pre></details></td>
        <td class="num"><b>${fmt(r.count)}</b></td><td class="num">${fmt(r.users)}</td><td>${when(r.last_seen)}</td><td>${esc(r.app_build)}</td></tr>`).join('')}</table></div>`
      : '<p class="muted">오류가 없습니다 🎉</p>';
  } catch (e) { $('eRes').innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}

// ---------------------------------------------------------------- 가격·보상 (app_config 'economy')
async function renderEcon() {
  main().innerHTML = '<div class="head"><h2>가격·보상</h2></div><p class="muted">불러오는 중…</p>';
  let cur;
  try { cur = await getConfig('economy'); } catch (e) { main().lastChild.remove(); return fail(e); }
  main().lastChild.remove();
  const example = { ...ECON, freeCoins: 200, freeCoinsCooldownSec: 1200, prices: { box: { aquarium: 45000 }, boost: { shield: 400 } } };
  main().insertAdjacentHTML('beforeend', `<div class="card"><p class="small">여기에 넣은 항목만 게임 기본값(js/config.js)을 덮어씁니다. 저장하면 앱 업데이트 없이 다음 실행부터 적용됩니다.
      가격은 <code>prices: { box | helmet | outfit | bike | paint | boost: { 아이템id: 가격 } }</code> 형식입니다.</p>
    <textarea id="ecJson" rows="16" spellcheck="false" style="font-family:ui-monospace,monospace">${esc(JSON.stringify(cur || {}, null, 2))}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="ecSave">저장</button><button class="btn" id="ecEx">예시 넣기</button><span id="ecMsg" class="msg"></span></div></div>
    <details class="card"><summary>현재 게임 기본값</summary><pre>${esc(JSON.stringify(ECON, null, 2))}</pre></details>`);
  $('ecEx').onclick = () => { $('ecJson').value = JSON.stringify(example, null, 2); };
  $('ecSave').onclick = async () => {
    let v;
    try { v = JSON.parse($('ecJson').value || '{}'); } catch (e) { $('ecMsg').textContent = `JSON 형식 오류: ${e.message}`; return; }
    try { await rpc('admin_set_config', { p_key: 'economy', p_value: v }); $('ecMsg').textContent = ''; toast('저장했습니다'); } catch (e) { $('ecMsg').textContent = e.message; }
  };
}

// ---------------------------------------------------------------- 시작
if (session) enter();

'use strict';
/* ============================================================
   体重管家 · UI 2.0
   纯原生 JS，零依赖。所有数据来自本地服务 /api/state。
   结构：工具 → 主题 → 状态 → 渲染（总览/曲线/摄入/对照/代谢/
        腰围/油量/明细/算法）→ 表单与对话框 → 启动
   ============================================================ */

/* ---------------- 基础工具 ---------------- */

const $ = (id) => document.getElementById(id);
const S = { data: null, sortKey: 'date', sortDir: -1, range: 0, query: '' };
let navPick = null;      /* 由 initNav 赋值，内容高度变化后手动刷新高亮 */
let navLock = null;      /* 点导航后的平滑滚动期间锁住高亮，避免中途乱跳 */
const SIDE_KEY = 'wt-side';
const THEME_KEY = 'wt-theme';
const RING_C = 2 * Math.PI * 52;      /* 与 CSS stroke-dasharray 对齐 */

const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.2 8.2 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function n(v, d) { const x = Number(v); return Number.isFinite(x) ? x : (d === undefined ? 0 : d); }
function f1(v) { return isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—'; }
function f2(v) { return isNum(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—'; }
function f0(v) { return isNum(v) ? String(Math.round(v)) : '—'; }
function signed(v, fn) {
  if (v === null || v === undefined || v === '') return '—';
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  const fmt = fn || f1;
  return (x < 0 ? '−' : (x > 0 ? '+' : '')) + fmt(Math.abs(x));
}
function mmdd(s) { return String(s || '').slice(5); }
function pad(z) { return String(z).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayKey() { return ymd(new Date()); }
function addDays(key, k) {
  const p = String(key).split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + k);
  return ymd(d);
}
function diffDays(a, b) {
  const pa = String(a).split('-'), pb = String(b).split('-');
  return Math.round((new Date(+pa[0], +pa[1] - 1, +pa[2]) - new Date(+pb[0], +pb[1] - 1, +pb[2])) / 86400000);
}
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function chartColors() {
  return {
    weight: cssVar('--chart-weight', '#2563eb'),
    weightSoft: cssVar('--chart-weight-soft', '#9cbaf7'),
    grid: cssVar('--chart-grid', '#e9efeb'),
    axis: cssVar('--chart-axis', '#8b9a92'),
    goal: cssVar('--chart-goal', '#dd5454'),
    forecast: cssVar('--chart-forecast', '#7557e8'),
    sodium: cssVar('--chart-sodium', '#ef5b5b'),
    protein: cssVar('--chart-protein', '#e2782e'),
    bar: cssVar('--chart-bar', '#5b9bf8'),
    oil: cssVar('--chart-oil', '#f0b23e'),
    band: cssVar('--chart-band', '#d9f2e3'),
    divider: cssVar('--chart-divider', '#dfe7e2'),
    surface: cssVar('--surface', '#ffffff'),
    text: cssVar('--text', '#0b1a14'),
    muted: cssVar('--muted', '#61736a'),
    accent: cssVar('--accent', '#0f8a72'),
    good: cssVar('--good', '#15803d'),
    bad: cssVar('--bad', '#d92d2d')
  };
}
function debounce(fn, wait) {
  let t = 0;
  return function () {
    const args = arguments, self = this;
    window.clearTimeout(t);
    t = window.setTimeout(() => fn.apply(self, args), wait);
  };
}

/* 图表 svg 用了固定高度 + preserveAspectRatio=meet，内容可能上下/左右留白。
   悬停换算要用“内容实际占据的矩形”，否则会偏。 */
function svgContentBox(svg, vw, vh) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return { left: r.left, top: r.top, width: 0, height: 0 };
  const scale = Math.min(r.width / vw, r.height / vh);
  const width = vw * scale, height = vh * scale;
  return {
    left: r.left + (r.width - width) / 2,
    top: r.top + (r.height - height) / 2,
    width: width,
    height: height
  };
}

/* ---------------- 主题 ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('themeIcon');
  const label = $('themeLabel');
  if (icon) icon.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
  if (label) label.textContent = theme === 'dark' ? '浅色' : '深色';
  const btn = $('themeBtn');
  if (btn) btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function initTheme() {
  applyTheme(currentTheme());
  const btn = $('themeBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
      applyTheme(next);
      window.requestAnimationFrame(redrawCharts);
    });
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (e) => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* 忽略 */ }
    if (!saved) {
      applyTheme(e.matches ? 'dark' : 'light');
      window.requestAnimationFrame(redrawCharts);
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

/* ---------------- 侧栏收起 / 展开 ---------------- */

function sideCollapsed() {
  return document.documentElement.dataset.side === 'collapsed';
}

function applySide(collapsed, persist) {
  document.documentElement.dataset.side = collapsed ? 'collapsed' : 'expanded';
  const btn = $('sideToggle');
  const icon = $('sideToggleIcon');
  const label = btn ? btn.querySelector('.side-toggle-label') : null;
  if (btn) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开侧栏' : '收起侧栏';
  }
  if (icon) {
    icon.innerHTML = collapsed
      ? '<path d="m9 6 6 6-6 6"/>'
      : '<path d="m15 6-6 6 6 6"/>';
  }
  if (label) label.textContent = collapsed ? '展开侧栏' : '收起侧栏';
  if (persist) {
    try { localStorage.setItem(SIDE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) { /* 忽略 */ }
  }
}

function initSide() {
  applySide(sideCollapsed(), false);
  const btn = $('sideToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    applySide(!sideCollapsed(), true);
    if (navPick) window.requestAnimationFrame(navPick);
  });
}

/* ---------------- 提示 ---------------- */

function toast(text, type, ms) {
  const box = $('toasts');
  if (!box || !text) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' is-' + type : '');
  el.textContent = text;
  box.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 220);
  }, ms || 3000);
}

function setStatus(text, type) {
  const el = $('formMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (type ? ' is-' + type : '');
}

function notify(text, type) {
  setStatus(text, type === 'ok' ? 'ok' : type === 'bad' ? 'bad' : 'info');
  if (text) toast(text, type);
}

function online(ok, text) {
  const side = $('sideStatus');
  if (side) side.textContent = text;
  const dot = document.querySelector('.side-status .dot');
  if (dot) dot.classList.toggle('is-bad', !ok);
}

/* ---------------- 数据 ---------------- */

async function requestJSON(url, options) {
  const res = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('返回的不是 JSON'); }
  if (!res.ok && json && json.error) throw new Error(json.error);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return json;
}

async function load(opts) {
  const options = opts || {};
  if (options.silent !== true) setStatus('正在读取数据…', 'info');
  try {
    const json = await requestJSON('/api/state');
    S.data = json;
    render();
    online(true, '已连接 · 第 ' + S.data.stats.last.day + ' 天');
    setStatus('', '');
    if (options.toast) toast('数据已刷新', 'ok');
    else if (options.msg) setStatus(options.msg.text, options.msg.type);
  } catch (err) {
    online(false, '本地服务未连接');
    const msg = '载入失败：' + (err && err.message ? err.message : err);
    setStatus(msg, 'bad');
    if (!S.data) toast(msg, 'bad', 6000);
  }
}

/* ---------------- 渲染总入口 ---------------- */

function render() {
  const data = S.data;
  if (!data) return;
  const st = data.stats;

  if (!st || !st.n) {
    $('daybadge').textContent = '暂无数据';
    $('kLevelT').textContent = '先记录一次体重，趋势会自动算出来。';
    $('chartScroll').innerHTML = '<div class="chart-empty">还没有可信的体重记录。<br>在「记录体重」里填一条就能看到曲线。</div>';
    $('intakebox').innerHTML = '<div class="chart-empty">还没有饮食记录。</div>';
    $('methodBox').innerHTML = '<div class="empty">数据不足</div>';
    $('metaBox').innerHTML = '<div class="empty">数据不足</div>';
    $('waistBox').innerHTML = '';
    $('oilStats').innerHTML = '<div class="empty">数据不足</div>';
    $('oilVerdict').innerHTML = '';
    $('oilGrid').innerHTML = '';
    $('tb').innerHTML = '<tr><td colspan="8"><div class="empty">还没有记录</div></td></tr>';
    $('algoNote').innerHTML = '';
    $('foot').textContent = '';
    return;
  }

  const cfg = data.config;
  const last = st.last;

  online(true, '已连接 · 第 ' + last.day + ' 天');

  const age = cfg.formula && cfg.formula.age ? cfg.formula.age : 22;
  const hCm = cfg.formula && cfg.formula.hCm ? cfg.formula.hCm : 178;
  $('profileLine').innerHTML = age + ' 岁 · ' + hCm + ' cm · 基准 <b>' + f1(cfg.startWeight) +
    '</b> 斤 · 目标 <b>' + f1(cfg.goal) + '</b> 斤 · 目标日 ' + esc(cfg.holiday || '—');
  const holidayChip = $('holidayChip');
  if (holidayChip) holidayChip.textContent = cfg.holiday || '—';

  $('daybadge').textContent = '第 ' + last.day + ' 天 · ' + mmdd(last.date);
  $('daybadge').title = '最新记录：' + last.date;

  renderHero(st, cfg, last);
  renderKpis(st, cfg, last);
  drawWeightChart();
  drawIntakeChart();
  drawMethods(st);
  drawMeta(st, cfg);
  drawWaist(st);
  drawOil(st);
  drawTable();
  drawAlgo(st, cfg);
  renderFoot(st);
  updateGoalDialog(st, cfg);
  if (navPick) window.requestAnimationFrame(navPick);
}

/* ---------------- 总览 ---------------- */

function renderHero(st, cfg, last) {
  const level = st.holt ? st.holt.level : last.w;
  const done = cfg.startWeight - last.w;
  const total = cfg.startWeight - cfg.goal;
  const pct = total > 0 ? clamp(done / total * 100, 0, 100) : 0;
  const remain = Math.max(0, last.w - cfg.goal);

  $('kLevel').textContent = f1(level);

  const weekChange = st.avgPrev7 !== null && st.avgPrev7 !== undefined
    ? st.avg7 - st.avgPrev7 : null;
  let copy = '最新实测 <b>' + f1(last.w) + ' 斤</b>，去噪后的真实水平 <b>' + f1(level) + ' 斤</b>（差 ' +
    f2(Math.abs(level - last.w)) + ' 斤）。';
  if (weekChange !== null) {
    copy += '<br>近 7 个点平均 <b>' + f1(st.avg7) + ' 斤</b>，比前 7 个点' +
      (weekChange < 0 ? '低' : '高') + ' <b>' + f2(Math.abs(weekChange)) + ' 斤</b>；' +
      (Math.abs(weekChange) >= st.minDelta
        ? '已超过噪声门槛，是<b>真变化</b>。'
        : '还在噪声门槛 ' + f2(st.minDelta) + ' 斤以内，先不用改方案。');
  }
  $('kLevelT').innerHTML = copy;

  const chip = $('heroDelta');
  if (chip) {
    chip.textContent = done >= 0 ? '较起始 −' + f1(done) + ' 斤' : '较起始 +' + f1(-done) + ' 斤';
    chip.className = 'chip ' + (done >= 0 ? 'chip-good' : 'chip-bad');
  }

  $('heroStart').textContent = f1(cfg.startWeight) + ' 斤';
  $('heroMeasured').textContent = f1(last.w) + ' 斤';
  $('heroRemain').textContent = f1(remain) + ' 斤';

  const ring = $('ringFill');
  if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - pct / 100));
  $('goalPct').textContent = Math.round(pct) + '%';

  $('progtxt').innerHTML = '已减 <b>' + f1(Math.max(0, done)) + '</b> / 共 <b>' +
    f1(Math.max(0, total)) + '</b> 斤<br>还差 <b>' + f1(remain) + '</b> 斤';

  const backup = n(S.data.goalBackup, cfg.goal);
  const note = $('goalNote');
  if (note) {
    note.textContent = Math.abs(backup - cfg.goal) > 0.05
      ? '基准 ' + f1(backup) + ' 斤已留档，改目标不会丢' : '';
  }
}

function renderKpis(st, cfg, last) {
  const speed = st.holt ? st.holt.trend * 7 : null;
  const need = st.needPerWeek;

  $('kRate').textContent = signed(speed, f1);
  const tag = $('rateTag');
  if (tag) {
    if (speed === null) { tag.textContent = '数据不足'; tag.className = 'chip'; }
    else if (speed >= 0) { tag.textContent = '需要 ' + f1(need) + ' 斤/周'; tag.className = 'chip chip-bad'; }
    else if (Math.abs(speed) >= need) { tag.textContent = '正在达标'; tag.className = 'chip chip-good'; }
    else { tag.textContent = '略慢于计划'; tag.className = 'chip chip-warn'; }
  }
  $('kRateT').innerHTML = '计划需要 <b>' + f1(need) + ' 斤/周</b> · Holt 对转向最敏感，反映“现在”的速度。';

  const long = st.fit ? st.fit.slope * 7 : null;
  $('kLong').textContent = signed(long, f1);
  let longText = '拟合点不足';
  if (st.fit) {
    const ar = st.ciLoAR !== null && st.ciHiAR !== null
      ? '95% 区间 [' + f2(st.ciLoAR * 7) + ', ' + f2(st.ciHiAR * 7) + ']'
      : '';
    longText = ar + '<br>R² ' + f2(st.fit.r2) + ' · 拟合 ' + st.n + ' 个点';
    if (st.ciLoNaive !== null && st.ciHiNaive !== null) {
      longText += '<br><span class="is-muted">未修正自相关会是 [' + f2(st.ciLoNaive * 7) +
        ', ' + f2(st.ciHiNaive * 7) + ']，太窄、不诚实</span>';
    }
  }
  $('kLongT').innerHTML = longText;

  $('kHoli').textContent = f0(st.daysToHoliday);
  let holiText = '每周需 <b>' + f1(need) + ' 斤</b> → 每天 ' + f2(st.needPerDay) + ' 斤';
  if (st.goalEta && st.goalEta.decay) {
    holiText += '<br>含代谢适应外推约 ' + st.goalEta.decay.days + ' 天 → ' + st.goalEta.decay.date;
  }
  $('kHoliT').innerHTML = holiText;

  const done = cfg.startWeight - last.w;
  $('kTotal').textContent = signed(-done, f1);
  $('kTotalT').innerHTML = '从 <b>' + f1(cfg.startWeight) + '</b> → <b>' + f1(last.w) +
    '</b> 斤 · 用了 ' + last.day + ' 天';
}

function renderFoot(st) {
  const parts = [];
  parts.push('测量噪声 σ=<b>' + f2(st.noise) + ' 斤</b>');
  if (st.rho !== null) parts.push('残差自相关 ρ=<b>' + f2(st.rho) + '</b>（Durbin-Watson ' + f2(st.durbinWatson) + '）');
  parts.push('两个 7 日均值要差 <b>' + f2(st.minDelta) + ' 斤</b>以上才算真变化');
  let h = parts.join(' · ');
  if (st.minDeltaNaive && st.minDelta > st.minDeltaNaive) {
    h += '（<span class="is-muted">不修正自相关会误判成 ' + f2(st.minDeltaNaive) + ' 斤</span>）';
  }
  h += '<br>近 7 天摄入 <b>' + f0(st.avgKcal) + ' kcal</b> · 蛋白 <b>' + f0(st.avgProt) +
    ' g</b> ｜ 拟合用 <b>' + st.n + '</b> 个点（排除 ' + st.skippedCount +
    ' 个）｜ 区间已用 AR(1) 修正';
  $('foot').innerHTML = h;
}

/* ---------------- 体重曲线 ---------------- */

function hideTip(tip) {
  if (!tip) return;
  tip.hidden = true;
}

/* 与 server.js 的 holt() 完全一致的公式（含真实天数间隔），保证图上线和卡片数字不打架 */
function holtSeries(w, st) {
  const out = [];
  if (!w.length || !st.holt) return out;
  const a = st.holt.alpha, b = st.holt.beta;
  let L = w[0].w, T = 0;
  out.push(L);
  for (let i = 1; i < w.length; i++) {
    const gap = Math.max(1, w[i].day - w[i - 1].day);
    const Lp = L;
    L = a * w[i].w + (1 - a) * (L + T * gap);
    T = b * (L - Lp) / gap + (1 - b) * T;
    out.push(L);
  }
  return out;
}

function drawWeightChart() {
  const host = $('chartScroll');
  const box = $('chartbox');
  const tip = $('tip');
  const st = S.data && S.data.stats;
  if (!host || !st || !st.n || !st.holt) return;
  const cfg = S.data.config;
  const IN = S.data.intake || {};
  const excluded = new Set((st.excludes || []).map((e) => e.date));
  const w = (S.data.weight || []).filter((r) => r.day >= 1 && !excluded.has(r.date));

  hideTip(tip);
  if (!w.length) {
    host.innerHTML = '<div class="chart-empty">还没有可信的体重记录。</div>';
    return;
  }

  const C = chartColors();
  const VW = 1000, VH = 430, L = 60, R = 968, T = 26, B = 352;
  const PAD = 96, XR = R - PAD, PW = XR - L, PH = B - T;

  const vals = w.map((r) => r.w);
  let lo = Math.floor(Math.min.apply(null, vals) - 0.9);
  let hi = Math.ceil(Math.max.apply(null, vals) + 0.6);
  if (st.forecast) {
    hi = Math.max(hi, Math.ceil(st.forecast.hi + 0.5));
    lo = Math.min(lo, Math.floor(st.forecast.lo - 0.4));
  }
  const span = Math.max(1, hi - lo);

  const d0 = w[0].day, d1 = w[w.length - 1].day;
  const X = (d) => (d1 === d0 ? L + PW / 2 : L + ((d - d0) / (d1 - d0)) * PW);
  const XF = (k) => XR + (k / 7) * PAD;
  const Y = (v) => B - ((v - lo) / span) * PH;

  const lv = holtSeries(w, st);

  let s = '';
  s += '<defs><linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + C.weight + '" stop-opacity=".22"/>' +
    '<stop offset="1" stop-color="' + C.weight + '" stop-opacity="0"/>' +
    '</linearGradient></defs>';

  const step = span > 24 ? 2 : 1;
  for (let v = lo; v <= hi; v += step) {
    const y = Y(v);
    s += '<line x1="' + L + '" y1="' + y + '" x2="' + R + '" y2="' + y + '" stroke="' + C.grid + '" stroke-width="1"/>';
    s += '<text x="' + (L - 11) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11.5" fill="' + C.axis + '">' + v + '</text>';
  }

  if (cfg.goal >= lo && cfg.goal <= hi) {
    const gy = Y(cfg.goal);
    s += '<line x1="' + L + '" y1="' + gy + '" x2="' + R + '" y2="' + gy + '" stroke="' + C.goal +
      '" stroke-width="1.4" stroke-dasharray="6 5" opacity=".72"/>';
    s += '<text x="' + (R - 4) + '" y="' + (gy - 8) + '" text-anchor="end" font-size="11.5" font-weight="700" fill="' + C.goal + '">目标 ' + f1(cfg.goal) + '</text>';
  }

  s += '<line x1="' + XR + '" y1="' + T + '" x2="' + XR + '" y2="' + B + '" stroke="' + C.divider + '"/>';
  s += '<text x="' + (XR + 7) + '" y="' + (T + 12) + '" font-size="10" font-weight="700" fill="' + C.axis + '">预测 ▸</text>';

  let bandTop = '', bandBot = '';
  for (let i = 0; i < w.length; i++) bandTop += X(w[i].day) + ',' + Y(lv[i] + st.noise) + ' ';
  for (let j = w.length - 1; j >= 0; j--) bandBot += X(w[j].day) + ',' + Y(lv[j] - st.noise) + ' ';
  s += '<polygon points="' + bandTop + bandBot + '" fill="' + C.weight + '" opacity=".07"/>';

  let area = 'M' + X(w[0].day) + ',' + B;
  for (let k = 0; k < w.length; k++) area += ' L' + X(w[k].day) + ',' + Y(lv[k]);
  area += ' L' + X(w[w.length - 1].day) + ',' + B + ' Z';
  s += '<path d="' + area + '" fill="url(#wGrad)"/>';

  const rawPts = w.map((r, i) => X(r.day) + ',' + Y(r.w)).join(' ');
  const trendPts = w.map((r, i) => X(r.day) + ',' + Y(lv[i])).join(' ');
  s += '<polyline points="' + rawPts + '" fill="none" stroke="' + C.weightSoft + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<polyline points="' + trendPts + '" fill="none" stroke="' + C.weight + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>';

  w.forEach((r, i) => {
    const it = IN[r.date];
    if (it && it.na > 0) {
      const x = X(r.day), y = B - 7;
      s += '<polygon points="' + x + ',' + (y - 8) + ' ' + (x - 5) + ',' + y + ' ' + (x + 5) + ',' + y + '" fill="' + C.sodium + '" opacity=".8"/>';
    }
  });

  for (let m = 0; m < w.length; m++) {
    s += '<circle cx="' + X(w[m].day) + '" cy="' + Y(lv[m]) + '" r="2.6" fill="' + C.weight + '"/>';
  }

  const lastX = X(w[w.length - 1].day), lastY = Y(lv[lv.length - 1]);
  s += '<circle cx="' + lastX + '" cy="' + lastY + '" r="11" fill="' + C.weight + '" opacity=".12"/>';
  s += '<circle cx="' + lastX + '" cy="' + lastY + '" r="5" fill="' + C.weight + '" stroke="' + C.surface + '" stroke-width="2.5"/>';
  s += '<text x="' + (lastX - 10) + '" y="' + (lastY - 14) + '" text-anchor="end" font-size="14" font-weight="800" fill="' + C.weight + '">' + f1(lv[lv.length - 1]) + '</text>';

  if (st.forecast) {
    const fx = XF(7), fy = Y(st.forecast.val), yTop = Y(st.forecast.hi), yBot = Y(st.forecast.lo);
    s += '<polygon points="' + lastX + ',' + lastY + ' ' + fx + ',' + yTop + ' ' + fx + ',' + yBot + '" fill="' + C.forecast + '" opacity=".13"/>';
    s += '<line x1="' + lastX + '" y1="' + lastY + '" x2="' + fx + '" y2="' + fy + '" stroke="' + C.forecast + '" stroke-width="1.8" stroke-dasharray="5 4"/>';
    s += '<line x1="' + fx + '" y1="' + yTop + '" x2="' + fx + '" y2="' + yBot + '" stroke="' + C.forecast + '" stroke-width="1.1" opacity=".55"/>';
    s += '<circle cx="' + fx + '" cy="' + fy + '" r="4" fill="' + C.forecast + '"/>';
    s += '<text x="' + fx + '" y="' + (yBot + 17) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.forecast + '">' + f1(st.forecast.val) + '</text>';
    s += '<text x="' + fx + '" y="' + (yBot + 30) + '" text-anchor="middle" font-size="9.5" fill="' + C.forecast + '" opacity=".82">±' + f1((st.forecast.hi - st.forecast.lo) / 2) + '</text>';
  }

  const every = w.length > 40 ? 5 : w.length > 28 ? 4 : w.length > 18 ? 3 : 2;
  let lastTick = -99;
  w.forEach((r, i) => {
    if (i % every === 0) {
      s += '<text x="' + X(r.day) + '" y="' + (B + 24) + '" text-anchor="middle" font-size="10.5" fill="' + C.axis + '">' + mmdd(r.date) + '</text>';
      lastTick = i;
    }
  });
  if (w.length - 1 - lastTick >= 2) {
    const r = w[w.length - 1];
    s += '<text x="' + X(r.day) + '" y="' + (B + 24) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.axis + '">' + mmdd(r.date) + '</text>';
  }
  if (st.forecast) {
    s += '<text x="' + XF(7) + '" y="' + (B + 24) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.forecast + '">' + mmdd(st.forecast.date) + '</text>';
  }

  s += '<line id="wGuide" x1="0" y1="' + T + '" x2="0" y2="' + B + '" stroke="' + C.axis + '" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>';
  s += '<circle id="wDot" r="5.5" fill="' + C.surface + '" stroke="' + C.weight + '" stroke-width="3" opacity="0"/>';
  s += '<rect id="wHit" x="' + L + '" y="' + T + '" width="' + PW + '" height="' + PH + '" fill="transparent" style="cursor:crosshair"/>';

  host.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="体重趋势图">' + s + '</svg>';

  const svg = host.querySelector('svg');
  const hit = host.querySelector('#wHit');
  const guide = host.querySelector('#wGuide');
  const hdot = host.querySelector('#wDot');
  if (!svg || !hit || !guide || !hdot || !tip || !box) return;

  host.onscroll = () => hideTip(tip);

  hit.addEventListener('pointermove', (ev) => {
    const vp = svgContentBox(svg, VW, VH);
    if (!vp.width) return;
    const vx = ((ev.clientX - vp.left) / vp.width) * VW;
    let best = 0, bestD = Infinity;
    w.forEach((r, i) => {
      const d = Math.abs(X(r.day) - vx);
      if (d < bestD) { bestD = d; best = i; }
    });

    const r = w[best], it = IN[r.date];
    guide.setAttribute('x1', X(r.day));
    guide.setAttribute('x2', X(r.day));
    guide.setAttribute('opacity', '.7');
    hdot.setAttribute('cx', X(r.day));
    hdot.setAttribute('cy', Y(r.w));
    hdot.setAttribute('opacity', '1');

    const dev = r.w - lv[best];
    let html = '<b>' + esc(r.date) + '</b> · 第 ' + r.day + ' 天<br>' +
      '实测 ' + f1(r.w) + ' 斤 · 去噪 ' + f1(lv[best]) + ' 斤<br>' +
      '<span class="sm">偏离趋势 ' + signed(dev, (v) => f2(v)) + ' 斤（' +
      (Math.abs(dev) > st.noise ? '超过噪声，真变化' : '噪声范围内') + '）</span>';

    if (it) {
      html += '<br>热量 ' + f0(it.kcal) + ' kcal · 蛋白 ' + f0(it.prot) + ' g';
      if (it.oilKcal) {
        html += '<br><span class="sm">含残留油 +' + f0(it.oilKcal) + ' kcal（' + it.legs + ' 只 × ' + f1(it.oil_g) + ' g）</span>';
      }
      if (it.na > 0) html += '<br><span class="hi">▼ 高钠日</span>';
      if (it.est === 0) html += ' <span class="sm">含估算</span>';
    } else {
      html += '<br><span class="sm">无饮食记录</span>';
    }
    if (r.note) html += '<br><span class="sm">' + esc(r.note) + '</span>';

    tip.innerHTML = html;
    tip.hidden = false;

    const boxRect = box.getBoundingClientRect();
    let left = ev.clientX - boxRect.left + 16;
    let top = ev.clientY - boxRect.top - tip.offsetHeight - 14;
    if (left + tip.offsetWidth > boxRect.width - 8) left = ev.clientX - boxRect.left - tip.offsetWidth - 16;
    if (top < 6) top = ev.clientY - boxRect.top + 18;
    left = clamp(left, 6, Math.max(6, boxRect.width - tip.offsetWidth - 6));
    top = clamp(top, 6, Math.max(6, boxRect.height - tip.offsetHeight - 6));
    tip.style.transform = 'translate(' + left + 'px,' + top + 'px)';
  });

  const clear = () => {
    hideTip(tip);
    guide.setAttribute('opacity', '0');
    hdot.setAttribute('opacity', '0');
  };
  hit.addEventListener('pointerleave', clear);
  hit.addEventListener('pointerdown', clear);
}

/* ---------------- 摄入 ---------------- */

function drawIntakeChart() {
  const host = $('intakebox');
  const st = S.data && S.data.stats;
  if (!host || !st) return;
  const IN = S.data.intake || {};
  const cfg = S.data.config;
  const dates = Object.keys(IN).sort();
  const C = chartColors();

  host.innerHTML = '';
  if (!dates.length) {
    host.innerHTML = '<div class="chart-empty">还没有饮食记录。</div>';
    const sub = $('intakeSub');
    if (sub) sub.textContent = '没有摄入数据，热量与蛋白无法评估。';
    return;
  }

  const VW = 1000, VH = 232, L = 62, R = 968, T = 20, B = 168;
  const PW = R - L, PH = B - T;
  const KMAX = 2400, PMAX = 200;
  const nD = dates.length;
  const stepX = nD > 1 ? PW / (nD - 1) : PW;
  const X = (i) => (nD === 1 ? L + PW / 2 : L + i * stepX);
  const YK = (v) => B - clamp(v, 0, KMAX) / KMAX * PH;
  const YP = (v) => B - clamp(v, 0, PMAX) / PMAX * PH;

  let s = '';
  /* 目标热量带 */
  s += '<rect x="' + L + '" y="' + YK(cfg.kcalHi) + '" width="' + PW + '" height="' + Math.max(1, YK(cfg.kcalLo) - YK(cfg.kcalHi)) +
    '" fill="' + C.good + '" opacity=".08" rx="2"/>';
  s += '<line x1="' + L + '" y1="' + YK(cfg.kcalHi) + '" x2="' + R + '" y2="' + YK(cfg.kcalHi) + '" stroke="' + C.good + '" stroke-width=".8" opacity=".35"/>';
  s += '<line x1="' + L + '" y1="' + YK(cfg.kcalLo) + '" x2="' + R + '" y2="' + YK(cfg.kcalLo) + '" stroke="' + C.good + '" stroke-width=".8" opacity=".35"/>';

  [1000, 1500, 2000].forEach((v) => {
    const y = YK(v);
    s += '<line x1="' + L + '" y1="' + y + '" x2="' + R + '" y2="' + y + '" stroke="' + C.grid + '" stroke-width="1"/>';
    s += '<text x="' + (L - 10) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10.5" fill="' + C.axis + '">' + v + '</text>';
  });
  s += '<text x="' + (L - 10) + '" y="' + (T - 5) + '" text-anchor="end" font-size="9.5" font-weight="700" fill="' + C.axis + '">kcal</text>';
  s += '<text x="' + (R - 4) + '" y="' + (T - 5) + '" text-anchor="end" font-size="9.5" font-weight="700" fill="' + C.protein + '">蛋白 g</text>';

  const bw = Math.max(6, Math.min(20, stepX * 0.56));
  const pPts = [];

  dates.forEach((d, i) => {
    const it = IN[d];
    const total = n(it.netKcal, it.kcal);
    const oilPart = n(it.oilKcal);
    const base = total - oilPart;
    const x = X(i);
    const yTop = YK(total);
    const yBase = YK(base);
    const color = it.na > 0 ? C.sodium : C.bar;
    s += '<rect x="' + (x - bw / 2) + '" y="' + yTop + '" width="' + bw + '" height="' + Math.max(1, B - yTop) +
      '" rx="2" fill="' + color + '" opacity=".85"/>';
    if (oilPart > 0) {
      s += '<rect x="' + (x - bw / 2) + '" y="' + yBase + '" width="' + bw + '" height="' + Math.max(2, yTop - yBase) +
        '" rx="2" fill="' + C.oil + '" opacity=".9"/>';
    }
    pPts.push([x, YP(n(it.prot))]);
  });

  s += '<line x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '" stroke="' + C.divider + '"/>';

  const protLo = st.protTarget && st.protTarget.lo ? st.protTarget.lo : 90;
  s += '<line x1="' + L + '" y1="' + YP(protLo) + '" x2="' + R + '" y2="' + YP(protLo) + '" stroke="' + C.protein +
    '" stroke-width="1" stroke-dasharray="4 4" opacity=".55"/>';
  s += '<polyline points="' + pPts.map((p) => p[0] + ',' + p[1]).join(' ') + '" fill="none" stroke="' + C.protein +
    '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
  pPts.forEach((p) => {
    s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.8" fill="' + C.surface + '" stroke="' + C.protein + '" stroke-width="1.8"/>';
  });

  const labelEvery = nD > 30 ? Math.ceil(nD / 10) : nD > 16 ? 3 : 2;
  let lastLabelled = -99;
  dates.forEach((d, i) => {
    if (i % labelEvery === 0) {
      s += '<text x="' + X(i) + '" y="' + (B + 20) + '" text-anchor="middle" font-size="10" fill="' + C.axis + '">' + mmdd(d) + '</text>';
      lastLabelled = i;
    }
  });
  if (nD - 1 - lastLabelled >= 2) {
    s += '<text x="' + X(nD - 1) + '" y="' + (B + 20) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + C.axis + '">' + mmdd(dates[nD - 1]) + '</text>';
  }

  s += '<rect id="iHit" x="' + L + '" y="' + T + '" width="' + PW + '" height="' + PH + '" fill="transparent" style="cursor:crosshair"/>';

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  host.appendChild(tip);

  const scroll = document.createElement('div');
  scroll.className = 'chart-scroll';
  scroll.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="摄入与蛋白图">' + s + '</svg>';
  host.insertBefore(scroll, tip);

  const svg = scroll.querySelector('svg');
  const hit = host.querySelector('#iHit');
  if (!svg || !hit) return;

  hit.addEventListener('pointermove', (ev) => {
    const vp = svgContentBox(svg, VW, VH);
    if (!vp.width) return;
    const vx = ((ev.clientX - vp.left) / vp.width) * VW;
    const i = clamp(Math.round((vx - L) / (stepX || 1)), 0, nD - 1);
    const d = dates[i], it = IN[d];
    if (!it) return;

    let html = '<b>' + esc(d) + '</b><br>热量 ' + f0(it.netKcal || it.kcal) + ' kcal' +
      (it.oilKcal ? ' <span class="sm">（含残留油 ' + f0(it.oilKcal) + '）</span>' : '') +
      '<br>蛋白 ' + f0(it.prot) + ' g · 鸡腿 ' + (it.legs || 0) + ' 只';
    if (it.na > 0) html += '<br><span class="hi">▼ 高钠日（' + it.na + ' 条高钠）</span>';
    if (it.complete === 0) html += '<br><span class="sm">当天记录不完整</span>';
    if (it.items && it.items.length) {
      html += '<br><span class="sm">' + it.items.slice(-3).map((x) => esc(x.meal || '') + ' ' + esc(x.summary || '')).join('；') + '</span>';
    }

    tip.innerHTML = html;
    tip.hidden = false;
    const boxRect = host.getBoundingClientRect();
    let left = ev.clientX - boxRect.left + 16;
    let top = ev.clientY - boxRect.top - tip.offsetHeight - 12;
    if (left + tip.offsetWidth > boxRect.width - 8) left = ev.clientX - boxRect.left - tip.offsetWidth - 16;
    if (top < 6) top = ev.clientY - boxRect.top + 18;
    left = clamp(left, 6, Math.max(6, boxRect.width - tip.offsetWidth - 6));
    top = clamp(top, 6, Math.max(6, boxRect.height - tip.offsetHeight - 6));
    tip.style.transform = 'translate(' + left + 'px,' + top + 'px)';
  });
  hit.addEventListener('pointerleave', () => hideTip(tip));

  const sub = $('intakeSub');
  if (sub) {
    sub.innerHTML = '柱 = 净热量（<span style="color:' + C.sodium + '">红</span>=高钠日，' +
      '<span style="color:' + C.oil + '">黄顶</span>=残留油估算）· 绿带 = ' + cfg.kcalLo + '~' + cfg.kcalHi +
      ' 目标 · <span style="color:' + C.protein + '">橙线</span> = 蛋白（虚线 = 目标下限 ' + protLo + ' g）';
  }
}

/* ---------------- 趋势对照 ---------------- */

function drawMethods(st) {
  const host = $('methodBox');
  if (!host) return;
  const rows = st.methodRows || [];
  if (!rows.length) {
    host.innerHTML = '<div class="empty">数据不足，还没有可对比的算法结果。</div>';
    return;
  }

  const body = rows.map((r) => {
    const rate = n(r.rate);
    const cls = rate < 0 ? 'is-good' : (rate > 0 ? 'is-bad' : 'is-muted');
    const isBoot = /自举/.test(r.name);
    const ci = (r.lo === null || r.lo === undefined || r.hi === null || r.hi === undefined)
      ? '<span class="dash">—</span>'
      : f2(r.lo) + ' ~ ' + f2(r.hi);
    /* 自举这一行后端给的是 OLS 斜率 + 自举区间。当区间把主口径斜率排除在外时，
       说明它这次不可信（独立块太少），只保留“旁证”身份，不摆出一个假的速度。 */
    const bootOdd = isBoot && (rate < n(r.lo) || rate > n(r.hi));
    const rateCell = bootOdd
      ? '<span class="is-muted">旁证</span>'
      : signed(rate, (v) => f2(v)) + ' <span class="cell-unit">斤/周</span>';
    const ciCell = bootOdd
      ? ci + '<br><span class="tag warn">与主口径矛盾</span>'
      : ci;
    return '<tr>' +
      '<td class="cell-title">' + esc(r.name) + '</td>' +
      '<td class="rate ' + (bootOdd ? 'is-muted' : cls) + '">' + rateCell + '</td>' +
      '<td class="num">' + ciCell + '</td>' +
      '<td class="cell-note">' + esc(r.note || '') + '</td>' +
      '</tr>';
  }).join('');

  const vals = rows.map((r) => n(r.rate));
  const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  const spread = mx - mn;
  const tag = spread <= 0.8
    ? '<span class="tag ok">互相一致 → 结论可信</span>'
    : '<span class="tag warn">存在分歧 → 速度正在转折</span>';

  host.innerHTML =
    '<table class="mini-table"><thead><tr>' +
    '<th style="width:26%">算法</th><th style="width:18%">得出速度</th><th style="width:17%">95% 区间</th><th>说明</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>' +
    '<div class="table-footnote">' +
    '四种算法跨度 <b>' + f2(spread) + ' 斤/周</b>（' + f2(mn) + ' ~ ' + f2(mx) + '）　' + tag +
    '<br><b>区间只有最小二乘能给</b>：已按残差自相关修正（ρ=' + f2(st.rho) + '，标准误膨胀 ' + f2(st.inflation) + ' 倍），否则会假性收窄。' +
    '移动块自举' + (st.boot ? (st.boot.trustworthy ? '只作交叉验证' : '<b>不可用</b>（' + esc(st.boot.why || '') + '）') : '不可用') + '。' +
    '<br>长窗口（OLS）看全程，数值靠中间；Holt 反映最新转向。两者不同并不矛盾。' +
    '</div>';
}

/* ---------------- 代谢与目标 ---------------- */

function statRow(label, value, note, tag) {
  return '<div class="stat-row">' +
    '<div class="stat-label">' + label + (tag || '') +
    (note ? '<div class="stat-note">' + note + '</div>' : '') + '</div>' +
    '<div class="stat-value">' + value + '</div>' +
    '</div>';
}

function drawMeta(st, cfg) {
  const host = $('metaBox');
  if (!host) return;
  const cc = st.crossCheck;
  let h = '';

  /* TDEE */
  h += '<div class="meta-title">TDEE · 维持热量（三种口径）</div>';
  let rows = 0;
  if (st.tdee) {
    rows++;
    h += statRow('滚动窗口（主口径）', f0(st.tdee.value) + ' kcal',
      '最近 ' + st.tdee.window + ' 天：摄入 ' + f0(st.tdee.avgIntake) + '、掉 ' + f2(st.tdee.lossKg) +
      ' kg、缺口 ' + f0(st.tdee.deficit) + ' kcal/天' +
      (st.tdee.lo ? '；交叉口径 [' + f0(st.tdee.lo) + ', ' + f0(st.tdee.hi) + ']' : ''),
      st.tdee.reliable ? '<span class="tag ok">可信</span>' : '<span class="tag warn">暂不采用</span>');
  }
  if (st.ewmaTdee) {
    rows++;
    h += statRow('EWMA（最灵敏）', f0(st.ewmaTdee.value) + ' kcal',
      'α=' + st.ewmaTdee.alpha + '，代谢适应能自己跟上',
      st.ewmaTdee.reliable ? '<span class="tag ok">可信</span>' : '<span class="tag warn">暂不采用</span>');
  }
  if (st.tdeePair) {
    rows++;
    h += statRow('配对中位（交叉验证）', f0(st.tdeePair.value) + ' kcal',
      '[' + f0(st.tdeePair.lo) + ', ' + f0(st.tdeePair.hi) + ']，' + st.tdeePair.pairs + ' 个窗口；有十几天滞后',
      '<span class="tag">仅验证</span>');
  }
  if (!rows) h += '<div class="empty">数据不足</div>';
  if (st.tdee && !st.tdee.reliable) {
    h += '<div class="callout callout-warn"><b>为什么现在不给 TDEE 数值：</b>前 3 周掉的体重里糖原和水占大头，' +
      '拿它除以 7700 会把缺口算大，TDEE 因此被高估。满第 ' + st.tdee.requiredDay + ' 天（还差 ' +
      (st.tdee.requiredDay - st.last.day) + ' 天）后再看才准。</div>';
  }

  /* 活动系数 */
  if (cc && cc.activity && cc.activity.length) {
    h += '<div class="meta-title">活动系数 · 从数据反算（不套公式）</div>';
    cc.activity.forEach((a) => {
      h += statRow(esc(a.name) + '（TDEE ' + f0(a.tdee) + '）', f2(a.factor),
        a.plausible ? 'BMR ' + f0(cc.formula.bmr) + ' × ' + f2(a.factor) : '超出 1.0~2.2 的合理范围',
        a.plausible ? '' : '<span class="tag no">超出范围</span>');
    });
    h += '<div class="callout">公式默认假设 <b>' + cc.formula.actLo + '~' + cc.formula.actHi + '</b>，' +
      '你实测在 <b>' + Array.from(new Set(cc.activity.map((a) => f2(a.factor)))).join('~') + '</b>。说明公式那个区间偏高，' +
      '不该直接拿来算缺口。</div>';
  }

  /* 蛋白 */
  if (st.protTarget) {
    const p = st.protTarget;
    const judge = st.avgProt >= p.lo
      ? '<span class="tag ok">在目标区间</span>'
      : st.avgProt >= p.hardFloor
        ? '<span class="tag warn">过了底线，略低于目标</span>'
        : '<span class="tag no">低于硬底线</span>';
    h += '<div class="meta-title">蛋白目标 · 按去脂体重算</div>';
    h += statRow('体重 / 去脂体重', p.kg + ' kg / ' + p.lbmLo + '~' + p.lbmHi + ' kg');
    h += statRow('目标区间（' + cfg.protPerKgLo + '~' + cfg.protPerKgHi + ' g/kg 去脂）', p.lo + ' ~ ' + p.hi + ' g',
      '硬底线 ' + p.hardFloor + ' g');
    h += statRow('近 7 天均值', f0(st.avgProt) + ' g ' + judge,
      p.perKgBody + ' g/kg 总体重 · ' + p.perKgLbm + ' g/kg 去脂');
  }

  /* 预测 */
  if (st.goalEta) {
    const g = st.goalEta;
    h += '<div class="meta-title">到 ' + f1(cfg.goal) + ' 斤的预测 · 衰减 vs 线性</div>';
    if (g.linear && g.linear.days) {
      h += statRow('线性外推（一定乐观）', g.linear.days + ' 天 → ' + g.linear.date,
        '假设速度永远不变');
    }
    if (g.decay) {
      h += statRow('衰减模型（含代谢适应）', g.decay.days + ' 天 → ' + g.decay.date,
        'τ=' + g.tau + ' 天 · 每掉 1 kg，TDEE 降 ' + g.kAdapt + ' kcal');
    }
    if (st.forecastLong) {
      const f = st.forecastLong;
      h += statRow('到目标日（' + f.days + ' 天）· 衰减',
        f.byDecay.slow + ' / <b>' + f.byDecay.mid + '</b> / ' + f.byDecay.fast + ' 斤',
        '慢 / 中 / 快三档；中位是当前速度',
        f.hitGoal ? '<span class="tag ok">能到目标</span>' : '<span class="tag warn">到不了目标</span>');
      h += statRow('到目标日（' + f.days + ' 天）· 线性',
        f.byLinear.slow + ' / ' + f.byLinear.mid + ' / ' + f.byLinear.fast + ' 斤',
        '同样三档，但不含代谢变慢');
    }
    if (st.plateau && st.plateau.still) {
      h += '<div class="callout"><b>最近 ' + st.plateau.days + ' 个点落在 ' + f2(st.plateau.range) +
        ' 斤以内</b>，还没超过噪声门槛 ' + f2(st.minDelta) + ' 斤 —— 这叫平台期，不是失败。' +
        '先看腰围和趋势线，别急着砍热量。</div>';
    }
  }

  /* 目标历史 */
  const hist = S.data.goalHistory || [];
  if (hist.length) {
    h += '<div class="meta-title">目标改动历史</div>';
    hist.slice().reverse().forEach((x) => {
      h += statRow(esc(x.setAt || '') + ' · 旧目标 ' + f1(x.goal) + ' 斤', '<span class="is-muted">' + esc(x.note || '') + '</span>');
    });
  }

  host.innerHTML = h;
}

/* ---------------- 腰围 ---------------- */

function drawWaist(st) {
  const host = $('waistBox');
  if (!host) return;
  const q = st.waistStat;
  if (!q || !q.n) {
    host.innerHTML = '<div class="empty">还没有腰围记录。量一次就有基准了 —— 腰围比体重更能说明“掉的是不是脂肪”。</div>';
    return;
  }

  const last = q.list[q.list.length - 1];
  const prev = q.list.length >= 2 ? q.list[q.list.length - 2] : null;
  const d = prev ? last.cm - prev.cm : null;

  let h = '<div class="mini-grid">';
  h += '<div class="mini-stat"><span>最新 · ' + mmdd(last.date) + '</span><b>' + f1(last.cm) + '<small>cm</small></b>' +
    '<small>' + (d === null ? '首次记录' : '较上次 ' + signed(d, f1) + ' cm') + '</small></div>';
  h += '<div class="mini-stat"><span>累计</span><b>' + signed(q.delta, f1) + '<small>cm</small></b>' +
    '<small>' + q.days + ' 天 · 每周 ' + f1(q.perWeek) + ' cm</small></div>';
  h += '<div class="mini-stat"><span>每掉 1 斤体重</span><b>' +
    (q.cmPerJin === null ? '—' : f2(q.cmPerJin)) + '<small>cm</small></b>' +
    '<small>同期体重 ' + (q.weightDeltaJin === null ? '—' : '−' + f1(q.weightDeltaJin) + ' 斤') + '</small></div>';
  h += '</div>';

  if (q.cmPerJin !== null) {
    const tag = q.ratioPlausible === false
      ? '<span class="tag warn">' + esc(q.verdict) + '</span>'
      : (q.cmPerJin >= 0.4 ? '<span class="tag ok">' + esc(q.verdict) + '</span>'
        : '<span class="tag">' + esc(q.verdict) + '</span>');
    h += statRow('判定（男性经验 0.25~0.35 cm/斤）', tag);
  }
  if (q.ratioPlausible === false) {
    h += '<div class="callout callout-warn"><b>比值偏高（' + f2(q.cmPerJin) + ' cm/斤），说明不了问题 —— 大概率是两次量法不一致。</b><br>' +
      '常见原因：一次早上空腹一次饭后、量的位置差了几厘米、尺子松紧不同、穿没穿衣服。<br>' +
      '从今天起固定成「早上空腹 + 肚脐水平 + 不收腹」再量，下一次的比值才可信。</div>';
  }

  h += '<div class="callout"><b>为什么腰围比体重值钱：</b>体重里混着水，腰围不混。体重横盘但腰围在掉，' +
    '说明掉的是脂肪，而且优先掉内脏脂肪。卡秤的时候先看腰围。</div>';

  h += '<details class="disclosure"><summary>全部 ' + q.n + ' 次记录</summary><div class="disclosure-list">';
  q.list.slice().reverse().forEach((x) => {
    h += statRow(mmdd(x.date) + (x.note ? ' <span class="is-muted">' + esc(x.note) + '</span>' : ''), f1(x.cm) + ' cm');
  });
  h += '</div></details>';

  host.innerHTML = h;
}

/* ---------------- 油量误差 ---------------- */

function drawOil(st) {
  const hostStats = $('oilStats');
  const hostVerdict = $('oilVerdict');
  const hostGrid = $('oilGrid');
  const o = st.oil;
  const cc = st.crossCheck;

  if (!o) {
    if (hostStats) hostStats.innerHTML = '<div class="empty">还没有鸡腿记录，油量模型无法评估。</div>';
    if (hostVerdict) hostVerdict.innerHTML = '';
    if (hostGrid) hostGrid.innerHTML = '';
    return;
  }

  const reg = o.reg;
  if (hostStats) {
    hostStats.innerHTML =
      '<div class="oil-stat-col"><h3>记录口径</h3>' +
      statRow('平均每天吃', f2(o.legsPerDay) + ' 只鸡腿') +
      statRow('每只鸡腿记录到的热量', '中位 ' + f1(o.perLegMed) + ' kcal') +
      statRow('四分位区间', f1(o.perLegP25) + ' ~ ' + f1(o.perLegP75) + ' kcal') +
      statRow('口径离散度（稳健 σ）', '±' + f1(o.perLegSigma) + ' kcal', f2(o.perLegSigmaPct) + '%') +
      '</div>' +
      '<div class="oil-stat-col"><h3>反推实验</h3>' +
      statRow('配对窗口样本', (reg ? reg.n : 0) + ' 个') +
      statRow('反推出的“每只鸡腿的油”', reg ? f0(reg.slope) + ' kcal = ' + f1(reg.gPerLeg) + ' g' : '—') +
      statRow('95% 置信区间', reg ? '[' + f0(reg.lo) + ', ' + f0(reg.hi) + '] kcal' : '—') +
      statRow('R²（数据能解释多少）', reg ? f2(reg.r2) : '—', '越接近 0 越说明自变量没用') +
      '</div>';
  }

  if (hostVerdict) {
    let v = '<span class="callout-title">结论：用现有数据反推“油量”这条路走不通 —— 不是算法不行，是数据里没有这个信息。</span>';
    if (reg) {
      v += '做法：把每个配对窗口反推出来的 TDEE 对“该窗口平均每天几只鸡腿”做回归，' +
        '斜率本该正好等于每只鸡腿残留油的热量。实得 <b>' + f0(reg.slope) + ' kcal</b>（≈ ' + f1(reg.gPerLeg) + ' g 油），' +
        '但 95% 区间 <b>[' + f0(reg.lo) + ', ' + f0(reg.hi) + ']</b> 横跨 0，R² 只有 <b>' + f2(reg.r2) + '</b>。<br>' +
        '<b>最有用的是 MDE（最小可检出效应）= ' + f0(reg.mde) + ' kcal/只</b>：这个样本量能检出的最小差异。' +
        '换成油就是每只鸡腿要差 <b>' + f1(reg.mdeGPerLeg) + ' g</b>。可一只鸡腿（去皮后）总共才 175 kcal，' +
        '差 ' + f0(reg.mde) + ' kcal 等于差 ' + f0(reg.mde / 9) + ' g 油 —— 物理上不可能。<br>' +
        '<b>所以别再试这个实验了，做不出来。</b>' +
        (reg.targetMdeNote ? '<br><span class="is-muted">' + esc(reg.targetMdeNote) + '</span>' : '') + '<br>' +
        '根因：你的鸡腿数几乎不变（' + f2(reg.xRange[0]) + '~' + f2(reg.xRange[1]) + ' 只/天）。' +
        '自变量没有变化，回归就测不出它的影响 —— 这是统计上的硬限制，换任何算法都一样。';
    }
    hostVerdict.innerHTML = v;
  }

  if (!hostGrid) return;

  const cards = o.scenarios.slice();
  let inStd = cards.some((c) => Math.abs(c.g - o.currentG) < 1e-6);
  if (!inStd && o.currentG > 0) {
    cards.push({
      g: o.currentG,
      label: '当前记录值',
      kcalPerLeg: +(o.currentG * o.oilKcalPerG).toFixed(1),
      perDay: Math.round(o.legsPerDay * o.currentG * o.oilKcalPerG),
      nonStd: true
    });
  }

  let g = '';
  cards.forEach((sc) => {
    const selected = Math.abs(sc.g - o.currentG) < 1e-6;
    let extra = '';
    if (cc && cc.byOil) {
      const row = cc.byOil.find((x) => x.g === sc.g);
      if (row) {
        extra = '<br>净摄入 ' + f0(row.netIntake) + ' kcal → 反推 TDEE <b>' + f0(row.tdee) + '</b> kcal<br>' +
          (row.inFormulaRange ? '<span class="tag ok">落在公式区间内</span>' : '<span class="tag no">低于公式区间</span>');
      }
    }
    g += '<div class="oil-card' + (selected ? ' is-selected' : '') + '">' +
      '<div class="oil-card-top"><h3>' + esc(sc.label) + '</h3><span class="chip">' + f1(sc.g) + ' g/只</span></div>' +
      '<div class="oil-kcal">+' + f0(sc.perDay) + '<small>kcal/天</small></div>' +
      '<div class="oil-desc">每只鸡腿多算 ' + f1(sc.kcalPerLeg) + ' kcal（' + f1(sc.g) + ' g × ' + o.oilKcalPerG + ' kcal/g）' +
      extra + '</div>' +
      '<div class="oil-actions">' +
      '<button class="btn ' + (selected ? 'btn-ghost' : 'btn-primary') + '" type="button" data-oil="' + sc.g + '">' +
      (selected ? '✓ 已是当前' : '设为今天') + '</button>' +
      '<button class="btn btn-ghost" type="button" data-oilall="' + sc.g + '" title="把全部历史记录改成这个档位，通常不需要">全库统一</button>' +
      '</div>' +
      (sc.nonStd ? '<div class="oil-desc"><span class="tag warn">中间值</span> 你实际记录的档位，不在标准三档里</div>' : '') +
      '</div>';
  });

  if (o.oilMixedDays > 0) {
    g += '<div class="oil-note"><b>注意：你有 ' + o.oilMixedDays + ' 天是“混合档位”</b>' +
      '（同一天几顿的油不一样）。每顿按自己的档位算，全库平均是 <b>每只鸡腿 ' + f1(o.oilGPerLegEffective) + ' g</b> 油；' +
      '上面高亮的是<b>最新一顿</b>的档位。</div>';
  }
  hostGrid.innerHTML = g;

  hostGrid.querySelectorAll('button[data-oilall]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grams = parseFloat(btn.getAttribute('data-oilall'));
      if (!confirm('会把【全部历史】记录的油量档位改成 ' + grams + ' g/只（含已过去的日子）。\n\n' +
        '通常不需要 —— 油档位是【当天】的属性，过去的记录是已经发生的事实。\n' +
        '只会重算“估算口径”，体重和趋势速度不受影响。\n\n确定要改历史吗？（会先自动备份 intake.csv）')) return;
      setOil('*', grams);
    });
  });

  hostGrid.querySelectorAll('button[data-oil]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grams = parseFloat(btn.getAttribute('data-oil'));
      if (!confirm('把【今天】(' + todayKey() + ') 的鸡腿油量档位设成 ' + grams + ' g/只？\n\n' +
        '只改今天，历史不动。要改全部历史请用「全库统一」。')) return;
      setOil(todayKey(), grams);
    });
  });
}

async function setOil(dateStr, grams) {
  setStatus('设置中…', 'info');
  try {
    const j = await requestJSON('/api/oil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, grams: grams })
    });
    if (!j.ok) throw new Error(j.error || '设置失败');
    S.data = j.state;
    render();
    notify('油量档位已设为 ' + grams + ' g/只', 'ok');
  } catch (err) {
    notify('设置失败：' + (err.message || err), 'bad');
  }
}

/* ---------------- 明细表 ---------------- */

function filteredRows() {
  const st = S.data && S.data.stats;
  if (!st) return [];
  const IN = S.data.intake || {};
  const excluded = {};
  (st.excludes || []).forEach((e) => { excluded[e.date] = e.reason || '不可信'; });
  const w = S.data.weight || [];
  const lv = holtSeries(w.filter((r) => r.day >= 1), st);
  const lvMap = {};
  let k = 0;
  w.forEach((r) => {
    if (r.day >= 1) { lvMap[r.date] = lv[k]; k++; }
  });

  let rows = w.map((r, i) => ({
    r: r,
    it: IN[r.date],
    d: i > 0 ? r.w - w[i - 1].w : null,
    dev: lvMap[r.date] === undefined ? null : r.w - lvMap[r.date],
    exc: Object.prototype.hasOwnProperty.call(excluded, r.date),
    exr: excluded[r.date] || ''
  }));

  if (S.range > 0) {
    const newest = w.length ? w[w.length - 1].date : todayKey();
    const from = addDays(newest, -(S.range - 1));
    rows = rows.filter((o) => o.r.date >= from);
  }

  const q = S.query.trim().toLowerCase();
  if (q) {
    rows = rows.filter((o) =>
      (o.r.note || '').toLowerCase().indexOf(q) >= 0 ||
      o.r.date.indexOf(q) >= 0 ||
      String(o.r.w).indexOf(q) >= 0 ||
      ('第' + o.r.day + '天').indexOf(q) >= 0);
  }

  const key = S.sortKey;
  const dir = S.sortDir;
  const val = (o) => {
    if (key === 'date') return o.r.date;
    if (key === 'w') return o.r.w;
    if (key === 'd') return o.d === null ? -1e9 : o.d;
    if (key === 'kcal') return o.it ? n(o.it.kcal) : -1;
    if (key === 'prot') return o.it ? n(o.it.prot) : -1;
    if (key === 'na') return o.it ? n(o.it.na) : -1;
    return o.r.date;
  };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  return rows;
}

function drawTable() {
  const tb = $('tb');
  const st = S.data && S.data.stats;
  if (!tb || !st) return;

  const rows = filteredRows();
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="8"><div class="empty">没有符合条件的记录。<br>试试清空搜索，或把时间范围改成「全部」。</div></td></tr>';
  } else {
    tb.innerHTML = rows.map((o) => {
      const r = o.r, it = o.it;
      const diffCls = o.d === null ? 'dash' : (o.d < -0.05 ? 'is-good' : o.d > 0.05 ? 'is-bad' : 'dash');
      const diffTxt = o.d === null ? '—' : (Math.abs(o.d) < 0.05 ? '0.0' : signed(o.d, f1));
      const devTxt = o.dev === null ? '' :
        '<span class="cell-sub">偏离 ' + signed(o.dev, (v) => f2(v)) + '</span>';
      const kcal = it ? f0(it.kcal) + '<span class="cell-unit"> kcal</span>' : '<span class="dash">—</span>';
      const prot = it ? f0(it.prot) + '<span class="cell-unit"> g</span>' : '<span class="dash">—</span>';
      let na = '<span class="dash">—</span>';
      if (it && it.na > 0) na = '<span class="badge-na">高钠</span>';
      const exBadge = o.exc
        ? ' <span class="badge-ex" title="' + esc(o.exr) + '">排除</span>'
        : '';

      return '<tr class="' + (o.exc ? 'is-excluded' : '') + '" data-date="' + esc(r.date) + '">' +
        '<td><b>' + mmdd(r.date) + '</b>' + exBadge + '<span class="cell-sub">第 ' + r.day + ' 天</span></td>' +
        '<td class="num"><b>' + f1(r.w) + '</b>' + devTxt + '</td>' +
        '<td class="num ' + diffCls + '">' + diffTxt + '</td>' +
        '<td class="num">' + kcal + '</td>' +
        '<td class="num">' + prot + '</td>' +
        '<td>' + na + '</td>' +
        '<td><textarea class="note-input" rows="1" data-note="' + esc(r.date) + '" aria-label="' +
        esc(r.date) + ' 备注" placeholder="点这里写备注">' + esc(r.note || '') + '</textarea></td>' +
        '<td><div class="row-actions">' +
        '<button class="mini-btn ' + (o.exc ? '' : 'warn') + '" type="button" data-exc="' + esc(r.date) + '">' +
        (o.exc ? '恢复' : '排除') + '</button>' +
        '<button class="mini-btn danger" type="button" data-del="' + esc(r.date) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  const total = (S.data.weight || []).length;
  const exCount = (st.excludes || []).length;
  const sub = $('tblSub');
  if (sub) {
    sub.textContent = '显示 ' + rows.length + ' / 共 ' + total + ' 天' +
      (S.query ? ' · 已筛选' : '') + (exCount ? ' · 排除 ' + exCount + ' 天' : '');
  }

  /* 表头排序状态 */
  document.querySelectorAll('.data-table th[data-k]').forEach((th) => {
    const k = th.getAttribute('data-k');
    const active = k === S.sortKey;
    th.setAttribute('aria-sort', active ? (S.sortDir > 0 ? 'ascending' : 'descending') : 'none');
    const arrow = th.querySelector('.arrow');
    if (arrow) arrow.textContent = active ? (S.sortDir > 0 ? '↑' : '↓') : '↕';
  });

  if (navPick) window.requestAnimationFrame(navPick);
}

/* ---------------- 算法说明 ---------------- */

function algoItem(title, body, open) {
  return '<details class="algo-item"' + (open ? ' open' : '') + '>' +
    '<summary>' + title + '</summary>' +
    '<div class="algo-body">' + body + '</div>' +
    '</details>';
}

function drawAlgo(st, cfg) {
  const host = $('algoNote');
  if (!host) return;
  const o = st.oil;
  const cc = st.crossCheck;
  let items = [];

  items.push(algoItem('Holt 双参数指数平滑', 
    '只平滑“水平”，趋势项自己跟随转向，不像普通均线会滞后。参数靠网格搜索最小化一步预测误差（当前 α=' +
    f2(st.holt ? st.holt.alpha : NaN) + '，β=' + f2(st.holt ? st.holt.beta : NaN) + '）。' +
    '给出顶部的<b>去噪体重</b>和<b>近期速度</b>。断记几天时按真实天数间隔缩放，所以回家没带秤也不会把 7 天的变化摊到 1 天。', true));

  if (st.fit) {
    items.push(algoItem('最小二乘 + 95% 置信区间',
      '传统趋势线，给长期速度和不确定度。朴素区间 <b>' + f2(st.fit.slope * 7) + ' 斤/周（' +
      f2(st.fit.ciLo * 7) + ' ~ ' + f2(st.fit.ciHi * 7) + '）</b>，R²=' + f2(st.fit.r2) + '。' +
      '区间不跨 0 才叫“确实在掉”。', false));
  }

  items.push(algoItem('AR(1) 自相关修正（关键）',
    '你的体重序列天生强自相关（ρ=' + f2(st.rho) + '，Durbin-Watson ' + f2(st.durbinWatson) + '）。' +
    '朴素 OLS 假装每个点独立，名义 95% 区间<b class="hl">实际只有 78% 覆盖率</b> —— 也就是说它在撒谎。' +
    '修正后区间是 <b>' + f2(st.ciLoAR * 7) + ' ~ ' + f2(st.ciHiAR * 7) + '</b>，覆盖率 <b>92%</b>（蒙特卡洛 4000 次实测）。' +
    '标准误膨胀 ' + f2(st.inflation) + ' 倍，界面上一律用修正后的区间。', false));

  let bootBody = 'Theil-Sen 两两配对取中位数，抗异常值，当前 <b>' +
    (st.theilSen === null ? '—' : f2(st.theilSen * 7)) + ' 斤/周</b>，和最小二乘互相验证。<br>' +
    '移动块自举对自相关和异方差都不假设，但你的 n 太短：n=' + st.n;
  if (st.boot) {
    const mismatch = st.fit && (st.fit.slope < st.boot.lo || st.fit.slope > st.boot.hi);
    bootBody += '，块长 3 有 <b>' + st.boot.blocks + ' 个独立块</b>';
    if (mismatch) {
      bootBody += '；本次自举区间 <b>[' + f2(st.boot.lo * 7) + ', ' + f2(st.boot.hi * 7) + ']</b>' +
        ' 把主口径斜率排除在外，说明独立块还是太少 —— <b class="hl">不采用</b>，只保留代码当旁证。';
    } else {
      bootBody += '，可作为交叉验证，不单独下结论。';
    }
  } else {
    bootBody += '，样本不足，自举没有结果。';
  }
  items.push(algoItem('Theil-Sen 与移动块自举', bootBody, false));

  items.push(algoItem('测量噪声与“平台期”门槛',
    '从残差估出测量噪声 <b>σ=' + f2(st.noise) + ' 斤</b>。两个 7 日均值要差 <b>' + f2(st.minDelta) +
    ' 斤</b>（朴素口径只有 ' + f2(st.minDeltaNaive) + ' 斤，会误判）以上才算真变化，否则是水。' +
    '<b>这就是“别被单日吓到”的数学依据。</b>最近 ' + (st.plateau ? st.plateau.days : 0) + ' 个点跨度 ' +
    f2(st.plateau ? st.plateau.range : NaN) + ' 斤，' + (st.plateau && st.plateau.still ? '还在门槛内。' : '已超过门槛。'), false));

  if (o && o.reg) {
    items.push(algoItem('油量误差模型：为什么反推不出来',
      '把每个配对窗口反推的 TDEE 对“每日鸡腿数”回归，斜率本应等于每只鸡腿的油热量。实得 ' +
      f0(o.reg.slope) + ' kcal，95% CI [' + f0(o.reg.lo) + ', ' + f0(o.reg.hi) + ']，R²=' + f2(o.reg.r2) +
      ' → <b class="hl">区间横跨 0，数据无法反推油量</b>。原因是鸡腿数几乎不变，自变量没有变化。<br>' +
      '<b>MDE = ' + f0(o.reg.mde) + ' kcal/只</b> 是这个样本量能检出的最小差异，换成油是每只差 ' +
      f1(o.reg.mdeGPerLeg) + ' g；可一只鸡腿总共才 175 kcal —— <b class="hl">这个实验物理上做不出来，别试</b>。<br>' +
      '正确做法：把残留油固定成三档（0 / 5 / 10 g）记录。固定偏移在斜率里抵消，只抬升 TDEE 水平，趋势照样准。', false));
  }

  items.push(algoItem('TDEE 三种口径',
    '滚动窗口（主，最近 ' + cfg.tdeeWindow + ' 天，不被三周前的旧数据拖着）' +
    (st.tdee ? ' <b>' + f0(st.tdee.value) + ' kcal</b>' : '') + '；' +
    'EWMA（最灵敏，α=' + cfg.ewmaAlpha + '，代谢适应能自己跟上）' +
    (st.ewmaTdee ? ' ' + f0(st.ewmaTdee.value) + ' kcal' : '') + '；' +
    '配对中位（交叉验证，≥' + cfg.tdeeMinPairDays + ' 天窗口，有十几天滞后）' +
    (st.tdeePair ? ' ' + f0(st.tdeePair.value) + ' kcal' : '') + '。<br>' +
    '为什么前 21 天不给数值：前期掉的体重里糖原和水占大头，拿它除以 7700 会把缺口算大，' +
    '<b class="hl">TDEE 因此被高估</b>，所以满第 ' + cfg.minDaysForTdee + ' 天后再看。现在第 ' + st.last.day + ' 天，' +
    (st.tdee && st.tdee.reliable ? '已达标。' : '还差 ' + (cfg.minDaysForTdee - st.last.day) + ' 天。'), false));

  if (cc) {
    const factors = Array.from(new Set(cc.activity.filter((x) => x.plausible).map((x) => f2(x.factor)))).sort();
    items.push(algoItem('活动系数：从数据反算，不套公式',
      cc.activity.map((x) => esc(x.name) + ' ' + f2(x.factor) + (x.plausible ? '' : '（超范围）')).join('、') +
      '。公式默认 ' + cc.formula.actLo + '~' + cc.formula.actHi + '，' +
      '实测只有 ' + (factors.length ? factors.join('~') : '—') +
      ' → <b class="hl">公式那个区间定得偏高</b>，不该直接拿来算缺口。', false));
  }

  if (st.protTarget) {
    items.push(algoItem('蛋白目标：按去脂体重算',
      '总体重 ' + st.protTarget.kg + ' kg、体脂 20~25% ⇒ 去脂 ' + st.protTarget.lbmLo + '~' + st.protTarget.lbmHi +
      ' kg ⇒ ' + cfg.protPerKgLo + '~' + cfg.protPerKgHi + ' g/kg 去脂 = <b>' + st.protTarget.lo + '~' +
      st.protTarget.hi + ' g</b>，硬底线 ' + st.protTarget.hardFloor + ' g。你近 7 天 ' + f0(st.avgProt) + ' g。' +
      '<span class="hl">按总体重算会得出 127 g 这种偏高的数，那是分母用错了。</span>', false));
  }

  if (st.goalEta) {
    items.push(algoItem('预测：衰减模型，不是直线',
      '每掉 1 kg，TDEE 会降约 ' + st.goalEta.kAdapt + ' kcal，速度必然越来越慢，所以直线外推一定乐观。' +
      '衰减模型（τ=' + st.goalEta.tau + ' 天）给 ' + (st.goalEta.decay ? st.goalEta.decay.days : '—') +
      ' 天，线性给 ' + (st.goalEta.linear ? st.goalEta.linear.days : '—') + ' 天。' +
      (st.forecastLong ? '到目标日按当前速度中位落在 <b>' + st.forecastLong.byDecay.mid + ' 斤</b>' +
        (st.forecastLong.hitGoal ? '（能到目标）' : '<b class="hl">（到不了目标）</b>') + '。' : ''), false));
  }

  items.push(algoItem('数据可信度与备份',
    '当前排除 <b>' + st.skippedCount + ' 个点</b>（第 0 天晚裸重 + 排除清单里的日子）。明细表每行右侧可手动“排除/恢复”。' +
    '每次写 CSV 之前都会把旧内容存进 <b>data\\_备份</b>（按天去重，只留最近 14 份），误删可以从那里恢复。' +
    '所有数据只存在这台电脑上，服务只监听 127.0.0.1。', false));

  host.innerHTML = items.join('');
  const toggle = $('algoToggle');
  if (toggle) {
    const sync = () => {
      const all = host.querySelectorAll('.algo-item');
      const open = host.querySelectorAll('.algo-item[open]');
      toggle.textContent = open.length === all.length ? '全部收起' : '全部展开';
    };
    toggle.onclick = () => {
      const all = host.querySelectorAll('.algo-item');
      const openAll = host.querySelectorAll('.algo-item[open]').length !== all.length;
      all.forEach((d) => { d.open = openAll; });
      sync();
      if (navPick) window.requestAnimationFrame(navPick);
    };
    host.querySelectorAll('.algo-item').forEach((d) => d.addEventListener('toggle', sync));
    sync();
  }
}

/* ---------------- 图表重绘 ---------------- */

function redrawCharts() {
  if (!S.data || !S.data.stats) return;
  drawWeightChart();
  drawIntakeChart();
}

/* ---------------- 表单：记录体重 ---------------- */

async function saveWeight(ev) {
  if (ev) ev.preventDefault();
  const dt = $('dt').value;
  const wv = $('w').value;
  const note = $('note').value;
  const btn = $('saveBtn');

  if (!dt) { notify('请选日期', 'bad'); $('dt').focus(); return; }
  if (!wv) { notify('请填体重', 'bad'); $('w').focus(); return; }
  const num = parseFloat(wv);
  if (!Number.isFinite(num)) { notify('体重不是数字', 'bad'); return; }
  if (num < 60 || num > 300) { notify('体重应在 60~300 斤之间', 'bad'); return; }

  if (btn) btn.disabled = true;
  setStatus('记录中…', 'info');
  try {
    const j = await requestJSON('/api/weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dt, weight: wv, note: note })
    });
    if (!j.ok) throw new Error(j.error || '记录失败');
    S.data = j.state;
    render();
    $('note').value = '';
    notify('已记录 ' + f1(j.row.w) + ' 斤 · 第 ' + j.row.day + ' 天', 'ok');
  } catch (err) {
    notify('记录失败：' + (err.message || err), 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- 表单：腰围 ---------------- */

async function saveWaist(ev) {
  if (ev) ev.preventDefault();
  const dt = $('wdt').value;
  const cm = $('wcm').value;
  const btn = $('wsaveBtn');
  if (!dt) { toast('请选日期', 'bad'); return; }
  if (!cm) { toast('请填腰围', 'bad'); $('wcm').focus(); return; }
  if (btn) btn.disabled = true;
  try {
    const j = await requestJSON('/api/waist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dt, cm: cm })
    });
    if (!j.ok) throw new Error(j.error || '记录失败');
    S.data = j.state;
    render();
    $('wcm').value = '';
    toast('腰围已记录', 'ok');
  } catch (err) {
    toast('腰围记录失败：' + (err.message || err), 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- 目标对话框 ---------------- */

function updateGoalDialog(st, cfg) {
  const cur = $('dlgCurrent');
  const bak = $('dlgBackup');
  if (cur) cur.textContent = f1(cfg.goal);
  if (bak) bak.textContent = f1(S.data.goalBackup);
  const input = $('dlgGoal');
  if (input && !input.value) input.value = f1(cfg.goal);
}

function openGoal() {
  const dlg = $('goalDialog');
  if (!dlg || !S.data) return;
  const cfg = S.data.config;
  const cur = $('dlgCurrent');
  const bak = $('dlgBackup');
  if (cur) cur.textContent = f1(cfg.goal);
  if (bak) bak.textContent = f1(S.data.goalBackup);
  const input = $('dlgGoal');
  if (input) input.value = f1(cfg.goal);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  if (input) { input.focus(); input.select(); }
}

function closeGoal() {
  const dlg = $('goalDialog');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

async function saveGoal() {
  if (!S.data) return;
  const input = $('dlgGoal');
  const raw = input ? input.value : '';
  const v = parseFloat(raw);
  const cur = S.data.config.goal;
  const bak = n(S.data.goalBackup, S.data.config.goal);

  if (!Number.isFinite(v)) { toast('目标要是数字', 'bad'); return; }
  if (v < 40 || v > 200) { toast('目标要在 40~200 斤之间', 'bad'); return; }
  if (Math.abs(v - cur) < 0.05) { closeGoal(); toast('目标没变', 'info'); return; }
  if (!confirm('把目标从 ' + f1(cur) + ' 斤改成 ' + f1(v) + ' 斤？\n\n旧目标会写进历史，' +
    f1(bak) + ' 斤那个基准档也会保留。\n这只影响“还差多少”，不影响体重曲线和趋势速度。')) return;

  const btn = $('goalSave');
  if (btn) btn.disabled = true;
  try {
    const j = await requestJSON('/api/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: v })
    });
    if (!j.ok) throw new Error(j.error || '保存失败');
    S.data = j.state;
    render();
    closeGoal();
    notify('目标已改成 ' + f1(v) + ' 斤', 'ok');
  } catch (err) {
    toast('保存失败：' + (err.message || err), 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- 明细表交互 ---------------- */

async function updateNote(date, value) {
  const row = (S.data.weight || []).find((r) => r.date === date);
  if (!row || value === row.note) return;
  try {
    const j = await requestJSON('/api/weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date, weight: row.w, note: value })
    });
    if (!j.ok) throw new Error(j.error || '保存失败');
    S.data = j.state;
    notify('已更新 ' + date + ' 的备注', 'ok');
  } catch (err) {
    notify('备注保存失败：' + (err.message || err), 'bad');
  }
}

async function toggleExclude(date, on) {
  const reason = on ? '手动标记为不可信' : '';
  try {
    const j = await requestJSON('/api/exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date, on: on, reason: reason })
    });
    if (!j.ok) throw new Error(j.error || '操作失败');
    S.data = j.state;
    render();
    notify(on ? '已排除 ' + date : '已恢复 ' + date, 'ok');
  } catch (err) {
    notify('操作失败：' + (err.message || err), 'bad');
  }
}

async function deleteRow(date) {
  if (!confirm('确定删除 ' + date + ' 这条体重记录？\n（会从 weight.csv 移除，天数会重新计算）')) return;
  try {
    const j = await requestJSON('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date })
    });
    if (!j.ok) throw new Error(j.error || '删除失败');
    S.data = j.state;
    render();
    notify('已删除 ' + date, 'ok');
  } catch (err) {
    notify('删除失败：' + (err.message || err), 'bad');
  }
}

/* ---------------- 导航高亮 ---------------- */

function initNav() {
  const links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
  if (!links.length) return;
  const sections = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  const setActive = (id) => {
    links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('data-nav') === id));
  };

  links.forEach((a) => {
    const label = a.querySelector('.label');
    if (label) a.title = label.textContent.trim();
  });

  const pick = () => {
    /* 点了导航后，平滑滚动会经过中间几个 section。
       这段时间锁住高亮在目标项上，否则小圆点会一路乱跳。 */
    if (navLock) {
      const top = navLock.el.getBoundingClientRect().top;
      const margin = window.innerWidth <= 1024 ? 74 : 22;
      if (Math.abs(top - margin) <= 10 || performance.now() > navLock.until) navLock = null;
      else { setActive(navLock.id); return; }
    }
    const line = window.scrollY + Math.min(180, window.innerHeight * 0.3);
    let current = sections[0];
    let bestTop = -Infinity;
    /* 导航链接按分组排列，不一定是文档顺序；取“已经划过去且位置最靠下”的那个 */
    sections.forEach((sec) => {
      const top = sec.getBoundingClientRect().top + window.scrollY;
      if (top <= line && top > bestTop) { bestTop = top; current = sec; }
    });
    if (window.scrollY > 20 &&
        document.documentElement.scrollHeight > window.innerHeight + 40 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
      current = sections[sections.length - 1];
    }
    if (current) setActive(current.id);
  };

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => { ticking = false; pick(); });
  }, { passive: true });
  window.addEventListener('resize', debounce(pick, 150));
  ['wheel', 'touchstart'].forEach((type) => {
    window.addEventListener(type, () => { navLock = null; }, { passive: true });
  });

  navPick = pick;

  links.forEach((a) => {
    a.addEventListener('click', (ev) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      ev.preventDefault();
      const id = a.getAttribute('data-nav');
      navLock = { id: id, el: target, until: performance.now() + 1700 };
      setActive(id);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  pick();
}

/* ---------------- 启动 ---------------- */

function init() {
  initTheme();
  initSide();
  initNav();

  const today = todayKey();
  const dt = $('dt');
  if (dt) dt.value = today;
  const wdt = $('wdt');
  if (wdt) wdt.value = today;

  const form = $('recordForm');
  if (form) form.addEventListener('submit', saveWeight);

  const waistForm = $('waistForm');
  if (waistForm) waistForm.addEventListener('submit', saveWaist);

  const refresh = $('refreshBtn');
  if (refresh) refresh.addEventListener('click', () => load({ toast: true }));

  const quick = $('quickAdd');
  if (quick) {
    quick.addEventListener('click', () => {
      const rec = $('overview');
      const target = $('recordForm');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (rec) rec.scrollIntoView({ behavior: 'smooth' });
      const input = $('w');
      if (input) window.setTimeout(() => input.focus(), 320);
    });
  }

  const goalBtn = $('goalBtn');
  if (goalBtn) goalBtn.addEventListener('click', openGoal);
  const goalClose = $('goalClose');
  if (goalClose) goalClose.addEventListener('click', closeGoal);
  const goalCancel = $('goalCancel');
  if (goalCancel) goalCancel.addEventListener('click', closeGoal);
  const goalSave = $('goalSave');
  if (goalSave) goalSave.addEventListener('click', saveGoal);

  const dlg = $('goalDialog');
  if (dlg) {
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeGoal(); });
    const input = $('dlgGoal');
    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); saveGoal(); }
      });
    }
  }

  const search = $('search');
  if (search) {
    search.addEventListener('input', debounce(() => {
      S.query = search.value || '';
      drawTable();
    }, 120));
  }

  const range = $('range');
  if (range) {
    range.addEventListener('change', () => {
      S.range = parseInt(range.value, 10) || 0;
      drawTable();
    });
  }

  document.querySelectorAll('.data-table th[data-k]').forEach((th) => {
    th.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) ev.preventDefault();
      const k = th.getAttribute('data-k');
      if (S.sortKey === k) S.sortDir = -S.sortDir;
      else { S.sortKey = k; S.sortDir = -1; }
      drawTable();
    });
  });

  const tb = $('tb');
  if (tb) {
    tb.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t && t.dataset && t.dataset.note) updateNote(t.dataset.note, t.value);
    });

    tb.addEventListener('click', (ev) => {
      const del = ev.target.closest ? ev.target.closest('button[data-del]') : null;
      if (del) { deleteRow(del.getAttribute('data-del')); return; }
      const exc = ev.target.closest ? ev.target.closest('button[data-exc]') : null;
      if (exc) {
        const date = exc.getAttribute('data-exc');
        const on = exc.textContent.trim() === '排除';
        if (on && !confirm('把 ' + date + ' 标为不可信？\n它会被排除在趋势拟合之外（曲线和速度都会重算），但记录本身还在。')) return;
        toggleExclude(date, on);
      }
    });

    tb.addEventListener('keydown', (ev) => {
      if (ev.target.classList && ev.target.classList.contains('note-input') && ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        ev.target.blur();
      }
    });

    tb.addEventListener('focusout', (ev) => {
      const t = ev.target;
      if (t && t.classList && t.classList.contains('note-input') && t.dataset.note) {
        updateNote(t.dataset.note, t.value);
      }
    });
  }

  ['w', 'note'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveWeight(); }
    });
  });

  window.addEventListener('resize', debounce(() => redrawCharts(), 180));

  load();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

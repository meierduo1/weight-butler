#!/usr/bin/env node
'use strict';
/* ============================================================
   体重管家 · 本地服务
   启动   node app\server.js
   换端口 设置环境变量 WT_PORT
   ============================================================ */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP    = __dirname;
const ROOT   = path.resolve(APP, '..');
const DATA   = path.join(ROOT, 'data');
const PUBLIC = path.join(APP, 'public');
const PORT   = parseInt(process.env.WT_PORT || '8787', 10);
const STARTED_AT = new Date().toISOString();
/* 代码指纹：内容变了指纹就变，外部启动脚本可据此判断是否需要重启 */
const SERVER_HASH = require('crypto').createHash('sha1')
  .update(fs.readFileSync(__filename)).digest('hex').slice(0, 12);

/* 个人参数全部放在 data/profile.json，不写死在代码里。
   换人用只需要改这个文件（年龄、身高、起点、目标日、热量区间…）。 */
const DEFAULT_PROFILE = {
  sex: 'male',
  age: 22,
  heightCm: 178,
  startWeight: 181.0,
  goal: 160.0,
  holiday: '2027-06-30',
  kcalLo: 1900,
  kcalHi: 2300,
  protHardFloor: 110,
  protPerKgLo: 1.6,
  protPerKgHi: 2.0,
  bodyFatLo: 0.18,
  bodyFatHi: 0.24
};
function readProfile() {
  const f = path.join(DATA, 'profile.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Object.assign({}, DEFAULT_PROFILE, j);
  } catch (e) {
    return Object.assign({}, DEFAULT_PROFILE);
  }
}
const PROFILE = readProfile();

/* 目标体重可以随时改：真源在 data/目标.json，不在代码里。
   改的时候【旧的会被写进 history】，最初的基准目标永远保留在 backup 里。 */
function readGoalFile() {
  const f = path.join(DATA, '目标.json');
  const base = parseFloat(PROFILE.goal) || 160.0;
  const fallback = { goal: base, history: [], backup: base };
  if (!fs.existsSync(f)) return fallback;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const g = parseFloat(j.goal);
    return {
      goal: (isNaN(g) ? base : g),
      history: Array.isArray(j.history) ? j.history : [],
      backup: parseFloat(j.backup) || base
    };
  } catch (e) { return fallback; }
}
function writeGoalFile(o) {
  const f = path.join(DATA, '目标.json');
  backupFile('目标.json');
  fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8');
}
/* 改目标：旧目标进 history，最初的基准目标永远保留在 backup 里 */
function setGoal(g, note) {
  const v = parseFloat(g);
  if (isNaN(v) || v < 40 || v > 200) throw new Error('目标体重要在 40~200 斤之间');
  const cur = readGoalFile();
  if (Math.abs(cur.goal - v) < 0.05) return { goal: v, changed: false, history: cur.history };
  const hist = cur.history.slice();
  hist.push({ goal: cur.goal, note: note || ('被 ' + v + ' 斤替换'), setAt: ymd(new Date()) });
  /* 最初的目标（第一次启动时的 goal）始终留一份备份 */
  const baseGoal = parseFloat(cur.backup) || parseFloat(PROFILE.goal) || 160.0;
  const keepsBase = hist.some(x => Math.abs(x.goal - baseGoal) < 0.05) || Math.abs(cur.goal - baseGoal) < 0.05;
  const out = { goal: v, history: hist, backup: baseGoal, keepsBase: keepsBase };
  writeGoalFile(out);
  return { goal: v, changed: true, history: hist };
}

/* 通用备份（目标.json / 其他小文件用） */
function backupFile(name) {
  try {
    const src = path.join(DATA, name);
    if (!fs.existsSync(src)) return;
    const dir = path.join(DATA, '_备份');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const dst = path.join(dir, name + '.bak-' + ymd(new Date()));
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  } catch (e) { }
}

const CONFIG = {
  goal: PROFILE.goal,
  startWeight: PROFILE.startWeight,   // 统一基准 = 第1天早晨空腹（不用第0天晚裸重）
  holiday: PROFILE.holiday,
  kcalLo: PROFILE.kcalLo, kcalHi: PROFILE.kcalHi,
  protHardFloor: PROFILE.protHardFloor,
  protPerKgLo: PROFILE.protPerKgLo, // 每公斤【去脂体重】的合理下限
  protPerKgHi: PROFILE.protPerKgHi, // 上限
  bodyFatLo: PROFILE.bodyFatLo, bodyFatHi: PROFILE.bodyFatHi, // 减脂期体脂率估计区间
  minDaysForTdee: 21,           // 满 3 周才给 TDEE 数值（前 3 周水分占大头，会高估）
  tdeeMinPairDays: 10,          // 配对窗口 >=10 天
  tdeeWindow: 14,               // 滚动窗口：只看最近 14 天
  tdeeWindowMin: 10,            // 滚动窗口最少天数
  ewmaAlpha: 0.15,              // EWMA 版的平滑系数
  /* ---- 油量误差模型（回答"油多油少怎么办"）----
     沥干后仍残留一层油。给"每只鸡腿残留油量"定三档固定克数，
     于是误差从"随时间漂移的随机量"变成"固定偏移"——固定偏移能靠
     体重数据反推校正，随机漂移不能。 */
  oilGPerLeg: [0, 5, 10],       // 档位 0=沥得很干 1=一般 2=明显油
  oilGPerLegMax: 15,            // 极端上限（基本没沥）
  oilKcalPerG: 9,               // 油 9 kcal/g
  fatKcalPerKg: 7700,           // 1 kg 脂肪 ≈ 7700 kcal
  jinPerKg: 2,                  // 1 kg = 2 斤
  /* 公式 TDEE（Mifflin-St Jeor）用于和数据反推交叉验证 */
  formula: { age: PROFILE.age, hCm: PROFILE.heightCm, actLo: 1.35, actHi: 1.55 },
  excludeFile: '排除.json'
};

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } }
      else { cur += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else { cur += c; }
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
function q(v) {
  v = (v === undefined || v === null) ? '' : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(header, rows) {
  return [header.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\r\n') + '\r\n';
}
function readTable(name) {
  const f = path.join(DATA, name);
  if (!fs.existsSync(f)) return [];
  const rows = parseCSV(fs.readFileSync(f, 'utf8'));
  if (!rows.length) return [];
  const head = rows[0], out = [];
  for (let i = 1; i < rows.length; i++) {
    const o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = rows[i][j] === undefined ? '' : rows[i][j];
    out.push(o);
  }
  return out;
}
/* 写盘前自动留一份快照。
   为什么需要：写盘是"整表覆盖"，一旦代码出错（比如误匹配删行）就是永久丢失。
   这里每次写之前把【旧内容】存进 data_备份，并按天去重，只留最近的那一份。
   恢复方法：把 _备份<文件名>.bak-<日期> 复制回 data 覆盖即可。 */
function backupTable(name) {
  try {
    const src = path.join(DATA, name);
    if (!fs.existsSync(src)) return;
    const dir = path.join(DATA, '_备份');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const dst = path.join(dir, name + '.bak-' + ymd(new Date()));
    /* 同一天多次写盘只留第一次（也就是"这一天开始时的样子"），避免把坏数据覆盖进去 */
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    /* 只保留最近 14 份 */
    const all = fs.readdirSync(dir).filter(x => x.indexOf(name + '.bak-') === 0).sort();
    while (all.length > 14) { try { fs.unlinkSync(path.join(dir, all.shift())); } catch (e) { } }
  } catch (e) { /* 备份失败不能挡住主流程 */ }
}

function writeTable(name, header, rows) {
  backupTable(name);
  fs.writeFileSync(path.join(DATA, name), toCSV(header, rows.map(r => header.map(h => r[h]))), 'utf8');
}

/* 排除清单：数据不可信的日子不进拟合。文件 data\排除.json
   [{ "date":"2026-09-21", "reason":"当天只记到早餐，次日孤立低点" }] */
function readExcludes() {
  const f = path.join(DATA, CONFIG.excludeFile);
  if (!fs.existsSync(f)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (Array.isArray(j) ? j : j.list || []).filter(x => x && x.date);
  } catch (e) { return []; }
}
function writeExcludes(list) {
  fs.writeFileSync(path.join(DATA, CONFIG.excludeFile),
    JSON.stringify(list, null, 2), 'utf8');
}

/* ---------------- 日期 ---------------- */
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseYmd(s) {
  const p = String(s).trim().split('-');
  if (p.length !== 3) return null;
  const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(ymdStr, k) {
  const d = parseYmd(ymdStr);
  d.setDate(d.getDate() + k);
  return ymd(d);
}
function diffDays(a, b) { return Math.round((parseYmd(a) - parseYmd(b)) / 86400000); }

/* ---------------- 读数据 ---------------- */
function readWeight() {
  const rows = readTable('weight.csv')
    .map(r => ({ date: r.date, day: parseInt(r.day, 10) || 0, w: parseFloat(r.weight), note: r.note || '' }))
    .filter(r => r.date && !isNaN(r.w))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return renumber(rows);
}
/* 天数统一由日期算出来，避免手改日期后 day 和 date 对不上 */
function renumber(rows) {
  if (!rows.length) return rows;
  for (const r of rows) r.day = diffDays(r.date, rows[0].date);
  return rows;
}

function legCount(s) {
  const m = String(s || '').match(/鸡腿\s*[xX×]?\s*(\d+)/);
  if (m) return parseInt(m[1], 10) || 0;
  return /鸡腿/.test(String(s || '')) ? 1 : 0;
}

function readIntake() {
  const daily = {};
  for (const r of readTable('intake.csv')) {
    const d = r.date; if (!d) continue;
    if (!daily[d]) daily[d] = { kcal: 0, prot: 0, na: 0, est: 1, legs: 0, oil_g: 0, oilGrams: 0, complete: 1, items: [] };
    const D = daily[d];
    const kcal = parseInt(r.kcal, 10) || 0, prot = parseInt(r.p, 10) || 0;
    D.kcal += kcal; D.prot += prot;
    if (r.high_na === '1') D.na++;
    if (r.certainty === '0') D.est = 0;
    if (r.complete === '0') D.complete = 0;
    /* 油量：按【这一行自己的】档位累计，而不是"全天共用最后一个档位"。
       原因：同一天两顿油档位可能不同（午餐 5g、下午 3g 沥得更干）。
       旧写法只取最后一条的档位、再乘【全天】鸡腿数 —— 会把午餐那顿也算错。
       全库历史上每一行的 oil_g 都是 5，所以这次改动不改变任何已有数字。
       oil_g 本身仍保留"最后一条腿行"的值，供界面显示"当前档位"。 */
    const lg = legCount(r.summary);
    if (lg) {
      const hasOg = (r.oil_g !== undefined && r.oil_g !== '');
      const og = hasOg ? (parseFloat(r.oil_g) || 0) : CONFIG.oilGPerLeg[1];
      D.oilGrams += lg * og;
      if (hasOg) D.oil_g = og;
    }
    if (r.summary && r.meal !== '校正') {
      D.items.push({ meal: r.meal, summary: r.summary, kcal: kcal, p: prot,
        na: r.high_na === '1', est: r.certainty !== '0' });
    }
    D.legs += lg;
  }
  /* 净摄入 = 记录热量 + 残留油的热量 */
  for (const d of Object.keys(daily)) {
    const D = daily[d];
    D.oilKcal = Math.round(D.oilGrams * CONFIG.oilKcalPerG);
    D.oilPermedG = D.legs > 0 ? +(D.oilGrams / D.legs).toFixed(2) : 0;
    D.netKcal = D.kcal + D.oilKcal;
  }
  return daily;
}
function readTraining() {
  return readTable('training.csv').map(r => ({ date: r.date, type: r.type, detail: r.detail }))
    .filter(r => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
}
function readSleep() { return readTable('sleep.csv').filter(r => r.date); }
function readWaist() {
  return readTable('waist.csv')
    .map(r => ({ date: r.date, cm: parseFloat(r.cm) || null, note: r.note || '' }))
    .filter(r => r.date && r.cm)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
/* 腰围写盘：同一天覆盖，不写重 */
function saveWaist(dateStr, cm, note) {
  const header = ['date', 'cm', 'note'];
  const v = parseFloat(cm);
  if (!dateStr) throw new Error('缺日期');
  if (isNaN(v) || v < 40 || v > 200) throw new Error('腰围要是 40~200 之间的数字(cm)');
  let rows = readTable('waist.csv');
  if (!rows.length) rows = [];
  const hit = rows.filter(r => r.date === dateStr);
  if (hit.length) {
    hit.forEach(r => { r.cm = v; if (note !== undefined && note !== '') r.note = note; });
    /* 同一天多余的行删掉 */
    const keep = rows.filter(r => r.date !== dateStr);
    keep.push({ date: dateStr, cm: v, note: (note !== undefined && note !== '') ? note : (hit[0].note || '') });
    rows = keep;
  } else {
    rows.push({ date: dateStr, cm: v, note: note || '' });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  writeTable('waist.csv', header, rows);
  return { date: dateStr, cm: v, n: rows.length };
}

/* 行级鸡腿记录：用来量"每只鸡腿记录了多少 kcal"，这是油量波动的直接观测口径 */
function readLegRows() {
  const out = [];
  for (const r of readTable('intake.csv')) {
    if (!r.date || r.meal === '校正') continue;
    const k = legCount(r.summary);
    const kc = parseInt(r.kcal, 10) || 0;
    if (!k || kc <= 0) continue;
    out.push({ date: r.date, legs: k, kcal: kc, perLeg: kc / k, na: r.high_na === '1', summary: r.summary });
  }
  return out;
}

/* ================= 统计工具 ================= */
const T975 = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,
  10:2.228,11:2.201,12:2.179,13:2.160,14:2.145,15:2.131,16:2.120,17:2.110,18:2.101,
  19:2.093,20:2.086,21:2.080,22:2.074,23:2.069,24:2.064,25:2.060,26:2.056,27:2.052,
  28:2.048,29:2.045,30:2.042};
function tCrit(df) { return T975[df] || (df > 30 ? 2.0 : 12.706); }
function median(a) {
  const s = a.slice().sort((x, y) => x - y), m = s.length;
  if (!m) return 0;
  return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
}
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

/* 最小二乘 + 95% 置信区间 + R² */
function ols(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const mx = mean(pts.map(p => p.x)), my = mean(pts.map(p => p.y));
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let sse = 0;
  for (const p of pts) sse += (p.y - (intercept + slope * p.x)) ** 2;
  const df = n - 2, s2 = df > 0 ? sse / df : 0;
  const se = df > 0 ? Math.sqrt(s2 / sxx) : 0, tc = tCrit(df);
  const res = [];
  for (const p of pts) res.push(p.y - (intercept + slope * p.x));
  return {
    slope, intercept, n, df, se, tc, mx, sxx,
    r2: syy > 0 ? 1 - sse / syy : 0,
    ciLo: slope - tc * se, ciHi: slope + tc * se,
    residSd: Math.sqrt(s2),
    sse, res
  };
}

/* ============ AR(1) 自相关修正 ============
   为什么必须做：体重有惯性，今天偏高明天也偏高，残差不独立。
   独立假设下的 OLS 标准误因此严重偏小 —— 蒙特卡洛实测覆盖率只有 78%
   （名义 95%），也就是"95% 区间"其实只有 78% 的把握。

   为什么用"下限"而不是纯估计：残差自相关在小样本里偏差极大。
   模拟真值 rho=0.5、n=14 时，估计量的均值只有 0.15。只信估计值会继续过度自信。
   做法是 偏差校正 + 下限 0.5，宁可保守。

   蒙特卡洛验证（真 rho=0.5, n=14, 4000 次）：
     朴素 OLS        覆盖率 78%   CI 宽 0.55 斤/周
     本方法(下限0.5)  覆盖率 92%   CI 宽 0.85 斤/周
   代价是区间变宽，但这是诚实的代价。 */
const RHO_FLOOR = 0.5;
const RHO_CAP = 0.8;

/* 残差 lag-1 自相关（偏差校正后，取下限） */
function ar1Rho(res) {
  const n = res.length;
  if (n < 4) return RHO_FLOOR;
  let mu = 0;
  for (const e of res) mu += e;
  mu /= n;
  let den = 0, num = 0;
  for (const e of res) den += (e - mu) ** 2;
  for (let i = 1; i < n; i++) num += (res[i] - mu) * (res[i - 1] - mu);
  let rho = den > 0 ? num / den : 0;
  if (!isFinite(rho)) rho = 0;
  rho = Math.max(-0.95, Math.min(0.95, rho));
  const bc = rho + (1 + 3 * rho) / n;          // 小样本偏差校正
  return Math.min(RHO_CAP, Math.max(bc, RHO_FLOOR));
}

/* 膨胀因子 = sqrt( x'Vx / (x'x) )，V_ij = rho^|i-j|（x 为去均值的天数） */
function ar1Inflation(xv, rho) {
  const n = xv.length;
  let mx = 0;
  for (const v of xv) mx += v;
  mx /= n;
  const x = xv.map(v => v - mx);
  const sxx = x.reduce((a, v) => a + v * v, 0);
  if (sxx <= 0) return 1;
  let xVx = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) xVx += x[i] * x[j] * Math.pow(rho, Math.abs(i - j));
  return Math.sqrt(xVx / sxx);
}

/* 把 AR(1) 结果挂到 OLS 结果上 */
function withAR1(fit, xv) {
  if (!fit || !fit.res) return fit;
  const rho = ar1Rho(fit.res);
  const infl = ar1Inflation(xv, rho);
  const seAR = fit.se * infl;
  fit.rho = rho;
  fit.inflation = infl;
  fit.seNaive = fit.se;
  fit.seAR = seAR;
  fit.ciLoAR = fit.slope - fit.tc * seAR;
  fit.ciHiAR = fit.slope + fit.tc * seAR;
  return fit;
}

/* Durbin-Watson（2=无自相关，明显小于 2 = 正自相关） */
function durbinWatson(res) {
  let num = 0, den = 0;
  for (let i = 1; i < res.length; i++) num += (res[i] - res[i - 1]) ** 2;
  let mu = 0;
  for (const e of res) mu += e;
  mu /= res.length;
  for (const e of res) den += (e - mu) ** 2;
  return den > 0 ? num / den : 2;
}

/* ============ 移动块自举（残差重采样）· 仅作参考 ============
   蒙特卡洛实测：n=14、rho=0.5 时，块长 3 的覆盖率只有
   70% 左右（名义 95%），因为 n/blockLen 只有 4~5 个独立块，
   统计量本身方差巨大。**所以它不配当主口径**，只列出来当交叉验证，
   并在界面上明确标注它的不足。

   主口径用 AR(1) 修正（覆盖率 92%）。 */
function blockBootstrapSlope(xv, res, B, blockLen) {
  const n = xv.length;
  if (n < 6) return null;
  let mx = 0;
  for (let i = 0; i < n; i++) mx += xv[i];
  mx /= n;
  const x = xv.map(v => v - mx);
  const sxx = x.reduce((a, v) => a + v * v, 0);
  if (sxx <= 0) return null;
  /* 原趋势的截距与斜率：重采样时要把趋势加回去，
     否则重新拟合的只是"残差的斜率"（≈0），区间会假性收窄。 */
  let my = 0;
  for (const e of res) my += e;
  my /= n;
  let sxy0 = 0;
  for (let i = 0; i < n; i++) sxy0 += x[i] * (res[i] - my);
  const b0 = sxy0 / sxx;
  const a0 = my - b0 * mx;
  let seed = 20260929;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const slopes = [];
  for (let b = 0; b < B; b++) {
    const er = [];
    while (er.length < n) {
      const st = Math.floor(rnd() * Math.max(1, n - blockLen + 1));
      for (let k = 0; k < blockLen && er.length < n; k++) er.push(res[st + k]);
    }
    const y2 = [];
    for (let i = 0; i < n; i++) y2.push(a0 + b0 * xv[i] + er[i]);
    let m2 = 0, m3 = 0;
    for (let i = 0; i < n; i++) { m2 += xv[i]; m3 += y2[i]; }
    m2 /= n; m3 /= n;
    let sxx2 = 0, sxy2 = 0;
    for (let i = 0; i < n; i++) { sxx2 += (xv[i] - m2) ** 2; sxy2 += (xv[i] - m2) * (y2[i] - m3); }
    if (sxx2 > 0) slopes.push(sxy2 / sxx2);
  }
  if (slopes.length < 50) return null;
  slopes.sort((a, b) => a - b);
  const q = p => slopes[Math.min(slopes.length - 1, Math.floor(p * slopes.length))];
  const mid = slopes[Math.floor(0.5 * slopes.length)];
  const sd = Math.sqrt(slopes.reduce((a, v) => a + (v - mid) ** 2, 0) / slopes.length);
  /* 独立块数：太少就不可信。n/blocks < 6 直接标不可用 */
  const blocks = Math.floor(n / blockLen);
  return {
    lo: q(0.025), hi: q(0.975), n: B, blockLen, sd,
    blocks: blocks,
    trustworthy: blocks >= 6,
    why: blocks >= 6 ? null
      : ('只有 ' + blocks + ' 个独立块（n=' + n + ' / 块长' + blockLen + '），太少，区间不可信')
  };
}

/* Theil-Sen 稳健斜率：两两配对取中位数，抗异常值 */
function theilSen(pts) {
  const sl = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      if (dx > 0) sl.push((pts[j].y - pts[i].y) / dx);
    }
  return sl.length ? median(sl) : null;
}

/* Holt 双参数指数平滑：只平滑"水平"，趋势项自己跟随转向（不像均线滞后） */
function holt(pts) {
  if (pts.length < 6) return null;
  let best = null;
  for (let a = 0.10; a <= 0.35001; a += 0.05) {
    for (let b = 0.05; b <= 0.20001; b += 0.05) {
      let L = pts[0].y, T = 0, sse = 0;
      for (let i = 1; i < pts.length; i++) {
        /* 关键：两点之间可能隔好几天（回家没带秤）。
           旧写法把每个点都当成"隔 1 天"，7 天的变化会被摊到 1 天上，
           趋势项 T 因此被严重低估。这里按真实间隔 gap 缩放：
             一步预测 = L + T*gap
             新的 T    = 水平变化 / gap     （T 始终是"每天"的斜率）
           gap=1 时与旧写法完全等价，所以在校连续记录的那段数字不变。 */
        const gap = Math.max(1, pts[i].x - pts[i - 1].x);
        sse += (pts[i].y - (L + T * gap)) ** 2;
        const Lp = L;
        L = a * pts[i].y + (1 - a) * (L + T * gap);
        T = b * (L - Lp) / gap + (1 - b) * T;
      }
      if (!best || sse < best.sse) best = { alpha: a, beta: b, level: L, trend: T, sse: sse };
    }
  }
  return best;
}

/* EWMA：老的平滑值，保留用于对照（滞后明显，不能拿来算速度） */
function ewmaLast(vals, alpha) {
  let s = vals[0];
  for (let i = 1; i < vals.length; i++) s = s + alpha * (vals[i] - s);
  return s;
}

/* ================= 油量误差模型 ================= */
/* 目的：回答"今天油多、明天油少，这个误差怎么办"。
   结论分三层：
   (1) 记录口径的离散有多大      -> 统计每只鸡腿的记录值
   (2) 能不能用数据把油量反推出来 -> 配对回归，看 CI。（当前数据：不能，见 reg.ok=false）
   (3) 不能反推时的正确做法      -> 把残留油固定成三档记录；固定偏移在斜率里抵消，
                                    只抬升 TDEE 水平，所以趋势照样准。 */
function oilModel(intake, legRows, w) {
  if (!legRows.length) return null;
  const per = legRows.map(r => r.perLeg);
  const med = median(per);
  const mad = median(per.map(v => Math.abs(v - med)));
  const sigma = 1.4826 * mad;
  const clean = legRows.filter(r => !r.na && r.legs === 2);

  /* ---- (2) 配对回归：TDEE(假定油=0) 对 每日鸡腿数 回归 ---- */
  let reg = null;
  const pts = [];
  for (let i = 0; i < w.length; i++)
    for (let j = i + 1; j < w.length; j++) {
      const dd = w[j].day - w[i].day;
      if (dd < CONFIG.tdeeMinPairDays) continue;
      let sk = 0, sl = 0, cnt = 0;
      for (let k = i; k < j; k++) {
        const key = addDays(w[i].date, w[k + 1].day - w[i].day);
        if (intake[key]) { sk += intake[key].kcal; sl += intake[key].legs; cnt++; }
      }
      if (cnt < 5) continue;
      const avgL = sl / cnt;
      pts.push({ x: avgL, y: sk / cnt - (w[j].w - w[i].w) * 0.5 * CONFIG.fatKcalPerKg / dd });
    }
  if (pts.length >= 5) {
    const f = ols(pts);
    if (f && pts.length) {
      /* MDE（最小可检出效应）：在 80% 功效、5% 显著性下，
         这个样本量能检出的最小斜率。它比"CI 跨 0"有用得多 ——
         直接告诉你"要做这个实验，自变量得差多少"。 */
      const z80 = 2.802;                       // z_{0.975} + z_{0.80}
      const mde = z80 * f.se;
      /* 自变量（每日鸡腿数）当前的跨度 */
      reg = {
        slope: f.slope, lo: f.slope - f.tc * f.se, hi: f.slope + f.tc * f.se,
        se: f.se, tc: f.tc,
        intercept: f.intercept, r2: f.r2, n: f.n, residSd: f.residSd,
        /* 只有 CI 不跨 0 才算"数据能把油量定出来" */
        ok: (f.slope - f.tc * f.se) > 0 || (f.slope + f.tc * f.se) < 0,
        xRange: [Math.min.apply(null, pts.map(p => p.x)), Math.max.apply(null, pts.map(p => p.x))],
        mde: Math.round(mde),
        mdeGPerLeg: +(mde / CONFIG.oilKcalPerG).toFixed(1),
        gPerLeg: f.slope / CONFIG.oilKcalPerG,
        /* 要让这个回归能给出结论，自变量（每日鸡腿数）需要跨多大范围。
           思路：se ≈ sigmaResid / (sqrt(n) * SD(x))，要 MDE 降到目标值，
           就得把 SD(x)（即鸡腿数的波动）放大。这里给出"需要扩到几倍"。 */
        targetMdeNote: '要让 MDE 减半（约 ' + Math.round(mde / 2) + ' kcal/只），'
          + '需要把"每日鸡腿数的波动"扩大到现在的 2 倍 —— 也就是刻意制造对比'
      };
    }
  }

  /* ---- (1) 记录口径统计 ---- */
  const legsPerDay = mean(Object.keys(intake).map(d => intake[d].legs));
  const meanKcal = Math.round(mean(Object.keys(intake).map(d => intake[d].kcal)));

  /* ---- (3) 三档固定偏移情景 ---- */
  const scenarios = CONFIG.oilGPerLeg.map(g => ({
    g: g,
    label: g === 0 ? '沥得很干' : (g === 5 ? '一般' : '明显油'),
    kcalPerLeg: g * CONFIG.oilKcalPerG,
    perDay: Math.round(legsPerDay * g * CONFIG.oilKcalPerG)
  }));
  const spread = scenarios[2].perDay - scenarios[0].perDay;

  /* 当前生效的档位：取最后一条有鸡腿的饮食记录上的 oil_g */
  let currentG = 5, currentDate = null;
  const ds = Object.keys(intake).filter(d => intake[d].legs > 0).sort();
  if (ds.length) { currentDate = ds[ds.length - 1]; currentG = intake[currentDate].oil_g; }
  /* 全库平均口径：同一天两顿档位不同时，oil_g 只反映最后一条腿行，
     所以再给一个"每只鸡腿平均算了几克油"，供界面做诚实提示。 */
  const _dsAll = Object.keys(intake).filter(d => intake[d].legs > 0);
  const _gSum = _dsAll.reduce((s, d) => s + intake[d].oilGrams, 0);
  const _legSum = _dsAll.reduce((s, d) => s + intake[d].legs, 0);
  const oilGPerLegEffective = _legSum > 0 ? +(_gSum / _legSum).toFixed(2) : 0;
  /* 真正"混合档位"的天：当天平均油量 != 最后一条腿行的档位 */
  const oilMixedDays = _dsAll.filter(d => Math.abs(intake[d].oilPermedG - intake[d].oil_g) > 0.01).length;

  return {
    currentG: currentG, currentDate: currentDate,
    oilGPerLegEffective: oilGPerLegEffective, oilMixedDays: oilMixedDays,
    nRows: legRows.length, nClean2Leg: clean.length,
    perLegMed: +med.toFixed(1),
    perLegP25: +median(per.filter(v => v <= med)).toFixed(1),
    perLegP75: +median(per.filter(v => v >= med)).toFixed(1),
    perLegSigma: +sigma.toFixed(1),
    perLegSigmaPct: med > 0 ? +(sigma / med * 100).toFixed(1) : 0,
    legsPerDay: +legsPerDay.toFixed(2),
    meanKcal: meanKcal,
    oilKcalPerG: CONFIG.oilKcalPerG, oilGPerLeg: CONFIG.oilGPerLeg, oilGPerLegMax: CONFIG.oilGPerLegMax,
    reg: reg,
    scenarios: scenarios,
    spreadPerDay: spread,
    spreadJinPerMonth: +(spread * 30 / CONFIG.fatKcalPerKg * CONFIG.jinPerKg).toFixed(1),
    /* 固定偏移在斜率里抵消 —— 这是"别纠结油"的数学依据 */
    cancelsInTrend: true
  };
}

/* ================= 主统计 ================= */
function computeStats(allW, intake) {
  if (!allW.length) return {};
  const last = allW[allW.length - 1];

  /* 排除：第 0 天（晚裸重，测量条件不同）+ 排除清单里的不可信日子 */
  const ex = readExcludes();
  const exMap = {};
  for (const e of ex) exMap[e.date] = e.reason || '';
  const skipped = [];
  const w = allW.filter(r => {
    if (r.day < 1) { skipped.push({ r: r, reason: '第0天晚上裸重，测量条件与早晨空腹不同' }); return false; }
    if (exMap[r.date] !== undefined) { skipped.push({ r: r, reason: exMap[r.date] }); return false; }
    return true;
  });
  if (w.length < 3) return {};

  const first = w[0], n = w.length;
  const days = last.day - first.day;
  const validDates = w.map(r => r.date);
  const pts = w.map(r => ({ x: r.day, y: r.w }));

  const xv = w.map(r => r.day);
  let fit = ols(pts);
  fit = withAR1(fit, xv);                       // AR(1) 自相关修正
  const dw = fit && fit.res ? durbinWatson(fit.res) : null;
  const ts  = theilSen(pts);
  const ho  = holt(pts);
  const ew  = ewmaLast(w.map(r => r.w), 0.15);
  const boot = fit ? blockBootstrapSlope(xv, fit.res, 400, 3) : null;

  /* --- 多方法趋势对照 --- */
  const methodRows = [];
  if (fit) methodRows.push({ name: '最小二乘（AR(1) 修正）', rate: fit.slope * 7,
    lo: fit.ciLoAR * 7, hi: fit.ciHiAR * 7,
    note: '全窗口拟合，滞后；区间已按残差自相关修正（rho=' + fit.rho.toFixed(2) + '）' });
  if (boot && boot.trustworthy) methodRows.push({ name: '移动块自举（交叉验证）', rate: fit.slope * 7,
    lo: boot.lo * 7, hi: boot.hi * 7,
    note: '残差重采样，不假设分布；只作交叉验证' });
  if (ts !== null) methodRows.push({ name: 'Theil-Sen 稳健斜率', rate: ts * 7,
    lo: null, hi: null, note: '两两配对取中位数，抗异常值；不给区间' });
  if (ho) methodRows.push({ name: 'Holt 双参数（近期）', rate: ho.trend * 7,
    lo: null, hi: null, note: '只看最近几天的转向，不滞后；不给区间' });

  const seg7 = w.slice(Math.max(0, n - 7));
  const avg7 = mean(seg7.map(r => r.w));
  let avgPrev7 = null, rateRecent7 = null;
  if (n > 7) {
    const take = Math.min(7, n - 7);
    const p = w.slice(n - 7 - take, n - 7);
    avgPrev7 = mean(p.map(r => r.w));
    rateRecent7 = (avg7 - avgPrev7) / take * 7;
    methodRows.push({ name: '近 7 点 vs 前 7 点', rate: rateRecent7,
      lo: null, hi: null, note: '最简单直观，对端点敏感' });
  }
  const seg5 = w.slice(Math.max(0, n - 5));
  const avg5 = mean(seg5.map(r => r.w));
  let rateLast5 = null;
  if (n > 5) {
    const take = Math.min(5, n - 5);
    rateLast5 = (avg5 - mean(w.slice(n - 5 - take, n - 5).map(r => r.w))) / take * 7;
  }

  const l5lo = Math.min.apply(null, seg5.map(r => r.w));
  const l5hi = Math.max.apply(null, seg5.map(r => r.w));

  /* 噪声门槛：两个 7 日均值之差要多大才算"真变化"
     均值的标准误同样受自相关影响，所以用同一个膨胀因子修正。
     修正前门槛 0.38 斤 → 修正后约 0.60 斤。 */
  const noise = fit ? fit.residSd : 0.51;
  const infl = fit && fit.inflation ? fit.inflation : 1;
  const seMean = noise * infl / Math.sqrt(7);
  const minDelta = +(1.96 * Math.SQRT2 * seMean).toFixed(2);
  const minDeltaNaive = +(1.96 * Math.SQRT2 * noise / Math.sqrt(7)).toFixed(2);

  /* --- 7 天预测 + 预测区间（OLS 标准公式） --- */
  let forecast = null;
  if (fit && fit.df > 0 && fit.residSd > 0) {
    const x0 = last.day + 7;
    const sxx = pts.reduce((s, p) => s + (p.x - fit.mx) ** 2, 0);
    const yhat = fit.intercept + fit.slope * x0;
    const margin = fit.tc * fit.residSd * Math.sqrt(1 + 1 / n + ((x0 - fit.mx) ** 2) / sxx);
    forecast = { days: 7, date: addDays(last.date, 7), val: yhat, lo: yhat - margin, hi: yhat + margin };
  }

  /* 当前目标体重：从 data\目标.json 读（可随时改），不是写死的 */
  const GOAL = readGoalFile().goal;
  const goalFile = readGoalFile();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysToHoliday = Math.ceil((parseYmd(CONFIG.holiday) - today) / 86400000);
  const gap = last.w - GOAL;
  const needPerDay = daysToHoliday > 0 ? gap / daysToHoliday : 0;
  const needPerWeek = needPerDay * 7;

  /* --- 到目标：三种预测互相参照 ---
     线性的问题：每掉 1kg，TDEE 会降约 20~25 kcal，速度必然越来越慢。
     所以直线外推一定乐观。用指数衰减模型修正：
       u(t) = (A/k)(1 - exp(-k t / 7700))     A = TDEE - 摄入, k = 每公斤降的 kcal
     时间常数 tau = 7700/k 天。k=22 时 tau≈350 天，94 天只衰减到 88%。 */
  const K_ADAPT = 22;                  // 每掉 1kg，TDEE 降 22 kcal
  const TAU = CONFIG.fatKcalPerKg / K_ADAPT;

  /* 衰减模型的解析解：给定初始速率 r0（斤/周），t 天后的平均速率 */
  function rateAvgDecay(r0, t) {
    if (t <= 0) return r0;
    return r0 * (TAU / t) * (1 - Math.exp(-t / TAU));
  }
  /* 用当前速度当"瞬时"速率，反推 t 天能掉多少 */
  function lostDecay(r0, t) { return rateAvgDecay(r0, t) * t / 7; }

  let goalEta = null, forecastLong = null;
  const r0 = ho && ho.trend < -0.01 ? -ho.trend * 7 : null;   // 斤/周（正数=降）
  if (r0) {
    /* 线性 */
    const linDays = Math.ceil((ho.level - GOAL) / (-ho.trend));
    /* 衰减：解 w_eq + (W0-w_eq)exp(-t/tau) 形式不便，改用数值迭代 */
    let wt = ho.level, d = 0, rate = r0;
    const dt = 0.5;
    while (d < 1500 && wt > GOAL) {
      wt -= rate * dt / 7;
      rate = r0 * Math.exp(-d / TAU);       // 速率指数衰减
      d += dt;
    }
    const decDays = d >= 1500 ? null : Math.ceil(d);
    goalEta = {
      linear: { days: linDays < 2000 ? linDays : null,
                date: linDays < 2000 ? addDays(last.date, linDays) : null },
      decay: decDays ? { days: decDays, date: addDays(last.date, decDays) } : null,
      tau: Math.round(TAU),
      kAdapt: K_ADAPT,
      r0: +r0.toFixed(2),
      /* 到目标日的预测（带区间） */
      forecastHoliday: null
    };

    /* 到目标日的预测 + 区间：用 AR(1) 修正后的速率区间推 */
    if (fit && daysToHoliday > 0) {
      const t = daysToHoliday;
      const loRate = Math.abs(fit.ciLoAR * 7);   // 慢端
      const hiRate = Math.abs(fit.ciHiAR * 7);   // 快端
      forecastLong = {
        days: t,
        byDecay: {
          slow: +(last.w - lostDecay(loRate, t)).toFixed(1),
          mid: +(last.w - lostDecay(r0, t)).toFixed(1),
          fast: +(last.w - lostDecay(hiRate, t)).toFixed(1)
        },
        byLinear: {
          slow: +(last.w - loRate * t / 7).toFixed(1),
          mid: +(last.w - r0 * t / 7).toFixed(1),
          fast: +(last.w - hiRate * t / 7).toFixed(1)
        },
        hitGoal: (last.w - lostDecay(r0, t)) <= GOAL
      };
    }
  }


  /* --- 摄入 --- */
  const dates = Object.keys(intake).sort();
  /* 近 7 天均值只取【已过完的完整日】：
     (a) complete=0 的那天只有部分餐次，算进去会把均值拉低
     (b) 今天还没吃完，算进去会把均值拉低一大截 —— 所以排除"今天" */
  const todayKey = ymd(new Date());
  const fullDays = dates.filter(d => d !== todayKey && intake[d].complete === 1);
  const refDays = fullDays.length ? fullDays : dates.filter(d => d !== todayKey);
  const last7 = (refDays.length ? refDays : dates).slice(-7).map(d => intake[d]);
  const avgKcal = last7.length ? Math.round(mean(last7.map(x => x.kcal))) : 0;
  const avgProt = last7.length ? Math.round(mean(last7.map(x => x.prot))) : 0;
  const naDates = dates.filter(d => intake[d].na > 0);

  /* --- TDEE：三种口径 ---
     1) 滚动窗口（主口径）：只看最近 14 天，不再被三周前的旧数据拖着
     2) EWMA 版（最灵敏）：代谢适应能自己跟上
     3) 全历史配对中位（交叉验证）：留着对比，不当主口径 */
  let tdee = null, tdeePair = null;

  /* (1) 滚动窗口 */
  const win = w.slice(Math.max(0, w.length - CONFIG.tdeeWindow));
  if (win.length >= CONFIG.tdeeWindowMin) {
    let sum = 0, cnt = 0;
    for (let k = 0; k < win.length - 1; k++) {
      const key = addDays(win[k].date, win[k + 1].day - win[k].day);
      if (intake[key]) { sum += intake[key].kcal; cnt++; }
    }
    if (cnt >= 5) {
      const avgIn = sum / cnt;
      const dd = win[win.length - 1].day - win[0].day;
      const kgLost = (win[0].w - win[win.length - 1].w) * 0.5;
      const deficit = kgLost * CONFIG.fatKcalPerKg / dd;
      tdee = {
        value: Math.round(avgIn + deficit),
        avgIntake: Math.round(avgIn),
        lossKg: +kgLost.toFixed(2),
        days: dd,
        deficit: Math.round(deficit),
        window: win.length,
        /* 【诚实】前 3 周水分占大头，缺口被高估 -> TDEE 被高估，所以满 21 天前不给数值 */
        reliable: last.day >= CONFIG.minDaysForTdee,
        requiredDay: CONFIG.minDaysForTdee,
        waterInflated: true
      };
    }
  }

  /* (2) EWMA 版：逐日递推 */
  let ewmaTdee = null;
  {
    const ds = w.map(r => r.date);
    let est = null, prevDay = null;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (!intake[d]) continue;
      const prev = i > 0 ? w[i - 1] : null;
      if (!prev) { prevDay = d; continue; }
      const dd = w[i].day - prev.day;
      if (dd <= 0) continue;
      /* 当天的"摄入 - 体重变化×7700" = 当天 TDEE 的无偏估计 */
      const daily = intake[d].kcal - (w[i].w - prev.w) * 0.5 * CONFIG.fatKcalPerKg / dd;
      est = est === null ? daily
        : CONFIG.ewmaAlpha * daily + (1 - CONFIG.ewmaAlpha) * est;
    }
    if (est !== null) {
      ewmaTdee = {
        value: Math.round(est),
        alpha: CONFIG.ewmaAlpha,
        reliable: last.day >= CONFIG.minDaysForTdee
      };
    }
  }

  /* (3) 全历史配对中位（交叉验证，保留但降级） */
  const est2 = [];
  for (let i = 0; i < w.length; i++)
    for (let j = i + 1; j < w.length; j++) {
      const dd = w[j].day - w[i].day;
      if (dd < CONFIG.tdeeMinPairDays) continue;
      let sum = 0, cnt = 0;
      for (let k = i; k < j; k++) {
        const key = addDays(w[i].date, w[k + 1].day - w[i].day);
        if (intake[key]) { sum += intake[key].kcal; cnt++; }
      }
      if (cnt < 5) continue;
      est2.push(sum / cnt - (w[j].w - w[i].w) * 0.5 * CONFIG.fatKcalPerKg / dd);
    }
  if (est2.length >= 4) {
    const so = est2.slice().sort((a, b) => a - b), m = so.length;
    tdeePair = {
      value: Math.round(median(so)),
      lo: Math.round(so[Math.floor(m * 0.25)]),
      hi: Math.round(so[Math.floor(m * 0.75)]),
      pairs: m
    };
  }
  /* 兼容旧字段：把滚动窗口结果同时放进 tdee.lo/hi */
  if (tdee && tdeePair) { tdee.lo = tdeePair.lo; tdee.hi = tdeePair.hi; tdee.pairs = tdeePair.pairs; }

  /* --- 按去脂体重算蛋白目标（比按总体重更合理） --- */
  const wkgNow = last.w / 2;
  const lbmLo = wkgNow * (1 - CONFIG.bodyFatHi);   // 体脂高 -> 去脂体重低
  const lbmHi = wkgNow * (1 - CONFIG.bodyFatLo);
  const protTarget = {
    kg: +wkgNow.toFixed(2),
    lbmLo: +lbmLo.toFixed(1), lbmHi: +lbmHi.toFixed(1),
    lo: Math.round(lbmLo * CONFIG.protPerKgLo),
    hi: Math.round(lbmHi * CONFIG.protPerKgHi),
    hardFloor: CONFIG.protHardFloor,
    perKgBody: +(avgProt / wkgNow).toFixed(2),
    perKgLbm: +(avgProt / ((lbmLo + lbmHi) / 2)).toFixed(2)
  };

  /* --- 油量模型 + 与公式交叉验证 --- */
  const oil = oilModel(intake, readLegRows(), w);
  let crossCheck = null;
  if (oil && fit) {
    const deficitPerDay = -fit.slope * 0.5 * CONFIG.fatKcalPerKg;   // 斤/天 → kcal/天
    const wkg = last.w / 2;
    const F = CONFIG.formula;
    const bmr = 10 * wkg + 6.25 * F.hCm - 5 * F.age + (PROFILE.sex === 'female' ? -161 : 5);
    const base = Math.round(mean(w.slice(Math.max(0, n - 10)).map(r => intake[r.date] ? intake[r.date].kcal : 0)));
    crossCheck = {
      deficitPerDay: Math.round(deficitPerDay),
      waterInflated: true,
      baseKcal: base,
      byOil: oil.scenarios.map(sc => ({
        g: sc.g, label: sc.label,
        netIntake: base + sc.perDay,
        tdee: Math.round(base + sc.perDay + deficitPerDay),
        inFormulaRange: (base + sc.perDay + deficitPerDay) >= bmr * F.actLo - 60
                     && (base + sc.perDay + deficitPerDay) <= bmr * F.actHi + 60
      })),
      formula: { bmr: Math.round(bmr),
        lo: Math.round(bmr * F.actLo), hi: Math.round(bmr * F.actHi),
        actLo: F.actLo, actHi: F.actHi },
      /* 【第三优先】活动系数从"假设"变成"估计"：数据TDEE / BMR */
      activity: (function () {
        const cands = [];
        if (tdee && tdee.value) cands.push({ name: '滚动窗口', val: tdee.value });
        if (tdeePair) cands.push({ name: '配对中位', val: tdeePair.value });
        if (ewmaTdee) cands.push({ name: 'EWMA', val: ewmaTdee.value });
        return cands.map(c => ({
          name: c.name, tdee: c.val,
          factor: +(c.val / bmr).toFixed(2),
          /* 系数明显 <1 说明 TDEE 被低估（记录偏高/水分），>2 说明记录偏低 */
          plausible: c.val / bmr >= 1.0 && c.val / bmr <= 2.2
        }));
      })()
    };
  }

  /* --- 腰围趋势（独立于体重的第二条证据线） ---
     腰围对内脏脂肪敏感，且是"体积"指标：体重不动但腰围在掉 = 体成分在改善。
     经验参考：男性体重每掉 1 斤，腰围掉 0.25~0.35 cm 属正常。 */
  const waist = readWaist();
  let waistStat = null;
  if (waist.length) {
    const w0 = waist[0], wN = waist[waist.length - 1];
    const wDays = Math.max(1, Math.round((parseYmd(wN.date) - parseYmd(w0.date)) / 86400000));
    const wDelta = wN.cm - w0.cm;
    /* 与腰围同日的体重：取当天或之前最近的一个点 */
    function wtAt(dstr) {
      let hit = null;
      for (const r of w) if (r.date <= dstr) hit = r;
      if (!hit) hit = w[0];
      return hit ? hit.w : null;
    }
    const a = wtAt(w0.date), c = wtAt(wN.date);
    const dJin = (a !== null && c !== null) ? (a - c) : null;
    waistStat = {
      n: waist.length, first: w0, last: wN,
      delta: +wDelta.toFixed(1),
      days: wDays,
      perWeek: +(wDelta / wDays * 7).toFixed(2),
      list: waist,
      weightDeltaJin: dJin === null ? null : +dJin.toFixed(1),
      cmPerJin: (dJin !== null && dJin > 0.5) ? +(Math.abs(wDelta) / dJin).toFixed(2) : null,
      trendReady: waist.length >= 2 && wDays >= 5
    };
    if (waistStat.cmPerJin !== null) {
      const r = waistStat.cmPerJin;
      waistStat.verdict = r >= 0.40 ? '很好·主要在掉内脏脂肪'
        : r >= 0.25 ? '正常'
        : r >= 0.15 ? '偏慢·注意别掉肌肉'
        : '偏慢·蛋白和力量训练跟上';
      /* 男性正常范围约 0.25~0.35 cm/斤。超过 0.8 基本不可能是真实的体成分变化，
         更可能是两次测量的条件不一样（时间/位置/松紧/是否空腹）。 */
      waistStat.ratioPlausible = r <= 0.8;
      if (r > 0.8) waistStat.verdict = '方向对·但比值偏高，两次量法可能不一致';
    }
  }

  return {
    first, last, n, days, skippedCount: skipped.length,
    skippedList: skipped.map(o => ({ date: o.r.date, day: o.r.day, w: o.r.w, note: o.r.note, reason: o.reason })),
    excludes: ex,
    fit, theilSen: ts, holt: ho, ewma: ew,
    methodRows, avg7, avgPrev7, rateRecent7, rateLast5, avg5,
    l5lo, l5hi, l5range: l5hi - l5lo,
    noise: +noise.toFixed(2), minDelta, minDeltaNaive,
    rho: fit ? +fit.rho.toFixed(3) : null,
    inflation: fit ? +fit.inflation.toFixed(3) : null,
    durbinWatson: dw === null ? null : +dw.toFixed(3),
    boot: boot,
    /* AR(1) 修正后的区间（主口径） */
    ciLoAR: fit ? fit.ciLoAR : null,
    ciHiAR: fit ? fit.ciHiAR : null,
    ciLoNaive: fit ? fit.ciLo : null,
    ciHiNaive: fit ? fit.ciHi : null,
    plateau: { days: seg5.length, range: +(l5hi - l5lo).toFixed(2), still: (l5hi - l5lo) < minDelta },
    forecast, goalEta, forecastLong, tdee, tdeePair, ewmaTdee, crossCheck, oil,
    daysToHoliday, gap, needPerDay, needPerWeek,
    avgKcal, avgProt, naDates, protTarget, waistStat,
    goal: GOAL, goalHistory: goalFile.history, goalBackup: goalFile.backup,
    totalDelta: last.w - CONFIG.startWeight,
    progress: Math.max(0, Math.min(1, (CONFIG.startWeight - last.w) / (CONFIG.startWeight - GOAL)))
  };
}

/* ---------------- 写数据 ---------------- */
function saveWeight(rows) {
  writeTable('weight.csv', ['date', 'day', 'weight', 'note'],
    rows.map(r => ({ date: r.date, day: r.day, weight: r.w.toFixed(1), note: r.note })));
}
function addWeight(dateStr, weightVal, note) {
  const w = readWeight();
  if (!w.length) throw new Error('weight.csv 为空');
  let d = dateStr && dateStr.trim() ? parseYmd(dateStr) : new Date();
  if (!d) throw new Error('日期格式应为 yyyy-mm-dd');
  d.setHours(0, 0, 0, 0);
  const val = parseFloat(weightVal);
  if (isNaN(val)) throw new Error('体重不是数字');
  if (val < 60 || val > 300) throw new Error('体重应在 60~300 斤之间');

  const dStr = ymd(d);
  const idx = w.findIndex(r => r.date === dStr);
  const row = { date: dStr, day: 0, w: val, note: note || '' };
  if (idx >= 0) w[idx] = row; else w.push(row);
  w.sort((a, b) => (a.date < b.date ? -1 : 1));
  renumber(w);
  saveWeight(w);
  return w.find(r => r.date === dStr);
}
function delWeight(dateStr) {
  const w = readWeight();
  const idx = w.findIndex(r => r.date === dateStr);
  if (idx < 0) throw new Error('没有 ' + dateStr + ' 这条记录');
  if (w.length <= 3) throw new Error('只剩不到 3 条记录，已拒绝删除');
  w.splice(idx, 1);
  renumber(w);
  saveWeight(w);
  return dateStr;
}
/* 设置油量档位（写入 intake.csv 的 oil_g 列）
   date = '*'  -> 全部历史统一设成这一档（推荐：固定偏移，趋势不受影响）
   date = 具体日期 -> 只改那天的档位（那天油特别多/特别少时用） */
function setOil(dateStr, grams) {
  const header = ['date', 'day', 'meal', 'summary', 'kcal', 'p', 'high_na', 'complete', 'certainty', 'oil_g'];
  const rows = readTable('intake.csv');
  if (!rows.length) throw new Error('intake.csv 为空');
  const allowed = CONFIG.oilGPerLeg;
  let g = parseFloat(grams);
  if (isNaN(g)) throw new Error('档位不是数字');
  if (allowed.indexOf(g) < 0) throw new Error('档位只能是 ' + allowed.join(' / ') + ' 克');
  const all = (dateStr === '*');
  let touched = 0, legsRows = 0;
  for (const r of rows) {
    if (all || r.date === dateStr) {
      r.oil_g = g;
      touched++;
      if (/鸡腿/.test(r.summary || '')) legsRows++;
    } else if (r.oil_g === undefined || r.oil_g === '') r.oil_g = 1 * 5;
  }
  if (!touched) throw new Error('没有 ' + dateStr + ' 这天的饮食记录');
  if (!legsRows) throw new Error('这两天没有鸡腿记录，改档位没意义');
  /* 改历史之前先备份 —— 这条路径会覆盖已过去的事实，必须留后路 */
  let backup = null;
  if (all) {
    try {
      const src = path.join(DATA, 'intake.csv');
      backup = path.join(DATA, 'intake.csv.bak-' + ymd(new Date()));
      fs.copyFileSync(src, backup);
    } catch (e) { backup = null; }
  }
  writeTable('intake.csv', header, rows);
  return { date: dateStr, oil_g: g, touched: touched, legsRows: legsRows, backup: backup };
}

function buildState() {
  const weight = readWeight();
  const intake = readIntake();
  const goalFile = readGoalFile();
  return {
    config: Object.assign({}, CONFIG, { goal: goalFile.goal }),
    goalHistory: goalFile.history, goalBackup: goalFile.backup,
    weight: weight, intake: intake,
    training: readTraining(), sleep: readSleep(), waist: readWaist(),
    stats: computeStats(weight, intake)
  };
}

/* 可选钩子：如果项目里放了 tools/track.ps1，就顺手刷新一份纯文本报告。
   开源版默认没有这个脚本，直接跳过。 */
function refreshReport() {
  const script = path.join(ROOT, 'tools', 'track.ps1');
  if (!fs.existsSync(script)) return;
  try {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { detached: true, stdio: 'ignore', windowsHide: true });
    ps.unref();
  } catch (e) { /* 忽略 */ }
}

/* ---------------- HTTP ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml' };

function sendJSON(res, obj, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body || '{}'); } catch (e) { return cb(new Error('请求不是合法 JSON')); }
    cb(null, j);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  try {
    /* 版本指纹：启动器用它判断跑着的进程是不是当前这份代码 */
    if (p === '/api/version') return sendJSON(res, {
      ok: true, pid: process.pid, server: SERVER_HASH, startedAt: STARTED_AT
    });

    if (p === '/api/state') return sendJSON(res, buildState());

    if (p === '/api/weight' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const row = addWeight(j.date, j.weight, j.note);
          refreshReport();
          return sendJSON(res, { ok: true, row: row, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    if (p === '/api/delete' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const d = delWeight(j.date);
          return sendJSON(res, { ok: true, deleted: d, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    if (p === '/api/exclude' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const list = readExcludes();
          const i = list.findIndex(x => x.date === j.date);
          if (j.on) {
            if (i < 0) list.push({ date: j.date, reason: j.reason || '手动标记为不可信' });
            else list[i].reason = j.reason || list[i].reason;
          } else if (i >= 0) list.splice(i, 1);
          list.sort((a, b) => (a.date < b.date ? -1 : 1));
          writeExcludes(list);
          return sendJSON(res, { ok: true, excludes: list, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    if (p === '/api/oil' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const r = setOil(j.date, j.grams);
          return sendJSON(res, { ok: true, oil: r, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    if (p === '/api/goal' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const r = setGoal(j.goal, j.note);
          refreshReport();
          return sendJSON(res, { ok: true, goal: r, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    if (p === '/api/waist' && req.method === 'POST') {
      return readBody(req, (err, j) => {
        if (err) return sendJSON(res, { ok: false, error: err.message }, 400);
        try {
          const r = saveWaist(j.date, j.cm, j.note);
          refreshReport();
          return sendJSON(res, { ok: true, waist: r, state: buildState() });
        } catch (e) { return sendJSON(res, { ok: false, error: e.message }, 400); }
      });
    }

    let file = p === '/' ? '/index.html' : p;
    file = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + e.message);
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') { console.error('PORT_IN_USE ' + PORT); process.exit(2); }
  console.error(err); process.exit(1);
});
/* 被 require（自检脚本）时只导出函数，不起服务 */
if (require.main === module) {
  try { fs.writeFileSync(path.join(APP, '.pid'), String(process.pid), 'utf8'); } catch (e) { }
  server.listen(PORT, '127.0.0.1', () => console.log('LISTENING http://127.0.0.1:' + PORT + '  (pid ' + process.pid + ')'));
} else {
  module.exports = {
    ols, theilSen, holt, ewmaLast, ar1Rho, ar1Inflation, withAR1,
    durbinWatson, blockBootstrapSlope, median, mean, tCrit,
    computeStats, oilModel, readWeight, readIntake, readLegRows, readWaist, saveWaist,
    readGoalFile, setGoal,
    CONFIG, RHO_FLOOR, RHO_CAP, addDays, parseYmd, ymd
  };
}

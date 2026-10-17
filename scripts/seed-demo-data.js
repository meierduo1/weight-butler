#!/usr/bin/env node
'use strict';
/* ============================================================
   生成一份完全合成的示例数据（不是真人数据）
   用法:
     node scripts/seed-demo-data.js --force
   会覆盖 data/ 下的 CSV / 目标.json / 排除.json / profile.json
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FORCE = process.argv.includes('--force');

function q(v) {
  v = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function csv(header, rows) {
  return [header.join(',')].concat(rows.map(r => r.map(q).join(','))).join('\r\n') + '\r\n';
}
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function addDays(date, k) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + k);
  return d;
}

/* 固定种子的伪随机，保证每次生成的数据一样 */
let seed = 20261017;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function gauss() {
  /* Box–Muller，截到 ±2.2，避免离谱的假数据 */
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.max(-2.2, Math.min(2.2, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
}

if (!FORCE) {
  console.error('这会覆盖 data/ 下的数据。确认后加 --force 再运行。');
  process.exit(1);
}
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const PROFILE = {
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
fs.writeFileSync(path.join(DATA, 'profile.json'), JSON.stringify(PROFILE, null, 2) + '\n', 'utf8');

const START = new Date(2026, 8, 3);       // 2026-09-03
const DAYS = 45;                          // day 0 .. 44
const EXCLUDE_DAY = 17;                   // 2026-09-20 示例不可信点

/* ---- weight.csv ---- */
const weightRows = [];
for (let d = 0; d < DAYS; d++) {
  const date = ymd(addDays(START, d));
  let w;
  if (d === 0) {
    w = 182.0;                            // 第 0 天晚上裸重，拟合时会被排除
  } else {
    w = 181.0 - 0.115 * d + gauss() * 0.42;
    if (d === EXCLUDE_DAY) w -= 2.1;      // 孤立低点，演示“排除不可信数据”
    w = Math.round(w * 10) / 10;
  }
  const notes = ['晨起空腹', '昨晚吃得偏咸', '训练后', '周末', '外食', '睡得一般', '正常记录'];
  const note = d === 0 ? '示例：第 0 天晚上称重，拟合时排除'
    : d === EXCLUDE_DAY ? '示例：当天记录不完整（已排除）'
    : notes[d % notes.length];
  weightRows.push({ date, day: d, w, note });
}

/* ---- intake.csv ---- */
const intakeRows = [];
const foods = {
  breakfast: ['燕麦+牛奶+鸡蛋', '全麦面包+鸡蛋+豆浆', '包子+无糖豆浆', '酸奶+香蕉+坚果'],
  lunch: ['鸡腿x2+米饭+青菜', '牛肉面+凉拌菜', '食堂套餐+紫菜汤', '鸡腿x2+糙米饭+西兰花', '鱼香肉丝+米饭'],
  dinner: ['鸡腿x2+米饭+青菜', '虾仁炒饭+青菜', '鸡腿x2+红薯+西兰花', '番茄牛腩+米饭', '豆腐+青菜+米饭']
};
for (let d = 1; d < DAYS; d++) {
  const date = ymd(addDays(START, d));
  const highNa = (d % 7 === 3) ? 1 : 0;
  const complete = (d === 28) ? 0 : 1;
  const bKcal = 360 + Math.round(rnd() * 140);
  const lKcal = 680 + Math.round(rnd() * 180);
  const dKcal = 650 + Math.round(rnd() * 190);
  const bProt = 16 + Math.round(rnd() * 10);
  const lProt = 30 + Math.round(rnd() * 16);
  const dProt = 32 + Math.round(rnd() * 14);
  const lMain = foods.lunch[d % foods.lunch.length];
  const dMain = foods.dinner[(d + 2) % foods.dinner.length];
  const legsL = /鸡腿x2/.test(lMain) ? 2 : 0;
  const legsD = /鸡腿x2/.test(dMain) ? 2 : 0;
  const oil = 5;

  intakeRows.push({ date, day: d, meal: '早餐', summary: foods.breakfast[d % foods.breakfast.length], kcal: bKcal, p: bProt, na: 0, complete, certainty: 1, oil: '' });
  intakeRows.push({ date, day: d, meal: '午餐', summary: lMain, kcal: lKcal, p: lProt, na: highNa, complete, certainty: 1, oil: legsL ? oil : '' });
  intakeRows.push({ date, day: d, meal: '晚餐', summary: dMain, kcal: dKcal, p: dProt, na: 0, complete, certainty: 1, oil: legsD ? oil : '' });
  if (d % 5 === 0) {
    intakeRows.push({ date, day: d, meal: '加餐', summary: '水果+无糖酸奶', kcal: 180, p: 8, na: 0, complete, certainty: 1, oil: '' });
  }
}

/* ---- waist.csv ---- */
const waistRows = [
  { date: '2026-09-05', cm: 104.0, note: '示例：晨起空腹' },
  { date: '2026-09-26', cm: 102.5, note: '示例：同一位置' },
  { date: '2026-10-16', cm: 101.0, note: '示例：晨起空腹' }
];

/* ---- sleep.csv / training.csv（界面暂不展示，保留数据格式示例） ---- */
const sleepRows = [];
for (let d = 1; d < DAYS; d += 1) {
  const date = ymd(addDays(START, d));
  const bedH = 23 + (d % 2) * 0.5;
  const bed = String(Math.floor(bedH)).padStart(2, '0') + ':' + (bedH % 1 ? '30' : '00');
  const wake = (d % 3 === 0) ? '07:10' : '07:30';
  sleepRows.push({ date, period: '在校', bed, wake, hours: 8.0, note: '示例数据' });
}
const trainingRows = [];
for (let d = 1; d < DAYS; d += 2) {
  const date = ymd(addDays(START, d));
  trainingRows.push({ date, type: d % 3 === 0 ? '力量' : '步行', detail: d % 3 === 0 ? '上肢 + 核心' : '日常约 8000 步', minutes: d % 3 === 0 ? 40 : '', kcal: d % 3 === 0 ? 220 : '', note: '示例数据' });
}

/* ---- 写盘 ---- */
fs.writeFileSync(path.join(DATA, 'weight.csv'),
  csv(['date', 'day', 'weight', 'note'], weightRows.map(r => [r.date, r.day, r.w.toFixed(1), r.note])), 'utf8');

fs.writeFileSync(path.join(DATA, 'intake.csv'),
  csv(['date', 'day', 'meal', 'summary', 'kcal', 'p', 'high_na', 'complete', 'certainty', 'oil_g'],
    intakeRows.map(r => [r.date, r.day, r.meal, r.summary, r.kcal, r.p, r.na, r.complete, r.certainty, r.oil])), 'utf8');

fs.writeFileSync(path.join(DATA, 'waist.csv'),
  csv(['date', 'cm', 'note'], waistRows.map(r => [r.date, r.cm, r.note])), 'utf8');

fs.writeFileSync(path.join(DATA, 'sleep.csv'),
  csv(['date', 'period', 'bed', 'wake', 'hours', 'note'], sleepRows.map(r => [r.date, r.period, r.bed, r.wake, r.hours, r.note])), 'utf8');

fs.writeFileSync(path.join(DATA, 'training.csv'),
  csv(['date', 'type', 'detail', 'minutes', 'kcal', 'note'], trainingRows.map(r => [r.date, r.type, r.detail, r.minutes, r.kcal, r.note])), 'utf8');

fs.writeFileSync(path.join(DATA, '目标.json'), JSON.stringify({
  goal: PROFILE.goal,
  history: [],
  backup: PROFILE.goal
}, null, 2) + '\n', 'utf8');

fs.writeFileSync(path.join(DATA, '排除.json'), JSON.stringify([
  { date: ymd(addDays(START, EXCLUDE_DAY)), reason: '示例：当天记录不完整，次日出现孤立低点，标记为不可信' }
], null, 2) + '\n', 'utf8');

console.log('示例数据已写入 ' + DATA);
console.log('  weight.csv   ' + weightRows.length + ' 行');
console.log('  intake.csv   ' + intakeRows.length + ' 行');
console.log('  waist.csv    ' + waistRows.length + ' 行');
console.log('  sleep.csv    ' + sleepRows.length + ' 行');
console.log('  training.csv ' + trainingRows.length + ' 行');

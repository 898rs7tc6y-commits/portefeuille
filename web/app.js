'use strict';

/* ==========================================================================
   Portefeuille — suivi de patrimoine, dépenses hebdo et projets.
   Toutes les données restent sur l'appareil (localStorage).
   ========================================================================== */

const STORAGE_KEY = 'portefeuille.v1';

const ACCOUNT_TYPES = {
  courant:   { label: 'Compte courant',   emoji: '🏦', color: 'var(--c1)', invest: false },
  epargne:   { label: 'Épargne / Livret', emoji: '🐖', color: 'var(--c2)', invest: false },
  pea:       { label: 'PEA',              emoji: '📈', color: 'var(--c3)', invest: true  },
  cto:       { label: 'Actions / CTO',    emoji: '💹', color: 'var(--c4)', invest: true  },
  av:        { label: 'Assurance-vie',    emoji: '🛡️', color: 'var(--c5)', invest: true  },
  crypto:    { label: 'Crypto',           emoji: '🪙', color: 'var(--c6)', invest: true  },
  autre:     { label: 'Autre',            emoji: '💼', color: 'var(--c7)', invest: false },
};

const EXPENSE_CATEGORIES = {
  courses:    { label: 'Courses',     emoji: '🛒', color: 'var(--c1)' },
  restaurant: { label: 'Restaurants', emoji: '🍽️', color: 'var(--c3)' },
  transport:  { label: 'Transport',   emoji: '🚇', color: 'var(--c2)' },
  logement:   { label: 'Logement',    emoji: '🏠', color: 'var(--c4)' },
  loisirs:    { label: 'Loisirs',     emoji: '🎉', color: 'var(--c5)' },
  shopping:   { label: 'Shopping',    emoji: '🛍️', color: 'var(--c6)' },
  sante:      { label: 'Santé',       emoji: '💊', color: 'var(--c2)' },
  abonnements:{ label: 'Abonnements', emoji: '🔁', color: 'var(--c4)' },
  autre:      { label: 'Autre',       emoji: '🧾', color: 'var(--c7)' },
};

const GOAL_EMOJIS = ['🏠', '🚗', '✈️', '🎓', '💍', '👶', '🛟', '🏖️', '💻', '🎯'];

/* ---------- Utilitaires ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

const fmtEUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtEUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const money = (n, compact = false) => `<span class="money">${(compact ? fmtEUR0 : fmtEUR).format(n)}</span>`;
const signedMoney = (n) => `<span class="money">${n > 0 ? '+' : ''}${fmtEUR.format(n)}</span>`;

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const today = () => isoDate(new Date());

/** Lundi de la semaine contenant `d`. */
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoWeekNumber(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}
const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/* ---------- État & persistance ---------- */

function defaultState() {
  return {
    version: 1,
    accounts: [],
    expenses: [],
    goals: [],
    history: [],
    settings: { weeklyBudget: 250, hideAmounts: false },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return { ...defaultState(), ...s, settings: { ...defaultState().settings, ...(s.settings || {}) } };
  } catch (e) {
    console.error('Lecture impossible', e);
    return defaultState();
  }
}

let state = loadState();

function save() {
  snapshotNetWorth();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('⚠️ Sauvegarde impossible sur cet appareil');
  }
}

/** Enregistre un point d'historique du patrimoine (1 par jour). */
function snapshotNetWorth() {
  const t = today();
  const total = round2(netWorth());
  const last = state.history[state.history.length - 1];
  if (last && last.date === t) last.total = total;
  else if (state.accounts.length) state.history.push({ date: t, total });
  if (state.history.length > 1500) state.history = state.history.slice(-1500);
}

/* ---------- Calculs ---------- */

function positionsValue(acc) {
  return (acc.positions || []).reduce((s, p) => s + num(p.qty) * num(p.price), 0);
}
function positionsCost(acc) {
  return (acc.positions || []).reduce((s, p) => s + num(p.qty) * num(p.pru), 0);
}
function accountValue(acc) { return num(acc.cash) + positionsValue(acc); }
function netWorth() { return state.accounts.reduce((s, a) => s + accountValue(a), 0); }

function allocationByType() {
  const map = {};
  for (const a of state.accounts) map[a.type] = (map[a.type] || 0) + accountValue(a);
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .map(([type, value]) => ({ key: type, label: ACCOUNT_TYPES[type]?.label || type, color: ACCOUNT_TYPES[type]?.color || 'var(--c7)', value }))
    .sort((a, b) => b.value - a.value);
}

function expensesInRange(from, toExcl) {
  const a = isoDate(from), b = isoDate(toExcl);
  return state.expenses.filter((e) => e.date >= a && e.date < b);
}
function weekTotal(start) {
  return expensesInRange(start, addDays(start, 7)).reduce((s, e) => s + num(e.amount), 0);
}

function historyDelta(days) {
  if (state.history.length < 2) return null;
  const cutoff = isoDate(addDays(new Date(), -days));
  const past = [...state.history].reverse().find((h) => h.date <= cutoff) || state.history[0];
  const now = netWorth();
  if (!past || past.date === today()) return null;
  return { abs: now - past.total, pct: past.total ? (now - past.total) / Math.abs(past.total) : 0, since: past.date };
}

function goalStats(g) {
  const saved = goalSaved(g);
  const target = num(g.target);
  const remaining = Math.max(0, target - saved);
  const pct = target > 0 ? Math.min(1, saved / target) : 0;
  let monthly = null, monthsLeft = null;
  if (g.deadline) {
    const end = parseISO(g.deadline + '-01');
    monthsLeft = Math.max(0, monthsBetween(new Date(), end));
    monthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
  }
  return { saved, target, remaining, pct, monthly, monthsLeft };
}
function goalSaved(g) {
  if (g.accountId) {
    const acc = state.accounts.find((a) => a.id === g.accountId);
    if (acc) return accountValue(acc);
  }
  return num(g.saved);
}

/* ---------- Graphiques SVG ---------- */

function donutSVG(items, size = 140) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = size / 2 - 10, c = 2 * Math.PI * r, cx = size / 2;
  if (!total) {
    return `<svg class="chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--line)" stroke-width="18"/></svg>`;
  }
  let offset = 0;
  const gap = items.length > 1 ? 2 : 0;
  const arcs = items.map((i) => {
    const len = (i.value / total) * c;
    const seg = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${i.color}" stroke-width="18"
      stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cx})"/>`;
    offset += len;
    return seg;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Répartition">${arcs}</svg>`;
}

function lineSVG(points, { height = 150 } = {}) {
  const W = 320, H = height, padL = 4, padR = 4, padT = 10, padB = 20;
  if (points.length < 2) {
    return `<div class="empty" style="padding:18px 0"><p>La courbe apparaîtra dès que vous aurez mis à jour vos comptes sur plusieurs jours.</p></div>`;
  }
  const xs = points.map((p) => parseISO(p.date).getTime());
  const ys = points.map((p) => p.total);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const yPad = (y1 - y0) * 0.1; y0 -= yPad; y1 += yPad;
  const X = (t) => padL + ((t - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - y0) / (y1 - y0)) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.total).toFixed(1)}`).join(' ');
  const area = `${d} L${X(x1).toFixed(1)},${H - padB} L${X(x0).toFixed(1)},${H - padB} Z`;
  const up = ys[ys.length - 1] >= ys[0];
  const col = up ? 'var(--pos)' : 'var(--neg)';
  const lastX = X(x1), lastY = Y(ys[ys.length - 1]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="Évolution du patrimoine">
    <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
    <path d="${area}" fill="url(#lg)"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${col}"/>
    <text x="${padL}" y="${H - 4}">${esc(fmtShort.format(new Date(x0)))}</text>
    <text x="${W - padR}" y="${H - 4}" text-anchor="end">${esc(fmtShort.format(new Date(x1)))}</text>
  </svg>`;
}

function barsSVG(bars, { budget = 0, height = 150, selected = -1 } = {}) {
  const W = 320, H = height, padT = 14, padB = 20;
  const max = Math.max(budget, ...bars.map((b) => b.value), 1) * 1.08;
  const n = bars.length, slot = W / n, bw = Math.min(26, slot * 0.6);
  const Y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const rects = bars.map((b, i) => {
    const x = i * slot + (slot - bw) / 2, y = Y(b.value), h = H - padB - y;
    const over = budget && b.value > budget;
    const fill = over ? 'var(--neg)' : (i === selected ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 40%, transparent)');
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(0, h).toFixed(1)}" rx="5" fill="${fill}" data-bar="${i}"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(b.label)}</text>`;
  }).join('');
  const budgetLine = budget ? `<line x1="0" x2="${W}" y1="${Y(budget).toFixed(1)}" y2="${Y(budget).toFixed(1)}" stroke="var(--warn)" stroke-dasharray="4 4" stroke-width="1.5"/>
    <text x="${W}" y="${(Y(budget) - 4).toFixed(1)}" text-anchor="end" style="fill:var(--warn)">budget</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="Dépenses par semaine">
    <line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>${budgetLine}${rects}</svg>`;
}

function legendHTML(items, total) {
  return `<div class="legend">${items.map((i) => `
    <div class="legend-item"><span class="dot" style="background:${i.color}"></span>${esc(i.label)}
      <span class="val">${total ? fmtPct.format(i.value / total).replace('+', '') : ''}<strong>${money(i.value, true)}</strong></span></div>`).join('')}</div>`;
}

/* ---------- Navigation ---------- */

const TITLES = { home: 'Accueil', accounts: 'Comptes', expenses: 'Dépenses', goals: 'Projets' };
let currentTab = 'home';
let weekOffset = 0; // 0 = semaine en cours, -1 = précédente…

function go(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#page-title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.body.classList.toggle('private', !!state.settings.hideAmounts);
  $('#btn-privacy').classList.toggle('on', !!state.settings.hideAmounts);
  const view = $('#view');
  view.innerHTML = ({ home: viewHome, accounts: viewAccounts, expenses: viewExpenses, goals: viewGoals })[currentTab]();
}

/* ---------- Vue : Accueil ---------- */

function viewHome() {
  const total = netWorth();
  const alloc = allocationByType();
  const d30 = historyDelta(30);
  const ws = weekStart(new Date());
  const spent = weekTotal(ws);
  const budget = num(state.settings.weeklyBudget);
  const invested = state.accounts.filter((a) => ACCOUNT_TYPES[a.type]?.invest && (a.positions || []).length);
  const pv = invested.reduce((s, a) => s + positionsValue(a), 0);
  const pc = invested.reduce((s, a) => s + positionsCost(a), 0);

  const installTip = isIOS() && !isStandalone() ? `
    <div class="card install-tip"><p>📲 <strong>Installer l'app :</strong> touchez <strong>Partager</strong> <svg class="inline-icon" style="width:16px;height:16px;vertical-align:-3px" viewBox="0 0 24 24"><path d="M12 3v13M7 8l5-5 5 5M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/></svg> puis <strong>« Sur l'écran d'accueil »</strong>.</p></div>` : '';

  if (!state.accounts.length && !state.expenses.length && !state.goals.length) {
    return `${installTip}
      <div class="card empty">
        <div style="font-size:44px">👛</div>
        <h2 style="text-transform:none;letter-spacing:0;font-size:20px;color:var(--text);margin:8px 0">Bienvenue !</h2>
        <p>Ajoutez vos comptes bancaires, votre PEA, vos actions Revolut… pour voir tout votre patrimoine au même endroit.</p>
        <button class="btn" data-action="add-account">Ajouter un compte</button>
        <p style="margin-top:14px"><button class="btn secondary" data-action="demo">Essayer avec des données d'exemple</button></p>
      </div>`;
  }

  return `${installTip}
    <div class="card hero">
      <div class="label">Patrimoine total</div>
      <div class="big">${money(total)}</div>
      ${d30 ? `<div class="delta ${d30.abs >= 0 ? 'pos' : 'neg'}">${signedMoney(d30.abs)} (${fmtPct.format(d30.pct)}) <span class="muted" style="font-weight:400">depuis le ${esc(fmtShort.format(parseISO(d30.since)))}</span></div>` : '<div class="delta muted" style="font-weight:400">Mettez à jour vos soldes régulièrement pour suivre l\'évolution.</div>'}
      <div style="margin-top:12px">${lineSVG(state.history.slice(-180))}</div>
    </div>

    <div class="card">
      <h2>Répartition</h2>
      <div class="donut-wrap">${donutSVG(alloc)}${legendHTML(alloc, total)}</div>
    </div>

    ${invested.length ? `
    <div class="card">
      <h2>Investissements</h2>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div><div class="muted" style="font-size:13px">Valeur des titres</div><div class="v">${money(pv, true)}</div></div>
        <div><div class="muted" style="font-size:13px">Plus/moins-value</div>
          <div class="v ${pv - pc >= 0 ? 'pos' : 'neg'}">${signedMoney(round2(pv - pc))}</div>
          <div class="delta ${pv - pc >= 0 ? 'pos' : 'neg'}">${pc ? fmtPct.format((pv - pc) / pc) : ''}</div></div>
      </div>
    </div>` : ''}

    <div class="card tappable" data-goto="expenses" style="cursor:pointer">
      <h2>Dépenses de la semaine</h2>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <div class="v" style="font-size:24px;font-weight:700">${money(spent)}</div>
        <div class="muted">${budget ? `sur ${money(budget, true)}` : ''}</div>
      </div>
      ${budget ? `<div class="progress ${spent > budget ? 'over' : ''}"><div style="width:${Math.min(100, (spent / budget) * 100)}%"></div></div>
      <div class="muted" style="font-size:13px;margin-top:6px">${spent > budget ? `Budget dépassé de ${money(spent - budget)}` : `Reste ${money(budget - spent)} jusqu'à dimanche`}</div>` : ''}
    </div>

    ${state.goals.length ? `
    <div class="section-title"><h2>Projets</h2><button class="link" data-goto="goals">Tout voir</button></div>
    <div class="card">${state.goals.slice(0, 3).map(goalHTML).join('')}</div>` : ''}
  `;
}

/* ---------- Vue : Comptes ---------- */

function viewAccounts() {
  if (!state.accounts.length) {
    return `<div class="card empty"><div style="font-size:40px">🏦</div>
      <p>Aucun compte pour l'instant.<br>Banques, livrets, PEA, Revolut, crypto…</p>
      <button class="btn" data-action="add-account">Ajouter un compte</button></div>`;
  }
  const groups = {};
  for (const a of state.accounts) (groups[a.type] ||= []).push(a);
  const order = Object.keys(ACCOUNT_TYPES);
  const html = order.filter((t) => groups[t]).map((t) => {
    const list = groups[t];
    const sum = list.reduce((s, a) => s + accountValue(a), 0);
    return `<div class="section-title"><h2>${esc(ACCOUNT_TYPES[t].label)}</h2><span class="muted">${money(sum, true)}</span></div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">${list.map(accountRowHTML).join('')}</div>`;
  }).join('');
  return `<div class="card hero"><div class="label">Total des comptes</div><div class="big">${money(netWorth())}</div>
      <div class="muted" style="font-size:13px">Touchez un compte pour mettre à jour son solde.</div></div>
    ${html}<button class="fab" data-action="add-account" aria-label="Ajouter un compte">+</button>`;
}

function accountRowHTML(a) {
  const t = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.autre;
  const v = accountValue(a);
  let sub = esc(a.institution || t.label);
  let extra = '';
  if ((a.positions || []).length) {
    const pv = positionsValue(a), pc = positionsCost(a), g = pv - pc;
    sub += ` · ${a.positions.length} ligne${a.positions.length > 1 ? 's' : ''}`;
    if (pc) extra = `<div class="sub ${g >= 0 ? 'pos' : 'neg'}">${signedMoney(round2(g))} (${fmtPct.format(g / pc)})</div>`;
  }
  const upd = a.updatedAt ? `<div class="sub">maj ${esc(fmtShort.format(new Date(a.updatedAt)))}</div>` : '';
  return `<div class="row tappable" data-action="edit-account" data-id="${a.id}">
    <div class="badge">${t.emoji}</div>
    <div class="main"><div class="title">${esc(a.name)}</div><div class="sub">${sub}</div></div>
    <div class="amount">${money(v)}${extra || upd}</div></div>`;
}

/* ---------- Vue : Dépenses ---------- */

function viewExpenses() {
  const thisWeek = weekStart(new Date());
  const ws = addDays(thisWeek, weekOffset * 7);
  const we = addDays(ws, 7);
  const list = expensesInRange(ws, we).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const total = list.reduce((s, e) => s + num(e.amount), 0);
  const budget = num(state.settings.weeklyBudget);

  // 8 dernières semaines jusqu'à la semaine affichée
  const bars = [];
  for (let i = 7; i >= 0; i--) {
    const s = addDays(ws, -7 * i);
    bars.push({ label: `S${isoWeekNumber(s)}`, value: weekTotal(s) });
  }
  const avg = bars.slice(0, 7).reduce((s, b) => s + b.value, 0) / 7;

  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + num(e.amount);
  const cats = Object.entries(byCat).map(([k, v]) => ({
    key: k, value: v,
    label: `${EXPENSE_CATEGORIES[k]?.emoji || ''} ${EXPENSE_CATEGORIES[k]?.label || k}`,
    color: EXPENSE_CATEGORIES[k]?.color || 'var(--c7)',
  })).sort((a, b) => b.value - a.value);

  // regroupement par jour
  const days = {};
  for (const e of list) (days[e.date] ||= []).push(e);

  const label = weekOffset === 0 ? 'Cette semaine' : weekOffset === -1 ? 'Semaine dernière' : `Semaine ${isoWeekNumber(ws)}`;

  return `
    <div class="card">
      <div class="week-nav">
        <button data-action="week-prev" aria-label="Semaine précédente">‹</button>
        <div class="lbl">${label}<div class="sub">${esc(fmtShort.format(ws))} – ${esc(fmtShort.format(addDays(ws, 6)))}</div></div>
        <button data-action="week-next" aria-label="Semaine suivante" ${weekOffset >= 0 ? 'disabled' : ''}>›</button>
      </div>
      <div class="stats" style="margin:12px 0">
        <div><div class="muted" style="font-size:13px">Dépensé</div><div class="v">${money(total)}</div></div>
        <div><div class="muted" style="font-size:13px">${budget ? 'Budget restant' : 'Moyenne 7 sem.'}</div>
          <div class="v ${budget && total > budget ? 'neg' : ''}">${budget ? money(budget - total) : money(avg)}</div></div>
      </div>
      ${budget ? `<div class="progress ${total > budget ? 'over' : ''}"><div style="width:${Math.min(100, (total / budget) * 100)}%"></div></div>` : ''}
      <div style="margin-top:16px">${barsSVG(bars, { budget, selected: 7 })}</div>
      <div class="muted" style="font-size:13px;text-align:center">Moyenne des 7 semaines précédentes : ${money(avg)}</div>
    </div>

    ${cats.length ? `<div class="card"><h2>Par catégorie</h2>${cats.map((c) => `
      <div style="margin:10px 0">
        <div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:4px"><span>${esc(c.label)}</span><strong>${money(c.value)}</strong></div>
        <div class="progress"><div style="width:${(c.value / total) * 100}%;background:${c.color}"></div></div>
      </div>`).join('')}</div>` : ''}

    ${Object.keys(days).length ? Object.entries(days).map(([d, es]) => `
      <div class="section-title"><h2 style="font-size:16px;text-transform:capitalize">${esc(fmtDay.format(parseISO(d)))}</h2>
        <span class="muted">${money(es.reduce((s, e) => s + num(e.amount), 0))}</span></div>
      <div class="card" style="padding-top:4px;padding-bottom:4px">${es.map(expenseRowHTML).join('')}</div>`).join('')
      : `<div class="card empty"><p>Aucune dépense cette semaine.</p><button class="btn" data-action="add-expense">Ajouter une dépense</button></div>`}
    <button class="fab" data-action="add-expense" aria-label="Ajouter une dépense">+</button>`;
}

function expenseRowHTML(e) {
  const c = EXPENSE_CATEGORIES[e.category] || EXPENSE_CATEGORIES.autre;
  const acc = state.accounts.find((a) => a.id === e.accountId);
  return `<div class="row tappable" data-action="edit-expense" data-id="${e.id}">
    <div class="badge">${c.emoji}</div>
    <div class="main"><div class="title">${esc(e.note || c.label)}</div><div class="sub">${esc(c.label)}${acc ? ' · ' + esc(acc.name) : ''}</div></div>
    <div class="amount">${money(-num(e.amount))}</div></div>`;
}

/* ---------- Vue : Projets ---------- */

function viewGoals() {
  if (!state.goals.length) {
    return `<div class="card empty"><div style="font-size:40px">🎯</div>
      <p>Définissez vos projets : apport immobilier, voyage, voiture, épargne de précaution…</p>
      <button class="btn" data-action="add-goal">Créer un projet</button></div>`;
  }
  const totT = state.goals.reduce((s, g) => s + num(g.target), 0);
  const totS = state.goals.reduce((s, g) => s + Math.min(goalSaved(g), num(g.target)), 0);
  const monthly = state.goals.reduce((s, g) => s + (goalStats(g).monthly || 0), 0);
  return `
    <div class="card hero">
      <div class="label">Progression globale</div>
      <div class="big">${totT ? Math.round((totS / totT) * 100) : 0} %</div>
      <div class="progress" style="margin:6px 0 10px"><div style="width:${totT ? (totS / totT) * 100 : 0}%"></div></div>
      <div class="muted" style="font-size:14px">${money(totS, true)} sur ${money(totT, true)} · épargne nécessaire ≈ <strong style="color:var(--text)">${money(monthly, true)}/mois</strong></div>
    </div>
    <div class="card">${state.goals.map(goalHTML).join('')}</div>
    <button class="fab" data-action="add-goal" aria-label="Créer un projet">+</button>`;
}

function goalHTML(g) {
  const s = goalStats(g);
  const done = s.pct >= 1;
  let foot = '';
  if (done) foot = '<span class="pos">Objectif atteint 🎉</span>';
  else if (s.monthly != null) foot = s.monthsLeft > 0
    ? `${money(s.monthly, true)}/mois pendant ${s.monthsLeft} mois`
    : `<span class="neg">Échéance passée · reste ${money(s.remaining, true)}</span>`;
  else foot = `Reste ${money(s.remaining, true)}`;
  const deadline = g.deadline ? esc(fmtMonthYear.format(parseISO(g.deadline + '-01'))) : 'sans échéance';
  return `<div class="goal" data-action="edit-goal" data-id="${g.id}">
    <div class="head"><div><strong>${esc(g.emoji || '🎯')} ${esc(g.name)}</strong><div class="muted" style="font-size:13px">${deadline}${g.accountId ? ' · lié à un compte' : ''}</div></div>
      <div style="text-align:right"><strong>${money(s.saved, true)}</strong><div class="muted" style="font-size:13px">/ ${money(s.target, true)}</div></div></div>
    <div class="progress ${done ? 'done' : ''}"><div style="width:${s.pct * 100}%"></div></div>
    <div class="foot"><span>${Math.round(s.pct * 100)} %</span><span>${foot}</span></div></div>`;
}

/* ---------- Feuilles (formulaires) ---------- */

function openSheet(title, body, { onSubmit, onDelete, submitLabel = 'Enregistrer' } = {}) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><button type="button" data-close>Annuler</button><h3>${esc(title)}</h3>
      ${onSubmit ? `<button type="button" data-submit style="font-weight:600">OK</button>` : '<span style="width:50px"></span>'}</div>
    <form class="form" novalidate>${body}
      ${onSubmit ? `<button class="btn block" type="submit">${esc(submitLabel)}</button>` : ''}
      ${onDelete ? `<button class="btn danger block" type="button" data-delete>Supprimer</button>` : ''}
    </form>`;
  sheet.hidden = false; $('#sheet-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  const form = $('form', sheet);
  const submit = (ev) => { ev?.preventDefault(); if (onSubmit(new FormData(form), form) !== false) closeSheet(); };
  form.addEventListener('submit', submit);
  $('[data-submit]', sheet)?.addEventListener('click', submit);
  $('[data-close]', sheet).addEventListener('click', closeSheet);
  $('[data-delete]', sheet)?.addEventListener('click', () => {
    if (confirm('Supprimer définitivement ?')) { onDelete(); closeSheet(); }
  });
  return { sheet, form };
}
function closeSheet() {
  $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
}

function chipsHTML(name, options, selected) {
  return `<div class="chips" data-chips="${name}">${Object.entries(options).map(([k, o]) =>
    `<button type="button" class="chip ${k === selected ? 'on' : ''}" data-val="${k}">${o.emoji} ${esc(o.label)}</button>`).join('')}
    <input type="hidden" name="${name}" value="${esc(selected)}"></div>`;
}
function wireChips(root, onChange) {
  root.querySelectorAll('[data-chips]').forEach((wrap) => {
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      wrap.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      $('input[type=hidden]', wrap).value = b.dataset.val;
      onChange?.(b.dataset.val);
    });
  });
}

/* Compte */
function accountForm(acc) {
  const isNew = !acc;
  const a = acc ? structuredClone(acc) : { id: uid(), name: '', institution: '', type: 'courant', cash: 0, positions: [] };
  const posRow = (p) => `<div class="pos-edit" data-pid="${p.id}">
      <input class="name-in" name="p_name" placeholder="Nom / ticker (ex. CW8, AAPL)" value="${esc(p.name)}">
      <button type="button" class="rm" data-rm aria-label="Retirer">×</button>
      <div class="inputs">
        <div><div class="mini-label">Quantité</div><input name="p_qty" inputmode="decimal" value="${p.qty ?? ''}"></div>
        <div><div class="mini-label">PRU (€)</div><input name="p_pru" inputmode="decimal" value="${p.pru ?? ''}"></div>
        <div><div class="mini-label">Cours (€)</div><input name="p_price" inputmode="decimal" value="${p.price ?? ''}"></div>
      </div></div>`;
  const body = `
    <div class="field"><label>Type</label>${chipsHTML('type', ACCOUNT_TYPES, a.type)}</div>
    <div class="field"><label>Nom du compte</label><input name="name" required placeholder="ex. Compte joint, PEA Boursorama, Revolut Actions" value="${esc(a.name)}"></div>
    <div class="field"><label>Établissement</label><input name="institution" placeholder="ex. BNP, Boursorama, Revolut, Trade Republic" value="${esc(a.institution)}"></div>
    <div class="field"><label data-cash-label>${ACCOUNT_TYPES[a.type]?.invest ? 'Liquidités / espèces (€)' : 'Solde (€)'}</label>
      <input name="cash" inputmode="decimal" placeholder="0,00" value="${a.cash || a.cash === 0 ? String(a.cash).replace('.', ',') : ''}"></div>
    <div data-positions ${ACCOUNT_TYPES[a.type]?.invest ? '' : 'hidden'}>
      <div class="field"><label>Lignes (actions, ETF, fonds…)</label>
        <div class="positions" data-pos-list>${(a.positions || []).map(posRow).join('') || ''}</div>
        <button type="button" class="btn secondary" data-add-pos style="margin-top:6px">+ Ajouter une ligne</button>
        <div class="muted" style="font-size:12px;padding:4px">Valeur = quantité × cours. Mettez à jour le cours de temps en temps depuis votre appli bancaire.</div>
      </div>
    </div>`;
  const { sheet } = openSheet(isNew ? 'Nouveau compte' : 'Modifier le compte', body, {
    onSubmit(fd, form) {
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('Donnez un nom au compte'); return false; }
      a.name = name;
      a.institution = String(fd.get('institution') || '').trim();
      a.type = fd.get('type');
      a.cash = round2(num(fd.get('cash')));
      a.positions = ACCOUNT_TYPES[a.type]?.invest ? [...form.querySelectorAll('.pos-edit')].map((row) => ({
        id: row.dataset.pid,
        name: $('[name=p_name]', row).value.trim(),
        qty: num($('[name=p_qty]', row).value),
        pru: num($('[name=p_pru]', row).value),
        price: num($('[name=p_price]', row).value),
      })).filter((p) => p.name || p.qty) : [];
      a.updatedAt = Date.now();
      if (isNew) state.accounts.push(a);
      else state.accounts[state.accounts.findIndex((x) => x.id === a.id)] = a;
      save(); render(); toast('Compte enregistré');
    },
    onDelete: isNew ? null : () => {
      state.accounts = state.accounts.filter((x) => x.id !== a.id);
      state.goals.forEach((g) => { if (g.accountId === a.id) { g.saved = 0; delete g.accountId; } });
      save(); render(); toast('Compte supprimé');
    },
  });
  wireChips(sheet, (type) => {
    const inv = ACCOUNT_TYPES[type]?.invest;
    $('[data-positions]', sheet).hidden = !inv;
    $('[data-cash-label]', sheet).textContent = inv ? 'Liquidités / espèces (€)' : 'Solde (€)';
  });
  const list = $('[data-pos-list]', sheet);
  $('[data-add-pos]', sheet).addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', posRow({ id: uid(), name: '', qty: '', pru: '', price: '' }));
    list.lastElementChild.querySelector('input').focus();
  });
  list.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.pos-edit').remove(); });
}

/* Dépense */
function expenseForm(exp) {
  const isNew = !exp;
  const e = exp ? { ...exp } : { id: uid(), date: today(), amount: '', category: 'courses', note: '', accountId: '' };
  const accOpts = state.accounts.filter((a) => !ACCOUNT_TYPES[a.type]?.invest);
  const body = `
    <div class="field"><label>Montant (€)</label><input name="amount" inputmode="decimal" placeholder="0,00" style="font-size:28px;font-weight:700" value="${e.amount !== '' ? String(e.amount).replace('.', ',') : ''}"></div>
    <div class="field"><label>Catégorie</label>${chipsHTML('category', EXPENSE_CATEGORIES, e.category)}</div>
    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" name="date" value="${esc(e.date)}"></div>
      <div class="field"><label>Payé avec</label><select name="accountId"><option value="">—</option>
        ${accOpts.map((a) => `<option value="${a.id}" ${a.id === e.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Note</label><input name="note" placeholder="ex. Carrefour, Uber, cinéma…" value="${esc(e.note)}"></div>`;
  const { form } = openSheet(isNew ? 'Nouvelle dépense' : 'Modifier la dépense', body, {
    onSubmit(fd) {
      const amount = round2(num(fd.get('amount')));
      if (amount <= 0) { toast('Montant invalide'); return false; }
      Object.assign(e, { amount, category: fd.get('category'), date: fd.get('date') || today(), note: String(fd.get('note') || '').trim(), accountId: fd.get('accountId') || '' });
      if (isNew) { e.createdAt = Date.now(); state.expenses.push(e); }
      else state.expenses[state.expenses.findIndex((x) => x.id === e.id)] = e;
      // positionne la vue sur la semaine de la dépense
      weekOffset = Math.min(0, Math.round((weekStart(parseISO(e.date)) - weekStart(new Date())) / (7 * 86400000)));
      save(); render(); toast('Dépense enregistrée');
    },
    onDelete: isNew ? null : () => { state.expenses = state.expenses.filter((x) => x.id !== e.id); save(); render(); },
  });
  if (isNew) setTimeout(() => form.amount.focus(), 250);
  wireChips(form);
}

/* Projet */
function goalForm(goal) {
  const isNew = !goal;
  const g = goal ? { ...goal } : { id: uid(), name: '', emoji: '🎯', target: '', saved: 0, deadline: '', accountId: '' };
  const emojiOpts = Object.fromEntries(GOAL_EMOJIS.map((e) => [e, { emoji: e, label: '' }]));
  const body = `
    <div class="field"><label>Icône</label>${chipsHTML('emoji', emojiOpts, g.emoji)}</div>
    <div class="field"><label>Nom du projet</label><input name="name" placeholder="ex. Apport appartement, Voyage Japon" value="${esc(g.name)}"></div>
    <div class="field-row">
      <div class="field"><label>Objectif (€)</label><input name="target" inputmode="decimal" placeholder="10 000" value="${g.target !== '' ? String(g.target).replace('.', ',') : ''}"></div>
      <div class="field"><label>Échéance</label><input type="month" name="deadline" value="${esc(g.deadline)}"></div>
    </div>
    <div class="field"><label>Suivre la progression via</label><select name="accountId">
      <option value="">Montant saisi manuellement</option>
      ${state.accounts.map((a) => `<option value="${a.id}" ${a.id === g.accountId ? 'selected' : ''}>Solde de : ${esc(a.name)}</option>`).join('')}
    </select></div>
    <div class="field" data-saved-field ${g.accountId ? 'hidden' : ''}><label>Déjà épargné (€)</label><input name="saved" inputmode="decimal" placeholder="0" value="${g.saved ? String(g.saved).replace('.', ',') : ''}"></div>`;
  const { form } = openSheet(isNew ? 'Nouveau projet' : 'Modifier le projet', body, {
    onSubmit(fd) {
      const name = String(fd.get('name') || '').trim();
      const target = round2(num(fd.get('target')));
      if (!name) { toast('Donnez un nom au projet'); return false; }
      if (target <= 0) { toast('Objectif invalide'); return false; }
      Object.assign(g, { name, target, emoji: fd.get('emoji') || '🎯', deadline: fd.get('deadline') || '', accountId: fd.get('accountId') || '', saved: round2(num(fd.get('saved'))) });
      if (!g.accountId) delete g.accountId;
      if (isNew) state.goals.push(g); else state.goals[state.goals.findIndex((x) => x.id === g.id)] = g;
      save(); render(); toast('Projet enregistré');
    },
    onDelete: isNew ? null : () => { state.goals = state.goals.filter((x) => x.id !== g.id); save(); render(); },
  });
  wireChips(form);
  form.accountId.addEventListener('change', () => { $('[data-saved-field]', form).hidden = !!form.accountId.value; });
}

/* Réglages */
function settingsSheet() {
  const body = `
    <div class="field"><label>Budget hebdomadaire de dépenses (€)</label>
      <input name="weeklyBudget" inputmode="decimal" placeholder="0 = pas de budget" value="${state.settings.weeklyBudget || ''}"></div>
    <div class="card settings-list" style="padding:4px 16px;margin:0">
      <div class="row" data-s="export"><div class="badge">💾</div><div class="main"><div class="title">Exporter une sauvegarde</div><div class="sub">Fichier JSON à garder dans Fichiers / iCloud</div></div></div>
      <div class="row" data-s="import"><div class="badge">📥</div><div class="main"><div class="title">Importer une sauvegarde</div><div class="sub">Remplace les données actuelles</div></div></div>
      <div class="row" data-s="csv"><div class="badge">🧾</div><div class="main"><div class="title">Importer des dépenses (CSV)</div><div class="sub">Colonnes : date;montant;catégorie;note</div></div></div>
      <div class="row" data-s="reset"><div class="badge">🗑️</div><div class="main"><div class="title" style="color:var(--neg)">Tout effacer</div><div class="sub">Supprime toutes les données de cet appareil</div></div></div>
    </div>
    <input type="file" class="file-input" accept="application/json,.json" data-file="json">
    <input type="file" class="file-input" accept=".csv,text/csv,text/plain" data-file="csv">
    <p class="muted" style="font-size:13px;margin:0">🔒 Vos données restent uniquement sur cet iPhone : rien n'est envoyé sur Internet. Pensez à exporter une sauvegarde de temps en temps.</p>`;
  const { form } = openSheet('Réglages', body, {
    onSubmit(fd) { state.settings.weeklyBudget = round2(num(fd.get('weeklyBudget'))); save(); render(); toast('Réglages enregistrés'); },
  });
  form.addEventListener('click', (e) => {
    const r = e.target.closest('[data-s]'); if (!r) return;
    const act = r.dataset.s;
    if (act === 'export') exportJSON();
    if (act === 'import') $('[data-file=json]', form).click();
    if (act === 'csv') $('[data-file=csv]', form).click();
    if (act === 'reset' && confirm('Effacer toutes les données ? Cette action est irréversible.')) {
      state = defaultState(); save(); closeSheet(); go('home'); toast('Données effacées');
    }
  });
  $('[data-file=json]', form).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.accounts)) throw new Error('format');
      if (!confirm('Remplacer les données actuelles par cette sauvegarde ?')) return;
      state = { ...defaultState(), ...data, settings: { ...defaultState().settings, ...(data.settings || {}) } };
      save(); closeSheet(); render(); toast('Sauvegarde importée');
    } catch { toast('Fichier invalide'); }
  });
  $('[data-file=csv]', form).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const n = importCSV(await f.text());
    save(); closeSheet(); render(); toast(n ? `${n} dépense(s) importée(s)` : 'Aucune ligne reconnue');
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const name = `portefeuille-${today()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

/** Import CSV tolérant : séparateur ; ou , — date JJ/MM/AAAA ou AAAA-MM-JJ — montants négatifs = dépenses. */
function importCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return 0;
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const catKeys = Object.keys(EXPENSE_CATEGORIES);
  let n = 0;
  for (const line of lines) {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    let [d, amt, cat = '', ...note] = cols;
    let date = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d;
    else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(d)) {
      let [dd, mm, yy] = d.split('/'); if (yy.length === 2) yy = '20' + yy;
      date = `${yy}-${pad(mm)}-${pad(dd)}`;
    }
    const amount = Math.abs(num(amt));
    if (!date || !amount) continue; // ignore l'en-tête et les lignes invalides
    const c = cat.toLowerCase();
    const category = catKeys.find((k) => k === c || EXPENSE_CATEGORIES[k].label.toLowerCase() === c) || 'autre';
    state.expenses.push({ id: uid(), date, amount: round2(amount), category, note: (category === 'autre' && cat && !note.length ? cat : note.join(' ')).trim(), createdAt: Date.now() });
    n++;
  }
  return n;
}

/* Données d'exemple */
function loadDemo() {
  const now = new Date();
  const s = defaultState();
  s.accounts = [
    { id: uid(), name: 'Compte courant', institution: 'Banque principale', type: 'courant', cash: 2340.55, positions: [] },
    { id: uid(), name: 'Livret A', institution: 'Banque principale', type: 'epargne', cash: 12450, positions: [] },
    { id: uid(), name: 'Revolut', institution: 'Revolut', type: 'courant', cash: 415.2, positions: [] },
    { id: uid(), name: 'PEA', institution: 'Courtier en ligne', type: 'pea', cash: 132.4, positions: [
      { id: uid(), name: 'ETF MSCI World', qty: 42, pru: 410.5, price: 512.3 },
      { id: uid(), name: 'ETF S&P 500', qty: 120, pru: 38.2, price: 44.9 },
      { id: uid(), name: 'Air Liquide', qty: 10, pru: 152, price: 168.4 },
    ] },
    { id: uid(), name: 'Revolut Actions', institution: 'Revolut', type: 'cto', cash: 58, positions: [
      { id: uid(), name: 'Apple', qty: 8, pru: 165, price: 210.2 },
      { id: uid(), name: 'Nvidia', qty: 12, pru: 98, price: 128.5 },
      { id: uid(), name: 'Tesla', qty: 3, pru: 260, price: 231 },
    ] },
  ].map((a) => ({ ...a, updatedAt: Date.now() }));
  const cats = ['courses', 'restaurant', 'transport', 'loisirs', 'shopping', 'abonnements'];
  const notes = { courses: ['Carrefour', 'Monoprix', 'Marché'], restaurant: ['Déjeuner', 'Pizzeria', 'Café'], transport: ['Navigo', 'Uber', 'Essence'], loisirs: ['Cinéma', 'Concert', 'Livre'], shopping: ['Vêtements', 'Amazon'], abonnements: ['Netflix', 'Spotify', 'Forfait mobile'] };
  for (let d = 0; d < 63; d++) {
    const date = addDays(now, -d);
    const k = 1 + ((d * 7) % 3);
    for (let j = 0; j < k; j++) {
      const c = cats[(d + j * 3) % cats.length];
      const base = { courses: 45, restaurant: 22, transport: 12, loisirs: 25, shopping: 40, abonnements: 11 }[c];
      s.expenses.push({ id: uid(), date: isoDate(date), amount: round2(base * (0.6 + ((d * 13 + j * 7) % 10) / 10)), category: c, note: notes[c][(d + j) % notes[c].length], createdAt: Date.now() });
    }
  }
  const y = now.getFullYear();
  s.goals = [
    { id: uid(), name: 'Épargne de précaution', emoji: '🛟', target: 10000, deadline: '', accountId: s.accounts[1].id },
    { id: uid(), name: 'Apport appartement', emoji: '🏠', target: 40000, saved: 8500, deadline: `${y + 3}-06` },
    { id: uid(), name: 'Voyage au Japon', emoji: '✈️', target: 4500, saved: 1800, deadline: `${y + 1}-04` },
  ];
  s.settings.weeklyBudget = 350;
  state = s;
  // historique fictif sur 120 jours
  const final = netWorth();
  for (let d = 120; d >= 1; d--) {
    const f = 1 - d * 0.0011 + Math.sin(d / 9) * 0.012;
    state.history.push({ date: isoDate(addDays(now, -d)), total: round2(final * f) });
  }
  save(); render(); toast('Données d\'exemple chargées');
}

/* ---------- Divers ---------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

/* ---------- Événements ---------- */

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (b) { if (b.dataset.tab === 'expenses' && currentTab !== 'expenses') weekOffset = 0; go(b.dataset.tab); }
});
$('#view').addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g && !e.target.closest('[data-action]')) { go(g.dataset.goto); return; }
  const el = e.target.closest('[data-action]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'add-account': accountForm(); break;
    case 'edit-account': accountForm(state.accounts.find((a) => a.id === id)); break;
    case 'add-expense': expenseForm(); break;
    case 'edit-expense': expenseForm(state.expenses.find((x) => x.id === id)); break;
    case 'add-goal': goalForm(); break;
    case 'edit-goal': goalForm(state.goals.find((x) => x.id === id)); break;
    case 'week-prev': weekOffset--; render(); break;
    case 'week-next': weekOffset = Math.min(0, weekOffset + 1); render(); break;
    case 'demo': loadDemo(); break;
  }
});
$('#sheet-backdrop').addEventListener('click', closeSheet);
$('#btn-settings').addEventListener('click', settingsSheet);
$('#btn-privacy').addEventListener('click', () => {
  state.settings.hideAmounts = !state.settings.hideAmounts; save(); render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

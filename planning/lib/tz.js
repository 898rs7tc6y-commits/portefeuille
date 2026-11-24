'use strict';

/* ==========================================================================
   Fuseaux horaires sans dépendance : conversions heure locale <-> instant UTC
   via Intl. Les dates « locales » sont des clés 'AAAA-MM-JJ'.
   ========================================================================== */

const pad = (n) => String(n).padStart(2, '0');
const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Composantes de l'heure locale d'un instant. */
function localParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = Number(value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mi: p.minute, ss: p.second };
}

/** Décalage (ms) entre l'heure locale et UTC à un instant donné. */
function offsetAt(ms, tz) {
  const p = localParts(ms, tz);
  const floored = ms - (((ms % 1000) + 1000) % 1000);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss) - floored;
}

/** Heure murale locale -> instant UTC (gère les changements d'heure). */
function zonedTimeToUtc(y, m, d, hh, mi, tz) {
  const naive = Date.UTC(y, m - 1, d, hh, mi);
  const first = naive - offsetAt(naive, tz);
  return naive - offsetAt(first, tz);
}

const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function splitKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function addDays(key, n) {
  const { y, m, d } = splitKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 1 = lundi … 7 = dimanche. */
function isoWeekday(key) {
  const { y, m, d } = splitKey(key);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

const mondayOf = (key) => addDays(key, 1 - isoWeekday(key));

function dayDiff(a, b) {
  const A = splitKey(a);
  const B = splitKey(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 864e5);
}

function localDateOf(ms, tz) {
  const p = localParts(ms, tz);
  return dateKey(p.y, p.m, p.d);
}

/** Instant correspondant à « jour à HH:MM » dans le fuseau. */
function at(key, hhmm, tz) {
  const { y, m, d } = splitKey(key);
  const [hh, mi] = hhmm.split(':').map(Number);
  return zonedTimeToUtc(y, m, d, hh, mi, tz);
}

function localTime(ms, tz) {
  const p = localParts(ms, tz);
  return `${pad(p.hh)}:${pad(p.mi)}`;
}

module.exports = {
  pad, isValidTimeZone, localParts, zonedTimeToUtc, addDays, isoWeekday,
  mondayOf, dayDiff, localDateOf, at, localTime,
};

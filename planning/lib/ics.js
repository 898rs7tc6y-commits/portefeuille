'use strict';

/* ==========================================================================
   Lecture et écriture iCalendar (RFC 5545), juste ce qu'il faut pour un flux
   de shifts Tanda en entrée et un calendrier d'abonnement en sortie.
   ========================================================================== */

const { zonedTimeToUtc, isValidTimeZone, addDays } = require('./tz');

function unfold(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

function parseLine(line) {
  let inQuotes = false;
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) break;
  }
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  const ms = ((((+w * 7 + +d) * 24 + +h) * 60 + +mi) * 60 + +s) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseDate(value, params, calendarTz) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { allDay: true };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss = '0', utc] = m;
  if (utc) return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss) };
  const tz = isValidTimeZone(params.TZID) ? params.TZID : calendarTz;
  return { ms: zonedTimeToUtc(+y, +mo, +d, +hh, +mi, tz) };
}

/**
 * Renvoie les évènements horodatés (les évènements « journée entière » et
 * annulés sont ignorés), triés par début.
 */
function parseIcs(text, defaultTz) {
  const raw = [];
  let cur = null;
  let declaredTz = null;
  for (const line of unfold(text).split('\n')) {
    if (!line.trim()) continue;
    const { name, params, value } = parseLine(line);
    if (name === 'X-WR-TIMEZONE') declaredTz = value.trim();
    else if (name === 'BEGIN' && value.trim() === 'VEVENT') cur = {};
    else if (name === 'END' && value.trim() === 'VEVENT') { if (cur) raw.push(cur); cur = null; }
    else if (cur) {
      if (name === 'DTSTART' || name === 'DTEND') cur[name] = { value, params };
      else if (name === 'DURATION') cur.duration = value;
      else if (name === 'SUMMARY') cur.summary = unescapeText(value);
      else if (name === 'DESCRIPTION') cur.description = unescapeText(value);
      else if (name === 'LOCATION') cur.location = unescapeText(value);
      else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
    }
  }

  const calendarTz = isValidTimeZone(declaredTz) ? declaredTz : defaultTz;
  const events = [];
  for (const e of raw) {
    if (e.status === 'CANCELLED' || !e.DTSTART) continue;
    const start = parseDate(e.DTSTART.value, e.DTSTART.params, calendarTz);
    if (!start || start.allDay) continue;
    let end = null;
    if (e.DTEND) {
      const en = parseDate(e.DTEND.value, e.DTEND.params, calendarTz);
      if (en && !en.allDay) end = en.ms;
    } else if (e.duration) {
      const dur = parseDuration(e.duration);
      if (dur) end = start.ms + dur;
    }
    if (end === null || end <= start.ms) continue;
    events.push({
      start: start.ms, end,
      summary: e.summary || '', description: e.description || '', location: e.location || '',
    });
  }
  events.sort((a, b) => a.start - b.start);
  return { events, declaredTz: isValidTimeZone(declaredTz) ? declaredTz : null };
}

/* ---------------------------------------------------------------- Écriture */

const fmtUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escapeText = (s) => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Plie les lignes à 75 octets sans couper un caractère multi-octets. */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 75) { out.push(cur); cur = ` ${ch}`; bytes = 1 + b; }
    else { cur += ch; bytes += b; }
  }
  out.push(cur);
  return out.join('\r\n');
}

function writeIcs(events, { name, timezone, now }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//portefeuille//planning//FR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${fmtUtc(now)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART:${fmtUtc(e.start)}`, `DTEND:${fmtUtc(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push(`TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`);
    if (e.alarmMin) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`,
        `TRIGGER:-PT${e.alarmMin}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { parseIcs, writeIcs, parseDuration };

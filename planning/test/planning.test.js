'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseConfig = require('../config');
const { at, addDays, localDateOf } = require('../lib/tz');
const { parseIcs } = require('../lib/ics');
const { buildPlanning } = require('../lib/report');
const { H, MIN } = require('../lib/planner');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'exemple-tanda.ics'), 'utf8');
const TZ = 'Europe/Paris';
const NOW = at('2026-11-30', '08:00', TZ);
const cfgWith = (patch) => ({ ...structuredClone(baseConfig), ...patch });

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

function roster(shifts) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  shifts.forEach(([s, e], i) => lines.push('BEGIN:VEVENT', `UID:${i}`,
    `DTSTART;TZID=${TZ}:${s}`, `DTEND;TZID=${TZ}:${e}`, 'SUMMARY:Shift', 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

test('fuseau : heure locale -> UTC, y compris au passage à l\'heure d\'été', () => {
  assert.equal(at('2026-12-04', '19:00', TZ), Date.UTC(2026, 11, 4, 18, 0));
  assert.equal(at('2027-03-27', '22:00', TZ), Date.UTC(2027, 2, 27, 21, 0));
  assert.equal(at('2027-03-28', '04:00', TZ), Date.UTC(2027, 2, 28, 2, 0));
  assert.equal(at('2026-07-01', '12:00', 'Australia/Sydney'), Date.UTC(2026, 6, 1, 2, 0));
});

test('lecture Tanda : shifts horodatés seulement, formats UTC / TZID / DURATION', () => {
  const { events, declaredTz } = parseIcs(SAMPLE, TZ);
  assert.equal(declaredTz, TZ);
  assert.equal(events.length, 8, 'annulé et journée entière ignorés');
  const friday = events.find((e) => e.start === at('2026-12-04', '19:00', TZ));
  assert.ok(friday, 'shift en UTC (Z) bien converti');
  assert.equal(friday.end, at('2026-12-05', '02:00', TZ));
  const brunch = events.find((e) => e.start === at('2026-12-06', '12:00', TZ));
  assert.equal(brunch.end - brunch.start, 8 * H, 'DURATION:PT8H');
  assert.match(events[0].description, /pliée sur plusieurs lignes, avec des virgules; et/);
});

test('invariants : rien ne se chevauche, plafonds et repos respectés', () => {
  const cfg = cfgWith({});
  const { result: r } = buildPlanning(SAMPLE, cfg, NOW);
  const shiftsBlocks = r.shifts.map((s) => ({ start: s.start - 30 * MIN, end: s.end + 30 * MIN }));
  const sleep = [...r.nights.values()].filter((n) => n.ms > 0);
  const planned = [...r.ueSessions, ...r.sportSessions];

  for (const p of planned) {
    for (const s of shiftsBlocks) assert.ok(!overlaps(p, s), 'activité pendant un shift/trajet');
    for (const n of sleep) assert.ok(!overlaps(p, n), 'activité pendant le sommeil');
    for (const q of planned) if (q !== p) assert.ok(!overlaps(p, q), 'deux activités en même temps');
  }

  for (const week of r.weeks) {
    const ue = r.ueSessions.filter((s) => week.days.includes(s.day));
    assert.ok(ue.reduce((t, s) => t + s.end - s.start, 0) <= cfg.uberEats.objectifSemaineH * H);
    assert.ok(!ue.some((s) => s.day === week.dayOff), 'UE pendant le jour off');
    const sport = r.sportSessions.filter((s) => week.days.includes(s.day)).map((s) => s.day).sort();
    for (let i = 1; i < sport.length; i++) assert.notEqual(addDays(sport[i - 1], 1), sport[i]);
  }

  for (const s of [...r.ueSessions, ...r.sportSessions]) {
    const prev = r.nights.get(addDays(s.day, -1));
    assert.ok(prev.ms >= cfg.sommeil.minimumH * H, `activité le ${s.day} après une nuit courte`);
  }
});

test('sommeil décalé après un shift tardif (fin + trajet + décompression)', () => {
  const { result: r } = buildPlanning(SAMPLE, cfgWith({}), NOW);
  const night = r.nights.get('2026-12-04'); // shift jusqu'à 02:00
  assert.equal(night.start, at('2026-12-05', '03:15', TZ));
  assert.equal(night.ms, 8 * H);
});

test('sport : trouve 3 séances même quand le choix glouton n\'en trouverait que 2', () => {
  const { result: r } = buildPlanning(SAMPLE, cfgWith({}), NOW);
  assert.equal(r.weeks[0].sportCount, 3);
});

test('engagements fixes : bloqués et jamais recouverts', () => {
  const cfg = cfgWith({ engagements: [{ jour: 'lundi', debut: '09:00', fin: '19:00', libelle: 'Cours' }] });
  const { result: r } = buildPlanning(SAMPLE, cfg, NOW);
  const mondays = r.commitments;
  assert.equal(mondays.length, 2);
  for (const c of mondays) {
    for (const p of [...r.ueSessions, ...r.sportSessions]) assert.ok(!overlaps(p, c));
  }
});

test('changement d\'heure : la nuit qui suit un shift reste cohérente', () => {
  const ics = roster([['20270327T220000', '20270328T040000']]);
  const { result: r } = buildPlanning(ics, cfgWith({}), at('2027-03-22', '08:00', TZ));
  const night = r.nights.get('2027-03-27');
  assert.equal(night.start, at('2027-03-28', '05:15', TZ));
  assert.equal(night.ms, 8 * H);
});

test('fichier .ics produit : lignes pliées à 75 octets et relisible', () => {
  const { ics, events } = buildPlanning(SAMPLE, cfgWith({}), NOW);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  const timed = events.filter((e) => !e.allDay).length;
  assert.equal(parseIcs(ics, TZ).events.length, timed);
  assert.equal(new Set(events.map((e) => e.uid)).size, events.length, 'UID uniques');
});

test('déterministe : deux générations identiques à la date près', () => {
  const a = buildPlanning(SAMPLE, cfgWith({}), NOW).events;
  const b = buildPlanning(SAMPLE, cfgWith({}), NOW + 3 * H).events;
  assert.deepEqual(a.map((e) => e.uid), b.map((e) => e.uid));
});

test('sans roster publié : planning de la semaine en cours, marqué provisoire', () => {
  const { result: r } = buildPlanning('BEGIN:VCALENDAR\r\nEND:VCALENDAR', cfgWith({}), NOW);
  assert.equal(r.weeks.length, 1);
  assert.ok(r.weeks[0].warnings.some((w) => w.type === 'pasDeRoster'));
  assert.equal(localDateOf(r.weeks[0].days[0] && at(r.weeks[0].days[0], '12:00', TZ), TZ), '2026-11-30');
});

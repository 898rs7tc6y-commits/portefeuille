'use strict';

/* ==========================================================================
   Moteur de planning. Ordre de priorité (le premier gagne toujours) :
     1. shifts du bar (+ trajets)          — imposés par Tanda
     2. sommeil (+ décompression, réveil)  — calculé à partir des shifts
     3. Uber Eats                          — rushs, week-end d'abord, plafonnés
     4. sport                              — jours les plus légers, jamais 2 de suite
     5. temps libre                        — ce qui reste
   Déterministe : mêmes shifts + même date => même planning.
   ========================================================================== */

const { addDays, at, isoWeekday, localDateOf, mondayOf, dayDiff, isValidTimeZone } = require('./tz');

const MIN = 60e3;
const H = 60 * MIN;
const Q = 15 * MIN;
const JOURS = [null, 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const ceilQ = (t) => Math.ceil(t / Q) * Q;
const floorQ = (t) => Math.floor(t / Q) * Q;
const hhmmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function merge(list) {
  const sorted = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Plages libres de `win` une fois retirés les intervalles occupés (élargis de `margin`). */
function freeSlots([ws, we], busy, margin = 0) {
  const out = [];
  let cur = ws;
  for (const [bs, be] of merge(busy.map(([s, e]) => [s - margin, e + margin]))) {
    if (be <= cur) continue;
    if (bs >= we) break;
    if (bs > cur) out.push([cur, bs]);
    cur = Math.max(cur, be);
    if (cur >= we) break;
  }
  if (cur < we) out.push([cur, we]);
  return out;
}

/** Fenêtre 'HH:MM'–'HH:MM' d'un jour ; passe minuit si la fin est avant le début. */
function windowOn(day, [a, b], tz) {
  const endDay = hhmmToMin(b) <= hhmmToMin(a) ? addDays(day, 1) : day;
  return [at(day, a, tz), at(endDay, b, tz)];
}

const quarterSlots = (slots, minLen) => slots
  .map(([s, e]) => [ceilQ(s), floorQ(e)])
  .filter(([s, e]) => e - s >= minLen);

function plan(allShifts, cfg, now) {
  const tz = cfg.fuseau;
  if (!isValidTimeZone(tz)) throw new Error(`Fuseau horaire inconnu : ${tz}`);
  const commute = cfg.bar.trajetMin * MIN;
  const windDown = cfg.sommeil.decompressionMin * MIN;
  const morning = cfg.sommeil.reveilMin * MIN;
  const sleepTarget = cfg.sommeil.dureeH * H;

  const filter = cfg.bar.filtreTitre ? new RegExp(cfg.bar.filtreTitre, 'i') : null;
  const barShifts = allShifts.filter((s) => !filter || filter.test(s.summary));

  /* ---- Horizon : semaine en cours -> fin de la semaine du dernier shift connu */
  const today = localDateOf(now, tz);
  const firstDay = mondayOf(today);
  const lastShiftDay = barShifts.length ? localDateOf(barShifts[barShifts.length - 1].start, tz) : null;
  let lastDay = addDays(mondayOf(lastShiftDay && lastShiftDay > today ? lastShiftDay : today), 6);
  const maxDay = addDays(firstDay, cfg.semainesMax * 7 - 1);
  if (lastDay > maxDay) lastDay = maxDay;
  const days = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) days.push(d);

  const from = at(addDays(firstDay, -1), '00:00', tz);
  const to = at(addDays(lastDay, 2), '00:00', tz);
  const shifts = barShifts.filter((s) => s.end > from && s.start < to);

  /* ---- Sommeil : nuit D = celle qui suit la journée D */
  const nights = new Map();
  for (const D of [addDays(firstDay, -1), ...days]) {
    const bedtime = at(hhmmToMin(cfg.sommeil.coucher) < 12 * 60 ? addDays(D, 1) : D, cfg.sommeil.coucher, tz);
    let start = bedtime;
    let afterShift = false;
    for (const s of shifts) {
      const eveningShift = s.start < bedtime + 3 * H && s.end > bedtime - commute - windDown
        && s.end < bedtime + 14 * H;
      if (eveningShift && s.end + commute + windDown > start) {
        start = s.end + commute + windDown;
        afterShift = true;
      }
    }
    start = ceilQ(start);
    let end = start + sleepTarget;
    let cutBy = null;
    for (const s of shifts) {
      if (s.start >= start && s.start < end + commute + morning) {
        const limit = s.start - commute - morning;
        if (limit < end) { end = limit; cutBy = s; }
      }
    }
    end = floorQ(Math.max(end, start));
    nights.set(D, { day: D, start, end, ms: end - start, afterShift, cutBy });
  }

  const busy = [];
  for (const s of shifts) busy.push([s.start - commute, s.end + commute]);

  const commitments = [];
  for (const d of days) {
    for (const c of cfg.engagements || []) {
      if (c.jour !== JOURS[isoWeekday(d)]) continue;
      const [start, end] = windowOn(d, [c.debut, c.fin], tz);
      commitments.push({ day: d, start, end, label: c.libelle });
      busy.push([start - (c.margeMin || 0) * MIN, end + (c.margeMin || 0) * MIN]);
    }
  }
  for (const n of nights.values()) if (n.ms > 0) busy.push([n.start - windDown, n.end + morning]);

  /* ---- Charge de travail par jour (jour = date locale du début) */
  const work = new Map(days.map((d) => [d, { bar: 0, ue: 0 }]));
  for (const s of shifts) {
    const w = work.get(localDateOf(s.start, tz));
    if (w) w.bar += s.end - s.start;
  }
  const load = (d) => work.get(d).bar + work.get(d).ue;
  const afterShortNight = (d) => {
    const n = nights.get(addDays(d, -1));
    return Boolean(cfg.limites.reposApresNuitCourte && n && n.ms < cfg.sommeil.minimumH * H);
  };

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push({ monday: days[i], days: days.slice(i, i + 7) });

  /* ---- Uber Eats */
  const ue = cfg.uberEats;
  const lim = cfg.limites;
  const ueSessions = [];
  for (const week of weeks) {
    week.dayOff = null;
    if (lim.garderUnJourOff) {
      const barFree = week.days.filter((d) => work.get(d).bar === 0);
      for (const name of lim.jourOffPrefere) {
        const d = barFree.find((x) => JOURS[isoWeekday(x)] === name);
        if (d) { week.dayOff = d; break; }
      }
    }
    const prio = new Set(ue.joursPrioritaires);
    const candidates = [];
    for (const d of week.days) {
      if (d === week.dayOff || afterShortNight(d)) continue;
      const name = JOURS[isoWeekday(d)];
      for (const w of ue.creneaux[name] || []) {
        candidates.push({ day: d, win: windowOn(d, w, tz), prio: prio.has(name) ? 0 : 1 });
      }
    }
    candidates.sort((a, b) => a.prio - b.prio || a.win[0] - b.win[0]);

    const minSession = ue.sessionMinH * H;
    let weekUe = 0;
    let weekWork = week.days.reduce((t, d) => t + work.get(d).bar, 0);
    for (const c of candidates) {
      const free = quarterSlots(freeSlots(c.win, busy, ue.pauseMin * MIN), minSession);
      if (!free.length) continue;
      const [fs, fe] = free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const len = floorQ(Math.min(
        fe - fs,
        ue.objectifSemaineH * H - weekUe,
        lim.maxTravailJourH * H - load(c.day),
        lim.maxTravailSemaineH * H - weekWork,
      ));
      if (len < minSession) continue;
      const start = fs + floorQ(((fe - fs) - len) / 2); // centré sur le cœur du rush
      ueSessions.push({ day: c.day, start, end: start + len });
      busy.push([start, start + len]);
      work.get(c.day).ue += len;
      weekUe += len;
      weekWork += len;
    }
  }

  /* ---- Sport : on teste toutes les combinaisons de jours de la semaine et on garde
         celle qui case le plus de séances, puis sur les jours les moins chargés. */
  const sp = cfg.sport;
  const sportSessions = [];
  for (const week of weeks) {
    const options = week.days.map((d) => {
      if (load(d) > sp.maxTravailJourH * H || afterShortNight(d)) return null;
      const night = nights.get(d);
      const extra = night && night.ms > 0 ? [[night.start - sp.pasAvantCoucherH * H, night.start]] : [];
      for (const w of sp.creneaux) {
        const free = quarterSlots(freeSlots(windowOn(d, w, tz), busy.concat(extra), sp.margeMin * MIN),
          sp.dureeMin * MIN);
        if (free.length) return { day: d, start: free[0][0], end: free[0][0] + sp.dureeMin * MIN };
      }
      return null;
    });

    let best = null;
    for (let mask = 1; mask < 1 << options.length; mask++) {
      const idx = options.map((_, i) => i).filter((i) => mask & (1 << i));
      if (idx.length > sp.seancesParSemaine || idx.some((i) => !options[i])) continue;
      if (sp.pasDeuxJoursDeSuite && idx.some((v, k) => k > 0 && v - idx[k - 1] < 2)) continue;
      const totalLoad = idx.reduce((t, i) => t + load(week.days[i]), 0);
      if (!best || idx.length > best.idx.length
        || (idx.length === best.idx.length && totalLoad < best.totalLoad)) best = { idx, totalLoad };
    }
    const placed = best ? best.idx.map((i) => options[i]) : [];
    for (const p of placed) busy.push([p.start, p.end]);
    sportSessions.push(...placed);
    week.sportCount = placed.length;
  }

  /* ---- Temps libre : entre le réveil et la décompression, hors tout le reste */
  const freeBlocks = [];
  const freeByDay = new Map(days.map((d) => [d, 0]));
  for (const d of days) {
    const prev = nights.get(addDays(d, -1));
    const night = nights.get(d);
    const wake = prev.end + morning;
    const sleep = night.start - windDown;
    if (sleep <= wake) continue;
    for (const [s, e] of freeSlots([wake, sleep], busy).filter(([a, b]) => b - a >= cfg.tempsLibre.blocMinH * H)) {
      freeBlocks.push({ day: d, start: s, end: e });
      freeByDay.set(d, freeByDay.get(d) + (e - s));
    }
  }

  /* ---- Bilan et alertes par semaine */
  for (const week of weeks) {
    const sum = (f) => week.days.reduce((t, d) => t + f(d), 0);
    const weekNights = week.days.map((d) => nights.get(d)).filter((n) => n.ms > 0);
    week.stats = {
      bar: sum((d) => work.get(d).bar),
      ue: sum((d) => work.get(d).ue),
      free: sum((d) => freeByDay.get(d)),
      sleepAvg: weekNights.length ? weekNights.reduce((t, n) => t + n.ms, 0) / weekNights.length : 0,
    };
    week.stats.work = week.stats.bar + week.stats.ue;
    week.stats.ueGain = Math.round((week.stats.ue / H) * ue.gainHoraireEstime);

    const w = [];
    for (const n of weekNights) {
      if (n.ms < cfg.sommeil.minimumH * H) w.push({ type: 'nuit', day: n.day, ms: n.ms });
    }
    for (const d of week.days) {
      if (load(d) > lim.maxTravailJourH * H) w.push({ type: 'jour', day: d, ms: load(d) });
    }
    if (week.stats.work > lim.maxTravailSemaineH * H) w.push({ type: 'semaine', ms: week.stats.work });
    if (!week.days.some((d) => load(d) === 0)) w.push({ type: 'pasDeJourOff' });
    if (week.sportCount < sp.seancesParSemaine) w.push({ type: 'sport', count: week.sportCount });
    if (week.stats.free < cfg.tempsLibre.minimumSemaineH * H) w.push({ type: 'libre', ms: week.stats.free });
    if (lastShiftDay && lastShiftDay < week.days[6] && lastShiftDay >= week.days[0]) {
      w.push({ type: 'roster', day: lastShiftDay });
    } else if (!lastShiftDay || lastShiftDay < week.days[0]) {
      w.push({ type: 'pasDeRoster' });
    }
    week.warnings = w;
  }

  return { tz, now, days, shifts, commitments, nights, ueSessions, sportSessions, freeBlocks, weeks, lastShiftDay };
}

module.exports = { plan, freeSlots, merge, JOURS, H, MIN };

'use strict';

/* ==========================================================================
   Mise en forme : évènements de calendrier + résumé texte lisible.
   ========================================================================== */

const { localDateOf, localTime, isoWeekday, pad } = require('./tz');
const { parseIcs, writeIcs } = require('./ics');
const { plan, H, MIN } = require('./planner');

const JOURS_COURTS = [null, 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

function fmtH(ms) {
  const total = Math.round(ms / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

const fmtDay = (key) => `${JOURS_COURTS[isoWeekday(key)]} ${key.slice(8, 10)}/${key.slice(5, 7)}`;

function warningText(w, cfg) {
  switch (w.type) {
    case 'nuit': return `Nuit courte après ${fmtDay(w.day)} : ${fmtH(w.ms)} (minimum ${cfg.sommeil.minimumH}h)`;
    case 'jour': return `${fmtDay(w.day)} : ${fmtH(w.ms)} de travail (plafond ${cfg.limites.maxTravailJourH}h)`;
    case 'semaine': return `${fmtH(w.ms)} de travail sur la semaine (plafond ${cfg.limites.maxTravailSemaineH}h)`;
    case 'pasDeJourOff': return 'Aucun jour sans travail cette semaine';
    case 'sport': return `Sport : seulement ${w.count}/${cfg.sport.seancesParSemaine} séances casables`;
    case 'libre': return `Temps libre : ${fmtH(w.ms)} (minimum visé ${cfg.tempsLibre.minimumSemaineH}h)`;
    case 'roster': return `Roster Tanda publié jusqu'au ${fmtDay(w.day)} seulement : la fin de semaine est provisoire`;
    case 'pasDeRoster': return 'Aucun shift publié sur Tanda pour cette semaine : planning provisoire';
    default: return w.type;
  }
}

function weekHeadline(week, cfg) {
  const s = week.stats;
  return [
    `Bar ${fmtH(s.bar)}`,
    `UE ${fmtH(s.ue)} (~${s.ueGain} ${cfg.uberEats.devise})`,
    `Sport ${week.sportCount}/${cfg.sport.seancesParSemaine}`,
    `Libre ${fmtH(s.free)}`,
    `Sommeil moy. ${fmtH(s.sleepAvg)}`,
  ].join(' · ');
}

/** Liste plate d'évènements, commune au flux .ics et au résumé texte. */
function collectEvents(r, cfg) {
  const ev = [];
  const tz = r.tz;
  const firstStart = r.days.length ? r.days[0] : null;
  const inRange = (ms) => firstStart && localDateOf(ms, tz) >= firstStart;

  if (cfg.bar.inclure) {
    for (const s of r.shifts) {
      if (!inRange(s.end)) continue;
      ev.push({
        kind: 'bar', uid: `bar-${s.start}`, start: s.start, end: s.end, busy: true,
        title: cfg.bar.libelle, description: [s.summary, s.description].filter(Boolean).join('\n'),
        location: s.location,
      });
    }
  }

  for (const c of r.commitments) {
    ev.push({
      kind: 'engagement', uid: `engagement-${c.start}`, start: c.start, end: c.end, busy: true,
      title: c.label || 'Engagement', description: 'Engagement fixe (config.js).',
    });
  }

  if (cfg.sommeil.afficher) {
    for (const n of r.nights.values()) {
      if (n.ms <= 0 || !inRange(n.end)) continue;
      const short = n.ms < cfg.sommeil.minimumH * H;
      const lines = [`Coucher ${localTime(n.start, tz)} → réveil ${localTime(n.end, tz)}.`];
      if (n.afterShift) lines.push('Décalé à cause du shift de la veille.');
      if (n.cutBy) lines.push(`Écourté par le shift de ${localTime(n.cutBy.start, tz)}.`);
      if (short) lines.push(`⚠️ Sous ton minimum de ${cfg.sommeil.minimumH}h.`);
      ev.push({
        kind: 'sommeil', uid: `sommeil-${n.start}`, start: n.start, end: n.end, busy: true,
        title: `😴 Sommeil ${fmtH(n.ms)}${short ? ' ⚠️' : ''}`, description: lines.join('\n'),
      });
    }
  }

  for (const s of r.ueSessions) {
    const midi = Number(localTime(s.start, tz).slice(0, 2)) < 16;
    const gain = Math.round(((s.end - s.start) / H) * cfg.uberEats.gainHoraireEstime);
    ev.push({
      kind: 'ue', uid: `ue-${s.start}`, start: s.start, end: s.end, busy: true,
      title: cfg.uberEats.libelle, alarmMin: cfg.uberEats.rappelMin,
      description: `Rush du ${midi ? 'midi' : 'soir'} · ~${gain} ${cfg.uberEats.devise} estimés `
        + `(${cfg.uberEats.gainHoraireEstime} ${cfg.uberEats.devise}/h)`,
    });
  }

  for (const s of r.sportSessions) {
    ev.push({
      kind: 'sport', uid: `sport-${s.start}`, start: s.start, end: s.end, busy: true,
      title: cfg.sport.libelle, alarmMin: cfg.sport.rappelMin,
      description: 'Placé sur un des jours les plus légers de la semaine.',
    });
  }

  if (cfg.tempsLibre.afficher) {
    for (const b of r.freeBlocks) {
      ev.push({
        kind: 'libre', uid: `libre-${b.start}`, start: b.start, end: b.end, busy: false,
        title: cfg.tempsLibre.libelle, description: 'Rien de prévu : à protéger.',
      });
    }
  }

  for (const week of r.weeks) {
    const lines = [weekHeadline(week, cfg)];
    if (week.dayOff) lines.push(`Jour off protégé : ${fmtDay(week.dayOff)}`);
    for (const w of week.warnings) lines.push(`⚠️ ${warningText(w, cfg)}`);
    ev.push({
      kind: 'bilan', uid: `bilan-${week.monday}`, allDay: true, date: week.monday, busy: false,
      title: `📊 ${weekHeadline(week, cfg)}${week.warnings.length ? ` · ⚠️${week.warnings.length}` : ''}`,
      description: lines.join('\n'),
    });
  }

  for (const e of ev) e.uid = `${e.uid}@planning.portefeuille`;
  return ev.sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || (a.start || 0) - (b.start || 0));
}

function toText(r, cfg, events) {
  const tz = r.tz;
  const out = [];
  out.push(`PLANNING — généré le ${fmtDay(localDateOf(r.now, tz))} à ${localTime(r.now, tz)} (${tz})`);
  out.push(r.lastShiftDay ? `Dernier shift Tanda connu : ${fmtDay(r.lastShiftDay)}` : 'Aucun shift Tanda trouvé');

  for (const week of r.weeks) {
    out.push('', `━━━ Semaine du ${fmtDay(week.monday)} ━━━`, weekHeadline(week, cfg));
    if (week.dayOff) out.push(`Jour off protégé : ${fmtDay(week.dayOff)}`);
    for (const w of week.warnings) out.push(`⚠️  ${warningText(w, cfg)}`);
    for (const day of week.days) {
      const dayEvents = events.filter((e) => !e.allDay && localDateOf(e.start, tz) === day);
      out.push('', fmtDay(day));
      if (!dayEvents.length) out.push('  —');
      for (const e of dayEvents) {
        const plusOne = localDateOf(e.end, tz) !== day ? ' (+1)' : '';
        out.push(`  ${localTime(e.start, tz)}–${localTime(e.end, tz)}${plusOne.padEnd(5)} ${e.title}`);
      }
    }
  }
  return `${out.join('\n')}\n`;
}

/** Point d'entrée : texte .ics Tanda -> { ics, text, result }. */
function buildPlanning(tandaIcs, cfg, now = Date.now()) {
  const { events: shifts, declaredTz } = parseIcs(tandaIcs, cfg.fuseau);
  const result = plan(shifts, cfg, now);
  const events = collectEvents(result, cfg);
  let text = toText(result, cfg, events);
  if (declaredTz && declaredTz !== cfg.fuseau) {
    text = `⚠️  Le flux Tanda est en ${declaredTz} mais le planning est réglé sur ${cfg.fuseau}\n${text}`;
  }
  const ics = writeIcs(events, { name: cfg.nomCalendrier, timezone: cfg.fuseau, now });
  return { ics, text, result, events, declaredTz };
}

module.exports = { buildPlanning, collectEvents, toText, fmtH };

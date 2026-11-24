#!/usr/bin/env node
'use strict';

/* ==========================================================================
   Aperçu en ligne de commande.
     node cli.js <fichier.ics | URL Tanda> [--ics sortie.ics] [--date AAAA-MM-JJ]
   Sans argument, lit la variable TANDA_ICS_URL.
   ========================================================================== */

const fs = require('node:fs');
const config = require('./config');
const { buildPlanning } = require('./lib/report');
const { at } = require('./lib/tz');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const icsOut = opt('--ics');
  const date = opt('--date');
  const source = (args[0] || process.env.TANDA_ICS_URL || '').trim();
  if (!source) {
    console.error('Usage : node cli.js <fichier.ics | URL Tanda> [--ics sortie.ics] [--date AAAA-MM-JJ]');
    process.exit(1);
  }

  let text;
  if (/^(https?|webcal):/i.test(source)) {
    const r = await fetch(source.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Tanda a répondu HTTP ${r.status}`);
    text = await r.text();
  } else {
    text = fs.readFileSync(source, 'utf8');
  }

  const now = date ? at(date, '08:00', config.fuseau) : Date.now();
  const out = buildPlanning(text, config, now);
  process.stdout.write(out.text);
  if (icsOut) {
    fs.writeFileSync(icsOut, out.ics);
    console.log(`\n→ ${out.events.length} évènements écrits dans ${icsOut}`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });

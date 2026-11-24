'use strict';

/* ==========================================================================
   Fonction Vercel : flux d'abonnement calendrier.
     GET /planning.ics?cle=XXX            -> calendrier (.ics)
     GET /planning.ics?cle=XXX&format=texte -> résumé lisible
   Variables d'environnement (jamais dans le dépôt) :
     TANDA_ICS_URL  lien d'abonnement calendrier fourni par Tanda
     PLANNING_KEY   clé secrète qui protège ce flux
   ========================================================================== */

const crypto = require('node:crypto');
const config = require('../config');
const { buildPlanning } = require('../lib/report');

function sameSecret(a, b) {
  const A = crypto.createHash('sha256').update(String(a)).digest();
  const B = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = process.env.PLANNING_KEY;
  if (!key || !sameSecret(url.searchParams.get('cle') || '', key)) {
    res.statusCode = 404;
    return res.end('Not found');
  }

  const tandaUrl = (process.env.TANDA_ICS_URL || '').trim().replace(/^webcal:/i, 'https:');
  if (!tandaUrl) {
    res.statusCode = 500;
    return res.end('TANDA_ICS_URL manquant');
  }

  let tandaIcs;
  try {
    const r = await fetch(tandaUrl, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tandaIcs = await r.text();
  } catch (err) {
    // Une erreur fait garder l'ancienne version au calendrier abonné : mieux qu'un planning vide.
    res.statusCode = 502;
    return res.end(`Tanda injoignable : ${err.message}`);
  }

  const { ics, text } = buildPlanning(tandaIcs, config, Date.now());
  res.setHeader('Cache-Control', 'private, max-age=0, s-maxage=600');
  if (url.searchParams.get('format') === 'texte') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(text);
  }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="planning.ics"');
  return res.end(ics);
};

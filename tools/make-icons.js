// Génère les icônes PNG de l'app avec Playwright (Chromium).
// Usage : node tools/make-icons.js
const { chromium } = require('playwright');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <rect x="96" y="150" width="320" height="230" rx="36" fill="#fff" opacity=".96"/>
  <path d="M96 200h320" stroke="#1d4ed8" stroke-width="22" opacity=".18"/>
  <rect x="300" y="235" width="140" height="80" rx="24" fill="#dbe6fd"/>
  <circle cx="345" cy="275" r="16" fill="#1d4ed8"/>
  <path d="M140 330 l50-45 40 30 60-70" fill="none" stroke="#0f9d8a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = path.join(__dirname, '..', 'web', 'icons');
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}</style><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`);
    await page.screenshot({ path: path.join(out, name), omitBackground: false });
  }
  await browser.close();
})();

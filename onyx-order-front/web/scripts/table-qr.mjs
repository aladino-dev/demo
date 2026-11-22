// Génère une page imprimable avec un QR code par table.
// Usage : npm run qr:tables -- <slug> <nombre de tables> <adresse du site> [nom affiché]
//   ex. : npm run qr:tables -- nsgrill 10 https://nsgrill.byonyx.fr
// Résultat : onyx-order/qr-tables/<slug>.html (ouvrir dans le navigateur, puis Imprimer / PDF).
// Chaque QR ouvre le site avec ?table=N : le client arrive en « Sur place », table verrouillée.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const [slug, count, site, ...nameParts] = process.argv.slice(2);
const n = parseInt(count, 10);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '') || !(n >= 1 && n <= 200) || !/^https?:\/\//.test(site || '')) {
  console.error('Usage : npm run qr:tables -- <slug> <nombre de tables 1-200> <adresse du site> [nom affiché]');
  console.error('ex.   : npm run qr:tables -- nsgrill 10 https://nsgrill.byonyx.fr');
  process.exit(1);
}
const base = site.replace(/\/+$/, '');
const name = (nameParts.join(' ') || slug).toUpperCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cards = [];
for (let t = 1; t <= n; t++) {
  const url = `${base}/?table=${t}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
  cards.push(`<section class="card"><div class="brand">${esc(name)}</div><div class="tbl">Table ${t}</div><div class="qr">${svg}</div><div class="cta">Scanne et commande</div><div class="url">${esc(url)}</div></section>`);
}

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>QR codes des tables – ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Poppins:wght@500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Poppins', sans-serif; background: #fff; color: #000; }
  .bar { padding: 12px 16px; background: #000; color: #fff; font-size: 14px; }
  .bar button { margin-left: 12px; padding: 8px 16px; border: 0; border-radius: 4px; background: #DD2424; color: #fff; font: 700 13px 'Poppins'; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; padding: 8mm; }
  .card { border: 2px solid #000; border-radius: 8px; padding: 8mm 6mm; text-align: center; break-inside: avoid; }
  .brand { font: 400 22px 'Bebas Neue'; letter-spacing: .08em; background: #000; color: #fff; display: inline-block; padding: 2px 14px; border-radius: 4px; }
  .tbl { font: 400 64px/1 'Bebas Neue'; color: #DD2424; margin: 8px 0 4px; letter-spacing: .02em; }
  .qr svg { width: 58mm; height: 58mm; display: block; margin: 0 auto; }
  .cta { font: 700 14px 'Poppins'; text-transform: uppercase; letter-spacing: .06em; margin-top: 6px; }
  .url { font-size: 9px; color: #606060; margin-top: 4px; word-break: break-all; }
  @media print { .bar { display: none; } .grid { padding: 0; } }
</style></head><body>
<div class="bar">${n} tables · ${esc(base)} <button onclick="print()">Imprimer / PDF</button></div>
<div class="grid">${cards.join('\n')}</div>
</body></html>`;

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../qr-tables');
mkdirSync(out, { recursive: true });
const file = resolve(out, `${slug}.html`);
writeFileSync(file, html);
console.log(`OK : ${n} QR codes -> ${file}`);

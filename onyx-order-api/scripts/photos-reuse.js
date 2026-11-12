// Réutilise des photos d'un restaurant existant pour un autre, depuis un fichier de correspondance : aucun code propre à un restaurant.
// Usage : npm run menu:photos -- --from fastcamion --slug nsgrill --file data/photos-nsgrill.json
// Fichier : { "products": { "Produit cible": "Produit source" }, "options": { "Option cible": "Option source" } }
// Les fichiers sont COPIÉS dans photos/<slug>/ (les originaux ne bougent pas). Ne remplace jamais une photo déjà présente.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });

const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };
if (!a.from || !a.slug || !a.file) fail('--from, --slug et --file obligatoires.');
const cfg = JSON.parse(fs.readFileSync(path.resolve(a.file), 'utf8'));
const dest = path.join(ROOT, 'photos', a.slug);
fs.mkdirSync(dest, { recursive: true });

function copy(url) {
  const src = path.join(ROOT, url.replace(/^\/photos\//, 'photos/'));
  if (!fs.existsSync(src)) return null;
  const name = path.basename(src);
  fs.copyFileSync(src, path.join(dest, name));
  return `/photos/${a.slug}/${name}`;
}

await connect();
const done = await tx(async (c) => {
  const ids = {};
  for (const s of [a.from, a.slug]) {
    const { rows: [r] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [s]);
    if (!r) fail(`restaurant « ${s} » introuvable.`);
    ids[s] = r.id;
  }
  let n = 0; const miss = [];
  for (const [table, col, map] of [['products', 'name', cfg.products || {}], ['options', 'label', cfg.options || {}]]) {
    for (const [target, source] of Object.entries(map)) {
      let { rows: [s] } = await c.query(`SELECT photo FROM ${table} WHERE restaurant_id = $1 AND ${col} = $2 AND photo IS NOT NULL AND archived_at IS NULL LIMIT 1`, [ids[a.from], source]);
      // une option peut reprendre la photo d'un produit du restaurant source (ex. la boisson vendue seule)
      if (!s && table === 'options') ({ rows: [s] } = await c.query('SELECT photo FROM products WHERE restaurant_id = $1 AND name = $2 AND photo IS NOT NULL AND archived_at IS NULL LIMIT 1', [ids[a.from], source]));
      const url = s && copy(s.photo);
      if (!url) { miss.push(`${target} (source « ${source} » sans photo)`); continue; }
      const r = await c.query(`UPDATE ${table} SET photo = $3 WHERE restaurant_id = $1 AND ${col} = $2 AND photo IS NULL`, [ids[a.slug], target, url]);
      if (r.rowCount) n += r.rowCount; else miss.push(`${target} (introuvable ou déjà une photo)`);
    }
  }
  return { n, miss };
});
console.log(`Photos associées : ${done.n}`);
if (done.miss.length) console.log('Non faites :\n- ' + done.miss.join('\n- '));
await close();

// Importe un dossier de photos (png/jpg/webp) dans un restaurant : conversion WebP 800 px et association aux produits ou options.
// Usage : npm run menu:import-photos -- --slug nsgrill --dir "C:\...\sandwitch" --file data/photos-nsgrill-sandwichs.json
// Fichier : { "products": { "adana.png": "Adana" }, "options": { "harissa.jpg": "Harissa" } }  (nom de fichier -> nom exact du produit / de l'option)
// Remplace la photo actuelle ; l'ancien fichier reste sur le disque (rien n'est supprimé).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });

const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };
if (!a.slug || !a.dir || !a.file) fail('--slug, --dir et --file obligatoires.');
const cfg = JSON.parse(fs.readFileSync(path.resolve(a.file), 'utf8'));
const out = path.join(ROOT, 'photos', a.slug);
fs.mkdirSync(out, { recursive: true });

await connect();
const res = await tx(async (c) => {
  const { rows: [r] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [a.slug]);
  if (!r) fail(`restaurant « ${a.slug} » introuvable.`);
  let n = 0; const miss = [];
  for (const [table, col, map] of [['products', 'name', cfg.products || {}], ['options', 'label', cfg.options || {}]]) {
    for (const [file, targets] of Object.entries(map)) {
      const src = path.join(a.dir, file);
      if (!fs.existsSync(src)) { miss.push(`${file} (fichier absent)`); continue; }
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.webp`;
      await sharp(src).rotate().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(out, name));
      // une même photo peut servir plusieurs produits : "fichier": ["Produit A", "Produit B"]
      for (const target of [].concat(targets)) {
        const u = await c.query(`UPDATE ${table} SET photo = $3 WHERE restaurant_id = $1 AND ${col} = $2 AND archived_at IS NULL`, [r.id, target, `/photos/${a.slug}/${name}`]);
        if (u.rowCount) n += u.rowCount; else miss.push(`${file} (« ${target} » introuvable)`);
      }
    }
  }
  return { n, miss };
});
console.log(`Photos associées : ${res.n}`);
if (res.miss.length) console.log('Non faites :\n- ' + res.miss.join('\n- '));
await close();

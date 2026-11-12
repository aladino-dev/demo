// Exporte un restaurant (fiche, horaires, carte, options) dans un fichier JSON, sans commandes ni comptes ni secrets.
// Usage : node scripts/restaurant-export.js --slug nsgrill --out ../../onyx-order-deploy/nsgrill.json
// Sert à envoyer une carte préparée en local vers un serveur (voir restaurant-import.js).
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
if (!a.slug || !a.out) { console.error('Erreur : --slug et --out obligatoires.'); process.exit(1); }

await connect();
const dump = await tx(async (c) => {
  const { rows: [r] } = await c.query('SELECT * FROM restaurants WHERE slug = $1', [a.slug]);
  if (!r) { console.error(`Erreur : restaurant « ${a.slug} » introuvable.`); process.exit(1); }
  const get = async (t, order = 'id') => (await c.query(`SELECT * FROM ${t} WHERE restaurant_id = $1 ORDER BY ${order}`, [r.id])).rows;
  const { id, created_at, smtp, ...restaurant } = r; // le SMTP (secrets) ne voyage jamais
  return {
    restaurant,
    opening_hours: await get('opening_hours'),
    categories: await get('categories'),
    option_groups: await get('option_groups'),
    options: await get('options'),
    products: await get('products'),
    option_group_links: await get('option_group_links'),
  };
});
fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
fs.writeFileSync(path.resolve(a.out), JSON.stringify(dump));
console.log(Object.entries(dump).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : 1}`).join(' | '));
await close();

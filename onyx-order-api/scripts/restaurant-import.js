// Importe un restaurant exporté (restaurant-export.js) dans cette base et crée ses comptes.
// Usage : node scripts/restaurant-import.js --file nsgrill.json --owner proprio@exemple.fr [--cuisine cuisine@exemple.fr] [--demo]
//   --demo : bandeau « Démonstration » et site non référencé par les moteurs de recherche.
// Les mots de passe générés ne s'affichent PAS : ils sont écrits dans --passwords (défaut : comptes-<slug>.txt, lisible par vous seul).
// Refuse d'écrire si le restaurant existe déjà.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };
if (!a.file || !a.owner) fail('--file et --owner obligatoires.');
const d = JSON.parse(fs.readFileSync(path.resolve(a.file), 'utf8'));
const slug = d.restaurant.slug;
const out = a.passwords && a.passwords !== true ? a.passwords : path.resolve(`comptes-${slug}.txt`);

// colonnes json/jsonb : à sérialiser ; les listes PostgreSQL (text[]) passent telles quelles
const jsonCols = new Map();
async function insert(c, table, row, drop = ['id']) {
  if (!jsonCols.has(table)) jsonCols.set(table, new Set((await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type IN ('json','jsonb')", [table])).rows.map((x) => x.column_name)));
  const val = (k, v) => (jsonCols.get(table).has(k) && v !== null ? JSON.stringify(v) : v);
  const keys = Object.keys(row).filter((k) => !drop.includes(k));
  const { rows: [x] } = await c.query(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, keys.map((k) => val(k, row[k])));
  return x.id;
}

await connect();
const accounts = await tx(async (c) => {
  const { rows: [ex] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [slug]);
  if (ex) fail(`« ${slug} » existe déjà : import annulé.`);
  const restaurant = { ...d.restaurant };
  if (a.demo) restaurant.settings = { ...(restaurant.settings || {}), demo: true, noindex: true };
  const rid = await insert(c, 'restaurants', restaurant);
  const map = { categories: new Map(), option_groups: new Map(), options: new Map(), products: new Map() };
  const ins = (table, row, fk = {}) => {
    const r = { ...row, restaurant_id: rid };
    for (const [col, m] of Object.entries(fk)) if (r[col] != null) r[col] = m.get(r[col]);
    return insert(c, table, r);
  };
  for (const h of d.opening_hours) await ins('opening_hours', h);
  for (const k of d.categories) map.categories.set(k.id, await ins('categories', k));
  for (const g of d.option_groups) map.option_groups.set(g.id, await ins('option_groups', g));
  for (const o of d.options) map.options.set(o.id, await ins('options', o, { group_id: map.option_groups }));
  for (const p of d.products) map.products.set(p.id, await ins('products', p, { category_id: map.categories }));
  for (const l of d.option_group_links) await ins('option_group_links', l, { group_id: map.option_groups, product_id: map.products, category_id: map.categories });
  const list = [{ email: a.owner, role: 'owner' }];
  if (a.cuisine && a.cuisine !== true) list.push({ email: a.cuisine, role: 'cuisine' });
  for (const u of list) {
    u.password = crypto.randomBytes(9).toString('base64url');
    await c.query('INSERT INTO users (restaurant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)', [rid, u.email, await bcrypt.hash(u.password, 10), u.role]);
  }
  return list;
});
fs.writeFileSync(out, accounts.map((u) => `${u.role}\t${u.email}\t${u.password}`).join('\n') + '\n', { mode: 0o600 });
console.log(`Restaurant « ${slug} » importé : ${d.categories.length} catégories, ${d.products.length} produits, ${d.option_groups.length} listes d'options.`);
console.log(`Comptes créés : ${accounts.map((u) => `${u.role} ${u.email}`).join(', ')}. Mots de passe dans : ${out}`);
await close();

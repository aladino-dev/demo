// Applique des listes d'options à un restaurant depuis un fichier JSON : aucun code propre à un restaurant.
// Usage : npm run menu:options -- --slug nsgrill --file data/options-nsgrill.json
// Fichier : { "groups": [{ "key","title","description","min","max","required","options":[{"label","price_cents"}] }],
//             "links":  [{ "group": "key", "category": "Nom de catégorie", "except": ["Nom de produit"], "only": ["Nom de produit"] }] }
// Une option peut avoir "default": true : elle est présélectionnée (le client peut en changer).
// Les liens s'appliquent aux produits visibles de la catégorie (price_cents peut être négatif : réduction).
// Refuse de s'exécuter si une clé de liste existe déjà pour ce restaurant.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });

const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };
if (!a.slug || !a.file) fail('--slug et --file obligatoires.');
const cfg = JSON.parse(fs.readFileSync(path.resolve(a.file), 'utf8'));

await connect();
const res = await tx(async (c) => {
  const { rows: [r] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [a.slug]);
  if (!r) fail(`restaurant « ${a.slug} » introuvable.`);
  const { rows: dup } = await c.query('SELECT key FROM option_groups WHERE restaurant_id = $1 AND key = ANY($2)', [r.id, (cfg.groups || []).map((g) => g.key)]);
  if (dup.length) fail(`listes déjà présentes : ${dup.map((d) => d.key).join(', ')}`);
  const { rows: [{ m }] } = await c.query('SELECT coalesce(max(sort),0) m FROM option_groups WHERE restaurant_id = $1', [r.id]);
  const id = {};
  let s = m;
  for (const g of cfg.groups || []) {
    const { rows: [x] } = await c.query(
      `INSERT INTO option_groups (restaurant_id, key, title, description, min_select, max_select, required, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [r.id, g.key, g.title, g.description || '', g.min ?? 0, g.max ?? null, !!g.required, ++s]);
    id[g.key] = x.id;
    let o = 0;
    for (const op of g.options) {
      await c.query('INSERT INTO options (restaurant_id, group_id, label, price_cents, is_default, sort) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, x.id, op.label, op.price_cents || 0, !!op.default, ++o]);
    }
  }
  // "expand" : remplace un choix par plusieurs (même prix, même liste), l'original est archivé. Ex. « Canette 33 cl » -> Coca-Cola, Fanta…
  for (const e of cfg.expand || []) {
    const { rows: olds } = await c.query('SELECT id, group_id, price_cents, sort FROM options WHERE restaurant_id = $1 AND label = $2 AND archived_at IS NULL', [r.id, e.label]);
    for (const old of olds) {
      let k = 0;
      for (const label of e.into) {
        await c.query('INSERT INTO options (restaurant_id, group_id, label, price_cents, sort) VALUES ($1,$2,$3,$4,$5)', [r.id, old.group_id, label, old.price_cents, old.sort * 100 + ++k]);
      }
      await c.query('UPDATE options SET archived_at = now() WHERE id = $1', [old.id]);
    }
  }
  const sort = new Map();
  let links = 0;
  for (const l of cfg.links) {
    if (!id[l.group]) { // liste déjà existante du restaurant
      const { rows: [e] } = await c.query('SELECT id FROM option_groups WHERE restaurant_id = $1 AND key = $2 AND archived_at IS NULL', [r.id, l.group]);
      if (e) id[l.group] = e.id;
    }
    if (!id[l.group]) fail(`lien : liste « ${l.group} » inconnue.`);
    const { rows: prods } = await c.query(
      `SELECT p.id FROM products p JOIN categories k ON k.id = p.category_id
       WHERE p.restaurant_id = $1 AND k.name = $2 AND p.archived_at IS NULL AND NOT (p.name = ANY($3)) AND (cardinality($4::text[]) = 0 OR p.name = ANY($4)) ORDER BY p.sort`,
      [r.id, l.category, l.except || [], l.only || []]);
    if (!prods.length) fail(`lien : aucun produit dans la catégorie « ${l.category} ».`);
    for (const p of prods) {
      const { rows: [{ n, has }] } = await c.query(
        'SELECT count(*)::int n, bool_or(group_id = $2) has FROM option_group_links WHERE product_id = $1', [p.id, id[l.group]]);
      if (has) continue; // déjà lié
      sort.set(p.id, n + 1);
      await c.query('INSERT INTO option_group_links (restaurant_id, group_id, product_id, sort) VALUES ($1,$2,$3,$4)', [r.id, id[l.group], p.id, sort.get(p.id)]);
      links++;
    }
  }
  return { groups: (cfg.groups || []).length, links };
});
console.log(`Options : ${res.groups} listes, ${res.links} liens produit.`);
await close();

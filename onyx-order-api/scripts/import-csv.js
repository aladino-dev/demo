// Importe une carte depuis un CSV « Categorie,Article,Prix » dans un restaurant existant.
// Usage : npm run menu:csv -- --slug nsgrill --file data/menu-nsgrill.csv
// Les catégories et produits gardent l'ordre du fichier. Refuse d'écrire si le restaurant a déjà des produits.
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

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const lines = fs.readFileSync(path.resolve(a.file), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1);
const rows = lines.map((l, n) => {
  const m = l.match(/^([^,]+),(.+),\s*(\d+(?:[.,]\d{1,2})?)\s*€?\s*$/);
  if (!m) fail(`ligne ${n + 2} illisible : ${l}`);
  return { cat: m[1].trim(), name: m[2].trim(), cents: Math.round(parseFloat(m[3].replace(',', '.')) * 100) };
});

await connect();
const res = await tx(async (c) => {
  const { rows: [r] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [a.slug]);
  if (!r) fail(`restaurant « ${a.slug} » introuvable.`);
  const { rows: [{ n }] } = await c.query('SELECT count(*)::int n FROM products WHERE restaurant_id = $1', [r.id]);
  if (n > 0) fail(`« ${a.slug} » a déjà ${n} produits : import annulé.`);
  const cats = new Map();
  const used = new Set();
  let p = 0;
  for (const x of rows) {
    if (!cats.has(x.cat)) {
      const { rows: [k] } = await c.query(
        'INSERT INTO categories (restaurant_id, name, slug, sort, visible) VALUES ($1,$2,$3,$4,true) RETURNING id',
        [r.id, x.cat, slugify(x.cat), (cats.size + 1) * 10]);
      cats.set(x.cat, k.id);
    }
    let slug = slugify(x.name) || 'produit'; let i = 2;
    while (used.has(slug)) slug = `${slugify(x.name)}-${i++}`;
    used.add(slug);
    await c.query(
      'INSERT INTO products (restaurant_id, category_id, name, slug, description, price_cents, visible, sort) VALUES ($1,$2,$3,$4,\'\',$5,true,$6)',
      [r.id, cats.get(x.cat), x.name, slug, x.cents, ++p * 10]);
  }
  return { cats: cats.size, products: p };
});
console.log(`Importé : ${res.cats} catégories, ${res.products} produits.`);
await close();

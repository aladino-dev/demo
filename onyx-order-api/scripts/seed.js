// Importe data/seed-food-station.json dans la base.
// Usage : npm run seed            (crée le restaurant s'il n'existe pas)
//         npm run seed -- --reset (remplace la carte du restaurant ; les commandes de test sont effacées)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const file = process.argv.find((a) => a.endsWith('.json')) || path.join(ROOT, 'data/seed-food-station.json');
const reset = process.argv.includes('--reset');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));

export const photoName = (src) => (src ? path.basename(src).replace(/\.[a-z0-9]+$/i, '') + '.webp' : null);

await connect();
const R = s.restaurant;
const created = await tx(async (c) => {
  const { rows: [existing] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [R.slug]);
  if (existing && !reset) return null;
  if (existing) await c.query('DELETE FROM restaurants WHERE id = $1', [existing.id]);

  const settings = {
    modes: R.modes, payment: R.payment, payment_note: R.payment_note, tags: R.tags,
    order_cutoff: R.order_cutoff, anti_bot: R.anti_bot,
    // restaurant de démonstration : bandeau « Démonstration » sur le site, jamais indexé par les moteurs de recherche
    ...(R.demo ? { demo: true } : {}), ...(R.noindex ? { noindex: true } : {}),
  };
  const { rows: [r] } = await c.query(
    `INSERT INTO restaurants (slug, name, legal_name, address, postcode, city, phone, timezone, currency, modules, settings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [R.slug, R.name, R.legal_name, R.address, R.postcode, R.city, R.phone, R.timezone, R.currency, R.modules, settings]);
  const rid = r.id;

  for (const h of s.opening_hours) {
    await c.query('INSERT INTO opening_hours (restaurant_id, day_index, opens, closes, enabled) VALUES ($1,$2,$3,$4,$5)',
      [rid, h.day_index, h.opens, h.closes, h.enabled]);
  }
  for (const [i, z] of s.delivery_zones.entries()) {
    await c.query(`INSERT INTO delivery_zones (restaurant_id, name, postcodes, cities, fee_cents, min_order_cents, sort)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [rid, z.name, z.postcodes, z.cities, z.fee_cents, z.min_order_cents, i]);
  }
  const catId = new Map();
  for (const k of s.categories) {
    const { rows: [x] } = await c.query(
      'INSERT INTO categories (restaurant_id, name, slug, sort, visible, source_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [rid, k.name, k.slug, k.sort, k.visible, String(k.wp_id)]);
    catId.set(k.wp_id, x.id);
  }
  const prodId = new Map();
  for (const p of s.products) {
    const { rows: [x] } = await c.query(
      `INSERT INTO products (restaurant_id, category_id, name, slug, description, price_cents, photo, visible, sort, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [rid, catId.get(p.category_wp_id) ?? null, p.name, p.slug, p.description, p.price_cents,
        photoName(p.photo_source) && `/photos/${R.slug}/${photoName(p.photo_source)}`, p.visible, p.sort, String(p.wp_id)]);
    prodId.set(p.wp_id, x.id);
  }
  const groupId = new Map();
  for (const [i, g] of s.option_groups.entries()) {
    const { rows: [x] } = await c.query(
      `INSERT INTO option_groups (restaurant_id, key, title, description, min_select, max_select, required, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [rid, g.key, g.title, g.description, g.min, g.max, g.required, i]);
    groupId.set(g.key, x.id);
    for (const o of g.options) {
      await c.query('INSERT INTO options (restaurant_id, group_id, label, price_cents, sort) VALUES ($1,$2,$3,$4,$5)',
        [rid, x.id, o.label, o.price_cents, o.sort]);
    }
  }
  for (const l of s.option_links) {
    await c.query(`INSERT INTO option_group_links (restaurant_id, group_id, product_id, category_id, sort) VALUES ($1,$2,$3,$4,$5)`,
      [rid, groupId.get(l.group), l.product_wp_id ? prodId.get(l.product_wp_id) : null,
        l.category_wp_id ? catId.get(l.category_wp_id) : null, l.sort]);
  }
  for (const p of s.promo_codes) {
    await c.query(`INSERT INTO promo_codes (restaurant_id, code, kind, value, first_order_only, per_customer_limit)
      VALUES ($1,$2,$3,$4,$5,$6)`, [rid, p.code, p.type, p.value, p.first_order_only, p.per_customer_limit]);
  }

  // Comptes de démonstration : mots de passe générés, affichés une seule fois dans ce terminal
  // Démonstration : seuls les comptes de test PUBLICS du fichier (mots de passe connus, affichés sur la page de démo).
  // Sinon : comptes générés avec des mots de passe aléatoires.
  const accounts = R.demo && Array.isArray(s.demo_accounts) && s.demo_accounts.length
    ? s.demo_accounts.map((d) => ({ email: d.email, role: d.role, password: d.password }))
    : [
      { email: process.env.SEED_OWNER_EMAIL || `admin@${R.slug}.local`, role: 'owner' },
      { email: `cuisine@${R.slug}.local`, role: 'cuisine' },
    ];
  for (const a of accounts) {
    a.password = a.password || crypto.randomBytes(6).toString('base64url');
    await c.query('INSERT INTO users (restaurant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)',
      [rid, a.email, await bcrypt.hash(a.password, 10), a.role]);
  }
  return { rid, accounts, counts: { categories: s.categories.length, products: s.products.length, groups: s.option_groups.length } };
});

if (!created) {
  console.log(`Le restaurant « ${R.slug} » existe déjà. Pour tout réimporter : npm run seed -- --reset`);
} else {
  console.log(`Import terminé : ${created.counts.categories} catégories, ${created.counts.products} produits, ${created.counts.groups} groupes d'options.`);
  console.log('\nComptes créés (notez-les, ils ne seront plus affichés) :');
  for (const a of created.accounts) console.log(`  ${a.role.padEnd(8)} ${a.email}  mot de passe : ${a.password}`);
}
await close();

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { q, tx } from './db.js';
import { OrderError } from './orders.js';
import { audit } from './audit.js';

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const cents = (v) => {
  const n = parseInt(v, 10);
  if (!(n >= 0)) throw new OrderError('Prix invalide.');
  return n;
};
const intOr = (v, d) => (Number.isInteger(parseInt(v, 10)) ? parseInt(v, 10) : d);

/** Construit un UPDATE partiel à partir des champs présents dans `body`. */
function patchSql(table, rid, id, fields, body) {
  const sets = [];
  const params = [rid, id];
  for (const [key, conv] of Object.entries(fields)) {
    if (body[key] === undefined) continue;
    params.push(conv(body[key]));
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw new OrderError('Rien à modifier.');
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE restaurant_id = $1 AND id = $2 RETURNING id`, params };
}

async function run(table, rid, id, fields, body) {
  const { sql, params } = patchSql(table, rid, id, fields, body);
  const { rows: [row] } = await q(sql, params);
  if (!row) throw new OrderError('Introuvable.', 404);
}

async function setLinks(c, rid, { productId = null, categoryId = null }, groupIds) {
  await c.query('DELETE FROM option_group_links WHERE restaurant_id = $1 AND product_id IS NOT DISTINCT FROM $2 AND category_id IS NOT DISTINCT FROM $3',
    [rid, productId, categoryId]);
  const ids = [...new Set((groupIds || []).map(Number))];
  for (const [i, gid] of ids.entries()) {
    await c.query(
      `INSERT INTO option_group_links (restaurant_id, group_id, product_id, category_id, sort)
       SELECT $1, g.id, $3, $4, $5 FROM option_groups g WHERE g.id = $2 AND g.restaurant_id = $1`,
      [rid, gid, productId, categoryId, i]);
  }
}

async function savePhoto(req, photosDir) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new OrderError('Aucune image reçue.');
  const { rows: [rest] } = await q('SELECT slug FROM restaurants WHERE id = $1', [req.user.rid]);
  const dir = path.join(photosDir, rest.slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.webp`;
  try {
    await sharp(req.body).rotate().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, file));
  } catch {
    throw new OrderError('Image illisible (formats acceptés : JPG, PNG, WebP).');
  }
  return `/photos/${rest.slug}/${file}`;
}

export function catalogRouter({ owner, wrap, photosDir }) {
  const r = express.Router();
  r.use(owner);

  const rid = (req) => req.user.rid;
  const pid = (req) => Number(req.params.id);
  const getRow = async (table, req) => {
    const { rows: [row] } = await q(`SELECT * FROM ${table} WHERE restaurant_id = $1 AND id = $2`, [rid(req), pid(req)]);
    if (!row) throw new OrderError('Introuvable.', 404);
    return row;
  };
  /** Enregistre l'ordre : ids dans l'ordre voulu (seuls ceux du restaurant sont touchés). */
  const reorder = async (table, req) => {
    const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
    if (!ids.length) throw new OrderError('Liste vide.');
    await q(`UPDATE ${table} t SET sort = v.pos FROM unnest($2::int[]) WITH ORDINALITY AS v(id, pos)
              WHERE t.id = v.id AND t.restaurant_id = $1`, [rid(req), ids]);
  };

  r.get('/catalog', wrap(async (req, res) => {
    const id = rid(req);
    const [cats, prods, groups, opts, links] = await Promise.all([
      q('SELECT id, name, visible, sort, archived_at FROM categories WHERE restaurant_id = $1 ORDER BY sort, name', [id]),
      q(`SELECT id, category_id, name, description, price_cents, photo, visible, sort, archived_at,
                (sold_out_until IS NOT NULL AND sold_out_until > now()) AS sold_out
           FROM products WHERE restaurant_id = $1 ORDER BY sort, name`, [id]),
      q('SELECT id, title, internal_name, description, min_select, max_select, required FROM option_groups WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY title', [id]),
      q('SELECT id, group_id, label, price_cents, photo, visible FROM options WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, id', [id]),
      q('SELECT group_id, product_id, category_id FROM option_group_links WHERE restaurant_id = $1 ORDER BY sort', [id]),
    ]);
    const ids = (key, v) => links.rows.filter((l) => l[key] === v).map((l) => l.group_id);
    const withGroups = (p) => ({ ...p, group_ids: ids('product_id', p.id) });
    res.json({
      categories: cats.rows.filter((c) => !c.archived_at).map((c) => ({ ...c, group_ids: ids('category_id', c.id) })),
      products: prods.rows.filter((p) => !p.archived_at).map(withGroups),
      archived: {
        categories: cats.rows.filter((c) => c.archived_at),
        products: prods.rows.filter((p) => p.archived_at).map(withGroups),
      },
      groups: groups.rows.map((g) => ({ ...g, options: opts.rows.filter((o) => o.group_id === g.id) })),
    });
  }));

  // ----- Catégories -----
  r.post('/categories', wrap(async (req, res) => {
    const name = text(req.body?.name, 80);
    if (!name) throw new OrderError('Indiquez le nom de la catégorie.');
    const { rows: [c] } = await q(
      `INSERT INTO categories (restaurant_id, name, slug, sort)
       VALUES ($1, $2, $3, (SELECT coalesce(max(sort), 0) + 1 FROM categories WHERE restaurant_id = $1)) RETURNING id`,
      [rid(req), name, slugify(name)]);
    await audit(req, 'category', c.id, 'create', null, { name });
    res.status(201).json(c);
  }));

  r.post('/categories/reorder', wrap(async (req, res) => {
    await reorder('categories', req);
    await audit(req, 'category', null, 'reorder', null, { ids: req.body.ids });
    res.json({ ok: true });
  }));

  r.patch('/categories/:id', wrap(async (req, res) => {
    const before = await getRow('categories', req);
    await run('categories', rid(req), pid(req), {
      name: (v) => { const t = text(v, 80); if (!t) throw new OrderError('Nom vide.'); return t; },
      visible: Boolean,
    }, req.body || {});
    await audit(req, 'category', pid(req), 'update', { name: before.name, visible: before.visible }, req.body);
    res.json({ ok: true });
  }));

  r.put('/categories/:id/option-groups', wrap(async (req, res) => {
    await getRow('categories', req);
    await tx((c) => setLinks(c, rid(req), { categoryId: pid(req) }, req.body?.group_ids || []));
    await audit(req, 'category', pid(req), 'option-groups', null, { group_ids: req.body?.group_ids || [] });
    res.json({ ok: true });
  }));

  for (const [verb, value] of [['archive', 'now()'], ['restore', 'NULL']]) {
    r.post(`/categories/:id/${verb}`, wrap(async (req, res) => {
      await getRow('categories', req);
      await q(`UPDATE categories SET archived_at = ${value} WHERE restaurant_id = $1 AND id = $2`, [rid(req), pid(req)]);
      await audit(req, 'category', pid(req), verb);
      res.json({ ok: true });
    }));
  }

  // ----- Produits -----
  r.post('/products', wrap(async (req, res) => {
    const b = req.body || {};
    const name = text(b.name, 120);
    if (!name) throw new OrderError('Indiquez le nom du produit.');
    if (b.category_id) {
      const { rows: [k] } = await q('SELECT id FROM categories WHERE restaurant_id = $1 AND id = $2 AND archived_at IS NULL', [rid(req), Number(b.category_id)]);
      if (!k) throw new OrderError('Catégorie introuvable.', 404);
    }
    const price = cents(b.price_cents ?? 0);
    const { rows: [p] } = await q(
      `INSERT INTO products (restaurant_id, category_id, name, slug, description, price_cents, photo, visible, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT coalesce(max(sort), 0) + 1 FROM products WHERE restaurant_id = $1)) RETURNING id`,
      [rid(req), b.category_id ? Number(b.category_id) : null, name, slugify(name), text(b.description, 600),
        price, b.photo || null, b.visible !== false]);
    await audit(req, 'product', p.id, 'create', null, { name, price_cents: price });
    res.status(201).json(p);
  }));

  r.post('/products/reorder', wrap(async (req, res) => {
    await reorder('products', req);
    await audit(req, 'product', null, 'reorder', null, { ids: req.body.ids });
    res.json({ ok: true });
  }));

  r.patch('/products/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const before = await getRow('products', req);
    const fields = {
      name: (v) => { const t = text(v, 120); if (!t) throw new OrderError('Nom vide.'); return t; },
      description: (v) => text(v, 600), price_cents: cents,
      category_id: (v) => (v ? Number(v) : null), photo: (v) => v || null,
      visible: Boolean,
    };
    const touched = Object.keys(fields).some((k) => b[k] !== undefined);
    if (touched) await run('products', rid(req), pid(req), fields, b);
    if (typeof b.sold_out_today === 'boolean') {
      // épuisé jusqu'à 5 h du matin le lendemain (heure du restaurant)
      await q(`UPDATE products SET sold_out_until = ${b.sold_out_today
        ? "(date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '1 day 5 hours') AT TIME ZONE 'Europe/Paris'"
        : 'NULL'} WHERE restaurant_id = $1 AND id = $2`, [rid(req), pid(req)]);
    } else if (!touched) throw new OrderError('Rien à modifier.');
    await audit(req, 'product', pid(req), 'update',
      { name: before.name, price_cents: before.price_cents, visible: before.visible, category_id: before.category_id, photo: before.photo }, b);
    res.json({ ok: true });
  }));

  r.put('/products/:id/option-groups', wrap(async (req, res) => {
    await getRow('products', req);
    const ids = req.body?.inherit ? [] : (req.body?.group_ids || []);
    await tx((c) => setLinks(c, rid(req), { productId: pid(req) }, ids));
    await audit(req, 'product', pid(req), 'option-groups', null, { inherit: !!req.body?.inherit, group_ids: ids });
    res.json({ ok: true });
  }));

  r.post('/products/:id/duplicate', wrap(async (req, res) => {
    const p = await getRow('products', req);
    const copy = await tx(async (c) => {
      const { rows: [n] } = await c.query(
        `INSERT INTO products (restaurant_id, category_id, name, slug, description, price_cents, photo, visible, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false, $8) RETURNING id`,
        [p.restaurant_id, p.category_id, `${p.name} (copie)`.slice(0, 120), `${p.slug}-copie`, p.description, p.price_cents, p.photo, p.sort + 1]);
      await c.query(
        `INSERT INTO option_group_links (restaurant_id, group_id, product_id, sort)
         SELECT restaurant_id, group_id, $3, sort FROM option_group_links WHERE restaurant_id = $1 AND product_id = $2`, [p.restaurant_id, p.id, n.id]);
      return n;
    });
    await audit(req, 'product', copy.id, 'duplicate', null, { from: p.id });
    res.status(201).json(copy);
  }));

  for (const [verb, value] of [['archive', 'now()'], ['restore', 'NULL']]) {
    r.post(`/products/:id/${verb}`, wrap(async (req, res) => {
      await getRow('products', req);
      await q(`UPDATE products SET archived_at = ${value} WHERE restaurant_id = $1 AND id = $2`, [rid(req), pid(req)]);
      await audit(req, 'product', pid(req), verb);
      res.json({ ok: true });
    }));
  }

  // Photo d'un produit : image envoyée telle quelle (corps brut), convertie en WebP 800 px
  r.post('/products/:id/photo', express.raw({ type: 'image/*', limit: '12mb' }), wrap(async (req, res) => {
    await getRow('products', req);
    const photo = await savePhoto(req, photosDir);
    await q('UPDATE products SET photo = $3 WHERE restaurant_id = $1 AND id = $2', [rid(req), pid(req), photo]);
    await audit(req, 'product', pid(req), 'photo', null, { photo });
    res.status(201).json({ photo });
  }));

  // ----- Listes d'options (bibliothèque) -----
  /** Règle d'une liste : obligatoire ⇔ minimum ≥ 1 ; maximum vide = illimité ; maximum ≥ minimum. */
  const ruleOf = (b, before = {}) => {
    let min = b.min_select !== undefined ? Math.max(intOr(b.min_select, 0), 0) : (before.min_select ?? 0);
    let max = before.max_select ?? null;
    if (b.max_select !== undefined) max = (b.max_select === null || b.max_select === '') ? null : intOr(b.max_select, NaN);
    if (max !== null && !(max >= 1)) throw new OrderError('Le maximum doit être d\'au moins 1.');
    if (b.required === false && !(min > 0 && b.min_select !== undefined)) min = 0;
    if (b.required === true && min < 1) min = 1;
    if (max !== null && max < min) throw new OrderError('Le maximum doit être supérieur ou égal au minimum.');
    return { min_select: min, max_select: max, required: min >= 1 };
  };

  /** Bibliothèque complète : règles, options, « utilisée par » et avertissements. */
  async function library(restaurantId) {
    const [groups, opts, links, prods, cats] = await Promise.all([
      q(`SELECT id, title, internal_name, description, min_select, max_select, required, sort, archived_at
           FROM option_groups WHERE restaurant_id = $1 ORDER BY sort, title`, [restaurantId]),
      q(`SELECT id, group_id, label, price_cents, photo, visible FROM options
          WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, id`, [restaurantId]),
      q('SELECT group_id, product_id, category_id FROM option_group_links WHERE restaurant_id = $1', [restaurantId]),
      q('SELECT id, name, category_id FROM products WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, name', [restaurantId]),
      q('SELECT id, name FROM categories WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, name', [restaurantId]),
    ]);
    const withOwn = new Set(links.rows.filter((l) => l.product_id).map((l) => l.product_id));
    return groups.rows.map((g) => {
      const mine = links.rows.filter((l) => l.group_id === g.id);
      const direct = prods.rows.filter((p) => mine.some((l) => l.product_id === p.id));
      const catIds = mine.filter((l) => l.category_id).map((l) => l.category_id);
      const categories = cats.rows.filter((c) => catIds.includes(c.id));
      const inherited = prods.rows.filter((p) => catIds.includes(p.category_id) && !withOwn.has(p.id));
      const options = opts.rows.filter((o) => o.group_id === g.id);
      const visible = options.filter((o) => o.visible).length;
      const warnings = [];
      if (g.required && !visible) warnings.push('Cette liste est obligatoire mais n\'a aucune option visible : les produits concernés ne pourront pas être commandés.');
      else if (g.min_select > visible) warnings.push(`Le minimum (${g.min_select}) dépasse le nombre d'options visibles (${visible}).`);
      return {
        ...g, options, warnings,
        used_by: {
          products: direct.map((p) => ({ id: p.id, name: p.name })),
          categories: categories.map((c) => ({ id: c.id, name: c.name })),
          inherited: inherited.map((p) => ({ id: p.id, name: p.name })),
          product_count: direct.length + inherited.length,
        },
      };
    });
  }

  r.get('/option-groups', wrap(async (req, res) => {
    const all = await library(rid(req));
    res.json({ groups: all.filter((g) => !g.archived_at), archived: all.filter((g) => g.archived_at) });
  }));

  r.get('/option-groups/:id', wrap(async (req, res) => {
    const g = (await library(rid(req))).find((x) => x.id === pid(req));
    if (!g) throw new OrderError('Liste introuvable.', 404);
    res.json(g);
  }));

  r.post('/option-groups', wrap(async (req, res) => {
    const b = req.body || {};
    const title = text(b.title, 80);
    if (!title) throw new OrderError('Indiquez le titre affiché au client (ex. Choisissez vos sauces).');
    const rule = ruleOf(b);
    const { rows: [g] } = await q(
      `INSERT INTO option_groups (restaurant_id, key, title, internal_name, description, min_select, max_select, required, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT coalesce(max(sort), 0) + 1 FROM option_groups WHERE restaurant_id = $1)) RETURNING id`,
      [rid(req), `g-${crypto.randomBytes(5).toString('hex')}`, title, text(b.internal_name, 80) || null, text(b.description),
        rule.min_select, rule.max_select, rule.required]);
    await audit(req, 'option_group', g.id, 'create', null, { title, ...rule });
    res.status(201).json(g);
  }));

  r.post('/option-groups/reorder', wrap(async (req, res) => {
    await reorder('option_groups', req);
    await audit(req, 'option_group', null, 'reorder', null, { ids: req.body.ids });
    res.json({ ok: true });
  }));

  r.patch('/option-groups/:id', wrap(async (req, res) => {
    const b = req.body || {};
    const before = await getRow('option_groups', req);
    const sets = {};
    if (b.title !== undefined) { sets.title = text(b.title, 80); if (!sets.title) throw new OrderError('Le titre ne peut pas être vide.'); }
    if (b.internal_name !== undefined) sets.internal_name = text(b.internal_name, 80) || null;
    if (b.description !== undefined) sets.description = text(b.description);
    if (['min_select', 'max_select', 'required'].some((k) => b[k] !== undefined)) Object.assign(sets, ruleOf(b, before));
    const keys = Object.keys(sets);
    if (!keys.length) throw new OrderError('Rien à modifier.');
    await q(`UPDATE option_groups SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE restaurant_id = $1 AND id = $2`,
      [rid(req), pid(req), ...keys.map((k) => sets[k])]);
    await audit(req, 'option_group', pid(req), 'update',
      { title: before.title, internal_name: before.internal_name, min_select: before.min_select, max_select: before.max_select, required: before.required }, sets);
    res.json({ ok: true });
  }));

  r.post('/option-groups/:id/duplicate', wrap(async (req, res) => {
    const g = await getRow('option_groups', req);
    const copy = await tx(async (c) => {
      const { rows: [n] } = await c.query(
        `INSERT INTO option_groups (restaurant_id, key, title, internal_name, description, min_select, max_select, required, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [g.restaurant_id, `g-${crypto.randomBytes(5).toString('hex')}`, g.title, `${g.internal_name || g.title} (copie)`.slice(0, 80),
          g.description, g.min_select, g.max_select, g.required, g.sort + 1]);
      await c.query(
        `INSERT INTO options (restaurant_id, group_id, label, price_cents, photo, sort, visible)
         SELECT restaurant_id, $3, label, price_cents, photo, sort, visible FROM options
          WHERE restaurant_id = $1 AND group_id = $2 AND archived_at IS NULL`, [g.restaurant_id, g.id, n.id]);
      return n;
    });
    await audit(req, 'option_group', copy.id, 'duplicate', null, { from: g.id });
    res.status(201).json(copy);
  }));

  for (const [verb, value] of [['archive', 'now()'], ['restore', 'NULL']]) {
    r.post(`/option-groups/:id/${verb}`, wrap(async (req, res) => {
      await getRow('option_groups', req);
      await q(`UPDATE option_groups SET archived_at = ${value} WHERE restaurant_id = $1 AND id = $2`, [rid(req), pid(req)]);
      await audit(req, 'option_group', pid(req), verb);
      res.json({ ok: true });
    }));
  }

  // Remplace la liste ordonnée des options ; celles qui ne sont plus dans la liste sont archivées, pas supprimées
  r.put('/option-groups/:id/options', wrap(async (req, res) => {
    await getRow('option_groups', req);
    const list = req.body?.options;
    if (!Array.isArray(list) || list.length > 200) throw new OrderError('Liste d\'options invalide.');
    const items = list.map((o) => {
      const label = text(o.label, 80);
      if (!label) throw new OrderError('Chaque option doit avoir un nom.');
      return { id: o.id ? Number(o.id) : null, label, price: cents(o.price_cents ?? 0), visible: o.visible !== false, photo: o.photo, hasPhoto: 'photo' in o };
    });
    await tx(async (c) => {
      const { rows } = await c.query('SELECT id FROM options WHERE restaurant_id = $1 AND group_id = $2 AND archived_at IS NULL', [rid(req), pid(req)]);
      const existing = new Set(rows.map((x) => x.id));
      const kept = [];
      for (const [i, o] of items.entries()) {
        if (o.id) {
          if (!existing.has(o.id)) throw new OrderError('Option introuvable dans cette liste.', 404);
          await c.query(
            `UPDATE options SET label = $3, price_cents = $4, visible = $5, sort = $6${o.hasPhoto ? ', photo = $7' : ''} WHERE restaurant_id = $1 AND id = $2`,
            [rid(req), o.id, o.label, o.price, o.visible, i + 1, ...(o.hasPhoto ? [o.photo || null] : [])]);
          kept.push(o.id);
        } else {
          const { rows: [made] } = await c.query(
            'INSERT INTO options (restaurant_id, group_id, label, price_cents, visible, sort, photo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [rid(req), pid(req), o.label, o.price, o.visible, i + 1, o.photo || null]);
          kept.push(made.id); // sinon la ligne serait archivée juste après

        }
      }
      await c.query('UPDATE options SET archived_at = now() WHERE restaurant_id = $1 AND group_id = $2 AND archived_at IS NULL AND NOT (id = ANY($3::int[]))',
        [rid(req), pid(req), kept]);
    });
    await audit(req, 'option_group', pid(req), 'options', null, { count: items.length });
    res.json({ ok: true });
  }));

  // Ajout rapide d'une option à la fin de la liste
  r.post('/option-groups/:id/options', wrap(async (req, res) => {
    const label = text(req.body?.label, 80);
    if (!label) throw new OrderError('Indiquez le nom de l\'option.');
    const { rows: [o] } = await q(
      `INSERT INTO options (restaurant_id, group_id, label, price_cents, sort)
       SELECT $1, g.id, $3, $4, (SELECT coalesce(max(sort), 0) + 1 FROM options WHERE group_id = g.id)
         FROM option_groups g WHERE g.id = $2 AND g.restaurant_id = $1 RETURNING id`,
      [rid(req), pid(req), label, cents(req.body?.price_cents ?? 0)]);
    if (!o) throw new OrderError('Liste introuvable.', 404);
    res.status(201).json(o);
  }));

  // « Utilisée par » : produits et catégories auxquels la liste est rattachée (remplace les rattachements de cette liste)
  r.put('/option-groups/:id/usage', wrap(async (req, res) => {
    await getRow('option_groups', req);
    const products = [...new Set((req.body?.product_ids || []).map(Number))];
    const categories = [...new Set((req.body?.category_ids || []).map(Number))];
    await tx(async (c) => {
      await c.query('DELETE FROM option_group_links WHERE restaurant_id = $1 AND group_id = $2', [rid(req), pid(req)]);
      await c.query(
        `INSERT INTO option_group_links (restaurant_id, group_id, product_id, sort)
         SELECT $1, $2, p.id, 0 FROM products p WHERE p.restaurant_id = $1 AND p.id = ANY($3::int[])`, [rid(req), pid(req), products]);
      await c.query(
        `INSERT INTO option_group_links (restaurant_id, group_id, category_id, sort)
         SELECT $1, $2, k.id, 0 FROM categories k WHERE k.restaurant_id = $1 AND k.id = ANY($3::int[])`, [rid(req), pid(req), categories]);
    });
    await audit(req, 'option_group', pid(req), 'usage', null, { products: products.length, categories: categories.length });
    res.json({ ok: true });
  }));

  r.patch('/options/:id', wrap(async (req, res) => {
    const before = await getRow('options', req);
    await run('options', rid(req), pid(req), {
      label: (v) => { const t = text(v, 80); if (!t) throw new OrderError('Nom vide.'); return t; },
      price_cents: cents, visible: Boolean, photo: (v) => v || null,
    }, req.body || {});
    await audit(req, 'option', pid(req), 'update', { label: before.label, price_cents: before.price_cents, visible: before.visible }, req.body);
    res.json({ ok: true });
  }));

  // Photo d'une option (même traitement que les produits : WebP 800 px)
  r.post('/options/:id/photo', express.raw({ type: 'image/*', limit: '12mb' }), wrap(async (req, res) => {
    await getRow('options', req);
    const photo = await savePhoto(req, photosDir);
    await q('UPDATE options SET photo = $3 WHERE restaurant_id = $1 AND id = $2', [rid(req), pid(req), photo]);
    await audit(req, 'option', pid(req), 'photo', null, { photo });
    res.status(201).json({ photo });
  }));

  // Photo envoyée avant la création du produit (ancien écran « Gérer la carte »)
  r.post('/photos', express.raw({ type: 'image/*', limit: '12mb' }), wrap(async (req, res) => {
    res.status(201).json({ photo: await savePhoto(req, photosDir) });
  }));

  return r;
}

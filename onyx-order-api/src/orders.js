import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { q, tx } from './db.js';
import { loadMenu, openingStatus } from './menu.js';
import { usesUber, checkQuote, dispatch, cancel as cancelCourier } from './uberDirect.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const STATUSES = ['new', 'preparing', 'ready', 'delivering', 'done', 'cancelled'];

export class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Zone de livraison : une zone qui précise la ville passe avant une zone « tout le code postal ». */
export async function findZone(restaurantId, postcode, city) {
  const { rows } = await q('SELECT * FROM delivery_zones WHERE restaurant_id = $1 ORDER BY sort, id', [restaurantId]);
  const pc = String(postcode || '').trim();
  const c = norm(city);
  const matches = rows.filter((z) => z.postcodes.includes(pc));
  return matches.find((z) => z.cities.some((x) => norm(x) === c)) || matches.find((z) => !z.cities.length) || null;
}

function checkGroups(product, selectedIds) {
  const chosen = [];
  const allowed = new Map();
  for (const g of product.option_groups) for (const o of g.options) allowed.set(o.id, { g, o });
  for (const id of selectedIds) {
    if (!allowed.has(id)) throw new OrderError(`Option invalide pour « ${product.name} ».`);
  }
  for (const g of product.option_groups) {
    const n = selectedIds.filter((id) => allowed.get(id).g.id === g.id).length;
    const min = Math.max(g.min || 0, g.required ? 1 : 0);
    if (n < min) throw new OrderError(`« ${product.name} » : « ${g.title} » — ${min} choix minimum.`);
    if (g.max != null && n > g.max) throw new OrderError(`« ${product.name} » : « ${g.title} » — ${g.max} choix maximum.`);
  }
  for (const id of selectedIds) chosen.push(allowed.get(id));
  return chosen;
}

/** Calcule et enregistre une commande. Les prix viennent de la base, jamais du navigateur. */
export async function createOrder(r, body, ip) {
  if (body.website) throw new OrderError('Commande refusée.', 400); // champ piège anti-robot
  const status = await openingStatus(r);
  if (!status.open) throw new OrderError('Le restaurant est fermé, les commandes en ligne sont suspendues.', 409);

  const s = r.settings || {};
  const ab = s.anti_bot || { max_orders: 5, window_minutes: 15 };
  const { rows: [{ n }] } = await q(
    `SELECT count(*)::int n FROM orders WHERE restaurant_id = $1 AND ip = $2 AND created_at > now() - make_interval(mins => $3)`,
    [r.id, ip, ab.window_minutes]);
  if (n >= ab.max_orders) throw new OrderError('Trop de commandes en peu de temps. Merci de réessayer plus tard.', 429);

  const mode = body.mode;
  if (!(s.modes || ['pickup']).includes(mode)) throw new OrderError('Mode de commande indisponible.');
  const name = String(body.customer?.name || '').trim();
  const phone = String(body.customer?.phone || '').replace(/[^\d+]/g, '');
  const email = String(body.customer?.email || '').trim() || null;
  if (name.length < 2) throw new OrderError('Indiquez votre nom.');
  if (phone.length < 10) throw new OrderError('Indiquez un numéro de téléphone valide.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OrderError('Adresse e-mail invalide.');

  // sur place : numéro de table (lettres, chiffres, tiret ; 12 caractères max)
  const tableLabel = mode === 'dine_in' ? String(body.table || '').trim().slice(0, 12) : null;
  if (mode === 'dine_in' && !/^[\p{L}\p{N}][\p{L}\p{N} -]*$/u.test(tableLabel || '')) throw new OrderError('Indiquez votre numéro de table.');

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 50) throw new OrderError('Votre panier est vide.');

  const menu = await loadMenu(r.id);
  const pById = new Map(menu.products.map((p) => [p.id, p]));
  const lines = items.map((it) => {
    const p = pById.get(Number(it.product_id));
    if (!p) throw new OrderError('Un produit du panier n\'est plus disponible.');
    if (p.sold_out) throw new OrderError(`« ${p.name} » est épuisé aujourd'hui.`);
    const qty = Math.min(Math.max(parseInt(it.quantity, 10) || 1, 1), 20);
    const ids = [...new Set((it.options || []).map(Number))];
    const chosen = checkGroups(p, ids);
    const unit = p.price_cents + chosen.reduce((a, c) => a + c.o.price_cents, 0);
    return { p, qty, unit, chosen, note: String(it.note || '').slice(0, 200) || null };
  });
  const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);

  let zone = null;
  let fee = 0;
  let address = null;
  let uberQuoteId = null;
  if (mode === 'delivery') {
    const rawLine = String(body.address?.line || '').trim(); // adresse seule : c'est elle qui sert au devis Uber
    const extra = String(body.address?.extra || '').trim().slice(0, 120); // étage, code, interphone
    address = rawLine + (extra ? `, ${extra}` : '');
    if (address.length < 5) throw new OrderError('Indiquez l\'adresse de livraison.');
    if (usesUber(r)) {
      // livraison par coursier Uber : le prix est celui du devis présenté au client (gardé côté serveur)
      const qt = checkQuote(r, body.quote_id, { line: rawLine, postcode: body.address?.postcode, city: body.address?.city });
      if (!qt) throw new OrderError("Le prix de livraison a expiré ou l'adresse a changé. Vérifiez l'adresse pour obtenir un nouveau prix.", 409);
      fee = qt.fee_cents;
      uberQuoteId = qt.uber_quote_id;
    } else {
      zone = await findZone(r.id, body.address?.postcode, body.address?.city);
      if (!zone) throw new OrderError('Nous ne livrons pas cette adresse. Le retrait au restaurant reste possible.');
      if (subtotal < zone.min_order_cents) throw new OrderError(`Minimum de commande pour ${zone.name} : ${(zone.min_order_cents / 100).toFixed(2).replace('.', ',')} €.`);
      fee = zone.fee_cents;
    }
  }

  let discount = 0;
  let promo = null;
  const promoInput = String(body.promo_code || '').trim().toLowerCase();
  if (promoInput) {
    const code = promoInput;
    const { rows: [pc] } = await q(
      `SELECT * FROM promo_codes WHERE restaurant_id = $1 AND lower(code) = $2 AND active
         AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())`, [r.id, code]);
    if (!pc) throw new OrderError('Code promo inconnu ou expiré.');
    const { rows: [{ prev, used }] } = await q(
      `SELECT count(*)::int prev, count(*) FILTER (WHERE lower(promo_code) = $3)::int used
         FROM orders WHERE restaurant_id = $1 AND customer_phone = $2 AND status <> 'cancelled'`, [r.id, phone, code]);
    if (pc.first_order_only && prev > 0) throw new OrderError('Ce code est réservé à la première commande.');
    if (pc.per_customer_limit && used >= pc.per_customer_limit) throw new OrderError('Ce code a déjà été utilisé.');
    discount = pc.kind === 'percent' ? Math.round(subtotal * pc.value / 100) : Math.min(pc.value, subtotal);
    promo = pc.code;
  }
  const total = subtotal - discount + fee;

  const order = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [r.id]);
    const { rows: [{ next }] } = await c.query('SELECT coalesce(max(number), 0) + 1 AS next FROM orders WHERE restaurant_id = $1', [r.id]);
    const token = crypto.randomBytes(12).toString('base64url');
    const { rows: [o] } = await c.query(
      `INSERT INTO orders (restaurant_id, number, token, mode, customer_name, customer_phone, customer_email,
          address, postcode, city, zone_id, subtotal_cents, discount_cents, fee_cents, total_cents, promo_code, slot, note, ip, uber_quote_id, table_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [r.id, next, token, mode, name, phone, email, address, mode === 'delivery' ? body.address.postcode : null,
        mode === 'delivery' ? body.address.city : null, zone?.id ?? null, subtotal, discount, fee, total, promo,
        String(body.slot || 'Dès que possible').slice(0, 60), String(body.note || '').slice(0, 500) || null, ip, uberQuoteId, tableLabel]);
    for (const l of lines) {
      const { rows: [it] } = await c.query(
        `INSERT INTO order_items (restaurant_id, order_id, product_id, name, quantity, unit_price_cents, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [r.id, o.id, l.p.id, l.p.name, l.qty, l.unit, l.note]);
      for (const ch of l.chosen) {
        await c.query(
          `INSERT INTO order_item_options (restaurant_id, order_item_id, group_title, label, price_cents) VALUES ($1,$2,$3,$4,$5)`,
          [r.id, it.id, ch.g.title, ch.o.label, ch.o.price_cents]);
      }
    }
    await c.query('INSERT INTO order_events (restaurant_id, order_id, status, author) VALUES ($1,$2,$3,$4)', [r.id, o.id, 'new', 'client']);
    if (email) {
      await c.query(`INSERT INTO email_queue (restaurant_id, order_id, recipient, template) VALUES ($1,$2,$3,'confirmation')`, [r.id, o.id, email]);
    }
    return o;
  });
  const full = await getOrder(r.id, order.id);
  bus.emit(`r${r.id}`, { type: 'order', order: full });
  return full;
}

export async function getOrder(restaurantId, id) {
  const { rows: [o] } = await q('SELECT * FROM orders WHERE restaurant_id = $1 AND id = $2', [restaurantId, id]);
  if (!o) return null;
  const { rows: items } = await q(
    'SELECT id, product_id, name, quantity, unit_price_cents, note FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
  const { rows: opts } = await q(
    `SELECT order_item_id, group_title, label, price_cents FROM order_item_options
      WHERE order_item_id = ANY($1::int[]) ORDER BY id`, [items.map((i) => i.id)]);
  const { rows: events } = await q('SELECT status, author, created_at FROM order_events WHERE order_id = $1 ORDER BY id', [o.id]);
  for (const i of items) i.options = opts.filter((x) => x.order_item_id === i.id).map(({ order_item_id, ...x }) => x);
  return { ...o, items, events };
}

export async function listOrders(restaurantId, { since, status, search, limit = 200 } = {}) {
  const where = ['restaurant_id = $1'];
  const params = [restaurantId];
  if (since) { params.push(since); where.push(`created_at >= $${params.length}`); }
  if (status) { params.push(status.split(',')); where.push(`status = ANY($${params.length})`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(customer_name ILIKE $${params.length} OR customer_phone ILIKE $${params.length} OR number::text = $${params.length + 1})`);
    params.push(String(search).replace('#', ''));
  }
  params.push(limit);
  const { rows } = await q(`SELECT id FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return Promise.all(rows.map((r) => getOrder(restaurantId, r.id)));
}

export async function setStatus(restaurantId, id, status, author) {
  if (!STATUSES.includes(status)) throw new OrderError('Statut inconnu.');
  const { rowCount } = await q('UPDATE orders SET status = $3 WHERE restaurant_id = $1 AND id = $2', [restaurantId, id, status]);
  if (!rowCount) throw new OrderError('Commande introuvable.', 404);
  await q('INSERT INTO order_events (restaurant_id, order_id, status, author) VALUES ($1,$2,$3,$4)', [restaurantId, id, status, author]);
  const o = await getOrder(restaurantId, id);
  // e-mails au client : commande prête, en route, et livrée (pour une livraison ; un retrait terminé n'en envoie pas)
  if (o.customer_email && (['ready', 'delivering'].includes(status) || (status === 'done' && o.mode === 'delivery'))) {
    await q(`INSERT INTO email_queue (restaurant_id, order_id, recipient, template) VALUES ($1,$2,$3,$4)`,
      [restaurantId, id, o.customer_email, `status_${status}`]);
  }
  // livraison Uber : la course est lancée quand le restaurant accepte la commande, annulée si la commande l'est
  if (o.mode === 'delivery' && (o.uber_quote_id || o.uber_delivery_id)) {
    try {
      const { rows: [rest] } = await q('SELECT * FROM restaurants WHERE id = $1', [restaurantId]);
      if (status === 'preparing' && usesUber(rest) && !o.uber_delivery_id) await dispatch(rest, o);
      if (status === 'cancelled' && o.uber_delivery_id) await cancelCourier(o);
    } catch (e) {
      console.error('Uber Direct :', e.message);
      await q('UPDATE orders SET courier_error = $2 WHERE id = $1', [id, String(e.message).slice(0, 300)]);
    }
    const o2 = await getOrder(restaurantId, id);
    bus.emit(`r${restaurantId}`, { type: 'status', order: o2 });
    return o2;
  }
  bus.emit(`r${restaurantId}`, { type: 'status', order: o });
  return o;
}

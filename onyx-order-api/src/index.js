import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connect, q, ROOT } from './db.js';
import { getRestaurant, loadMenu, openingStatus } from './menu.js';
import { catalogRouter } from './catalog.js';
import { importRouter } from './menuImport.js';
import { startMailer } from './mailer.js';
import { usesUber, getQuote, validSignature } from './uberDirect.js';
import { bus, createOrder, getOrder, listOrders, setStatus, OrderError, findZone } from './orders.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(ROOT, 'photos');
const SECRET =process.env.JWT_SECRET || 'change-moi-en-local';
if (process.env.NODE_ENV === 'production' && SECRET === 'change-moi-en-local') {
  console.error('JWT_SECRET doit être défini en production.');
  process.exit(1);
}

await connect();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/uber/')) req.rawBody = buf; } }));
const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.disable('x-powered-by');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Public (site client) ----------
async function restaurant(req, res, next) {
  const r = await getRestaurant(req.params.slug);
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable.' });
  req.r = r;
  next();
}

// Photos des produits (dossier persistant : volume du pod en production)
app.use('/photos', express.static(PHOTOS_DIR, { maxAge: '7d', fallthrough: false }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/r/:slug', wrap(restaurant), wrap(async (req, res) => {
  const r = req.r;
  const { rows: zones } = await q(
    'SELECT name, postcodes, cities, fee_cents, min_order_cents FROM delivery_zones WHERE restaurant_id = $1 ORDER BY fee_cents, sort', [r.id]);
  res.json({
    name: r.name, slug: r.slug, address: r.address, postcode: r.postcode, city: r.city, phone: r.phone,
    settings: r.settings, status: await openingStatus(r), zones,
  });
}));

app.get('/api/r/:slug/menu', wrap(restaurant), wrap(async (req, res) => {
  res.json((await loadMenu(req.r.id)).categories);
}));

app.get('/api/r/:slug/zone', wrap(restaurant), wrap(async (req, res) => {
  if (usesUber(req.r)) {
    // livraison par coursier Uber : le prix vient d'un devis Uber pour cette adresse
    const line = String(req.query.line || '').trim();
    if (line.length < 5 || !/^\d{5}$/.test(String(req.query.postcode || ''))) return res.json({ pending: true });
    const qt = await getQuote(req.r, { line, postcode: req.query.postcode, city: String(req.query.city || '') }).catch((e) => { console.error('Uber Direct :', e.message); return undefined; });
    if (qt === undefined) return res.status(503).json({ error: 'Livraison momentanément indisponible.' });
    return res.json(qt ? { name: 'Livraison par coursier', provider: 'uber', quote_id: qt.quote_id, fee_cents: qt.fee_cents, min_order_cents: 0 } : null);
  }
  const z = await findZone(req.r.id, req.query.postcode, req.query.city);
  res.json(z ? { name: z.name, fee_cents: z.fee_cents, min_order_cents: z.min_order_cents } : null);
}));

app.post('/api/r/:slug/orders', wrap(restaurant), wrap(async (req, res) => {
  const o = await createOrder(req.r, req.body || {}, req.ip);
  res.status(201).json({ number: o.number, token: o.token, total_cents: o.total_cents });
}));

app.get('/api/r/:slug/orders/:token', wrap(restaurant), wrap(async (req, res) => {
  const { rows: [row] } = await q('SELECT id FROM orders WHERE restaurant_id = $1 AND token = $2', [req.r.id, req.params.token]);
  if (!row) return res.status(404).json({ error: 'Commande introuvable.' });
  const o = await getOrder(req.r.id, row.id);
  const { ip, customer_phone, customer_email, restaurant_id, id, ...pub } = o;
  res.json(pub);
}));

// Mises à jour envoyées par Uber (coursier en route, livré…). Le restaurant est retrouvé par la course.
app.post('/api/uber/webhook', wrap(async (req, res) => {
  const sig = req.get('x-postmates-signature') || req.get('x-uber-signature');
  if (!validSignature(req.rawBody || Buffer.alloc(0), sig)) return res.status(401).end();
  const b = req.body || {};
  const deliveryId = b.delivery_id || b.data?.id;
  const st = b.status || b.data?.status;
  if (!deliveryId || !st) return res.status(200).end();
  const { rows: [o] } = await q('SELECT id, restaurant_id FROM orders WHERE uber_delivery_id = $1', [deliveryId]);
  if (!o) return res.status(200).end();
  await q('UPDATE orders SET courier_status = $2, tracking_url = coalesce($3, tracking_url) WHERE id = $1', [o.id, st, b.tracking_url || b.data?.tracking_url || null]);
  if (st === 'pickup_complete') await setStatus(o.restaurant_id, o.id, 'delivering', 'uber');
  else if (st === 'delivered') await setStatus(o.restaurant_id, o.id, 'done', 'uber');
  else bus.emit(`r${o.restaurant_id}`, { type: 'status', order: await getOrder(o.restaurant_id, o.id) });
  res.status(200).end();
}));

// ---------- Connexion cuisine / back-office ----------
app.post('/api/auth/login', wrap(async (req, res) => {
  const { restaurant: slug, email, password } = req.body || {};
  const r = await getRestaurant(slug || process.env.DEFAULT_RESTAURANT || 'fastcamion');
  if (!r) return res.status(401).json({ error: 'Identifiants incorrects.' });
  const { rows: [u] } = await q('SELECT * FROM users WHERE restaurant_id = $1 AND lower(email) = lower($2)', [r.id, email || '']);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  const token = jwt.sign({ uid: u.id, rid: r.id, role: u.role, email: u.email }, SECRET, { expiresIn: '14d' });
  res.json({ token, role: u.role, restaurant: { name: r.name, slug: r.slug } });
}));

// Le compte du jeton doit toujours exister : après une remise à zéro (démo) ou la suppression d'un compte,
// un ancien jeton pointerait vers un restaurant disparu et l'écran resterait vide sans erreur.
const knownUsers = new Map(); // « uid:rid » -> échéance du cache (30 s), uniquement pour les comptes trouvés
async function userStillExists({ uid, rid }) {
  const key = `${uid}:${rid}`;
  if ((knownUsers.get(key) || 0) > Date.now()) return true;
  const { rows } = await q('SELECT 1 FROM users WHERE id = $1 AND restaurant_id = $2', [uid, rid]);
  if (!rows.length) return false;
  knownUsers.set(key, Date.now() + 30_000);
  return true;
}

function auth(...roles) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.t;
    try {
      req.user = jwt.verify(String(t || ''), SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
    }
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
    try {
      if (!(await userStillExists(req.user))) return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
    } catch (e) {
      return next(e);
    }
    next();
  };
}

// ---------- Cuisine ----------
app.get('/api/admin/orders', auth(), wrap(async (req, res) => {
  const since = req.query.since || new Date(Date.now() - 24 * 3600e3).toISOString();
  res.json(await listOrders(req.user.rid, { since, status: req.query.status, search: req.query.search }));
}));

app.patch('/api/admin/orders/:id', auth(), wrap(async (req, res) => {
  res.json(await setStatus(req.user.rid, Number(req.params.id), req.body?.status, req.user.email));
}));

// Flux temps réel (EventSource : jeton passé en ?t=)
app.get('/api/admin/stream', auth(), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  bus.on(`r${req.user.rid}`, send);
  req.on('close', () => { clearInterval(ping); bus.off(`r${req.user.rid}`, send); });
});

// ---------- Back-office ----------
const owner = auth('owner', 'manager');

app.get('/api/admin/menu', owner, wrap(async (req, res) => {
  res.json(await loadMenu(req.user.rid, { includeHidden: true }));
}));

// Gestion de la carte : catégories, produits, options, photos (voir catalog.js)
app.use('/api/admin', catalogRouter({ owner, wrap, photosDir: PHOTOS_DIR }));
// Import de la carte par IA (brouillon à valider ; nécessite ANTHROPIC_API_KEY)
app.use('/api/admin', importRouter({ owner, wrap }));

app.get('/api/admin/orders.csv', owner, wrap(async (req, res) => {
  const since = req.query.since || new Date(Date.now() - 31 * 24 * 3600e3).toISOString();
  const orders = await listOrders(req.user.rid, { since, limit: 5000 });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const eur = (c) => (c / 100).toFixed(2).replace('.', ',');
  const lines = [['Numéro', 'Date', 'Mode', 'Statut', 'Client', 'Téléphone', 'Ville', 'Articles', 'Sous-total', 'Remise', 'Frais', 'Total'].join(';')];
  for (const o of orders) {
    lines.push([o.number, new Date(o.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), o.mode, o.status,
      o.customer_name, o.customer_phone, o.city || '', o.items.map((i) => `${i.quantity}x ${i.name}`).join(' | '),
      eur(o.subtotal_cents), eur(o.discount_cents), eur(o.fee_cents), eur(o.total_cents)].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="commandes.csv"');
  res.send('﻿' + lines.join('\n'));
}));

// ---------- Erreurs ----------
app.use((err, req, res, next) => {
  if (err instanceof OrderError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

const port = Number(process.env.API_PORT || 4000);
app.listen(port, () => {
  console.log(`[api] Onyx Order API prête sur http://localhost:${port}`);
  startMailer();
});

import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connect, q, ROOT } from './db.js';
import { getRestaurant, loadMenu, openingStatus } from './menu.js';
import { catalogRouter } from './catalog.js';
import { startMailer } from './mailer.js';
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
app.use(express.json({ limit: '200kb' }));
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

function auth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.t;
    try {
      req.user = jwt.verify(String(t || ''), SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
    }
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
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

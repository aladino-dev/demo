// Livraison par coursiers Uber (Uber Direct) : devis, création de la course, annulation, suivi.
// Actif par restaurant : settings.delivery_provider = 'uber'. Sans identifiants Uber dans .env, la livraison Uber
// est indisponible ; UBER_MOCK=true simule Uber pour tester en local (aucun appel réseau).
// À vérifier dans le bac à sable Uber dès qu'un compte existe : format d'adresse (state), signature du webhook.
import crypto from 'node:crypto';
import { q } from './db.js';

const env = (k) => (process.env[k] || '').trim();
export const uberMock = () => env('UBER_MOCK') === 'true';
export const uberConfigured = () => uberMock() || !!(env('UBER_CLIENT_ID') && env('UBER_CLIENT_SECRET') && env('UBER_CUSTOMER_ID'));
export const usesUber = (r) => r?.settings?.delivery_provider === 'uber';

const API = 'https://api.uber.com/v1/customers';
let tokenCache = { value: null, until: 0 };

async function accessToken() {
  if (tokenCache.value && tokenCache.until > Date.now() + 60_000) return tokenCache.value;
  const res = await fetch('https://auth.uber.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('UBER_CLIENT_ID'), client_secret: env('UBER_CLIENT_SECRET'),
      grant_type: 'client_credentials', scope: 'eats.deliveries',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Uber : connexion refusée (${res.status}).`);
  tokenCache = { value: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function call(method, path, body) {
  const res = await fetch(`${API}/${env('UBER_CUSTOMER_ID')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.message || `Uber : erreur ${res.status}.`);
    e.code = j.code; e.status = res.status;
    throw e;
  }
  return j;
}

const uberAddress = (street, postcode, city) => JSON.stringify({
  street_address: [street], city, state: '', zip_code: postcode, country: 'FR',
});

/** 06 12 34 56 78 -> +33612345678 (Uber exige le format international). */
export function e164(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (p.startsWith('0')) return `+33${p.slice(1)}`;
  return `+${p}`;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Devis proposés au client : le prix est gardé côté serveur, le navigateur ne peut pas le modifier.
const quotes = new Map(); // id -> { restaurantId, fee_cents, uber_quote_id, key, until }
const QUOTE_MS = 14 * 60_000; // Uber garde un devis environ 15 minutes

function sweep() { for (const [k, v] of quotes) if (v.until < Date.now()) quotes.delete(k); }

/** Prix de la livraison Uber pour une adresse. Retourne { quote_id, fee_cents } ou null si l'adresse n'est pas livrable. */
export async function getQuote(r, { line, postcode, city }) {
  if (!uberConfigured()) throw new Error('La livraison par Uber n\'est pas configurée.');
  if (!r.address || !r.postcode || !r.city) throw new Error('Adresse du restaurant incomplète.');
  sweep();
  let fee; let uberId;
  if (uberMock()) {
    fee = parseInt(env('UBER_MOCK_FEE_CENTS'), 10) || 0; uberId = `mock-${crypto.randomUUID()}`;
  } else {
    try {
      const j = await call('POST', '/delivery_quotes', {
        pickup_address: uberAddress(r.address, r.postcode, r.city),
        dropoff_address: uberAddress(line, postcode, city),
      });
      fee = j.fee; uberId = j.id;
    } catch (e) {
      if (e.status === 400 || e.status === 422) return null; // adresse hors zone ou introuvable
      throw e;
    }
  }
  const id = crypto.randomBytes(12).toString('base64url');
  quotes.set(id, { restaurantId: r.id, fee_cents: fee, uber_quote_id: uberId, key: norm(`${line} ${postcode} ${city}`), until: Date.now() + QUOTE_MS });
  return { quote_id: id, fee_cents: fee };
}

/** Vérifie le devis présenté à la commande (même restaurant, même adresse, pas expiré). */
export function checkQuote(r, quoteId, { line, postcode, city }) {
  const v = quotes.get(String(quoteId || ''));
  if (!v || v.restaurantId !== r.id || v.until < Date.now() || v.key !== norm(`${line} ${postcode} ${city}`)) return null;
  return v;
}

/** Lance la course : un coursier Uber vient chercher la commande au restaurant. */
export async function dispatch(r, o) {
  if (o.uber_delivery_id) return null;
  const prep = Math.max(0, parseInt(r.settings?.uber_prep_minutes, 10) || 0); // délai de préparation avant l'arrivée du coursier
  let d;
  if (uberMock()) {
    d = { id: `mock-${o.number}`, tracking_url: `${env('SITE_URL') || 'http://localhost:3000'}/suivi/${o.token}`, status: 'pending' };
  } else {
    const { rows: items } = await q('SELECT name, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
    const body = {
      pickup_name: r.name, pickup_address: uberAddress(r.address, r.postcode, r.city), pickup_phone_number: e164(r.phone),
      dropoff_name: o.customer_name, dropoff_address: uberAddress(o.address, o.postcode, o.city), dropoff_phone_number: e164(o.customer_phone),
      dropoff_notes: o.note || undefined,
      manifest_items: items.map((i) => ({ name: i.name, quantity: i.quantity, size: 'small' })),
      manifest_reference: `#${o.number}`,
      pickup_ready_dt: new Date(Date.now() + prep * 60_000).toISOString(),
    };
    // le devis est valable ~15 min : au-delà, Uber recalcule le prix à la création (écart à la charge du restaurant)
    const ageOk = Date.now() - new Date(o.created_at).getTime() < QUOTE_MS;
    if (o.uber_quote_id && ageOk) body.quote_id = o.uber_quote_id;
    d = await call('POST', '/deliveries', body);
  }
  await q(`UPDATE orders SET uber_delivery_id = $2, tracking_url = $3, courier_status = $4, courier_error = NULL WHERE id = $1`,
    [o.id, d.id, d.tracking_url || null, d.status || 'pending']);
  return d;
}

export async function cancel(o) {
  if (!o.uber_delivery_id || uberMock()) return;
  await call('POST', `/deliveries/${o.uber_delivery_id}/cancel`);
}

/** Signature du webhook Uber : HMAC-SHA256 du corps brut avec UBER_WEBHOOK_SECRET. */
export function validSignature(raw, header) {
  const secret = env('UBER_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const mac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(mac); const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

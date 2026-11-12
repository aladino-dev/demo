import express from 'express';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { q, tx } from './db.js';
import { OrderError } from './orders.js';
import { audit } from './audit.js';

/**
 * Import de la carte par IA : le restaurateur envoie une photo ou un PDF de sa carte, Claude en tire un BROUILLON
 * (catégories, produits, prix). Rien n'est enregistré avant la validation par le restaurateur, et les produits
 * importés sont créés MASQUÉS. L'IA ne doit jamais inventer : un prix absent reste vide.
 */

// Modèle : réglable (ANTHROPIC_MODEL). Un modèle plus économique convient à la lecture d'une carte, par exemple claude-sonnet-5-5.
const model = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
export const importEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE = 15 * 1024 * 1024;
const LIMITS = { categories: 40, items: 300, name: 120, description: 600 };

// ---------- Schéma de la réponse attendue (validé par l'API : structured outputs) ----------
const Item = z.object({
  name: z.string(),
  description: z.string(),           // recopiée de la carte ; vide si absente
  price_eur: z.number().nullable(),  // null si le prix est absent ou illisible : on ne le devine jamais
  uncertain: z.boolean(),            // true si le nom, le prix ou la rubrique sont peu lisibles
});
const Category = z.object({ name: z.string(), items: z.array(Item) });
const Menu = z.object({ categories: z.array(Category), notes: z.array(z.string()) });

const SYSTEM = `Tu lis la carte d'un restaurant ou d'un commerce (photo ou PDF) et tu en extrais les produits à vendre.

Règles strictes :
- N'invente rien. Recopie les noms, descriptions et prix tels qu'ils sont écrits. Si un prix est absent ou illisible, mets null.
- Garde les rubriques de la carte comme catégories, dans l'ordre d'apparition. Une rubrique inconnue : « Divers ».
- Un produit qui existe en plusieurs tailles ou plusieurs prix devient un article par prix, avec la taille dans le nom (ex. « Tacos - Maxi »).
- Les formules et menus sont des produits : mets leur composition dans la description.
- Les suppléments, sauces au choix, listes d'options, allergènes et mentions légales ne sont PAS des produits : ne les mets pas dans les catégories, résume-les dans « notes » (une phrase chacun).
- Mets uncertain à true dès que tu hésites sur le nom, le prix ou la rubrique.
- Prix en euros, nombre décimal (9.5 pour 9,50 €). Réponds en français.`;

// ---------- Conversion du fichier envoyé ----------
async function toContentBlock(buffer, mediaType) {
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
  }
  if (!IMAGE_TYPES.includes(mediaType)) throw new OrderError('Format non pris en charge : envoyez une photo (JPG, PNG, WebP) ou un PDF.', 415);
  // réduction : une carte lisible tient dans 2000 px ; au-delà, on paie des jetons pour rien
  let small;
  try {
    small = await sharp(buffer, { animated: false }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    throw new OrderError('Image illisible. Essayez une autre photo.', 400);
  }
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } };
}

// ---------- Nettoyage du brouillon (on ne fait jamais confiance au modèle) ----------
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeDraft(parsed) {
  const categories = [];
  let total = 0;
  for (const c of (parsed?.categories || []).slice(0, LIMITS.categories)) {
    const items = [];
    for (const it of c.items || []) {
      const name = clean(it.name, LIMITS.name);
      if (!name || total >= LIMITS.items) continue;
      const eur = Number(it.price_eur);
      const priceOk = it.price_eur !== null && Number.isFinite(eur) && eur >= 0 && eur <= 1000;
      items.push({
        name,
        description: clean(it.description, LIMITS.description),
        price_cents: priceOk ? Math.round(eur * 100) : null,
        uncertain: !!it.uncertain || !priceOk,
      });
      total++;
    }
    if (items.length) categories.push({ name: clean(c.name, 80) || 'Divers', items });
  }
  const notes = (parsed?.notes || []).map((n) => clean(n, 300)).filter(Boolean).slice(0, 20);
  return { categories, notes };
}

/** Appelle Claude et renvoie le brouillon. `client` est injectable (tests). */
export async function extractMenu(buffer, mediaType, { client } = {}) {
  const block = await toContentBlock(buffer, mediaType);
  const api = client || new Anthropic({ maxRetries: 2, timeout: 120_000 });
  let response;
  try {
    response = await api.messages.parse({
      model: model(),
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extrais les produits de cette carte.' }] }],
      output_config: { format: zodOutputFormat(Menu) },
    });
  } catch (e) {
    throw mapApiError(e);
  }
  if (response.stop_reason === 'refusal') throw new OrderError('Le fichier n\'a pas pu être analysé. Essayez une autre photo.', 422);
  if (response.stop_reason === 'max_tokens') throw new OrderError('La carte est trop longue pour une seule analyse : importez-la en plusieurs fois (quelques pages à la fois).', 413);
  if (!response.parsed_output) throw new OrderError('Réponse inexploitable. Réessayez avec une photo plus nette.', 502);
  return {
    ...normalizeDraft(response.parsed_output),
    usage: { model: response.model, input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens },
  };
}

function mapApiError(e) {
  if (e instanceof OrderError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error('[import] clé d\'API refusée :', e.status);
    return new OrderError('L\'import par IA est mal configuré (clé refusée). Contactez le support.', 503);
  }
  if (e instanceof Anthropic.RateLimitError) return new OrderError('Le service d\'analyse est très demandé. Réessayez dans une minute.', 429);
  if (e instanceof Anthropic.BadRequestError) return new OrderError('Fichier refusé par le service d\'analyse (trop lourd ou illisible). Essayez une photo plus petite.', 400);
  if (e instanceof Anthropic.APIConnectionError) return new OrderError('Service d\'analyse injoignable. Réessayez plus tard.', 503);
  console.error('[import]', e?.status, e?.message);
  return new OrderError('L\'analyse a échoué. Réessayez plus tard.', 502);
}

// ---------- Limite d'usage par restaurant (maîtrise du coût) ----------
const hits = new Map(); // restaurant -> horodatages
function allowImport(rid) {
  const max = Number(process.env.IMPORT_MAX_PER_HOUR || 10);
  const now = Date.now();
  const recent = (hits.get(rid) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(rid, recent);
  return true;
}

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

/** Enregistre le brouillon validé : produits MASQUÉS, catégories existantes réutilisées, doublons ignorés. */
export async function applyDraft(rid, body, req) {
  const cats = Array.isArray(body?.categories) ? body.categories : [];
  const problems = [];
  const plan = cats.slice(0, LIMITS.categories).map((c) => ({
    name: clean(c.name, 80),
    items: (Array.isArray(c.items) ? c.items : []).slice(0, LIMITS.items).map((it) => ({
      name: clean(it.name, LIMITS.name), description: clean(it.description, LIMITS.description), price_cents: it.price_cents,
    })),
  })).filter((c) => c.items.length);
  for (const c of plan) {
    if (!c.name) problems.push('une catégorie n\'a pas de nom');
    for (const it of c.items) {
      if (!it.name) problems.push(`un produit de « ${c.name} » n'a pas de nom`);
      else if (!Number.isInteger(it.price_cents) || it.price_cents < 0 || it.price_cents > 100000) problems.push(`« ${it.name} » n'a pas de prix valide`);
    }
  }
  if (!plan.length) throw new OrderError('Rien à ajouter.');
  if (problems.length) throw new OrderError(`À corriger avant l'ajout : ${problems.slice(0, 3).join(' ; ')}.`);

  const out = await tx(async (c) => {
    let newCats = 0; let created = 0; let skipped = 0;
    for (const cat of plan) {
      let { rows: [row] } = await c.query(
        'SELECT id FROM categories WHERE restaurant_id = $1 AND archived_at IS NULL AND lower(name) = lower($2) LIMIT 1', [rid, cat.name]);
      if (!row) {
        ({ rows: [row] } = await c.query(
          `INSERT INTO categories (restaurant_id, name, slug, sort, visible)
           VALUES ($1,$2,$3,(SELECT coalesce(max(sort),0)+1 FROM categories WHERE restaurant_id = $1), true) RETURNING id`,
          [rid, cat.name, slugify(cat.name)]));
        newCats++;
      }
      for (const it of cat.items) {
        const { rows: [dup] } = await c.query(
          'SELECT 1 FROM products WHERE restaurant_id = $1 AND category_id = $2 AND archived_at IS NULL AND lower(name) = lower($3) LIMIT 1', [rid, row.id, it.name]);
        if (dup) { skipped++; continue; }
        await c.query(
          `INSERT INTO products (restaurant_id, category_id, name, slug, description, price_cents, visible, sort)
           VALUES ($1,$2,$3,$4,$5,$6,false,(SELECT coalesce(max(sort),0)+1 FROM products WHERE restaurant_id = $1))`,
          [rid, row.id, it.name, slugify(it.name), it.description, it.price_cents]);
        created++;
      }
    }
    return { created, skipped, categories_created: newCats };
  });
  await audit(req, 'menu_import', null, 'apply', null, out);
  return out;
}

export function importRouter({ owner, wrap }) {
  const r = express.Router();
  r.use(owner);

  r.get('/import-menu/status', (req, res) => res.json({ enabled: importEnabled() }));

  r.post('/import-menu', express.raw({ type: [...IMAGE_TYPES, 'application/pdf'], limit: MAX_FILE }), wrap(async (req, res) => {
    if (!importEnabled()) throw new OrderError('L\'import par IA n\'est pas encore activé sur ce restaurant.', 503);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new OrderError('Aucun fichier reçu.');
    if (!allowImport(req.user.rid)) throw new OrderError('Trop d\'imports en peu de temps. Réessayez plus tard.', 429);
    const draft = await extractMenu(req.body, String(req.headers['content-type'] || '').split(';')[0].trim());
    await audit(req, 'menu_import', null, 'extract', null, { products: draft.categories.reduce((n, c) => n + c.items.length, 0), ...draft.usage });
    res.json(draft);
  }));

  r.post('/import-menu/apply', wrap(async (req, res) => {
    res.status(201).json(await applyDraft(req.user.rid, req.body, req));
  }));

  return r;
}

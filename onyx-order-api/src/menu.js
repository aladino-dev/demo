import { q } from './db.js';

export async function getRestaurant(slug) {
  const { rows } = await q('SELECT * FROM restaurants WHERE slug = $1', [slug]);
  return rows[0] || null;
}

/** Heure locale du restaurant : { dayIndex (0 = dimanche), hhmm, date } */
export function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { dayIndex: days[parts.weekday], hhmm: `${hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

export async function openingStatus(r) {
  const { rows: hours } = await q(
    `SELECT day_index, to_char(opens,'HH24:MI') opens, to_char(closes,'HH24:MI') closes, enabled
       FROM opening_hours WHERE restaurant_id = $1 ORDER BY day_index`, [r.id]);
  const now = localNow(r.timezone);
  const { rows: closed } = await q('SELECT reason FROM closures WHERE restaurant_id = $1 AND date = $2', [r.id, now.date]);
  const today = hours.filter((h) => h.day_index === now.dayIndex && h.enabled);
  let open = !closed.length && today.some((h) => now.hhmm >= h.opens && now.hhmm <= h.closes);
  const ignore = String(process.env.IGNORE_HOURS || '').toLowerCase() === 'true';
  return {
    open: open || ignore, really_open: open, demo_ignore_hours: ignore,
    closed_today: closed[0]?.reason ?? (closed.length ? 'Fermeture exceptionnelle' : null),
    hours,
  };
}

/** Listes obligatoires (ou à minimum >= 1) d'abord, les facultatives ensuite ; l'ordre reste celui du restaurateur à l'intérieur de chaque bloc. */
const obligatoiresD = (gs) => [...gs.filter((g) => g.required || g.min >= 1), ...gs.filter((g) => !(g.required || g.min >= 1))];

/** Groupes d'options applicables : ceux du produit s'il en a, sinon ceux de sa catégorie. */
export async function loadMenu(restaurantId, { includeHidden = false } = {}) {
  // Ce qui est archivé n'apparaît jamais (site, commandes, back-office : voir catalog.js pour les archives)
  const [cats, prods, groups, opts, links] = await Promise.all([
    q('SELECT id, name, slug, sort, visible FROM categories WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, name', [restaurantId]),
    q(`SELECT id, category_id, name, slug, description, price_cents, photo, visible, sort,
              (sold_out_until IS NOT NULL AND sold_out_until > now()) AS sold_out
         FROM products WHERE restaurant_id = $1 AND archived_at IS NULL ORDER BY sort, name`, [restaurantId]),
    q('SELECT id, key, title, description, min_select, max_select, required FROM option_groups WHERE restaurant_id = $1 AND archived_at IS NULL', [restaurantId]),
    q('SELECT id, group_id, label, price_cents, photo, sort FROM options WHERE restaurant_id = $1 AND visible AND archived_at IS NULL ORDER BY sort, id', [restaurantId]),
    q('SELECT group_id, product_id, category_id, sort FROM option_group_links WHERE restaurant_id = $1 ORDER BY sort', [restaurantId]),
  ]);
  const optsBy = new Map();
  for (const o of opts.rows) {
    if (!optsBy.has(o.group_id)) optsBy.set(o.group_id, []);
    optsBy.get(o.group_id).push({ id: o.id, label: o.label, price_cents: o.price_cents, photo: o.photo });
  }
  const groupById = new Map(groups.rows.map((g) => [g.id, {
    id: g.id, title: g.title, description: g.description, min: g.min_select, max: g.max_select,
    required: g.required, options: optsBy.get(g.id) || [],
  }]));
  const byProduct = new Map();
  const byCategory = new Map();
  for (const l of links.rows) {
    const m = l.product_id ? byProduct : byCategory;
    const k = l.product_id || l.category_id;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(l.group_id);
  }
  const products = prods.rows
    .filter((p) => includeHidden || p.visible)
    .map((p) => ({
      ...p,
      option_groups: obligatoiresD(((byProduct.get(p.id) || byCategory.get(p.category_id) || []).map((id) => groupById.get(id)).filter(Boolean))),
    }));
  const categories = cats.rows
    .filter((c) => includeHidden || c.visible)
    .map((c) => ({ ...c, products: products.filter((p) => p.category_id === c.id) }))
    .filter((c) => includeHidden || c.products.length);
  return { categories, products };
}

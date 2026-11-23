import { serverGet, DAYS, eur } from '../lib/api';
import Menu from './Menu';
import FeaturedProduct from './FeaturedProduct';

export const dynamic = 'force-dynamic';

function hoursText(hours) {
  // regroupe les jours aux mêmes horaires : « Tous les jours 11:30–23:55, sauf vendredi 14:30–23:55 »
  const byRange = new Map();
  for (const h of hours.filter((x) => x.enabled)) {
    const k = `${h.opens}–${h.closes}`;
    if (!byRange.has(k)) byRange.set(k, []);
    byRange.get(k).push(h.day_index);
  }
  const parts = [...byRange.entries()].sort((a, b) => b[1].length - a[1].length).map(([r, d]) => [r.replace(/:/g, 'h'), d]);
  if (!parts.length) return 'Fermé';
  const [main, ...others] = parts;
  const label = main[1].length === 7 ? 'Tous les jours' : main[1].length >= 4 ? 'Tous les jours' : main[1].map((d) => DAYS[d]).join(', ');
  const exc = others.map(([r, d]) => `${d.map((x) => DAYS[x].toLowerCase()).join(', ')} ${r}`);
  return `${label} ${main[0]}${exc.length ? ` (${exc.join(' · ')})` : ''}`;
}

export default async function Home() {
  let info, menu;
  try {
    [info, menu] = await Promise.all([serverGet(''), serverGet('/menu')]);
  } catch {
    return (
      <main className="wrap" style={{ padding: 40 }}>
        <h1>Service momentanément indisponible</h1>
        <p>L&apos;API Onyx Order ne répond pas. Vérifiez qu&apos;elle est lancée (onyx-order-api, port 4000).</p>
      </main>
    );
  }
  const st = info.status;
  // produit du mois : réglage du restaurant (settings.featured_product_id), rien n'est écrit en dur
  const featured = info.settings?.featured_product_id
    ? menu.flatMap((c) => c.products).find((p) => p.id === Number(info.settings.featured_product_id) && !p.sold_out)
    : null;
  const deliveryFrom = info.settings?.delivery_provider !== 'uber' && info.zones.length ? Math.min(...info.zones.map((z) => z.fee_cents)) : null;
  // données du restaurant telles qu'elles sont en base : rien n'est écrit en dur (type de cuisine, ville…)
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: info.name,
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(info.address ? { address: { '@type': 'PostalAddress', streetAddress: info.address, postalCode: info.postcode, addressLocality: info.city, addressCountry: 'FR' } } : {}),
  };
  const place = [info.address, [info.postcode, info.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const hasHours = st.hours.some((h) => h.enabled);
  const statusText = st.closed_today ? st.closed_today : st.really_open ? 'Ouvert : commandez maintenant' : 'Fermé pour le moment';
  return (
    <div>
      <header className="station-header">
        <div className="wrap">
          <a className="station-name" href="/">{info.name}</a>
          <a className="btn" href="#menu">Commander</a>
        </div>
      </header>
      <section className="hero">
        <div className="wrap">
          <div className="hero-identity">
            <span className="status"><span className={`dot ${st.really_open ? 'open' : 'closed'}`} />{statusText}</span>
            <h1>{info.name}</h1>
            <div className="chips">
              <span className="badge service">Retrait{deliveryFrom != null ? ` · Livraison dès ${eur(deliveryFrom)}` : ''}</span>
              {(info.settings?.tags || []).map((t) => <span key={t} className="badge">{t}</span>)}
              {st.demo_ignore_hours && !st.really_open && <span className="badge">Démo : commandes acceptées</span>}
            </div>
            {featured && <FeaturedProduct product={featured} />}
          </div>
          {(place || hasHours || info.phone) && <div className="hero-details">
            {place && <p>{place}</p>}
            {hasHours && <p>{hoursText(st.hours)}</p>}
            {info.phone && <a className="call" href={`tel:${String(info.phone).replace(/[^\d+]/g, '')}`}>Appeler le restaurant</a>}
          </div>}
        </div>
      </section>
      <Menu categories={menu} canOrder={st.open} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}

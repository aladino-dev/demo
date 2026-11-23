'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, eur, photoUrl, SLUG } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useTable } from '../../lib/table';
import emptyCartPhoto from './ns-grill-tacos.webp';

// Auto-complétion d'adresse : Géoplateforme IGN (base adresse nationale), sans clé
async function searchAddress(text, signal) {
  const url = `https://data.geopf.fr/geocodage/search?index=address&autocomplete=1&limit=5&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map((f) => ({ label: f.properties.label, line: f.properties.name, postcode: f.properties.postcode, city: f.properties.city }));
}

export default function Commande() {
  const cart = useCart();
  const router = useRouter();
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState('pickup');
  const [table, setTable] = useTable();
  const modeChosen = useRef(false);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [addr, setAddr] = useState({ line: '', postcode: '', city: '', extra: '' });
  const [sugg, setSugg] = useState([]);
  const [zone, setZone] = useState(undefined); // undefined = pas encore vérifié, null = hors zone
  const [promo, setPromo] = useState('');
  const [note, setNote] = useState('');
  const [hp, setHp] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const timer = useRef();
  const addressSearch = useRef();
  const submitting = useRef(false);

  useEffect(() => { apiGet('').then(setInfo).catch((e) => setErr(e.message)); }, []);
  // « Sur place » n'existe que si le client a scanné le QR code d'une table (le numéro n'est pas modifiable)
  const canDineIn = !!table && !!info?.settings?.modes?.includes('dine_in');
  useEffect(() => {
    if (canDineIn && !modeChosen.current) { modeChosen.current = true; setMode('dine_in'); }
  }, [canDineIn]);
  const pickMode = (m) => { modeChosen.current = true; setMode(m); };
  useEffect(() => () => {
    clearTimeout(timer.current);
    addressSearch.current?.abort();
  }, []);
  // zones du restaurant : prix selon le code postal. Livraison par coursier Uber : prix demandé pour l'adresse complète.
  const uber = info?.settings?.delivery_provider === 'uber';
  useEffect(() => {
    if (mode !== 'delivery' || !/^\d{5}$/.test(addr.postcode) || (uber && addr.line.trim().length < 5)) { setZone(undefined); setQuoting(false); return; }
    let stale = false;
    setZone(undefined);
    setQuoting(true);
    const t = setTimeout(() => {
      apiGet(`/zone?postcode=${addr.postcode}&city=${encodeURIComponent(addr.city)}&line=${encodeURIComponent(addr.line)}`)
        .then((z) => !stale && setZone(z?.pending ? undefined : z))
        .catch(() => !stale && setZone(null))
        .finally(() => !stale && setQuoting(false));
    }, uber ? 600 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [mode, addr.postcode, addr.city, addr.line, uber]);

  const onAddr = (v) => {
    setAddr((a) => ({ ...a, line: v }));
    clearTimeout(timer.current);
    addressSearch.current?.abort();
    setSugg([]);
    if (v.trim().length < 4) return;
    const request = new AbortController();
    addressSearch.current = request;
    timer.current = setTimeout(() => {
      searchAddress(v, request.signal).then((results) => {
        if (!request.signal.aborted) setSugg(results);
      }).catch(() => {});
    }, 200);
  };

  if (!cart.ready) return null;
  const fee = mode === 'delivery' && zone ? zone.fee_cents : 0;
  const tooLow = mode === 'delivery' && zone && cart.total < zone.min_order_cents;

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current || !info?.status?.open || (mode === 'delivery' && (!zone || quoting || tooLow))) return;
    submitting.current = true;
    setErr('');
    setSending(true);
    try {
      const res = await apiPost('/orders', {
        mode, table: mode === 'dine_in' ? table : undefined, customer, quote_id: mode === 'delivery' ? zone?.quote_id : undefined, promo_code: promo.trim() || undefined, note: note || undefined, website: hp,
        address: mode === 'delivery' ? { line: addr.line, extra: addr.extra, postcode: addr.postcode, city: addr.city } : undefined,
        items: cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, options: i.options, note: i.note || undefined })),
      });
      cart.clear();
      router.push(`/suivi/${res.token}`);
    } catch (e2) {
      setErr(e2.message);
      setSending(false);
      submitting.current = false;
      // sur téléphone le message d'erreur est au-dessus de la barre « Commander » : on l'amène à l'écran
      setTimeout(() => document.getElementById('order-err')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };

  if (sending && !cart.items.length) {
    return <main className="wrap checkout" role="status">Ouverture du suivi de commande…</main>;
  }

  if (!cart.items.length) {
    if (SLUG === 'nsgrill') {
      return (
        <main className="empty-cart" aria-labelledby="empty-cart-title">
          <div className="empty-cart-feature">
            <div className="empty-cart-photo">
              <img src={emptyCartPhoto.src} width={emptyCartPhoto.width} height={emptyCartPhoto.height} alt="" fetchPriority="high" />
            </div>
            <div className="empty-cart-copy">
              <p className="empty-cart-brand">NS Grill</p>
              <h1 id="empty-cart-title">Ton panier<br />est vide</h1>
              <p>Un tacos grillé, une assiette ou un sandwich&nbsp;? Fais-toi plaisir.</p>
              <div className="empty-cart-action">
                <Link href="/" className="btn center">Voir la carte</Link>
              </div>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="wrap" style={{ paddingTop: 30 }}>
        <h1>Votre panier est vide</h1>
        <Link href="/" className="btn center" style={{ display: 'flex', maxWidth: 320 }}>Voir la carte</Link>
      </main>
    );
  }

  return (
    <main className="wrap checkout">
      <header className="checkout-heading">
        <Link className="back-link" href="/">← Retour à la carte</Link>
        <h1>Votre commande</h1>
        <p>{cart.count} {cart.count === 1 ? 'article' : 'articles'} <span aria-hidden="true">·</span> {eur(cart.total)}</p>
      </header>
      <form onSubmit={submit} className="steps-form">
        <div className="panel">
          <h2>Votre panier</h2>
          {cart.items.map((i) => (
            <div key={i.key} className="line">
              {photoUrl(i.photo) && <div className="lph" style={{ backgroundImage: `url("${photoUrl(i.photo)}")` }} aria-hidden="true" />}
              <div className="info">
                <strong>{i.name}</strong>
                {i.labels?.length > 0 && <div className="o">{i.labels.join(', ')}</div>}
                {i.note && <div className="o">📝 {i.note}</div>}
                <div className="lp">{eur(i.unit_cents * i.quantity)}</div>
              </div>
              <div className="qty">
                <button type="button" onClick={() => cart.setQty(i.key, i.quantity - 1)} aria-label={i.quantity === 1 ? 'Retirer du panier' : 'Moins'}>{i.quantity === 1
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  : '−'}</button>
                <span>{i.quantity}</span>
                <button type="button" onClick={() => cart.setQty(i.key, i.quantity + 1)} disabled={i.quantity >= 20} aria-label="Plus"><span className="plus-icon" aria-hidden="true" /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>{canDineIn ? 'Sur place ou à emporter' : info?.settings?.modes?.includes('delivery') ? 'Retrait ou livraison' : 'Retrait'}</h2>
          <div className="seg">
            {canDineIn && (
              <button type="button" className={mode === 'dine_in' ? 'on' : ''} onClick={() => pickMode('dine_in')}>Sur place<small>Table {table}</small></button>
            )}
            <button type="button" className={mode === 'pickup' ? 'on' : ''} onClick={() => pickMode('pickup')}>{canDineIn ? 'Click & Collect' : 'Retrait'}<small>Gratuit</small></button>
            {info?.settings?.delivery_preview && !info?.settings?.modes?.includes('delivery') && (
              <button type="button" className="soon" aria-disabled="true" onClick={() => pickMode(canDineIn ? 'dine_in' : 'pickup')}>
                Livraison<small>Bientôt disponible</small>
              </button>
            )}
            {info?.settings?.modes?.includes('delivery') && (
              <button type="button" className={mode === 'delivery' ? 'on' : ''} onClick={() => pickMode('delivery')}>Livraison{uber ? <small>selon l&apos;adresse</small> : info.zones?.length ? <small>dès {eur(Math.min(...info.zones.map((z) => z.fee_cents)))}</small> : null}</button>
            )}
          </div>
          {mode === 'dine_in' && (
            <p className="note"><strong>Table {table}</strong> · Ce n&apos;est pas ta table ? Scanne à nouveau le QR code de ta table.</p>
          )}
          {mode === 'pickup' && info?.address && <p className="note">À retirer au {info.address}{info.city ? `, ${info.city}` : ''}.</p>}
          {mode === 'delivery' && (
            <>
              <label className="f">Adresse
                <input required value={addr.line} onChange={(e) => onAddr(e.target.value)} autoComplete="street-address" placeholder="N° et rue" />
              </label>
              {sugg.length > 0 && (
                <div className="sugg">
                  {sugg.map((s) => (
                    <button type="button" key={s.label} onClick={() => { setAddr((a) => ({ ...a, line: s.line, postcode: s.postcode, city: s.city })); setSugg([]); }}>{s.label}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <label className="f">Code postal<input required inputMode="numeric" autoComplete="postal-code" maxLength={5} value={addr.postcode} onChange={(e) => setAddr((a) => ({ ...a, postcode: e.target.value.replace(/\D/g, '') }))} /></label>
                <label className="f">Ville<input required autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} /></label>
              </div>
              <label className="f">Étage, code, interphone (facultatif)<input value={addr.extra} onChange={(e) => setAddr((a) => ({ ...a, extra: e.target.value }))} /></label>
              {zone === null && <p className="err">Nous ne livrons pas cette adresse. Le retrait au restaurant reste possible.</p>}
              {quoting && <p className="note">Calcul du prix de livraison…</p>}
              {zone && !quoting && <p className="note">{zone.name} : {eur(zone.fee_cents)}{zone.min_order_cents ? `, minimum ${eur(zone.min_order_cents)}` : ''}.</p>}
            </>
          )}
        </div>

        <div className="panel">
          <h2>Vos coordonnées</h2>
          <label className="f">Nom<input required name="name" autoComplete="name" enterKeyHint="next" value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} /></label>
          <label className="f">Téléphone<input required name="phone" type="tel" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} /></label>
          <details className="checkout-extras" onInvalid={(e) => { e.currentTarget.open = true; }}>
            <summary>Ajouter un e-mail, une remarque ou un code promo</summary>
            <label className="f">E-mail de confirmation<input name="email" type="email" autoComplete="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} /></label>
            <label className="f">Remarque<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <label className="f">Code promo<input name="promo" autoComplete="off" value={promo} onChange={(e) => setPromo(e.target.value)} /></label>
          </details>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} name="website" />
        </div>

        <div className="panel order-summary">
          <h2>Récapitulatif</h2>
          <div className="tot"><span>Sous-total</span><span>{eur(cart.total)}</span></div>
          {mode === 'delivery' && <div className="tot"><span>Livraison</span><span>{zone ? eur(fee) : '—'}</span></div>}
          {promo.trim() && <div className="tot note"><span>Code promo</span><span>appliqué à la validation</span></div>}
          <div className="tot big"><span>Total</span><span>{eur(cart.total + fee)}</span></div>
          {info?.settings?.payment_note && <p className="note">{info.settings.payment_note}</p>}
          {err && <p id="order-err" className="err" role="alert">{err}</p>}
          <div className="cartbar checkout-action">
            <button className="btn"
            disabled={sending || !info?.status?.open || (mode === 'delivery' && (!zone || quoting || tooLow))}>
            <span>{sending ? 'Envoi de la commande…' : !info ? 'Chargement…' : !info.status.open ? 'Restaurant fermé' : quoting ? 'Calcul de la livraison…' : 'Commander'}</span>
            <span>{eur(cart.total + fee)}</span>
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

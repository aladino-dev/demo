'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, eur, photoUrl } from '../../lib/api';
import { useCart } from '../../lib/cart';

// Auto-complétion d'adresse : Géoplateforme IGN (base adresse nationale), sans clé
async function searchAddress(text) {
  const url = `https://data.geopf.fr/geocodage/search?index=address&autocomplete=1&limit=5&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map((f) => ({ label: f.properties.label, line: f.properties.name, postcode: f.properties.postcode, city: f.properties.city }));
}

export default function Commande() {
  const cart = useCart();
  const router = useRouter();
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState('pickup');
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

  useEffect(() => { apiGet('').then(setInfo).catch((e) => setErr(e.message)); }, []);
  // zones du restaurant : prix selon le code postal. Livraison par coursier Uber : prix demandé pour l'adresse complète.
  const uber = info?.settings?.delivery_provider === 'uber';
  useEffect(() => {
    if (mode !== 'delivery' || !/^\d{5}$/.test(addr.postcode) || (uber && addr.line.trim().length < 5)) { setZone(undefined); setQuoting(false); return; }
    let stale = false;
    setQuoting(uber);
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
    if (v.length < 4) return setSugg([]);
    timer.current = setTimeout(() => searchAddress(v).then(setSugg).catch(() => setSugg([])), 250);
  };

  if (!cart.ready) return null;
  const fee = mode === 'delivery' && zone ? zone.fee_cents : 0;
  const tooLow = mode === 'delivery' && zone && cart.total < zone.min_order_cents;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSending(true);
    try {
      const res = await apiPost('/orders', {
        mode, customer, quote_id: mode === 'delivery' ? zone?.quote_id : undefined, promo_code: promo.trim() || undefined, note: note || undefined, website: hp,
        address: mode === 'delivery' ? { line: addr.line, extra: addr.extra, postcode: addr.postcode, city: addr.city } : undefined,
        items: cart.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, options: i.options })),
      });
      cart.clear();
      router.push(`/suivi/${res.token}`);
    } catch (e2) {
      setErr(e2.message);
      setSending(false);
      // sur téléphone le message d'erreur est au-dessus de la barre « Commander » : on l'amène à l'écran
      setTimeout(() => document.getElementById('order-err')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };

  if (!cart.items.length) {
    return (
      <main className="wrap" style={{ paddingTop: 30 }}>
        <h1>Votre panier est vide</h1>
        <Link href="/" className="btn center" style={{ display: 'flex', maxWidth: 320 }}>Voir la carte</Link>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ maxWidth: 640, paddingBottom: 110 }}>
      <p style={{ marginTop: 16 }}><Link href="/">← Retour à la carte</Link></p>
      <form onSubmit={submit} className="steps-form">
        <div className="panel">
          <h2>Votre commande</h2>
          {cart.items.map((i) => (
            <div key={i.key} className="line">
              {photoUrl(i.photo) && <div className="lph" style={{ backgroundImage: `url("${photoUrl(i.photo)}")` }} aria-hidden="true" />}
              <div className="info">
                <strong>{i.name}</strong>
                {i.labels?.length > 0 && <div className="o">{i.labels.join(', ')}</div>}
                <div className="lp">{eur(i.unit_cents * i.quantity)}</div>
              </div>
              <div className="qty" style={{ alignSelf: 'center' }}>
                <button type="button" onClick={() => cart.setQty(i.key, i.quantity - 1)} aria-label={i.quantity === 1 ? 'Retirer du panier' : 'Moins'}>{i.quantity === 1
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  : '−'}</button>
                <span>{i.quantity}</span>
                <button type="button" onClick={() => cart.setQty(i.key, i.quantity + 1)} aria-label="Plus">+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Mode</h2>
          <div className="seg">
            <button type="button" className={mode === 'pickup' ? 'on' : ''} onClick={() => setMode('pickup')}>Retrait<small>Gratuit</small></button>
            {info?.settings?.modes?.includes('delivery') && (
              <button type="button" className={mode === 'delivery' ? 'on' : ''} onClick={() => setMode('delivery')}>Livraison{uber ? <small>selon l&apos;adresse</small> : info.zones?.length ? <small>dès {eur(Math.min(...info.zones.map((z) => z.fee_cents)))}</small> : null}</button>
            )}
          </div>
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
          <label className="f">Nom<input required autoComplete="name" value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} /></label>
          <label className="f">Téléphone<input required type="tel" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} /></label>
          <label className="f">E-mail (pour la confirmation, facultatif)<input type="email" autoComplete="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} /></label>
          <label className="f">Remarque (facultatif)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="f">Code promo<input name="promo" autoComplete="off" placeholder="Facultatif" value={promo} onChange={(e) => setPromo(e.target.value)} /></label>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} name="website" />
        </div>

        <div className="panel">
          <div className="tot"><span>Sous-total</span><span>{eur(cart.total)}</span></div>
          {mode === 'delivery' && <div className="tot"><span>Livraison</span><span>{zone ? eur(fee) : '—'}</span></div>}
          {promo.trim() && <div className="tot note"><span>Code promo</span><span>appliqué à la validation</span></div>}
          <div className="tot big"><span>Total</span><span>{eur(cart.total + fee)}</span></div>
          {info?.settings?.payment_note && <p className="note">{info.settings.payment_note}</p>}
          {err && <p id="order-err" className="err" role="alert">{err}</p>}
        </div>

        <div className="cartbar">
          <button className="btn" style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}
            disabled={sending || !info?.status?.open || (mode === 'delivery' && (!zone || quoting || tooLow))}>
            <span>{sending ? 'Envoi…' : info && !info.status.open ? 'Restaurant fermé' : 'Commander'}</span>
            <span>{eur(cart.total + fee)}</span>
          </button>
        </div>
      </form>
    </main>
  );
}

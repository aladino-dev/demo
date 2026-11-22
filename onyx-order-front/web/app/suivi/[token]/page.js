'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, eur } from '../../../lib/api';

const STEPS = {
  pickup: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête à retirer'], ['done', 'Terminée']],
  delivery: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête'], ['delivering', 'En livraison'], ['done', 'Livrée']],
  dine_in: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête'], ['done', 'Terminée']],
};

// Message affiché (et notifié) à chaque changement de statut
function message(status, mode) {
  if (status === 'new') return 'Commande reçue : le restaurant va la préparer.';
  if (status === 'preparing') return 'Votre commande est en préparation.';
  if (status === 'ready') return mode === 'delivery' ? 'Votre commande est prête : le livreur va partir.' : mode === 'dine_in' ? 'Votre commande est prête : on vous l\'apporte à table !' : 'Votre commande est prête : vous pouvez venir la retirer !';
  if (status === 'delivering') return 'Votre commande est en route !';
  if (status === 'done') return mode === 'delivery' ? 'Votre commande a été livrée. Bon appétit !' : 'Commande terminée. Merci et bon appétit !';
  if (status === 'cancelled') return 'Votre commande a été annulée. Contactez le restaurant.';
  return '';
}

export default function Suivi({ params }) {
  const { token } = use(params);
  const [o, setO] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [perm, setPerm] = useState('unsupported');
  const prev = useRef(null);
  const baseTitle = useRef('');

  useEffect(() => {
    baseTitle.current = document.title;
    if (typeof Notification !== 'undefined') setPerm(Notification.permission);
    let stop = false;
    const load = () => apiGet(`/orders/${token}`).then((x) => !stop && setO(x)).catch((e) => !stop && setErr(e.message));
    load();
    const t = setInterval(load, 8000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); }; // retour sur la page : mise à jour tout de suite
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [token]);

  // alerte au changement de statut : bandeau, titre de l'onglet, vibration et notification du navigateur
  useEffect(() => {
    if (!o) return;
    if (prev.current && prev.current !== o.status) {
      const msg = message(o.status, o.mode);
      setFlash(msg);
      document.title = `🔔 N°${o.number} : ${msg}`;
      try { navigator.vibrate?.([250, 120, 250]); } catch { /* non supporté */ }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { new Notification(`Commande n°${o.number}`, { body: msg, tag: `order-${o.id}` }); } catch { /* ignoré */ }
      }
    }
    prev.current = o.status;
  }, [o]);

  // le titre normal revient quand le client regarde la page
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible' && baseTitle.current) document.title = baseTitle.current; };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  const enableNotifs = async () => { try { setPerm(await Notification.requestPermission()); } catch { /* ignoré */ } };

  if (err) return <main className="wrap" style={{ paddingTop: 30 }}><p className="err">{err}</p></main>;
  if (!o) return <main className="wrap" style={{ paddingTop: 30 }}>Chargement…</main>;
  const steps = STEPS[o.mode] || STEPS.pickup;
  const idx = steps.findIndex(([s]) => s === o.status);
  const now = message(o.status, o.mode);

  return (
    <main className="wrap" style={{ maxWidth: 640, paddingBottom: 40 }}>
      {flash && (
        <div className="flash" role="status" aria-live="polite" onClick={() => setFlash('')}>
          <span>🔔 {flash}</span><button type="button" aria-label="Fermer" onClick={() => setFlash('')}>×</button>
        </div>
      )}
      <div className="panel" style={{ marginTop: 20, textAlign: 'center' }}>
        {o.status === 'new' && (
          <svg className="okmark" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="24" /><path d="M17 29l8 8 14-16" /></svg>
        )}
        <p style={{ margin: 0 }}>Merci {o.customer_name.split(' ')[0]} !</p>
        <p className="big-num">N° {o.number}</p>
        <p className="now">{now}</p>
        <p className="note">{o.mode === 'delivery' ? `Livraison : ${o.address}, ${o.postcode} ${o.city}` : o.mode === 'dine_in' ? `Sur place · Table ${o.table_label}` : 'Retrait au restaurant'}</p>
      </div>
      <div className="panel">
        <h2>Suivi</h2>
        {o.status === 'cancelled' ? <p className="err">Commande annulée. Contactez le restaurant.</p> : (
          <ul className="steps">
            {steps.map(([s, label], i) => (
              <li key={s} className={i < idx ? 'done' : i === idx ? 'cur' : ''}><span className="dot" />{label}</li>
            ))}
          </ul>
        )}
        {o.tracking_url && !['done', 'cancelled'].includes(o.status) && (
          <a className="btn center" href={o.tracking_url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>Suivre le coursier</a>
        )}
        <p className="note">Cette page se met à jour toute seule{o.customer_email ? ' ; vous êtes aussi prévenu par e-mail.' : '.'}</p>
        {perm === 'default' && !['done', 'cancelled'].includes(o.status) && (
          <button type="button" className="btn center" style={{ marginTop: 10 }} onClick={enableNotifs}>🔔 Me prévenir quand c'est prêt</button>
        )}
        {perm === 'granted' && !['done', 'cancelled'].includes(o.status) && (
          <p className="note">🔔 Notifications activées : gardez cette page ouverte, nous vous prévenons.</p>
        )}
      </div>
      <div className="panel">
        <h2>Détail</h2>
        {o.items.map((i) => (
          <div key={i.id} className="line">
            <div className="info">
              <strong>{i.quantity} × {i.name}</strong>
              {i.options.length > 0 && <div className="o">{i.options.map((x) => x.label).join(', ')}</div>}
            </div>
            <div>{eur(i.unit_price_cents * i.quantity)}</div>
          </div>
        ))}
        <div className="tot"><span>Sous-total</span><span>{eur(o.subtotal_cents)}</span></div>
        {o.discount_cents > 0 && <div className="tot"><span>Remise ({o.promo_code})</span><span>−{eur(o.discount_cents)}</span></div>}
        {o.fee_cents > 0 && <div className="tot"><span>Livraison</span><span>{eur(o.fee_cents)}</span></div>}
        <div className="tot big"><span>Total à régler sur place</span><span>{eur(o.total_cents)}</span></div>
      </div>
      <p><Link href="/">← Retour à la carte</Link></p>
    </main>
  );
}

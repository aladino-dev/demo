'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, eur } from '../../../lib/api';

const STEPS = {
  pickup: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête à retirer'], ['done', 'Terminée']],
  delivery: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête'], ['delivering', 'En livraison'], ['done', 'Livrée']],
  dine_in: [['new', 'Commande reçue'], ['preparing', 'En préparation'], ['ready', 'Prête'], ['done', 'Terminée']],
};

// Icône et libellé court de chaque étape (barre de progression)
const ICON = { new: '🧾', preparing: '👨‍🍳', ready: '🛍️', delivering: '🛵', done: '🎉' };
const SHORT = { new: 'Reçue', preparing: 'En cuisine', ready: 'Prête', delivering: 'En route', done: 'Terminée' };
const HEAD = { new: 'Commande reçue !', preparing: 'On s’en occupe…', ready: 'C’est prêt !', delivering: 'En route vers vous', done: 'Bon appétit !', cancelled: 'Commande annulée' };

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
  const [resto, setResto] = useState(null); // nom et téléphone du restaurant, toujours affichés
  const [perm, setPerm] = useState('unsupported');
  const prev = useRef(null);
  const baseTitle = useRef('');

  useEffect(() => {
    baseTitle.current = document.title;
    if (typeof Notification !== 'undefined') setPerm(Notification.permission);
    let stop = false;
    const load = () => apiGet(`/orders/${token}`).then((x) => !stop && setO(x)).catch((e) => !stop && setErr(e.message));
    apiGet('').then((r) => !stop && setResto(r)).catch(() => {});
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
      document.title = `🔔 ${resto?.name ? resto.name + ' · ' : ''}N°${o.number} : ${msg}`;
      try { navigator.vibrate?.([250, 120, 250]); } catch { /* non supporté */ }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { new Notification(`${resto?.name ? resto.name + ' · ' : ''}Commande n°${o.number}`, { body: msg, tag: `order-${o.id}` }); } catch { /* ignoré */ }
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
      <section className={`trk-hero st-${o.status}`} aria-live="polite">
        {resto && <p className="trk-resto">{resto.name}</p>}
        <span className="trk-chip">N° {o.number}</span>
        <div className="trk-emoji" key={o.status} aria-hidden="true"><span>{o.status === 'cancelled' ? '⚠️' : ICON[o.status] || '🧾'}</span></div>
        <h1 className="trk-title">{HEAD[o.status] || now}</h1>
        <p className="trk-sub">{o.customer_name.split(' ')[0]}, {now.charAt(0).toLowerCase() + now.slice(1)}</p>
        {resto?.phone && <a className="trk-tel" href={`tel:${resto.phone.replace(/[^\d+]/g, '')}`}>📞 {resto.phone}</a>}
        <p className="trk-where">{o.mode === 'delivery' ? `📍 ${o.address}, ${o.postcode} ${o.city}` : o.mode === 'dine_in' ? `🍽️ Sur place · Table ${o.table_label}` : '🏪 Retrait au restaurant'}</p>
        {o.status !== 'cancelled' && (
          <div className="trk-bar" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={Math.max(idx, 0) + 1}
            aria-label={`Étape ${Math.max(idx, 0) + 1} sur ${steps.length}`} style={{ '--n': steps.length, '--p': Math.max(idx, 0) }}>
            <div className="trk-line"><i /></div>
            {steps.map(([s, label], i) => (
              <div key={s} className={`trk-step ${i < idx ? 'done' : i === idx ? 'cur' : ''}`}>
                <span className="trk-ic" aria-hidden="true">{i < idx ? '✓' : ICON[s]}</span>
                <small>{SHORT[s] || label}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="panel">
        {o.status === 'cancelled' && <p className="err">Commande annulée. Contactez le restaurant.</p>}
        {o.status === 'done' && resto?.settings?.google_review_url && (
          <div className="trk-review">
            <p><b>Un petit mot nous aide beaucoup ⭐</b><br />Votre avis aide {resto.name} à se faire connaître.</p>
            <a className="btn center" href={resto.settings.google_review_url} target="_blank" rel="noopener noreferrer">⭐ Laisser un avis Google</a>
          </div>
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

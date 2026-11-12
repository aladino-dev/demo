import { useEffect, useState } from 'react';
import { api, eur, time, MODE, STATUS } from '../../shared/session.js';

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

// Écran d'accueil : l'essentiel de la journée en un coup d'œil
export default function Today({ go }) {
  const [orders, setOrders] = useState(null);
  const [menu, setMenu] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => {
      api(`/api/admin/orders?since=${startOfDay()}`).then(setOrders).catch((e) => setErr(e.message));
      api('/api/admin/menu').then(setMenu).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!orders) return <p className="muted">Chargement…</p>;

  const valid = orders.filter((o) => o.status !== 'cancelled');
  const ca = valid.reduce((a, o) => a + o.total_cents, 0);
  const waiting = orders.filter((o) => o.status === 'new').length;
  const inProgress = orders.filter((o) => ['preparing', 'ready', 'delivering'].includes(o.status)).length;
  const soldOut = menu ? menu.categories.flatMap((c) => c.products).filter((p) => p.sold_out) : [];
  const hour = new Date().getHours();
  return (
    <>
      <h2 className="pt">{hour < 18 ? 'Bonjour' : 'Bonsoir'} 👋 <small>{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</small></h2>

      {waiting > 0 && (
        <button className="alertbar bad" onClick={() => go('orders')}>
          🔔 {waiting} commande{waiting > 1 ? 's' : ''} à prendre en charge sur l'écran cuisine <span>Voir →</span>
        </button>
      )}
      {soldOut.length > 0 && (
        <button className="alertbar warn" onClick={() => go('stock')}>
          ⚠️ {soldOut.length} produit{soldOut.length > 1 ? 's' : ''} épuisé{soldOut.length > 1 ? 's' : ''} aujourd'hui : {soldOut.slice(0, 3).map((p) => p.name).join(', ')}{soldOut.length > 3 ? '…' : ''} <span>Gérer →</span>
        </button>
      )}

      <div className="kpis big">
        <div className="kpi"><span>Commandes aujourd'hui</span><b>{valid.length}</b></div>
        <div className="kpi"><span>Chiffre d'affaires</span><b>{eur(ca)}</b></div>
        <div className="kpi"><span>Panier moyen</span><b>{valid.length ? eur(Math.round(ca / valid.length)) : '—'}</b></div>
        <div className="kpi"><span>En cours</span><b>{inProgress}</b></div>
      </div>

      <div className="quick">
        <button onClick={() => go('stock')}><span>✅</span><b>Marquer un produit épuisé</b><small>Il n'est plus commandable tout de suite</small></button>
        <button onClick={() => go('catalog')}><span>✏️</span><b>Changer un prix ou une photo</b><small>Dans « Ma carte »</small></button>
        <button onClick={() => go('orders')}><span>🧾</span><b>Retrouver une commande</b><small>Par nom, téléphone ou numéro</small></button>
      </div>

      <h3 className="sec">Dernières commandes</h3>
      {!orders.length ? <p className="empty">Pas encore de commande aujourd'hui.</p> : (
        <div className="olist">
          {orders.slice(0, 8).map((o) => (
            <button key={o.id} className="orow" onClick={() => go('orders')}>
              <b>#{o.number}</b><span className="muted">{time(o.created_at)}</span>
              <span className="who">{o.customer_name}<small>{MODE[o.mode]}</small></span>
              <b className="amt">{eur(o.total_cents)}</b>
              <span className={`pill ${o.status}`}>{STATUS[o.status]}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

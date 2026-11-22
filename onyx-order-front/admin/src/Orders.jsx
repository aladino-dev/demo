import { useEffect, useState } from 'react';
import { api, eur, time, MODE, STATUS } from '../../shared/session.js';

const PERIODS = [[1, 'Aujourd’hui'], [2, 'Hier et aujourd’hui'], [7, '7 jours'], [31, '31 jours']];
const FILTERS = [['', 'Toutes'], ['new', 'Nouvelles'], ['active', 'En cours'], ['done', 'Terminées'], ['cancelled', 'Annulées']];
const matches = (o, f) => !f || (f === 'active' ? ['preparing', 'ready', 'delivering'].includes(o.status) : o.status === f);

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(1);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const since = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() - (days - 1) * 24 * 3600e3).toISOString(); };
  useEffect(() => {
    const t = setTimeout(() => api(`/api/admin/orders?since=${since()}${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      .then((r) => { setOrders(r); setErr(''); }).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [search, days]);

  const exportCsv = async () => {
    const res = await api(`/api/admin/orders.csv?since=${since()}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'commandes.csv' }).click();
    URL.revokeObjectURL(url);
  };
  const shown = orders.filter((o) => matches(o, filter));
  const valid = shown.filter((o) => o.status !== 'cancelled');
  const ca = valid.reduce((a, o) => a + o.total_cents, 0);
  const sel = orders.find((o) => o.id === open);

  return (
    <>
      <h2 className="pt">Commandes</h2>
      <div className="bar">
        <input className="search" placeholder="🔍 Chercher un nom, un téléphone, un numéro…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période">
          {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </select>
      </div>
      <div className="chips">
        {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        <button className="ghost" onClick={exportCsv}>⬇ Exporter (Excel)</button>
      </div>
      <p className="summary"><b>{valid.length}</b> commande{valid.length > 1 ? 's' : ''} · <b>{eur(ca)}</b></p>
      {err && <p className="err">{err}</p>}
      {!shown.length ? <p className="empty">Aucune commande pour ce filtre.</p> : (
        <div className="olist">
          {shown.map((o) => (
            <button key={o.id} className={`orow${open === o.id ? ' sel' : ''}`} onClick={() => setOpen(o.id)}>
              <b>#{o.number}</b>
              <span className="muted">{days > 1 ? new Date(o.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' : ''}{time(o.created_at)}</span>
              <span className="who">{o.customer_name}<small>{MODE[o.mode]}{o.city ? ` · ${o.city}` : ''} · {o.items.reduce((a, i) => a + i.quantity, 0)} article(s)</small></span>
              <b className="amt">{eur(o.total_cents)}</b>
              <span className={`pill ${o.status}`}>{STATUS[o.status]}</span>
            </button>
          ))}
        </div>
      )}
      {sel && <Detail o={sel} onClose={() => setOpen(null)} />}
    </>
  );
}

// Détail d'une commande, en panneau qui glisse par-dessus la liste
function Detail({ o, onClose }) {
  const [full, setFull] = useState(null);
  useEffect(() => { setFull(null); api(`/api/admin/orders/${o.id}`).then(setFull).catch(() => setFull(o)); }, [o.id]);
  const d = full || o;
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Commande ${o.number}`}>
        <header>
          <h3>Commande #{d.number} <span className={`pill ${d.status}`}>{STATUS[d.status]}</span></h3>
          <button className="x" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        <p className="muted">{new Date(d.created_at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} · {MODE[d.mode]}{d.table_label ? ` · Table ${d.table_label}` : ''}{d.slot ? ` · ${d.slot}` : ''}</p>
        <div className="blk">
          <b>{d.customer_name}</b>
          <a href={`tel:${d.customer_phone}`}>📞 {d.customer_phone}</a>
          {d.customer_email && <span className="muted">✉ {d.customer_email}</span>}
          {d.mode === 'delivery' && d.address && <span>📍 {d.address}, {d.postcode} {d.city}</span>}
        </div>
        {d.note && <div className="blk note">💬 {d.note}</div>}
        <div className="blk">
          {d.items.map((i, k) => (
            <div key={k} className="line">
              <div><b>{i.quantity}× {i.name}</b>
                {(i.options || []).map((x, j) => <div key={j} className="muted sm">+ {x.label}{x.price_cents ? ` (${eur(x.price_cents)})` : ''}</div>)}
                {i.note && <div className="sm">📝 {i.note}</div>}
              </div>
              {i.unit_price_cents != null && <span>{eur(i.unit_price_cents * i.quantity)}</span>}
            </div>
          ))}
          {d.fee_cents > 0 && <div className="line sm"><span>Livraison</span><span>{eur(d.fee_cents)}</span></div>}
          {d.discount_cents > 0 && <div className="line sm"><span>Réduction</span><span>− {eur(d.discount_cents)}</span></div>}
          <div className="line tot"><b>Total</b><b>{eur(d.total_cents)}</b></div>
        </div>
        {d.events?.length > 0 && (
          <details><summary>Historique</summary>
            {d.events.map((e, k) => <div key={k} className="muted sm">{time(e.created_at)} · {STATUS[e.status] || e.status}{e.author ? ` (${e.author})` : ''}</div>)}
          </details>
        )}
      </aside>
    </div>
  );
}

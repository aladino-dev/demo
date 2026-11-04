import { useEffect, useState } from 'react';
import Login from '../../shared/Login.jsx';
import Carte from './Carte.jsx';
import Options from './Options.jsx';
import { api, getSession, saveSession, eur, time, MODE, STATUS } from '../../shared/session.js';

export default function App() {
  const [session, setSession] = useState(getSession());
  const [tab, setTab] = useState('orders');
  if (!session) return <Login title="Back-office" onLogged={setSession} />;
  if (!['owner', 'manager'].includes(session.role)) {
    return <div className="login"><h1>Accès réservé</h1><p>Ce compte sert à l'écran cuisine.</p>
      <button className="primary" onClick={() => { saveSession(null); setSession(null); }}>Changer de compte</button></div>;
  }
  return (
    <>
      <div className="top">
        <h1>{session.restaurant.name} · Back-office</h1>
        <div className="tabs">
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Commandes</button>
          <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Disponibilité</button>
          <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Carte</button>
          <button className={tab === 'options' ? 'active' : ''} onClick={() => setTab('options')}>Options</button>
        </div>
        <button onClick={() => { saveSession(null); setSession(null); }}>Déconnexion</button>
      </div>
      <div className="page">{tab === 'orders' ? <Orders /> : tab === 'menu' ? <MenuAdmin /> : tab === 'catalog' ? <Carte /> : <Options />}</div>
    </>
  );
}

function Orders() {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(1);
  const [err, setErr] = useState('');
  useEffect(() => {
    const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
    const t = setTimeout(() => api(`/api/admin/orders?since=${since}${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      .then(setOrders).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [search, days]);

  const valid = orders.filter((o) => o.status !== 'cancelled');
  const ca = valid.reduce((a, o) => a + o.total_cents, 0);
  const exportCsv = async () => {
    const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
    const res = await api(`/api/admin/orders.csv?since=${since}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'commandes.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="kpis">
        <div className="kpi"><span className="muted">Commandes</span><b>{valid.length}</b></div>
        <div className="kpi"><span className="muted">Chiffre d'affaires</span><b>{eur(ca)}</b></div>
        <div className="kpi"><span className="muted">Panier moyen</span><b>{valid.length ? eur(Math.round(ca / valid.length)) : '—'}</b></div>
        <div className="kpi"><span className="muted">Livraisons</span><b>{valid.filter((o) => o.mode === 'delivery').length}</b></div>
      </div>
      <div className="tools">
        <input placeholder="Rechercher : nom, téléphone, numéro" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="sw">
          <option value={1}>Aujourd'hui (24 h)</option><option value={7}>7 jours</option><option value={31}>31 jours</option>
        </select>
        <button onClick={exportCsv}>Exporter CSV</button>
      </div>
      {err && <p className="err">{err}</p>}
      <table>
        <thead><tr><th>N°</th><th>Heure</th><th>Mode</th><th>Client</th><th>Articles</th><th>Total</th><th>Statut</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="n"><b>#{o.number}</b></td>
              <td className="n">{new Date(o.created_at).toLocaleDateString('fr-FR')} {time(o.created_at)}</td>
              <td>{MODE[o.mode]}{o.city ? ` · ${o.city}` : ''}</td>
              <td>{o.customer_name}<br /><span className="muted">{o.customer_phone}</span></td>
              <td>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td>
              <td className="n">{eur(o.total_cents)}</td>
              <td><span className="st">{STATUS[o.status]}</span></td>
            </tr>
          ))}
          {!orders.length && <tr><td colSpan={7} className="muted">Aucune commande sur la période.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function MenuAdmin() {
  const [menu, setMenu] = useState(null);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api('/api/admin/menu').then(setMenu).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const patch = async (p, body) => {
    try {
      await api(`/api/admin/products/${p.id}`, { method: 'PATCH', body });
      setMsg(`« ${p.name} » mis à jour.`);
      load();
    } catch (e) { setMsg(e.message); }
  };
  const savePrice = (p, v) => {
    const c = Math.round(parseFloat(String(v).replace(',', '.')) * 100);
    if (Number.isFinite(c) && c !== p.price_cents) patch(p, { price_cents: c });
  };

  if (!menu) return <p className="muted">Chargement…</p>;
  const f = filter.toLowerCase();
  return (
    <>
      <div className="tools">
        <input placeholder="Rechercher un produit" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {msg && <p className="muted">{msg}</p>}
      {menu.categories.map((c) => {
        const list = c.products.filter((p) => !f || p.name.toLowerCase().includes(f));
        if (!list.length) return null;
        return (
          <div key={c.id}>
            <h2 className="cat">{c.name}{!c.visible && <span className="muted"> (masquée)</span>}</h2>
            <table>
              <thead><tr><th>Produit</th><th>Options</th><th>Prix</th><th>Sur le site</th><th>Aujourd'hui</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className={p.visible ? '' : 'hidden'}>
                    <td><b>{p.name}</b><br /><span className="muted">{p.description}</span></td>
                    <td className="muted">{p.option_groups.map((g) => g.title).join(', ') || '—'}</td>
                    <td className="n">
                      <input className="price" defaultValue={(p.price_cents / 100).toFixed(2).replace('.', ',')} key={p.price_cents}
                        onBlur={(e) => savePrice(p, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label={`Prix ${p.name}`} /> €
                    </td>
                    <td><button className={`sw ${p.visible ? 'on' : ''}`} onClick={() => patch(p, { visible: !p.visible })}>{p.visible ? 'Visible' : 'Masqué'}</button></td>
                    <td><button className={`sw ${p.sold_out ? 'out' : ''}`} onClick={() => patch(p, { sold_out_today: !p.sold_out })}>{p.sold_out ? 'Épuisé' : 'Disponible'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

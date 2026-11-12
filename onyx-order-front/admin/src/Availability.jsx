import { useEffect, useState } from 'react';
import { api } from '../../shared/session.js';

// « Qu'est-ce qui est épuisé aujourd'hui ? » : un grand bouton par produit, utilisable à la tablette ou au téléphone
export default function Availability() {
  const [menu, setMenu] = useState(null);
  const [filter, setFilter] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api('/api/admin/menu').then(setMenu).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2500); return () => clearTimeout(t); }, [msg]);

  const toggle = async (p) => {
    const out = !p.sold_out;
    // mise à jour immédiate à l'écran, retour en arrière si le serveur refuse
    setMenu((m) => ({ ...m, categories: m.categories.map((c) => ({ ...c, products: c.products.map((x) => (x.id === p.id ? { ...x, sold_out: out } : x)) })) }));
    try {
      await api(`/api/admin/products/${p.id}`, { method: 'PATCH', body: { sold_out_today: out } });
      setMsg(out ? `« ${p.name} » est épuisé : les clients ne peuvent plus le commander.` : `« ${p.name} » est de nouveau disponible.`);
    } catch (e) { setMsg(e.message); load(); }
  };

  if (!menu) return <p className="muted">Chargement…</p>;
  const f = filter.toLowerCase();
  const total = menu.categories.flatMap((c) => c.products).filter((p) => p.visible !== false);
  const outCount = total.filter((p) => p.sold_out).length;
  return (
    <>
      <h2 className="pt">Disponibilité <small>Touchez un produit pour l'indiquer épuisé aujourd'hui</small></h2>
      <div className="bar">
        <input className="search" placeholder="🔍 Chercher un produit…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="chips">
        <button className={!onlyOut ? 'on' : ''} onClick={() => setOnlyOut(false)}>Tous ({total.length})</button>
        <button className={onlyOut ? 'on' : ''} onClick={() => setOnlyOut(true)}>Épuisés ({outCount})</button>
      </div>
      <p className="hint">Un produit épuisé redevient disponible automatiquement le lendemain matin.</p>
      {menu.categories.map((c) => {
        const list = c.products.filter((p) => p.visible !== false && (!f || p.name.toLowerCase().includes(f)) && (!onlyOut || p.sold_out));
        if (!list.length) return null;
        return (
          <section key={c.id}>
            <h3 className="sec">{c.name}</h3>
            <div className="tiles">
              {list.map((p) => (
                <button key={p.id} className={`tile${p.sold_out ? ' out' : ''}`} onClick={() => toggle(p)} aria-pressed={!!p.sold_out}>
                  <span className="tn">{p.name}</span>
                  <span className="ts">{p.sold_out ? '⛔ Épuisé' : '✔ Disponible'}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {onlyOut && !outCount && <p className="empty">Rien n'est épuisé. 🎉</p>}
      {msg && <div className="toast" role="status">{msg}</div>}
    </>
  );
}

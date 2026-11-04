import { useEffect, useState } from 'react';
import { API, api, getSession, eur } from '../../shared/session.js';

const toCents = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100);
const fromCents = (c) => (c / 100).toFixed(2).replace('.', ',');

/** Listes d'options (en attendant l'écran « Options » de l'étape 2) : l'écran Carte gère catégories et produits. */
export default function Catalog() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api('/api/admin/catalog').then(setData).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  // Exécute une action API, recharge la carte et affiche le résultat
  const act = async (fn, ok) => {
    try { const r = await fn(); setMsg(ok || 'Enregistré.'); await load(); return r; } catch (e) { setMsg(e.message); }
  };
  if (!data) return <p className="muted">{msg || 'Chargement…'}</p>;
  return (
    <>
      {msg && <p className="muted msg">{msg}</p>}
      <Groups data={data} act={act} />
    </>
  );
}

function Groups({ data, act }) {
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState(null);
  const patch = (path, body, ok) => act(() => api(path, { method: 'PATCH', body }), ok);
  const current = data.groups.find((g) => g.id === sel);
  return (
    <div className="split">
      <div className="left">
      <div className="tools">
        <input placeholder="Nouveau groupe (ex. Sauces)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button onClick={async () => { if (!title.trim()) return; const g = await act(() => api('/api/admin/groups', { method: 'POST', body: { title } }), 'Groupe ajouté.'); setTitle(''); if (g) setSel(g.id); }}>Ajouter le groupe</button>
      </div>
      <p className="muted">1. Crée le groupe (Boisson, Dessert, Crudités…) · 2. Ajoute ses options · 3. Fixe le nombre de choix · 4. Associe-le aux produits.</p>
      <table>
        <tbody>
          {data.groups.map((g) => {
            const used = data.products.filter((p) => p.group_ids.includes(g.id)).length + data.categories.filter((c) => c.group_ids.includes(g.id)).length;
            return (
              <tr key={g.id} className={g.id === sel ? 'sel' : ''}>
                <td><b>{g.title}</b>{g.required && <span className="muted"> · obligatoire</span>}</td>
                <td className="muted">{g.options.length} option(s) · {g.max_select ? `max ${g.max_select}` : 'sans max'} · {used ? `associé à ${used}` : 'non associé'}</td>
                <td className="n"><button className="sw" onClick={() => setSel(g.id)}>Modifier</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="right">
        {current
          ? <GroupCard key={current.id} g={current} data={data} act={act} patch={patch} />
          : <div className="panel empty"><h2>Groupe d'options</h2><p className="muted">Choisis un groupe à gauche pour modifier ses options ici.</p></div>}
      </div>
    </div>
  );
}

function GroupCard({ g, data, act, patch }) {
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const base = `/api/admin/groups/${g.id}`;
  const uploadOption = (o, file) => act(async () => {
    const res = await fetch(`${API}/api/admin/options/${o.id}/photo`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getSession().token}` }, body: file });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Envoi impossible.');
  }, 'Photo enregistrée.');
  return (
    <div className="panel">
      <div className="row">
        <input className="inline big" defaultValue={g.title} key={g.title} onBlur={(e) => e.target.value.trim() && e.target.value !== g.title && patch(base, { title: e.target.value })} />
        <button className="sw danger" onClick={() => window.confirm(`Supprimer le groupe « ${g.title} » et ses ${g.options.length} option(s) ?`) && act(() => api(base, { method: 'DELETE' }), 'Groupe supprimé.')}>Supprimer le groupe</button>
      </div>
      <h3>Nombre de choix pour le client</h3>
      <div className="row rules">
        <label className="chk">Maximum <input className="num" type="number" min="1" placeholder="illimité" defaultValue={g.max_select ?? ''} key={`max${g.max_select}`} onBlur={(e) => (e.target.value === '' ? null : Number(e.target.value)) !== g.max_select && patch(base, { max_select: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label className="chk"><input type="checkbox" checked={g.required} onChange={(e) => patch(base, { required: e.target.checked, min_select: e.target.checked ? Math.max(g.min_select, 1) : 0 })} /> Choix obligatoire</label>
        {g.required && <label className="chk">Minimum <input className="num" type="number" min="1" defaultValue={g.min_select} key={`min${g.min_select}`} onBlur={(e) => Number(e.target.value) !== g.min_select && patch(base, { min_select: Math.max(Number(e.target.value), 1) })} /></label>}
      </div>
      <p className="muted">Ex. Crudités : maximum 3, facultatif. Boisson : maximum 1, obligatoire. Vide = illimité.</p>
      <h3>Options du groupe</h3>
      <table>
        <tbody>
          {g.options.map((o) => (
            <tr key={o.id} className={o.visible ? '' : 'hidden'}>
              <td className="optph">
                <label className="optthumb" title={o.photo ? 'Changer la photo' : 'Ajouter une photo'}>
                  {o.photo ? <img src={API + o.photo} alt="" /> : <span>＋ photo</span>}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files[0] && uploadOption(o, e.target.files[0])} />
                </label>
                {o.photo && <button className="sw" onClick={() => patch(`/api/admin/options/${o.id}`, { photo: null }, 'Photo retirée.')}>Retirer</button>}
              </td>
              <td><input className="inline" defaultValue={o.label} key={o.label} onBlur={(e) => e.target.value.trim() && e.target.value !== o.label && patch(`/api/admin/options/${o.id}`, { label: e.target.value })} /></td>
              <td className="n"><input className="price" defaultValue={fromCents(o.price_cents)} key={o.price_cents}
                onBlur={(e) => { const c = toCents(e.target.value); if (Number.isFinite(c) && c !== o.price_cents) patch(`/api/admin/options/${o.id}`, { price_cents: c }); }} /> €</td>
              <td><button className={`sw ${o.visible ? 'on' : ''}`} onClick={() => patch(`/api/admin/options/${o.id}`, { visible: !o.visible })}>{o.visible ? 'Visible' : 'Masquée'}</button></td>
              <td><button className="sw danger" onClick={() => act(() => api(`/api/admin/options/${o.id}`, { method: 'DELETE' }), 'Option supprimée.')}>✕</button></td>
            </tr>
          ))}
          <tr>
            <td />
            <td><input className="inline" placeholder="Nouvelle option (ex. Ketchup)" value={label} onChange={(e) => setLabel(e.target.value)} /></td>
            <td className="n"><input className="price" placeholder="0,00" value={price} onChange={(e) => setPrice(e.target.value)} /> €</td>
            <td colSpan={2}><button className="sw" onClick={() => label.trim() && act(() => api(`${base}/options`, { method: 'POST', body: { label, price_cents: price ? toCents(price) : 0 } }), 'Option ajoutée.').then(() => { setLabel(''); setPrice(''); })}>Ajouter</button></td>
          </tr>
        </tbody>
      </table>
      <Associate g={g} data={data} act={act} />
    </div>
  );
}

/** Associe le groupe à des produits (cases) ou à des catégories entières. */
function Associate({ g, data, act }) {
  const [prods, setProds] = useState(() => data.products.filter((p) => p.group_ids.includes(g.id)).map((p) => p.id));
  const [cats, setCats] = useState(() => data.categories.filter((c) => c.group_ids.includes(g.id)).map((c) => c.id));
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = () => act(() => api(`/api/admin/groups/${g.id}/links`, { method: 'PUT', body: { product_ids: prods, category_ids: cats } }), 'Association enregistrée.');
  return (
    <>
      <h3>Associer ce groupe</h3>
      <p className="muted">Coche une catégorie pour l'appliquer à tous ses produits, ou des produits un par un (un produit coché garde uniquement ses propres groupes).</p>
      <div className="assoc">
        {data.categories.map((c) => (
          <div key={c.id} className="acat">
            <label className="chk"><b><input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggle(cats, setCats, c.id)} /> {c.name} (toute la catégorie)</b></label>
            <div className="checks">
              {data.products.filter((p) => p.category_id === c.id).map((p) => (
                <label key={p.id}><input type="checkbox" checked={prods.includes(p.id)} onChange={() => toggle(prods, setProds, p.id)} /> {p.name}</label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="actions"><span style={{ flex: 1 }} /><button className="primary" onClick={save}>Enregistrer l'association</button></div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { API, api, getSession } from '../../shared/session.js';
import ProductPanel from './ProductPanel.jsx';
import ImportMenu from './ImportMenu.jsx';
import { Icon, Sortable, Switch, useDndSensors } from './ui.jsx';
import { byOrder, fromCents, ruleText, toCents } from './util.js';
import './carte.css';

function PriceInput({ cents, onSave, say }) {
  return (
    <span className="cr-price"><input defaultValue={fromCents(cents)} key={cents} inputMode="decimal" aria-label="Prix"
      onBlur={(e) => {
        const c = toCents(e.target.value);
        if (!Number.isFinite(c)) { e.target.value = fromCents(cents); say('Prix invalide.', true); return; }
        if (c !== cents) onSave(c);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} /> €</span>
  );
}

export default function Carte() {
  const [data, setData] = useState(null);
  const [catId, setCatId] = useState(null);
  const [prodId, setProdId] = useState(null);
  const [view, setView] = useState('carte');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [newCat, setNewCat] = useState('');
  const [newProd, setNewProd] = useState({ name: '', price: '' });
  const [menuCat, setMenuCat] = useState(null);
  const timer = useRef();

  const say = useCallback((text, bad) => {
    setToast({ text, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), bad ? 4000 : 2000);
  }, []);
  const load = useCallback(() => api('/api/admin/catalog').then(setData).catch((e) => say(e.message, true)), [say]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data && !data.categories.some((c) => c.id === catId)) setCatId([...data.categories].sort(byOrder)[0]?.id ?? null);
  }, [data, catId]);

  const sensors = useDndSensors();

  if (!data) return <p className="muted">Chargement…</p>;

  // Mise à jour optimiste : l'écran change tout de suite, retour arrière si l'API refuse.
  const mutate = async (apply, call, ok = 'Enregistré') => {
    const prev = data;
    setData(apply(prev));
    try { await call(); say(ok); return true; } catch (e) { setData(prev); say(e.message, true); return false; }
  };
  // Action sans mise à jour optimiste (création, archivage…) : on recharge ensuite.
  const act = async (call, ok = 'Enregistré') => {
    try { const r = await call(); say(ok); await load(); return r ?? true; } catch (e) { say(e.message, true); return false; }
  };

  const cats = [...data.categories].sort(byOrder);
  const cat = cats.find((c) => c.id === catId);
  const countIn = (id) => data.products.filter((p) => p.category_id === id).length;
  const searching = search.trim().length > 0;
  const shown = searching
    ? data.products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).sort(byOrder)
    : data.products.filter((p) => p.category_id === catId).sort(byOrder);
  const product = data.products.find((p) => p.id === prodId) || null;

  const effectiveGroups = (p) => {
    const own = p.group_ids.length ? p.group_ids : (data.categories.find((c) => c.id === p.category_id)?.group_ids || []);
    return own.map((id) => data.groups.find((g) => g.id === id)).filter(Boolean);
  };

  const patchProduct = (p, patch) => mutate(
    (d) => ({ ...d, products: d.products.map((x) => (x.id === p.id ? { ...x, ...patch, ...('sold_out_today' in patch ? { sold_out: patch.sold_out_today } : {}) } : x)) }),
    () => api(`/api/admin/products/${p.id}`, { method: 'PATCH', body: patch }));
  const patchCat = (c, patch) => mutate(
    (d) => ({ ...d, categories: d.categories.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }),
    () => api(`/api/admin/categories/${c.id}`, { method: 'PATCH', body: patch }));

  const dragCats = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = arrayMove(cats.map((c) => c.id), cats.findIndex((c) => c.id === active.id), cats.findIndex((c) => c.id === over.id));
    mutate((d) => ({ ...d, categories: d.categories.map((c) => ({ ...c, sort: ids.indexOf(c.id) + 1 })) }),
      () => api('/api/admin/categories/reorder', { method: 'POST', body: { ids } }), 'Ordre enregistré');
  };
  const dragProds = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = arrayMove(shown.map((p) => p.id), shown.findIndex((p) => p.id === active.id), shown.findIndex((p) => p.id === over.id));
    mutate((d) => ({ ...d, products: d.products.map((p) => (ids.includes(p.id) ? { ...p, sort: ids.indexOf(p.id) + 1 } : p)) }),
      () => api('/api/admin/products/reorder', { method: 'POST', body: { ids } }), 'Ordre enregistré');
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    const r = await act(() => api('/api/admin/categories', { method: 'POST', body: { name: newCat } }), 'Catégorie ajoutée');
    if (r?.id) setCatId(r.id);
    if (r) setNewCat('');
  };
  const addProduct = async () => {
    const price = toCents(newProd.price);
    if (!newProd.name.trim()) return say('Indiquez le nom du produit.', true);
    if (!Number.isFinite(price)) return say('Indiquez le prix, par exemple 9,90.', true);
    const r = await act(() => api('/api/admin/products', { method: 'POST', body: { name: newProd.name, price_cents: price, category_id: catId } }), 'Produit ajouté');
    if (r?.id) { setNewProd({ name: '', price: '' }); setProdId(r.id); }
  };
  const archiveCat = (c) => window.confirm(`Archiver la catégorie « ${c.name} » ? Elle disparaît du site ; vous pourrez la restaurer dans « Archivés ».`)
    && act(() => api(`/api/admin/categories/${c.id}/archive`, { method: 'POST' }), 'Catégorie archivée');
  const archiveProduct = async (p) => {
    if (!window.confirm(`Archiver « ${p.name} » ? Il disparaît du site ; vous pourrez le restaurer dans « Archivés ».`)) return;
    if (await act(() => api(`/api/admin/products/${p.id}/archive`, { method: 'POST' }), 'Produit archivé')) setProdId(null);
  };
  const duplicate = async (p) => {
    const r = await act(() => api(`/api/admin/products/${p.id}/duplicate`, { method: 'POST' }), 'Produit dupliqué (masqué, à vérifier)');
    if (r?.id) setProdId(r.id);
  };
  const uploadPhoto = async (p, file) => {
    try {
      const res = await fetch(`${API}/api/admin/products/${p.id}/photo`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getSession().token}` }, body: file });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Envoi impossible.');
      say('Photo enregistrée'); await load();
    } catch (e) { say(e.message, true); }
  };
  const setGroups = (p, body) => act(() => api(`/api/admin/products/${p.id}/option-groups`, { method: 'PUT', body }), 'Options enregistrées');

  return (
    <div className="carte">
      <div className="cr-bar">
        <div className="tabs sub">
          <button className={view === 'carte' ? 'active' : ''} onClick={() => setView('carte')}>Carte</button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>Importer ma carte</button>
          <button className={view === 'archives' ? 'active' : ''} onClick={() => setView('archives')}>
            Archivés ({data.archived.categories.length + data.archived.products.length})</button>
        </div>
        {view === 'carte' && <input className="cr-search" placeholder="Rechercher un produit dans toute la carte" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </div>

      {view === 'import' ? (
        <ImportMenu say={say} onDone={() => { load(); setView('carte'); }} />
      ) : view === 'archives' ? (
        <Archives data={data} onRestore={(kind, id) => act(() => api(`/api/admin/${kind}/${id}/restore`, { method: 'POST' }), 'Restauré')} />
      ) : (
        <div className={`cr-grid ${product ? 'with-panel' : ''}`}>
          <section className="cr-col cr-cats" aria-label="Catégories">
            <h2>Catégories</h2>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragCats}>
              <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {cats.map((c) => (
                  <Sortable key={c.id} id={c.id} className={c.id === catId && !searching ? 'sel' : ''}>
                    <button className="cr-name" onClick={() => { setCatId(c.id); setSearch(''); }}>
                      <b>{c.name}</b>{!c.visible && <small>Masquée sur le site</small>}
                    </button>
                    <span className="cr-count" title={`${countIn(c.id)} produit(s)`}>{countIn(c.id)}</span>
                    <button className={`cr-eye ${c.visible ? 'on' : ''}`} title={c.visible ? 'Visible sur le site (cliquer pour masquer)' : 'Masquée (cliquer pour afficher)'} aria-label={c.visible ? 'Masquer la catégorie' : 'Afficher la catégorie'}
                      onClick={() => patchCat(c, { visible: !c.visible })}><Icon name={c.visible ? 'eye' : 'eyeOff'} /></button>
                    <span className="cr-more">
                      <button aria-label="Plus d'actions" onClick={() => setMenuCat(menuCat === c.id ? null : c.id)}><Icon name="more" /></button>
                      {menuCat === c.id && (
                        <span className="cr-pop" onMouseLeave={() => setMenuCat(null)}>
                          <button onClick={() => { setMenuCat(null); const n = window.prompt('Nouveau nom de la catégorie', c.name); if (n && n.trim() && n !== c.name) patchCat(c, { name: n.trim() }); }}>Renommer</button>
                          <button onClick={() => { setMenuCat(null); archiveCat(c); }}>Archiver</button>
                        </span>
                      )}
                    </span>
                  </Sortable>
                ))}
              </SortableContext>
            </DndContext>
            <div className="cr-add">
              <input placeholder="Nouvelle catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
              <button onClick={addCategory}>+ Catégorie</button>
            </div>
          </section>

          <section className="cr-col cr-prods" aria-label="Produits">
            <h2>{searching ? `Résultats pour « ${search} »` : cat?.name || 'Produits'}</h2>
            {!searching && cat && (
              <div className="cr-add">
                <input placeholder="Nom du nouveau produit" value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} />
                <input className="short" placeholder="Prix" inputMode="decimal" value={newProd.price} onChange={(e) => setNewProd({ ...newProd, price: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addProduct()} />
                <button onClick={addProduct}>+ Produit</button>
              </div>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragProds}>
              <SortableContext items={shown.map((p) => p.id)} strategy={verticalListSortingStrategy} disabled={searching}>
                {shown.map((p) => {
                  const inherited = !p.group_ids.length;
                  const groups = effectiveGroups(p);
                  return (
                    <Sortable key={p.id} id={p.id} className={`${p.id === prodId ? 'sel' : ''} ${p.visible ? '' : 'off'}`}>
                      <button className="cr-thumb" onClick={() => setProdId(p.id)} aria-label={`Ouvrir ${p.name}`}>
                        {p.photo ? <img src={API + p.photo} alt="" /> : <Icon name="image" />}
                      </button>
                      <button className="cr-name" onClick={() => setProdId(p.id)}>
                        <b>{p.name}</b>
                        <small>{groups.length ? `${groups.map((g) => g.internal_name || g.title).join(' · ')}${inherited ? ' (de la catégorie)' : ''}` : 'Aucune option'}
                          {searching && ` — ${data.categories.find((c) => c.id === p.category_id)?.name || 'sans catégorie'}`}</small>
                      </button>
                      <PriceInput cents={p.price_cents} say={say} onSave={(c) => patchProduct(p, { price_cents: c })} />
                      {p.sold_out && <span className="cr-dot bad">Épuisé</span>}
                      {!p.visible && <span className="cr-dot hide">Masqué</span>}
                      <Switch on={p.visible} label={p.visible ? 'Visible' : 'Masqué'} onChange={(v) => patchProduct(p, { visible: v })} />
                      <Switch on={p.sold_out} danger label={p.sold_out ? 'Épuisé' : 'Disponible'} onChange={(v) => patchProduct(p, { sold_out_today: v })} />
                    </Sortable>
                  );
                })}
              </SortableContext>
            </DndContext>
            {!shown.length && (
              <div className="cr-empty"><Icon name="image" size={32} />
                <p>{searching ? 'Aucun produit trouvé.' : 'Aucun produit dans cette catégorie.'}</p>
                {!searching && <p className="muted">Ajoutez-en un avec le champ ci-dessus : nom, prix, puis « + Produit ».</p>}</div>
            )}
          </section>

          {product && (
            <ProductPanel key={product.id} product={product} data={data} groups={effectiveGroups(product)} say={say}
              onPatch={(patch) => patchProduct(product, patch)} onClose={() => setProdId(null)}
              onDuplicate={() => duplicate(product)} onArchive={() => archiveProduct(product)}
              onPhoto={(file) => uploadPhoto(product, file)} onGroups={(body) => setGroups(product, body)} ruleText={ruleText} />
          )}
        </div>
      )}
      {toast && <div className={`cr-toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}

function Archives({ data, onRestore }) {
  const { categories, products } = data.archived;
  const catName = (id) => data.categories.find((c) => c.id === id)?.name || data.archived.categories.find((c) => c.id === id)?.name || 'sans catégorie';
  if (!categories.length && !products.length) return <p className="muted">Rien d'archivé.</p>;
  return (
    <div className="cr-arch">
      {!!categories.length && <h2>Catégories archivées</h2>}
      {categories.map((c) => (
        <div key={c.id} className="cr-item"><span className="cr-name"><b>{c.name}</b></span><button className="cr-btn" onClick={() => onRestore('categories', c.id)}>Restaurer</button></div>
      ))}
      {!!products.length && <h2>Produits archivés</h2>}
      {products.map((p) => (
        <div key={p.id} className="cr-item">
          <span className="cr-thumb">{p.photo ? <img src={API + p.photo} alt="" /> : <span>—</span>}</span>
          <span className="cr-name"><b>{p.name}</b><small>{catName(p.category_id)}</small></span>
          <button className="cr-btn" onClick={() => onRestore('products', p.id)}>Restaurer</button>
        </div>
      ))}
    </div>
  );
}

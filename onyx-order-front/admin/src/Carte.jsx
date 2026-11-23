import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { API, api, getSession } from '../../shared/session.js';
import ProductPanel from './ProductPanel.jsx';
import ImportMenu from './ImportMenu.jsx';
import { Icon, Sortable, useDndSensors } from './ui.jsx';
import { byOrder, fromCents, ruleText, toCents } from './util.js';
import './carte.css';

const normalizeSearch = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export default function Carte({ onOpenOptions }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [catId, setCatId] = useState(null);
  const [prodId, setProdId] = useState(null);
  const [view, setView] = useState('carte');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [newCat, setNewCat] = useState('');
  const [newProd, setNewProd] = useState({ name: '', price: '' });
  const [menuCat, setMenuCat] = useState(null);
  const [productTab, setProductTab] = useState('infos');
  const [addingProduct, setAddingProduct] = useState(false);
  const [savingCategoryOrder, setSavingCategoryOrder] = useState(false);
  const timer = useRef();
  const searchInput = useRef(null);
  const productList = useRef(null);
  const productScroll = useRef(0);
  const productTrigger = useRef(null);

  const say = useCallback((text, bad) => {
    setToast({ text, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), bad ? 4000 : 2000);
  }, []);
  const load = useCallback(() => {
    setLoadError('');
    return api('/api/admin/catalog').then(setData).catch((e) => {
      setLoadError(e.message);
      say(e.message, true);
    });
  }, [say]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data && !data.categories.some((c) => c.id === catId)) setCatId([...data.categories].sort(byOrder)[0]?.id ?? null);
  }, [data, catId]);

  const sensors = useDndSensors();

  if (!data) return loadError
    ? <div className="empty"><p role="alert">{loadError}</p><button className="cr-btn" onClick={load}>Réessayer</button></div>
    : <p className="muted" role="status">Chargement…</p>;

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
  const query = normalizeSearch(search);
  const searching = query.length > 0;
  const shown = searching
    ? data.products.filter((p) => normalizeSearch(p.name).includes(query)).sort(byOrder)
    : data.products.filter((p) => p.category_id === catId).sort(byOrder);
  const product = data.products.find((p) => p.id === prodId) || null;
  const selectCategory = (id) => {
    setCatId(id);
    setSearch('');
    setProdId(null);
    setAddingProduct(false);
    setView('carte');
    setMenuCat(null);
    if (productList.current) productList.current.scrollTop = 0;
  };
  const openProduct = (id, tab = 'infos', trigger = null) => {
    if (productList.current?.getClientRects().length) productScroll.current = productList.current.scrollTop;
    productTrigger.current = trigger;
    setProductTab(tab);
    setProdId(id);
  };
  const closeProduct = () => {
    setProdId(null);
    requestAnimationFrame(() => {
      if (productList.current) productList.current.scrollTop = productScroll.current;
      const trigger = productTrigger.current;
      if (trigger?.getClientRects().length) trigger.focus();
    });
  };

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

  const moveCategory = async (from, to) => {
    if (savingCategoryOrder || from < 0 || to < 0 || to >= cats.length || from === to) return;
    const ids = arrayMove(cats.map((c) => c.id), from, to);
    const previousOrder = new Map(cats.map((c) => [c.id, c.sort]));
    setSavingCategoryOrder(true);
    setData((d) => ({ ...d, categories: d.categories.map((c) => ({
      ...c, sort: previousOrder.has(c.id) ? ids.indexOf(c.id) + 1 : c.sort,
    })) }));
    try {
      await api('/api/admin/categories/reorder', { method: 'POST', body: { ids } });
      say('Ordre de la carte enregistré');
    } catch (e) {
      setData((d) => ({ ...d, categories: d.categories.map((c) => ({
        ...c, sort: previousOrder.has(c.id) ? previousOrder.get(c.id) : c.sort,
      })) }));
      say(e.message, true);
    } finally {
      setSavingCategoryOrder(false);
    }
  };
  const dragCats = ({ active, over }) => {
    if (over) moveCategory(cats.findIndex((c) => c.id === active.id), cats.findIndex((c) => c.id === over.id));
  };
  const dragProds = ({ active, over }) => {
    if (searching || !over || active.id === over.id) return;
    const ids = arrayMove(shown.map((p) => p.id), shown.findIndex((p) => p.id === active.id), shown.findIndex((p) => p.id === over.id));
    mutate((d) => ({ ...d, products: d.products.map((p) => (ids.includes(p.id) ? { ...p, sort: ids.indexOf(p.id) + 1 } : p)) }),
      () => api('/api/admin/products/reorder', { method: 'POST', body: { ids } }), 'Ordre enregistré');
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    const r = await act(() => api('/api/admin/categories', { method: 'POST', body: { name: newCat } }), 'Catégorie ajoutée');
    if (r?.id) selectCategory(r.id);
    if (r) setNewCat('');
  };
  const addProduct = async () => {
    const price = toCents(newProd.price);
    if (!newProd.name.trim()) return say('Indiquez le nom du produit.', true);
    if (!Number.isFinite(price)) return say('Indiquez le prix, par exemple 9,90.', true);
    const r = await act(() => api('/api/admin/products', { method: 'POST', body: { name: newProd.name, price_cents: price, category_id: catId } }), 'Produit ajouté');
    if (r?.id) {
      setNewProd({ name: '', price: '' });
      setAddingProduct(false);
      openProduct(r.id);
    }
  };
  const archiveCat = (c) => window.confirm(`Archiver la catégorie « ${c.name} » ? Elle disparaît du site ; vous pourrez la restaurer dans « Archivés ».`)
    && act(() => api(`/api/admin/categories/${c.id}/archive`, { method: 'POST' }), 'Catégorie archivée');
  const archiveProduct = async (p) => {
    if (!window.confirm(`Archiver « ${p.name} » ? Il disparaît du site ; vous pourrez le restaurer dans « Archivés ».`)) return;
    if (await act(() => api(`/api/admin/products/${p.id}/archive`, { method: 'POST' }), 'Produit archivé')) setProdId(null);
  };
  const duplicate = async (p) => {
    const r = await act(() => api(`/api/admin/products/${p.id}/duplicate`, { method: 'POST' }), 'Produit dupliqué (masqué, à vérifier)');
    if (r?.id) openProduct(r.id);
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
    <div className="carte cr-workspace">
      <header className="cr-workspace-head" hidden={view === 'carte' && Boolean(product)}>
        <h2>Ma carte</h2>
        <nav className="tabs sub" aria-label="Gestion de la carte">
          <button aria-current={view === 'carte' ? 'page' : undefined} className={view === 'carte' ? 'active' : ''} onClick={() => setView('carte')}>Produits</button>
          <button aria-current={view === 'categories' ? 'page' : undefined} className={view === 'categories' ? 'active' : ''} onClick={() => setView('categories')}>Catégories</button>
          <button aria-current={view === 'import' ? 'page' : undefined} className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>Importer</button>
          <button aria-current={view === 'archives' ? 'page' : undefined} className={view === 'archives' ? 'active' : ''} onClick={() => setView('archives')}>
            Archivés ({data.archived.categories.length + data.archived.products.length})</button>
        </nav>
      </header>

      {view === 'carte' && <div className="cr-bar" hidden={Boolean(product)}>
        <input ref={searchInput} type="search" className="cr-search" aria-label="Rechercher dans toute la carte"
          placeholder="Rechercher un produit" value={search} onChange={(e) => {
            setSearch(e.target.value);
            if (productList.current) productList.current.scrollTop = 0;
          }} />
        {searching && <button type="button" className="cr-btn" onClick={() => { setSearch(''); searchInput.current?.focus(); }}>Effacer</button>}
      </div>}

      {view === 'import' ? (
        <ImportMenu say={say} onDone={() => { load(); setView('carte'); }} />
      ) : view === 'archives' ? (
        <Archives data={data} onRestore={(kind, id) => act(() => api(`/api/admin/${kind}/${id}/restore`, { method: 'POST' }), 'Restauré')} />
      ) : (
        <div className="cr-grid cr-catalog-grid">
          {view === 'categories' && <section className="cr-col cr-cats" aria-label="Catégories">
            <h2>Catégories</h2>
            <form className="cr-add" onSubmit={(e) => { e.preventDefault(); addCategory(); }}>
              <input required aria-label="Nom de la nouvelle catégorie" placeholder="Nouvelle catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button>+ Catégorie</button>
            </form>
            {cats.length > 1 && <p className="cr-order-hint">Montez ou descendez les catégories pour changer leur ordre sur la carte.</p>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragCats}>
              <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy} disabled={savingCategoryOrder}>
                {cats.map((c, index) => (
                  <Sortable key={c.id} id={c.id} className={`cr-category-row ${c.id === catId && !searching ? 'sel' : ''}`}>
                    <button className="cr-name" aria-current={c.id === catId && !searching ? 'true' : undefined} onClick={() => selectCategory(c.id)}>
                      <b>{c.name}</b>{!c.visible && <small>Masquée sur le site</small>}
                    </button>
                    <span className="cr-count" title={`${countIn(c.id)} produit(s)`}>{countIn(c.id)}</span>
                    {cats.length > 1 && <div className="cr-category-order" role="group" aria-label={`Ordre de ${c.name}`}>
                      <button type="button" aria-label={`Monter ${c.name}`} aria-disabled={savingCategoryOrder || index === 0}
                        onClick={() => moveCategory(index, index - 1)}>↑ <span>Monter</span></button>
                      <button type="button" aria-label={`Descendre ${c.name}`} aria-disabled={savingCategoryOrder || index === cats.length - 1}
                        onClick={() => moveCategory(index, index + 1)}>↓ <span>Descendre</span></button>
                    </div>}
                    <button className={`cr-eye ${c.visible ? 'on' : ''}`} title={c.visible ? 'Visible sur le site (cliquer pour masquer)' : 'Masquée (cliquer pour afficher)'} aria-label={c.visible ? 'Masquer la catégorie' : 'Afficher la catégorie'}
                      onClick={() => patchCat(c, { visible: !c.visible })}><Icon name={c.visible ? 'eye' : 'eyeOff'} /></button>
                    <span className="cr-more">
                      <button aria-label={`Actions pour ${c.name}`} aria-expanded={menuCat === c.id} onClick={() => setMenuCat(menuCat === c.id ? null : c.id)}><Icon name="more" /></button>
                      {menuCat === c.id && (
                        <span className="cr-pop">
                          <button onClick={() => { setMenuCat(null); const n = window.prompt('Nouveau nom de la catégorie', c.name); if (n && n.trim() && n !== c.name) patchCat(c, { name: n.trim() }); }}>Renommer</button>
                          <button onClick={() => { setMenuCat(null); archiveCat(c); }}>Archiver</button>
                        </span>
                      )}
                    </span>
                  </Sortable>
                ))}
              </SortableContext>
            </DndContext>
          </section>}

          {view === 'carte' && !searching && cats.length > 0 && <nav className="cr-category-strip" aria-label="Filtrer par catégorie" hidden={Boolean(product)}>
            {cats.map((c) => (
              <button type="button" key={c.id} aria-pressed={c.id === catId} onClick={() => selectCategory(c.id)}>
                {c.name}<span>{countIn(c.id)}</span>
              </button>
            ))}
          </nav>}
          {view === 'carte' && <section className="cr-col cr-prods" aria-label="Produits" ref={productList} hidden={Boolean(product)}>
            <div className="cr-product-heading">
              <div className="cr-product-heading-row">
                <div>
                  <h2>{searching ? 'Résultats de recherche' : cat?.name || 'Produits'}</h2>
                  <p>{shown.length} {shown.length === 1 ? 'produit' : 'produits'}</p>
                </div>
                {!searching && cat && <button type="button" className="cr-btn primary-ish" aria-expanded={addingProduct}
                  onClick={() => setAddingProduct(!addingProduct)}>{addingProduct ? 'Annuler' : '+ Produit'}</button>}
              </div>
              {addingProduct && !searching && cat && <form className="cr-new-product" onSubmit={(e) => { e.preventDefault(); addProduct(); }}>
                <label>Nom du produit<input required autoFocus value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} /></label>
                <label>Prix (€)<input required inputMode="decimal" placeholder="9,90" value={newProd.price} onChange={(e) => setNewProd({ ...newProd, price: e.target.value })} /></label>
                <button className="cr-btn primary-ish">Ajouter le produit</button>
              </form>}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragProds}>
              <SortableContext items={shown.map((p) => p.id)} strategy={verticalListSortingStrategy} disabled={searching}>
                {shown.map((p) => {
                  const groups = effectiveGroups(p);
                  return (
                    <Sortable key={p.id} id={p.id} className={`cr-product ${p.id === prodId ? 'sel' : ''}`}>
                      <button type="button" className="cr-product-main" onClick={(e) => openProduct(p.id, 'infos', e.currentTarget)} aria-label={`Modifier ${p.name}`}>
                        <span className="cr-thumb">
                        {p.photo ? <img src={API + p.photo} alt="" /> : <Icon name="image" />}
                        </span>
                        <span className="cr-name">
                          <b>{p.name}</b>
                          <small>{fromCents(p.price_cents)} €{groups.length > 0 && ` · ${groups.length} ${groups.length === 1 ? 'groupe' : 'groupes'} d’options`}
                            {searching && ` · ${data.categories.find((c) => c.id === p.category_id)?.name || 'Sans catégorie'}`}</small>
                        </span>
                        <span className="cr-edit-label" aria-hidden="true">Modifier</span>
                      </button>
                      <div className="cr-product-actions">
                        <button type="button" className="cr-product-options" aria-label={`Options de ${p.name}`}
                          onClick={(e) => openProduct(p.id, 'options', e.currentTarget)}>Options</button>
                        <button type="button" className={`cr-product-status ${!p.visible ? 'hidden-product' : p.sold_out ? 'sold-out' : ''}`}
                          aria-label={`Disponibilité de ${p.name} · ${!p.visible ? 'Masqué' : p.sold_out ? 'Épuisé' : 'Disponible'}`}
                          onClick={(e) => openProduct(p.id, 'dispo', e.currentTarget)}>
                          {!p.visible ? 'Masqué' : p.sold_out ? 'Épuisé' : 'Disponible'}
                        </button>
                      </div>
                    </Sortable>
                  );
                })}
              </SortableContext>
            </DndContext>
            {!shown.length && (
              <div className="cr-empty"><Icon name="image" size={32} />
                <p>{searching ? 'Aucun produit trouvé.' : cat ? 'Aucun produit dans cette catégorie.' : 'Créez une catégorie pour commencer.'}</p>
                {!searching && !cat && <button type="button" className="cr-btn primary-ish" onClick={() => setView('categories')}>Créer une catégorie</button>}
                </div>
            )}
          </section>}

          {view === 'carte' && product && (
            <ProductPanel key={`${product.id}-${productTab}`} initialTab={productTab} product={product} data={data} groups={effectiveGroups(product)} say={say}
              onPatch={(patch) => patchProduct(product, patch)} onClose={closeProduct}
              onDuplicate={() => duplicate(product)} onArchive={() => archiveProduct(product)}
              onPhoto={(file) => uploadPhoto(product, file)} onGroups={(body) => setGroups(product, body)}
              onOpenOptions={onOpenOptions} ruleText={ruleText} />
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

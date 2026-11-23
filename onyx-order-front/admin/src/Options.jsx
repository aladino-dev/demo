import { useCallback, useEffect, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { API, api, getSession } from '../../shared/session.js';
import BulkPhotos from './BulkPhotos.jsx';
import { Icon, Sortable, Switch, useDndSensors, useToast } from './ui.jsx';
import { fromCents, ruleSentence, ruleText, toCents, toSignedCents } from './util.js';
import './carte.css';

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const label = (g) => g.internal_name || g.title;

/** Bibliothèque des listes d'options (sauces, boissons…) : réutilisables, avec « utilisée par ». */
export default function Options() {
  const [lib, setLib] = useState(null);
  const [cat, setCat] = useState(null); // catégories et produits, pour les noms et « Utilisée par »
  const [selId, setSelId] = useState(null);
  const [view, setView] = useState('liste');
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [toast, say] = useToast();
  const sensors = useDndSensors();

  const load = useCallback(() => Promise.all([api('/api/admin/option-groups'), api('/api/admin/catalog')])
    .then(([l, c]) => { setLib(l); setCat(c); }).catch((e) => say(e.message, true)), [say]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lib || !cat) return <p className="muted">Chargement…</p>;

  const act = async (call, ok = 'Enregistré') => {
    try { const r = await call(); say(ok); await load(); return r ?? true; } catch (e) { say(e.message, true); await load(); return false; }
  };
  // mise à jour optimiste : l'écran change tout de suite, retour arrière si l'API refuse
  const mutate = async (apply, call, ok = 'Enregistré') => {
    const prev = lib;
    setLib(apply(prev));
    try { await call(); say(ok); await load(); return true; } catch (e) { setLib(prev); say(e.message, true); return false; }
  };

  const groups = lib.groups;
  const sel = groups.find((g) => g.id === selId) || lib.archived.find((g) => g.id === selId) || null;
  const q = search.trim().toLowerCase();
  const shown = groups.filter((g) => !q || `${g.title} ${g.internal_name || ''}`.toLowerCase().includes(q));

  const addGroup = async () => {
    if (!newTitle.trim()) return;
    const r = await act(() => api('/api/admin/option-groups', { method: 'POST', body: { title: newTitle } }), 'Liste créée : ajoutez ses options');
    if (r?.id) { setNewTitle(''); setSelId(r.id); }
  };
  const dragGroups = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = arrayMove(groups.map((g) => g.id), groups.findIndex((g) => g.id === active.id), groups.findIndex((g) => g.id === over.id));
    mutate((l) => ({ ...l, groups: ids.map((id) => l.groups.find((g) => g.id === id)) }),
      () => api('/api/admin/option-groups/reorder', { method: 'POST', body: { ids } }), 'Ordre enregistré');
  };

  return (
    <div className="carte opts">
      <div className="cr-bar">
        <div className="tabs sub">
          <button className={view === 'liste' ? 'active' : ''} onClick={() => { setView('liste'); setSelId(null); }}>Listes d'options ({groups.length})</button>
          <button className={view === 'photos' ? 'active' : ''} onClick={() => { setView('photos'); setSelId(null); }}>Photos en lot</button>
          <button className={view === 'archives' ? 'active' : ''} onClick={() => { setView('archives'); setSelId(null); }}>Archivées ({lib.archived.length})</button>
        </div>
        {view === 'liste' && <input className="cr-search" aria-label="Rechercher une liste" placeholder="Rechercher une liste" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </div>

      {view === 'photos' ? <BulkPhotos groups={groups} say={say} onDone={load} /> : (
      <div className={`cr-grid opts-grid ${sel ? 'has-selection' : ''}`}>
        <section className="cr-col option-library" aria-label="Listes d’options">
          <h2>{view === 'liste' ? 'Listes d’options' : 'Listes archivées'}</h2>
          {view === 'liste' ? (
            <>
              <div className="cr-add">
                <input aria-label="Nom de la nouvelle liste" placeholder="Ex. Sauces" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGroup()} />
                <button onClick={addGroup}>Créer une liste</button>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragGroups}>
                <SortableContext items={shown.map((g) => g.id)} strategy={verticalListSortingStrategy} disabled={!!q}>
                  {shown.map((g) => (
                    <Sortable key={g.id} id={g.id} className={g.id === selId ? 'sel' : ''}>
                      <button className="cr-name" onClick={() => setSelId(g.id)}>
                        <b>{label(g)}</b>
                        <small>{ruleText(g)} · {plural(g.options.length, 'option', 'options')} · {g.used_by.product_count ? `utilisée par ${plural(g.used_by.product_count, 'produit', 'produits')}` : 'non utilisée'}</small>
                      </button>
                      {g.warnings.length > 0 && <span className="cr-dot bad show" title={g.warnings[0]}>À vérifier</span>}
                    </Sortable>
                  ))}
                </SortableContext>
              </DndContext>
              {!shown.length && (
                <div className="cr-empty"><Icon name="plus" size={32} />
                  <p>{q ? 'Aucune liste trouvée.' : 'Aucune liste d\'options.'}</p>
                  {!q && <p className="muted">Créez-en une (ex. Sauces, Boissons, Suppléments), puis ajoutez ses options.</p>}</div>
              )}
            </>
          ) : (
            <>
              {lib.archived.map((g) => (
                <div key={g.id} className="cr-item">
                  <button className="cr-name" onClick={() => setSelId(g.id)}><b>{label(g)}</b><small>{plural(g.options.length, 'option', 'options')}</small></button>
                  <button className="cr-btn" onClick={() => act(() => api(`/api/admin/option-groups/${g.id}/restore`, { method: 'POST' }), 'Liste restaurée')}>Restaurer</button>
                </div>
              ))}
              {!lib.archived.length && <p className="muted">Aucune liste archivée.</p>}
            </>
          )}
        </section>

        {sel
          ? <Editor key={sel.id} g={sel} cat={cat} act={act} mutate={mutate} say={say} archived={!!sel.archived_at} onClose={() => setSelId(null)} onGone={() => setSelId(null)} onSelect={setSelId} />
          : <section className="cr-col cr-panel empty-editor"><div className="cr-empty"><Icon name="image" size={32} /><p>Choisissez une liste à gauche pour la modifier.</p>
            <p className="muted">Une liste d'options se crée une fois, puis se rattache à autant de produits que nécessaire.</p></div></section>}
      </div>
      )}
      {toast}
    </div>
  );
}

function Editor({ g, cat, act, mutate, say, archived, onClose, onGone, onSelect }) {
  const sensors = useDndSensors();
  const [newLabel, setNewLabel] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const n = g.used_by.product_count;
  const base = `/api/admin/option-groups/${g.id}`;
  const setG = (patch) => (l) => ({ ...l, groups: l.groups.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) });

  // Texte (titre, nom interne) : enregistré en quittant le champ
  const text = (key, required) => ({
    defaultValue: g[key] || '', key: `${key}-${g[key]}`,
    onBlur: (e) => {
      const v = e.target.value.trim();
      if (required && !v) { e.target.value = g[key]; return say('Le titre ne peut pas être vide.', true); }
      if (v !== (g[key] || '')) mutate(setG({ [key]: v }), () => api(base, { method: 'PATCH', body: { [key]: v } }));
    },
  });

  // Règle : avertit du nombre de produits concernés avant de modifier
  const setRule = (body) => {
    if (n > 0 && !window.confirm(`Ce changement s'applique aux ${plural(n, 'produit', 'produits')}. Continuer ?`)) return false;
    return act(() => api(base, { method: 'PATCH', body }), 'Règle enregistrée');
  };

  // Options : liste ordonnée, enregistrée en bloc (PUT) pour l'ordre, le retrait et le supplément global
  const putOptions = (options, ok) => act(() => api(`${base}/options`, { method: 'PUT', body: { options } }), ok);
  const asBody = (o) => ({ id: o.id, label: o.label, price_cents: o.price_cents, visible: o.visible });
  const patchOption = (o, patch) => mutate(
    (l) => ({ ...l, groups: l.groups.map((x) => (x.id === g.id ? { ...x, options: x.options.map((y) => (y.id === o.id ? { ...y, ...patch } : y)) } : x)) }),
    () => api(`/api/admin/options/${o.id}`, { method: 'PATCH', body: patch }));
  const dragOptions = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = arrayMove(g.options.map((o) => o.id), g.options.findIndex((o) => o.id === active.id), g.options.findIndex((o) => o.id === over.id));
    putOptions(ids.map((id) => asBody(g.options.find((o) => o.id === id))), 'Ordre enregistré');
  };
  const addOption = async () => {
    if (!newLabel.trim()) return;
    const price = newPrice.trim() ? toSignedCents(newPrice) : 0;
    if (!Number.isFinite(price)) return say('Supplément invalide (ex. 0,50).', true);
    const ok = await act(() => api(`${base}/options`, { method: 'POST', body: { label: newLabel, price_cents: price } }), 'Option ajoutée');
    if (ok) { setNewLabel(''); setNewPrice(''); document.getElementById('new-opt-label')?.focus(); }
  };
  const allSupplement = () => {
    const v = window.prompt('Supplément à appliquer à toutes les options (en €, 0 = gratuit) :', '0');
    if (v === null) return;
    const c = toSignedCents(v);
    if (!Number.isFinite(c)) return say('Montant invalide.', true);
    if (n > 0 && !window.confirm(`Ce changement s'applique aux ${plural(n, 'produit', 'produits')}. Continuer ?`)) return;
    putOptions(g.options.map((o) => ({ ...asBody(o), price_cents: c })), 'Supplément appliqué à toutes les options');
  };
  const uploadPhoto = (o, file) => act(async () => {
    const res = await fetch(`${API}/api/admin/options/${o.id}/photo`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getSession().token}` }, body: file });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Envoi impossible.');
  }, 'Photo enregistrée');

  const duplicate = async () => {
    const r = await act(() => api(`${base}/duplicate`, { method: 'POST' }), 'Liste dupliquée');
    if (r?.id) onSelect(r.id);
  };
  const archive = async () => {
    const warn = n > 0 ? ` Elle disparaîtra des ${plural(n, 'produit', 'produits')} qui l'utilisent.` : '';
    if (!window.confirm(`Archiver la liste « ${label(g)} » ?${warn} Vous pourrez la restaurer dans « Archivées ».`)) return;
    if (await act(() => api(`${base}/archive`, { method: 'POST' }), 'Liste archivée')) onGone();
  };

  return (
    <section className="cr-col cr-panel" aria-label="Éditeur de liste">
      <header className="cr-panel-head">
        <div className="hd-title">
          <h2>{label(g)}</h2>
          <span className="hd-meta"><span className="chip">{ruleText(g)}</span><span className="chip">{plural(g.options.length, 'option', 'options')}</span>
            <span className={`chip ${n ? 'ok' : ''}`}>{n ? `Utilisée par ${plural(n, 'produit', 'produits')}` : 'Non utilisée'}</span></span>
        </div>
        <button className="cr-btn" onClick={onClose}>Retour aux listes</button>
      </header>
      <div className="cr-scroll cr-form">
        {archived && <div className="op-note">Cette liste est archivée : elle n'apparaît plus sur le site. <button className="cr-btn" onClick={() => act(() => api(`${base}/restore`, { method: 'POST' }), 'Liste restaurée')}>Restaurer</button></div>}
        {n > 0 && !archived && <div className="op-note info">Utilisée par <b>{plural(n, 'produit', 'produits')}</b> : toute modification de cette liste s'applique à tous ces produits.</div>}
        {g.warnings.map((w) => <div key={w} className="op-note warn">⚠ {w}</div>)}

        <h3 className="op-h">Options <span className="muted">({g.options.length})</span></h3>
        <form className="cr-new-product option-create" onSubmit={(e) => { e.preventDefault(); addOption(); }}>
          <label>Nom du choix<input id="new-opt-label" required placeholder="Ex. Ketchup" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} /></label>
          <label>Supplément (€)<input inputMode="decimal" placeholder="0,00" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} /></label>
          <button className="cr-btn primary-ish">Ajouter le choix</button>
        </form>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragOptions}>
          <SortableContext items={g.options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            {g.options.map((o) => (
              <Sortable key={o.id} id={o.id} className={`option-editor-row ${o.visible ? '' : 'off'}`}>
                <label className="cr-thumb" title={o.photo ? 'Changer la photo' : 'Ajouter une photo'}>
                  {o.photo ? <img src={API + o.photo} alt="" /> : <Icon name="image" />}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files[0] && uploadPhoto(o, e.target.files[0])} />
                </label>
                <input className="op-label" aria-label="Nom de l'option" defaultValue={o.label} key={`l${o.label}`}
                  onBlur={(e) => { const v = e.target.value.trim(); if (!v) { e.target.value = o.label; return say('Le nom ne peut pas être vide.', true); } if (v !== o.label) patchOption(o, { label: v }); }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                <span className="cr-price"><input placeholder="gratuit" inputMode="decimal" aria-label="Supplément" defaultValue={o.price_cents ? fromCents(o.price_cents) : ''} key={`p${o.price_cents}`}
                  onBlur={(e) => { const raw = e.target.value.trim(); const c = raw ? toSignedCents(raw) : 0; if (!Number.isFinite(c)) { e.target.value = o.price_cents ? fromCents(o.price_cents) : ''; return say('Supplément invalide.', true); } if (c !== o.price_cents) patchOption(o, { price_cents: c }); }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} /> €</span>
                <Switch on={o.visible} label={o.visible ? 'Visible' : 'Masquée'} onChange={(v) => patchOption(o, { visible: v })} />
                <button className="cr-mini" aria-label={`Retirer ${o.label}`} title="Retirer (archivée)" onClick={() => window.confirm(`Retirer « ${o.label} » de la liste ? Elle sera archivée.`) && putOptions(g.options.filter((x) => x.id !== o.id).map(asBody), 'Option retirée')}>✕</button>
              </Sortable>
            ))}
          </SortableContext>
        </DndContext>
        {!g.options.length && <p className="muted">Ajoutez le premier choix ci-dessus.</p>}

        <details className="option-settings">
          <summary>Nom et règles de choix</summary>
          <h3 className="op-h">Affichage</h3>
          <label className="f">Titre affiché au client<input {...text('title', true)} placeholder="Ex. Choisissez vos sauces" /></label>
          <label className="f">Nom interne <span className="muted">(pour vous retrouver, jamais montré au client)</span><input {...text('internal_name')} placeholder="Ex. Sauces 2 max" /></label>

          <h3 className="op-h">Règle de choix</h3>
          <div className="op-rule">
            <Switch on={g.required} label="Obligatoire" onChange={(v) => setRule({ required: v })} />
            <label className="op-num">Minimum
              <input type="number" min="0" defaultValue={g.min_select} key={`min${g.min_select}`}
                onBlur={(e) => { const v = Math.max(parseInt(e.target.value, 10) || 0, 0); if (v !== g.min_select && !setRule({ min_select: v })) e.target.value = g.min_select; }} />
            </label>
            <label className="op-num">Maximum
              <input type="number" min="1" placeholder="illimité" defaultValue={g.max_select ?? ''} key={`max${g.max_select}`}
                onBlur={(e) => { const v = e.target.value === '' ? null : parseInt(e.target.value, 10); if (v !== g.max_select && !setRule({ max_select: v })) e.target.value = g.max_select ?? ''; }} />
            </label>
            <label className="op-num">Même option, au maximum
              <input type="number" min="1" max="20" defaultValue={g.max_per_option || 1} key={`per${g.max_per_option}`}
                onBlur={(e) => { const v = Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 20); if (v !== (g.max_per_option || 1) && !setRule({ max_per_option: v })) e.target.value = g.max_per_option || 1; }} />
            </label>
          </div>
          <p className="op-hint muted">« Même option, au maximum » : 1 = on la coche ou pas ; 2 ou 3 = le client peut en prendre plusieurs avec les boutons − et +.</p>
          <p className="op-sentence">{ruleSentence(g)}</p>
        </details>
        <details className="option-settings">
          <summary>Produits liés et autres actions</summary>
          {!!g.options.length && <button className="cr-btn" onClick={allSupplement}>Appliquer un supplément à toutes les options</button>}
          <h3 className="op-h">Utilisée par</h3>
          <Usage g={g} cat={cat} act={act} />

          <div className="cr-actions">
            <button className="cr-btn" onClick={duplicate}>Dupliquer</button>
            {!archived && <button className="cr-btn danger" onClick={archive}>Archiver</button>}
          </div>
        </details>
      </div>
    </section>
  );
}

/** Produits et catégories qui utilisent la liste : cocher/décocher enregistre tout de suite. */
function Usage({ g, cat, act }) {
  const direct = new Set(g.used_by.products.map((p) => p.id));
  const viaCat = new Set(g.used_by.inherited.map((p) => p.id));
  const cats = new Set(g.used_by.categories.map((c) => c.id));
  const save = (products, categories) => act(() => api(`/api/admin/option-groups/${g.id}/usage`, { method: 'PUT', body: { product_ids: [...products], category_ids: [...categories] } }), 'Rattachement enregistré');
  const flip = (set, id) => { const s = new Set(set); s.has(id) ? s.delete(id) : s.add(id); return s; };
  return (
    <div className="op-usage">
      <p className="muted">Cochez une catégorie pour l'appliquer à tous ses produits qui n'ont pas d'options personnalisées. Cochez un produit pour lui donner cette liste directement (il n'hérite alors plus de sa catégorie).</p>
      {[...cat.categories].sort((a, b) => a.sort - b.sort).map((c) => {
        const prods = cat.products.filter((p) => p.category_id === c.id).sort((a, b) => a.sort - b.sort);
        return (
          <details key={c.id} className="op-cat" open={cats.has(c.id) || prods.some((p) => direct.has(p.id))}>
            <summary>
              <label onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={cats.has(c.id)} onChange={() => save(direct, flip(cats, c.id))} /> <b>{c.name}</b>
              </label>
              <span className="muted"> {cats.has(c.id) ? 'toute la catégorie' : ''}</span>
            </summary>
            <div className="op-prods">
              {prods.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" checked={direct.has(p.id) || viaCat.has(p.id)} disabled={viaCat.has(p.id) && !direct.has(p.id)} onChange={() => save(flip(direct, p.id), cats)} /> {p.name}
                  {viaCat.has(p.id) && !direct.has(p.id) && <span className="muted"> (via la catégorie)</span>}
                </label>
              ))}
              {!prods.length && <span className="muted">Aucun produit.</span>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

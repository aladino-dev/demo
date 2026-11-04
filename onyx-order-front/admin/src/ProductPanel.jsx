import { useState } from 'react';
import { API } from '../../shared/session.js';
import ProductPreview from '../../shared/ProductPreview.jsx';
import { fromCents, toCents } from './util.js';

/** Fiche produit : onglets (Infos, Options, Disponibilité), tout se modifie sur place, aperçu client toujours visible à droite. */
export default function ProductPanel({ product: p, data, groups, say, onPatch, onClose, onDuplicate, onArchive, onPhoto, onGroups, ruleText }) {
  const [tab, setTab] = useState('infos');
  const [over, setOver] = useState(false);
  const [add, setAdd] = useState('');
  const cat = data.categories.find((c) => c.id === p.category_id);
  const inherits = !p.group_ids.length;
  const library = data.groups.filter((g) => !groups.some((x) => x.id === g.id));

  const text = (key, max) => ({
    defaultValue: p[key], key: `${key}-${p[key]}`, maxLength: max,
    onBlur: (e) => {
      const v = e.target.value.trim();
      if (key === 'name' && !v) { e.target.value = p.name; return say('Le nom ne peut pas être vide.', true); }
      if (v !== p[key]) onPatch({ [key]: v });
    },
  });
  const drop = (e) => {
    e.preventDefault(); setOver(false);
    if (e.dataTransfer.files[0]) onPhoto(e.dataTransfer.files[0]);
  };
  // l'aperçu montre les options visibles seulement, comme le site
  const previewGroups = groups.map((g) => ({
    id: g.id, title: g.title, min: g.min_select, max: g.max_select, required: g.required,
    options: g.options.filter((o) => o.visible),
  }));
  const move = (i, d) => { const ids = groups.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; onGroups({ group_ids: ids }); };

  return (
    <section className="cr-col cr-panel" aria-label="Fiche produit">
      <header className="cr-panel-head">
        <button className="cr-btn back" onClick={onClose}>← Retour</button>
        <span className="hd-thumb">{p.photo ? <img src={API + p.photo} alt="" /> : null}</span>
        <div className="hd-title">
          <h2>{p.name}</h2>
          <span className="hd-meta">
            <span className="chip">{cat?.name || 'Sans catégorie'}</span>
            <span className={`chip ${p.visible ? 'ok' : ''}`}>{p.visible ? 'Visible' : 'Masqué'}</span>
            {p.sold_out && <span className="chip bad">Épuisé aujourd'hui</span>}
          </span>
        </div>
        <button className="cr-btn" onClick={onClose} aria-label="Fermer la fiche">✕ Fermer</button>
      </header>
      <nav className="cr-tabs" role="tablist">
        {[['infos', 'Infos'], ['options', `Options (${groups.length})`], ['dispo', 'Disponibilité']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      <div className="cr-panel-body">
        <div className="cr-form cr-scroll">
          {tab === 'infos' && (
            <>
              <label className="f">Nom<input {...text('name', 120)} /></label>
              <div className="two">
                <label className="f">Prix (€)
                  <input defaultValue={fromCents(p.price_cents)} key={p.price_cents} inputMode="decimal"
                    onBlur={(e) => {
                      const c = toCents(e.target.value);
                      if (!Number.isFinite(c)) { e.target.value = fromCents(p.price_cents); return say('Prix invalide.', true); }
                      if (c !== p.price_cents) onPatch({ price_cents: c });
                    }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </label>
                <label className="f">Catégorie
                  <select value={p.category_id || ''} onChange={(e) => onPatch({ category_id: e.target.value ? Number(e.target.value) : null })}>
                    {!p.category_id && <option value="">— aucune —</option>}
                    {[...data.categories].sort((a, b) => a.sort - b.sort).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="f">Description <span className="muted">({p.description.length}/600)</span>
                <textarea rows={4} {...text('description', 600)} /></label>
              <div className="f">Photo
                <div className={`cr-photo ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
                  {p.photo ? <img src={API + p.photo} alt="" /> : <span className="none">Aucune photo</span>}
                  <span className="side">
                    <label className="cr-btn">{p.photo ? 'Changer la photo' : 'Choisir une photo'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files[0] && onPhoto(e.target.files[0])} />
                    </label>
                    <span className="muted">ou glissez une image ici</span>
                  </span>
                </div>
              </div>
            </>
          )}

          {tab === 'options' && (
            <>
              <div className="cr-opt-box">
                {inherits ? (
                  <>
                    <p>Ce produit <b>hérite de la catégorie {cat?.name || '—'}</b>{groups.length ? ' :' : ' (aucune option).'}</p>
                    {groups.map((g) => <p key={g.id} className="row-g"><b>{g.title}</b> <span className="muted">{ruleText(g)}</span></p>)}
                    <button className="cr-btn" onClick={() => onGroups({ group_ids: groups.map((g) => g.id) })}>Personnaliser pour ce produit</button>
                  </>
                ) : (
                  <>
                    <p><b>Options personnalisées</b> pour ce produit.</p>
                    {groups.map((g, i) => (
                      <p key={g.id} className="row-g">
                        <span><b>{g.title}</b> <span className="muted">{ruleText(g)}</span></span>
                        <span>
                          <button className="cr-mini" disabled={i === 0} aria-label="Monter" onClick={() => move(i, -1)}>↑</button>
                          <button className="cr-mini" disabled={i === groups.length - 1} aria-label="Descendre" onClick={() => move(i, 1)}>↓</button>
                          <button className="cr-mini" onClick={() => onGroups({ group_ids: groups.filter((x) => x.id !== g.id).map((x) => x.id) })}>Retirer</button>
                        </span>
                      </p>
                    ))}
                    {!groups.length && <p className="muted">Ce produit n'a aucune option.</p>}
                    <button className="cr-btn" onClick={() => window.confirm('Revenir aux options de la catégorie ? La liste personnalisée de ce produit sera remplacée.') && onGroups({ inherit: true })}>Hériter de la catégorie</button>
                  </>
                )}
              </div>
              <div className="cr-add">
                <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Ajouter une liste d'options">
                  <option value="">+ Ajouter une liste d'options…</option>
                  {library.map((g) => <option key={g.id} value={g.id}>{g.internal_name || g.title}</option>)}
                </select>
                <button className="cr-btn" disabled={!add} onClick={() => { onGroups({ group_ids: [...groups.map((g) => g.id), Number(add)] }); setAdd(''); }}>Ajouter</button>
              </div>
              <p className="muted">Les listes se créent et se modifient dans l'écran « Options ». L'aperçu à droite se met à jour tout de suite.</p>
            </>
          )}

          {tab === 'dispo' && (
            <>
              <button role="switch" aria-checked={p.visible} className={`cr-bigsw ${p.visible ? 'on' : ''}`} onClick={() => onPatch({ visible: !p.visible })}>
                <b>{p.visible ? 'Visible sur le site' : 'Masqué du site'}</b><span className="muted">{p.visible ? 'Touchez pour masquer' : 'Touchez pour afficher'}</span>
              </button>
              <button role="switch" aria-checked={p.sold_out} className={`cr-bigsw ${p.sold_out ? 'danger' : ''}`} onClick={() => onPatch({ sold_out_today: !p.sold_out })}>
                <b>{p.sold_out ? "Épuisé aujourd'hui" : 'Disponible'}</b><span className="muted">{p.sold_out ? 'Remis en vente demain à 5 h' : "Touchez s'il n'y en a plus"}</span>
              </button>
              <div className="cr-actions">
                <button className="cr-btn" onClick={onDuplicate}>Dupliquer</button>
                <button className="cr-btn danger" onClick={onArchive}>Archiver</button>
              </div>
              <p className="muted">Archiver masque le produit partout ; vous le retrouvez dans « Archivés ».</p>
            </>
          )}
        </div>
        <aside className="cr-preview cr-scroll" aria-label="Aperçu client">
          <h3>Aperçu client</h3>
          <ProductPreview key={`${p.id}-${previewGroups.map((g) => g.id).join()}`} name={p.name} description={p.description} price_cents={p.price_cents}
            photoUrl={p.photo ? API + p.photo : null} groups={previewGroups} photoBase={API} />
        </aside>
      </div>
    </section>
  );
}

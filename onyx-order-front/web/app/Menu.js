'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { eur, photoUrl } from '../lib/api';
import { useCart } from '../lib/cart';

// Photo en image de fond ; sans photo : pastille colorée avec l'initiale du nom
function Photo({ src, className, name }) {
  const url = photoUrl(src);
  if (url && className === 'ph') {
    return <img className="ph" src={url} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <span className={`${className} ${url ? '' : 'noph'}`} style={url ? { backgroundImage: `url("${url}")` } : undefined} role="img" aria-label={name || ''}>
      {!url && name ? name.trim().charAt(0).toUpperCase() : null}
    </span>
  );
}

export default function Menu({ categories, canOrder }) {
  const [active, setActive] = useState(categories[0]?.slug);
  const [product, setProduct] = useState(null);
  const cart = useCart();
  const tabsRef = useRef(null);
  // nombre d'exemplaires de chaque produit déjà dans le panier : affiché sur la carte du produit
  const inCart = useMemo(() => { const m = {}; for (const i of cart.items) m[i.product_id] = (m[i.product_id] || 0) + i.quantity; return m; }, [cart.items]);

  const selectProduct = (p) => {
    if (!canOrder || p.option_groups.length) {
      setProduct(p);
      return;
    }
    cart.add({ product_id: p.id, name: p.name, photo: p.photo, quantity: 1, options: [], labels: [], unit_cents: p.price_cents });
  };

  // « produit du mois » de la bannière : ouvre la fiche du produit
  useEffect(() => {
    const open = (e) => {
      const p = categories.flatMap((c) => c.products).find((x) => x.id === e.detail);
      if (p) selectProduct(p);
    };
    window.addEventListener('onyx:open-product', open);
    return () => window.removeEventListener('onyx:open-product', open);
  });

  // onglet actif selon la section visible
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const v = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (v) setActive(v.target.id);
    }, { rootMargin: '-70px 0px -60% 0px' });
    categories.forEach((c) => { const el = document.getElementById(c.slug); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [categories]);

  useEffect(() => {
    const el = tabsRef.current?.querySelector(`[data-slug="${active}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <>
      <nav className="tabs" aria-label="Catégories">
        <div className="wrap" ref={tabsRef}>
          {categories.map((c) => (
            <button key={c.id} data-slug={c.slug} className={`tab ${active === c.slug ? 'active' : ''}`}
              onClick={() => document.getElementById(c.slug)?.scrollIntoView({ behavior: 'smooth' })}>
              {c.name}
            </button>
          ))}
        </div>
      </nav>
      <main id="menu" className="wrap menu">
        {categories.map((c) => (
          <section key={c.id} id={c.slug} className="cat">
            <h2>{c.name}</h2>
            <div className="grid">
              {c.products.map((p) => (
                <button key={p.id} className={`card ${p.sold_out ? 'out' : ''}`} onClick={() => selectProduct(p)}
                  disabled={p.sold_out} aria-label={`${p.name}, ${eur(p.price_cents)}${inCart[p.id] ? `, ${inCart[p.id]} dans le panier` : ''}${p.sold_out ? ', épuisé aujourd\'hui' : p.option_groups.length ? ', personnaliser' : ', ajouter au panier'}`}>
                  <div className="pw">
                    <Photo src={p.photo} className="ph" name={p.name} />
                  </div>
                  <div className="b">
                    <span className="n">{p.name}</span>
                    {p.description && <span className="d">{p.description}</span>}
                    <span className="card-footer">
                      <span className="pp">{eur(p.price_cents)}</span>
                      {p.sold_out ? <span className="ribbon">Épuisé</span>
                        : p.option_groups.length ? <span className="card-customize">Personnaliser{inCart[p.id] ? ` · ${inCart[p.id]}` : ''}</span>
                        : inCart[p.id] ? <span key={inCart[p.id]} className="add in" aria-hidden="true">{inCart[p.id]}</span>
                        : <span className="add" aria-hidden="true"><span className="plus-icon" /></span>}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className="spacer" />
      </main>
      {product && <ProductModal p={product} canOrder={canOrder} onClose={() => setProduct(null)} onAdd={(line) => { cart.add(line); setProduct(null); }} />}
      {cart.ready && cart.count > 0 && (
        <div className="cartbar">
          <Link href="/commande" className="btn cartpill">
            <span className="bag" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 016 0" /></svg>
              <b key={cart.count} className="cnt">{cart.count}</b>
            </span>
            <span className="lbl">Voir mon panier</span><span>{eur(cart.total)}</span>
          </Link>
        </div>
      )}
    </>
  );
}


const minimumChoices = (group) => Math.max(group.min || 0, group.required ? 1 : 0);
const lastKey = (id) => `onyx-last-${id}`;
const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function ProductModal({ p, canOrder, onClose, onAdd }) {
  const [sel, setSel] = useState({}); // groupId -> [optionId]
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState({}); // groupId -> true : groupe complet rouvert à la main
  const [shake, setShake] = useState(null); // groupe manquant qui vibre en rouge
  const [search, setSearch] = useState({}); // groupId -> texte de recherche
  const [last, setLast] = useState(null); // « comme la dernière fois »
  const modalRef = useRef(null);
  const drag = useRef(null);
  const requiredGroups = p.option_groups.filter((g) => minimumChoices(g) > 0);
  const groups = [...requiredGroups, ...p.option_groups.filter((g) => minimumChoices(g) === 0)];

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);

  // dernière commande de ce produit sur cet appareil (seulement les options encore valides)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lastKey(p.id)) || 'null');
      if (!saved || !Array.isArray(saved.options) || !saved.options.length) return;
      const valid = new Set(p.option_groups.flatMap((g) => g.options.map((o) => o.id)));
      const ids = saved.options.filter((id) => valid.has(id));
      if (ids.length) setLast({ ids, note: String(saved.note || '') });
    } catch {}
  }, [p]);

  const next = requiredGroups.find((g) => (sel[g.id] || []).length < minimumChoices(g));
  const showGroup = (group) => {
    requestAnimationFrame(() => {
      const heading = document.getElementById(`option-title-${group.id}`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
    });
  };

  const toggle = (group, option) => {
    const current = sel[group.id] || [];
    const selected = current.includes(option.id);
    if (!selected && group.max != null && group.max !== 1 && current.length >= group.max) return;
    const updated = selected ? current.filter((id) => id !== option.id)
      : group.max === 1 ? [option.id] : [...current, option.id];
    const updatedSelection = { ...sel, [group.id]: updated };
    setSel(updatedSelection);

    const minimum = minimumChoices(group);
    if (current.length < minimum && updated.length >= minimum) {
      const remaining = requiredGroups.filter((item) => (updatedSelection[item.id] || []).length < minimumChoices(item));
      const groupIndex = requiredGroups.indexOf(group);
      const following = remaining.find((item) => requiredGroups.indexOf(item) > groupIndex) || remaining[0];
      if (following) showGroup(following);
    }
  };

  const unit = useMemo(() => p.price_cents + p.option_groups.reduce((a, g) =>
    a + (sel[g.id] || []).reduce((b, id) => b + (g.options.find((o) => o.id === id)?.price_cents || 0), 0), 0), [sel, p]);

  const chosenLabels = p.option_groups.flatMap((g) => (sel[g.id] || []).map((id) => g.options.find((o) => o.id === id)?.label).filter(Boolean));

  const applyLast = () => {
    if (!last) return;
    const s = {};
    for (const g of p.option_groups) {
      const ids = g.options.filter((o) => last.ids.includes(o.id)).map((o) => o.id);
      if (ids.length) s[g.id] = g.max != null ? ids.slice(0, g.max) : ids;
    }
    setSel(s);
    setNote(last.note);
    setReopen({});
  };

  const add = () => {
    if (next) {
      // pas de pop-up : on amène le groupe manquant à l'écran et il vibre en rouge
      setReopen((r) => ({ ...r, [next.id]: true }));
      showGroup(next);
      setShake(next.id);
      try { navigator.vibrate?.(40); } catch {}
      setTimeout(() => setShake(null), 700);
      return;
    }
    const options = [];
    const labels = [];
    for (const g of p.option_groups) for (const id of sel[g.id] || []) {
      const o = g.options.find((x) => x.id === id);
      options.push(id);
      labels.push(o.label + (o.price_cents ? ` (${o.price_cents > 0 ? "+" : "−"}${eur(Math.abs(o.price_cents))})` : ""));
    }
    const cleanNote = note.trim().slice(0, 200);
    try { localStorage.setItem(lastKey(p.id), JSON.stringify({ options, note: cleanNote })); } catch {}
    onAdd({ product_id: p.id, name: p.name, photo: p.photo || null, quantity: qty, options, labels, unit_cents: unit, note: cleanNote || undefined });
  };

  const rule = (g) => {
    const min = minimumChoices(g);
    if (g.max === 1) return min ? 'Sélectionnez une option' : 'Une option au maximum';
    if (g.max == null) return min ? `Sélectionnez au moins ${min === 1 ? 'une option' : `${min} options`}` : 'Plusieurs options possibles';
    if (min === g.max) return `Sélectionnez ${min} options`;
    return min ? `Sélectionnez de ${min} à ${g.max} options` : `Jusqu’à ${g.max} options`;
  };

  // glisser la poignée vers le bas ferme le tiroir
  const onHandleDown = (e) => { drag.current = { y: e.clientY, dy: 0 }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onHandleMove = (e) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    if (modalRef.current) { modalRef.current.style.transition = 'none'; modalRef.current.style.transform = `translateY(${drag.current.dy}px)`; }
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    const { dy } = drag.current;
    drag.current = null;
    if (modalRef.current) { modalRef.current.style.transition = ''; modalRef.current.style.transform = ''; }
    if (dy > 90) onClose();
  };

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={p.name}>
      <div className="modal drawer" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="handle-zone" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
          <span className="handle" aria-hidden="true" />
        </div>
        <button type="button" className="close drawer-close" onClick={onClose} aria-label="Fermer">
          <span className="plus-icon close-icon" aria-hidden="true" />
        </button>
        <div className="scroll">
          <Photo src={p.photo} className="mhero" name={p.name} />
          <div className="minfo2">
            <div className="mline"><h3>{p.name}</h3><p className="price">{eur(p.price_cents)}</p></div>
            {p.description && <p className="desc desc2">{p.description}</p>}
          </div>
          {last && <button type="button" className="last-time" onClick={applyLast}>↻ Comme la dernière fois</button>}
          <div className="groups">
            {groups.map((g) => {
              const cur = sel[g.id] || [];
              const min = minimumChoices(g);
              const single = g.max === 1;
              const full = !single && g.max != null && cur.length >= g.max;
              const photos = g.options.every((o) => o.photo);
              const done = min > 0 && cur.length >= min;
              const complete = cur.length > 0 && (single || (g.max != null && cur.length >= g.max));
              const collapsed = complete && !reopen[g.id];
              const q = normalize(search[g.id]);
              const shown = q ? g.options.filter((o) => normalize(o.label).includes(q)) : g.options;
              return (
                <section key={g.id} className={`group ${next?.id === g.id ? 'current' : ''} ${done ? 'done' : ''} ${collapsed ? 'collapsed' : ''} ${shake === g.id ? 'shake' : ''}`}>
                  <div className="group-heading">
                    <h4 id={`option-title-${g.id}`} tabIndex={-1}>{g.title}</h4>
                    {!single && g.max != null ? (
                      <span className={`req counter ${cur.length >= Math.max(min, 1) ? 'done' : ''}`} aria-live="polite">{cur.length}/{g.max} choisis</span>
                    ) : (
                      <span className={`req ${done ? 'done' : min ? '' : 'optional'}`}>
                        {done ? '✓ Choisi' : min ? 'Obligatoire' : 'Facultatif'}
                      </span>
                    )}
                  </div>
                  {collapsed ? (
                    <button type="button" className="group-summary" onClick={() => setReopen((r) => ({ ...r, [g.id]: true }))}>
                      <span>{cur.map((id) => g.options.find((o) => o.id === id)?.label).filter(Boolean).join(' · ')}</span>
                      <span className="edit">Modifier</span>
                    </button>
                  ) : (
                    <>
                      <p className="sub" id={`option-rule-${g.id}`}>{rule(g)}</p>
                      {g.options.length > 8 && (
                        <input className="opt-search" type="search" inputMode="search" placeholder="Rechercher…" aria-label={`Rechercher dans ${g.title}`}
                          value={search[g.id] || ''} onChange={(e) => setSearch((s) => ({ ...s, [g.id]: e.target.value }))} />
                      )}
                      <div className={`opts ${photos ? 'photos' : ''}`} role={single ? 'radiogroup' : 'group'}
                        aria-labelledby={`option-title-${g.id}`} aria-describedby={`option-rule-${g.id}`}>
                        {shown.map((o) => {
                          const on = cur.includes(o.id);
                          return (
                            <label key={o.id} className={`opt ${on ? 'on' : ''} ${photos ? 'withph' : ''} ${single ? 'radio' : 'check'}`}>
                              <input className="option-input" type={single ? 'radio' : 'checkbox'} name={`option-${g.id}`}
                                checked={on} disabled={!on && full} onChange={() => toggle(g, o)} />
                              <span className="ind" aria-hidden="true" />
                              {o.photo && <span className="option-photo" aria-hidden="true"><Photo src={o.photo} className="oph" name={o.label} /></span>}
                              <span className="lbl">{o.label}</span>
                              {o.price_cents !== 0 && <span className="x">{o.price_cents > 0 ? "+" : "−"}{eur(Math.abs(o.price_cents))}</span>}
                            </label>
                          );
                        })}
                        {q && shown.length === 0 && <p className="sub">Aucun résultat.</p>}
                      </div>
                      {full && <p className="option-count" aria-live="polite">Complet · désélectionne une option pour en changer.</p>}
                      {single && !min && cur.length > 0 && <button type="button" className="clear-option"
                        onClick={() => setSel((s) => ({ ...s, [g.id]: [] }))}>Retirer mon choix</button>}
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <details className="kitchen-note">
            <summary>Une remarque pour la cuisine ?</summary>
            <textarea rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. sans oignons, bien cuit…" aria-label="Remarque pour la cuisine" />
          </details>
        </div>
        <div className="product-footer">
          {(chosenLabels.length > 0 || next) && (
            <p className="choice-recap" aria-live="polite">
              {chosenLabels.length > 0 && <><b>Ton choix :</b> {chosenLabels.join(' · ')}</>}
              {chosenLabels.length > 0 && next && ' — '}
              {next && <b>Reste : {next.title}</b>}
            </p>
          )}
          <div className="bar">
            {canOrder && <div className="qty" role="group" aria-label="Quantité">
              <button onClick={() => setQty((q2) => Math.max(1, q2 - 1))} disabled={qty === 1} aria-label="Réduire la quantité">−</button>
              <span aria-live="polite">{qty}</span>
              <button onClick={() => setQty((q2) => Math.min(20, q2 + 1))} disabled={qty === 20} aria-label="Augmenter la quantité"><span className="plus-icon" aria-hidden="true" /></button>
            </div>}
            <button className={`btn add-btn ${canOrder && next ? 'blocked' : ''}`} onClick={add} disabled={!canOrder} aria-disabled={canOrder && next ? 'true' : undefined}>
              <span>{!canOrder ? 'Fermé' : 'Ajouter'}</span>
              <span key={unit * qty} className="tick">{eur(unit * qty)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

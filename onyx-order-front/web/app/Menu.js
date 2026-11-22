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

function ProductModal({ p, canOrder, onClose, onAdd }) {
  const [sel, setSel] = useState({}); // groupId -> [optionId]
  const [qty, setQty] = useState(1);
  const requiredGroups = p.option_groups.filter((g) => minimumChoices(g) > 0);
  const groups = [...requiredGroups, ...p.option_groups.filter((g) => minimumChoices(g) === 0)];

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);

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

  // rappel de tout ce qui a été choisi, pour ne rien oublier
  const chosenLabels = p.option_groups.flatMap((g) => (sel[g.id] || []).map((id) => g.options.find((o) => o.id === id)?.label).filter(Boolean));

  const add = () => {
    if (next) {
      showGroup(next);
      return;
    }
    const options = [];
    const labels = [];
    for (const g of p.option_groups) for (const id of sel[g.id] || []) {
      const o = g.options.find((x) => x.id === id);
      options.push(id);
      labels.push(o.label + (o.price_cents ? ` (${o.price_cents > 0 ? "+" : "−"}${eur(Math.abs(o.price_cents))})` : ""));
    }
    onAdd({ product_id: p.id, name: p.name, photo: p.photo || null, quantity: qty, options, labels, unit_cents: unit });
  };

  const rule = (g) => {
    const min = minimumChoices(g);
    if (g.max === 1) return min ? 'Sélectionnez une option' : 'Une option au maximum';
    if (g.max == null) return min ? `Sélectionnez au moins ${min === 1 ? 'une option' : `${min} options`}` : 'Plusieurs options possibles';
    if (min === g.max) return `Sélectionnez ${min} options`;
    return min ? `Sélectionnez de ${min} à ${g.max} options` : `Jusqu’à ${g.max} options`;
  };

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={p.name}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-toolbar">
          <button type="button" className="close" onClick={onClose}>
            <span className="plus-icon close-icon" aria-hidden="true" />
            Fermer
          </button>
        </div>
        <div className="scroll">
          <div className="mtop">
            <Photo src={p.photo} className="mph" name={p.name} />
            <div className="minfo">
              <h3>{p.name}</h3>
              {p.description && <p className="desc">{p.description}</p>}
              <p className="price">{eur(p.price_cents)}</p>
            </div>
          </div>
          <div className="groups">
            {groups.map((g) => {
              const cur = sel[g.id] || [];
              const min = minimumChoices(g);
              const single = g.max === 1;
              const full = !single && g.max != null && cur.length >= g.max;
              const photos = g.options.every((o) => o.photo);
              const done = min > 0 && cur.length >= min;
              return (
                <section key={g.id} className={`group ${next?.id === g.id ? 'current' : ''} ${done ? 'done' : ''}`}>
                  <div className="group-heading">
                    <h4 id={`option-title-${g.id}`} tabIndex={-1}>{g.title}</h4>
                    <span className={`req ${done ? 'done' : min ? '' : 'optional'}`}>
                      {done ? '✓ Choisi' : min ? 'Obligatoire' : 'Facultatif'}
                    </span>
                  </div>
                  <p className="sub" id={`option-rule-${g.id}`}>{rule(g)}</p>
                  <div className={`opts ${photos ? 'photos' : ''}`} role={single ? 'radiogroup' : 'group'}
                    aria-labelledby={`option-title-${g.id}`} aria-describedby={`option-rule-${g.id}`}>
                    {g.options.map((o) => {
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
                  </div>
                  {!single && cur.length > 0 && <p className="option-count" aria-live="polite">
                    {cur.length} {cur.length === 1 ? 'option sélectionnée' : 'options sélectionnées'}
                    {full && ' · Désélectionnez une option pour en choisir une autre.'}
                  </p>}
                  {single && !min && cur.length > 0 && <button type="button" className="clear-option"
                    onClick={() => setSel((s) => ({ ...s, [g.id]: [] }))}>Retirer mon choix</button>}
                </section>
              );
            })}
          </div>
        </div>
        <div className="product-footer">
          {chosenLabels.length > 0 && <p className="choice-recap" aria-live="polite"><b>Ton choix :</b> {chosenLabels.join(' · ')}</p>}
          <div className="bar">
            {!next && canOrder && <div className="qty" role="group" aria-label="Quantité">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty === 1} aria-label="Réduire la quantité">−</button>
              <span aria-live="polite">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={qty === 20} aria-label="Augmenter la quantité"><span className="plus-icon" aria-hidden="true" /></button>
            </div>}
            <button className={`btn ${canOrder && next ? 'need' : ''}`} onClick={add} disabled={!canOrder}>
              <span>{!canOrder ? 'Fermé' : next ? <>Choisir <strong>{next.title}</strong></> : 'Ajouter au panier'}</span>
              <span key={unit * qty} className="tick">{eur(unit * qty)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

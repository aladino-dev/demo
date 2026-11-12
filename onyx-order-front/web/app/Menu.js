'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { eur, photoUrl } from '../lib/api';
import { useCart } from '../lib/cart';

// Photo en image de fond ; sans photo : pastille colorée avec l'initiale du nom
function Photo({ src, className, name }) {
  const url = photoUrl(src);
  return (
    <div className={`${className} ${url ? '' : 'noph'}`} style={url ? { backgroundImage: `url("${url}")` } : undefined} role="img" aria-label={name || ''}>
      {!url && name ? name.trim().charAt(0).toUpperCase() : null}
    </div>
  );
}

export default function Menu({ categories, canOrder }) {
  const [active, setActive] = useState(categories[0]?.slug);
  const [product, setProduct] = useState(null);
  const cart = useCart();
  const tabsRef = useRef(null);
  // nombre d'exemplaires de chaque produit déjà dans le panier : affiché sur la carte du produit
  const inCart = useMemo(() => { const m = {}; for (const i of cart.items) m[i.product_id] = (m[i.product_id] || 0) + i.quantity; return m; }, [cart.items]);

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
      <main className="wrap">
        {categories.map((c) => (
          <section key={c.id} id={c.slug} className="cat">
            <h2>{c.name}</h2>
            <div className="grid">
              {c.products.map((p) => (
                <button key={p.id} className={`card ${p.sold_out ? 'out' : ''}`} onClick={() => !p.sold_out && setProduct(p)}
                  disabled={p.sold_out} aria-label={`${p.name}, ${eur(p.price_cents)}${inCart[p.id] ? `, ${inCart[p.id]} dans le panier` : ''}${p.sold_out ? ', épuisé aujourd\'hui' : ''}`}>
                  <div className="pw">
                    <Photo src={p.photo} className="ph" name={p.name} />
                    <span className="pp">{eur(p.price_cents)}</span>
                    {p.sold_out ? <span className="ribbon">Épuisé aujourd&apos;hui</span>
                      : inCart[p.id] ? <span key={inCart[p.id]} className="add in" aria-hidden="true">{inCart[p.id]}</span>
                      : <span className="add" aria-hidden="true">+</span>}
                  </div>
                  <div className="b">
                    <span className="n">{p.name}</span>
                    {p.description && <span className="d">{p.description}</span>}
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

function ProductModal({ p, canOrder, onClose, onAdd }) {
  const [sel, setSel] = useState({}); // groupId -> [optionId]
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);

  const toggle = (g, o) => setSel((s) => {
    const cur = s[g.id] || [];
    if (cur.includes(o.id)) return { ...s, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max === 1) return { ...s, [g.id]: [o.id] };            // choix unique : on remplace
    if (g.max != null && cur.length >= g.max) return s;
    return { ...s, [g.id]: [...cur, o.id] };
  });

  const missing = p.option_groups.filter((g) => (sel[g.id] || []).length < Math.max(g.min || 0, g.required ? 1 : 0));
  const unit = useMemo(() => p.price_cents + p.option_groups.reduce((a, g) =>
    a + (sel[g.id] || []).reduce((b, id) => b + (g.options.find((o) => o.id === id)?.price_cents || 0), 0), 0), [sel, p]);

  // un choix obligatoire vient d'être terminé : on amène doucement l'écran sur le suivant (utile au téléphone)
  const doneRef = useRef(new Set());
  useEffect(() => {
    const minOf = (g) => Math.max(g.min || 0, g.required ? 1 : 0);
    const done = new Set(p.option_groups.filter((g) => minOf(g) > 0 && (sel[g.id] || []).length >= minOf(g)).map((g) => g.id));
    const fresh = p.option_groups.some((g) => done.has(g.id) && !doneRef.current.has(g.id) && (g.max === 1 || (g.max != null && (sel[g.id] || []).length >= g.max)));
    doneRef.current = done;
    if (!fresh) return undefined;
    const next = p.option_groups.find((g) => minOf(g) > 0 && !done.has(g.id));
    if (!next) return undefined;
    const t = setTimeout(() => document.getElementById(`g${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 220);
    return () => clearTimeout(t);
  }, [sel, p]);

  const add = () => {
    setTried(true);
    if (missing.length) {
      document.getElementById(`g${missing[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const min = Math.max(g.min || 0, g.required ? 1 : 0);
    if (g.max === 1) return min ? 'Choisissez 1' : '1 choix maximum';
    if (g.max == null) return min ? `${min} minimum` : 'Plusieurs choix possibles';
    return min ? `Choisissez de ${min} à ${g.max}` : `Jusqu'à ${g.max} choix`;
  };

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={p.name}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="handle" aria-hidden="true" />
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
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
            {p.option_groups.map((g) => {
              const cur = sel[g.id] || [];
              const min = Math.max(g.min || 0, g.required ? 1 : 0);
              const full = g.max != null && g.max > 1 && cur.length >= g.max;
              const single = g.max === 1;
              const photos = g.options.some((o) => o.photo);
              const short = tried && cur.length < min;
              return (
                <div key={g.id} id={`g${g.id}`} className={`group ${short ? 'missing' : ''} ${min > 0 && cur.length >= min ? 'done' : ''}`}>
                  <h4>
                    <span>{g.title}<span className="sub">{rule(g)}{g.max > 1 ? ` · ${cur.length}/${g.max}` : ''}</span></span>
                    {min > 0
                      ? <span className={`req ${cur.length >= min ? 'done' : ''}`}>{cur.length >= min ? '✓ OK' : 'Obligatoire'}</span>
                      : <span className="req opt">Facultatif</span>}
                  </h4>
                  <div className={`opts ${photos ? 'photos' : ''}`} role={single ? 'radiogroup' : 'group'} aria-label={g.title}>
                    {g.options.map((o) => {
                      const on = cur.includes(o.id);
                      return (
                        <button key={o.id} className={`opt ${on ? 'on' : ''} ${o.photo ? 'withph' : ''} ${single ? 'radio' : 'check'}`} disabled={!on && full}
                          onClick={() => toggle(g, o)} role={single ? 'radio' : 'checkbox'} aria-checked={on}>
                          {o.photo && <Photo src={o.photo} className="oph" name={o.label} />}
                          <span className="ind" aria-hidden="true" />
                          <span className="lbl">{o.label}</span>
                          {o.price_cents !== 0 && <span className="x">{o.price_cents > 0 ? "+" : "−"}{eur(Math.abs(o.price_cents))}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {short && <p className="err">Ce choix est obligatoire.</p>}
                  {min > 0 && cur.length >= min && !full && g.max !== 1 && (() => {
                    // choix à plusieurs réponses : le minimum est atteint, on propose de passer au suivant sans deviner
                    const after = p.option_groups.slice(p.option_groups.indexOf(g) + 1);
                    const next = after.find((x) => (sel[x.id] || []).length < Math.max(x.min || 0, x.required ? 1 : 0));
                    return next ? (
                      <button type="button" className="nextg" onClick={() => document.getElementById(`g${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
                        Choix suivant : {next.title.replace(/\s*\(facultatif\)/i, '')} ↓
                      </button>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        <div className="bar">
          <div className="qty">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Moins">−</button>
            <span aria-live="polite">{qty}</span>
            <button onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Plus">+</button>
          </div>
          <button className={`btn ${canOrder && missing.length ? 'need' : ''}`} onClick={add} disabled={!canOrder}>
            <span>{!canOrder ? 'Fermé' : missing.length ? `${missing.length} choix à faire` : 'Ajouter au panier'}</span><span key={unit * qty} className="tick">{eur(unit * qty)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

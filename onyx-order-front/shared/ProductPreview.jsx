import { useState } from 'react';
import './preview.css';

const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';

/** Fenêtre produit telle que le client la voit sur le site (même rendu que web/app/Menu.js, ProductModal). */
export default function ProductPreview({ name, description, price_cents, photoUrl, groups, photoBase = '' }) {
  const [sel, setSel] = useState({}); // liste -> [option]
  const toggle = (g, o) => setSel((s) => {
    const cur = s[g.id] || [];
    if (cur.includes(o.id)) return { ...s, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max === 1) return { ...s, [g.id]: [o.id] };
    if (g.max != null && cur.length >= g.max) return s;
    return { ...s, [g.id]: [...cur, o.id] };
  });
  const unit = price_cents + groups.reduce((a, g) => a + (sel[g.id] || []).reduce((b, id) => b + (g.options.find((o) => o.id === id)?.price_cents || 0), 0), 0);
  const rule = (g) => {
    const min = Math.max(g.min || 0, g.required ? 1 : 0);
    if (g.max === 1) return min ? '1 choix' : '1 choix maximum';
    if (g.max == null) return min ? `${min} minimum` : 'Facultatif';
    return min ? `${min} à ${g.max} choix` : `Jusqu'à ${g.max}`;
  };
  return (
    <div className="pv" aria-label="Aperçu client">
      <div className="pv-top">
        <div className="pv-ph" style={photoUrl ? { backgroundImage: `url("${photoUrl}")` } : undefined} />
        <div>
          <h3>{name || 'Nom du produit'}</h3>
          <p className="pv-desc">{description}</p>
          <p className="pv-price">{eur(price_cents)}</p>
        </div>
      </div>
      {groups.map((g) => {
        const cur = sel[g.id] || [];
        const min = Math.max(g.min || 0, g.required ? 1 : 0);
        const full = g.max != null && g.max > 1 && cur.length >= g.max;
        return (
          <div key={g.id} className="pv-group">
            <h4>{g.title} <span className="pv-rule">{rule(g)}</span>
              {min > 0 && <span className={`pv-req ${cur.length >= min ? 'done' : ''}`}>{cur.length >= min ? 'OK' : 'Obligatoire'}</span>}</h4>
            <div className="pv-opts">
              {g.options.map((o) => {
                const on = cur.includes(o.id);
                return (
                  <button key={o.id} type="button" className={`pv-opt ${on ? 'on' : ''} ${o.photo ? 'withph' : ''}`} disabled={!on && full} onClick={() => toggle(g, o)}>
                    {o.photo && <span className="pv-oph" style={{ backgroundImage: `url("${o.photo.startsWith('http') ? o.photo : photoBase + o.photo}")` }} />}
                    <span>{o.label}</span>{o.price_cents > 0 && <span className="pv-x">+{eur(o.price_cents)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="pv-bar"><span>Ajouter</span><span>{eur(unit)}</span></div>
    </div>
  );
}

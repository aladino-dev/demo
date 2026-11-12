import { useEffect, useRef, useState } from 'react';
import { API, api, getSession } from '../../shared/session.js';
import { fromCents, toCents } from './util.js';
import { Icon } from './ui.jsx';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_MB = 15;

/**
 * Import de la carte par IA : photo ou PDF -> brouillon à vérifier -> ajout (produits masqués).
 * L'IA propose, le restaurateur valide : rien n'est publié sans lui.
 */
export default function ImportMenu({ say, onDone }) {
  const [enabled, setEnabled] = useState(null);
  const [step, setStep] = useState('choose'); // choose | analyzing | review | done
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [cats, setCats] = useState([]);
  const [notes, setNotes] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef();

  useEffect(() => { api('/api/admin/import-menu/status').then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false)); }, []);

  const pick = (f) => {
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) return say('Format non pris en charge : envoyez une photo (JPG, PNG, WebP) ou un PDF.', true);
    if (f.size > MAX_MB * 1024 * 1024) return say(`Fichier trop lourd (${MAX_MB} Mo maximum).`, true);
    setFile(f);
  };

  const analyze = async () => {
    setStep('analyzing');
    try {
      const res = await fetch(`${API}/api/admin/import-menu`, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getSession().token}` }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'L\'analyse a échoué.');
      let n = 0;
      setCats(j.categories.map((c) => ({
        name: c.name,
        items: c.items.map((it) => ({
          key: n++, include: it.price_cents != null, name: it.name, description: it.description,
          price: it.price_cents != null ? fromCents(it.price_cents) : '', uncertain: it.uncertain,
        })),
      })));
      setNotes(j.notes || []);
      setStep('review');
      if (!j.categories.length) say('Aucun produit trouvé dans ce fichier. Essayez une photo plus nette.', true);
    } catch (e) { say(e.message, true); setStep('choose'); }
  };

  const setItem = (ci, ii, patch) => setCats((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, items: c.items.map((it, j) => (j !== ii ? it : { ...it, ...patch })) })));
  const setCatName = (ci, name) => setCats((cs) => cs.map((c, i) => (i === ci ? { ...c, name } : c)));
  const toggleCat = (ci, on) => setCats((cs) => cs.map((c, i) => (i !== ci ? c : { ...c, items: c.items.map((it) => ({ ...it, include: on })) })));

  const chosen = cats.flatMap((c) => c.items.filter((it) => it.include));
  const priceOf = (it) => { const v = toCents(it.price); return Number.isFinite(v) ? v : null; };
  const blocking = chosen.filter((it) => !it.name.trim() || priceOf(it) == null);
  const toCheck = cats.flatMap((c) => c.items).filter((it) => it.uncertain || priceOf(it) == null).length;

  const apply = async () => {
    setBusy(true);
    try {
      const body = {
        categories: cats.map((c) => ({
          name: c.name,
          items: c.items.filter((it) => it.include).map((it) => ({ name: it.name, description: it.description, price_cents: priceOf(it) })),
        })).filter((c) => c.items.length),
      };
      const r = await api('/api/admin/import-menu/apply', { method: 'POST', body });
      setResult(r); setStep('done'); say('Produits ajoutés (masqués)');
    } catch (e) { say(e.message, true); }
    setBusy(false);
  };

  if (enabled === null) return <p className="muted">Chargement…</p>;
  if (!enabled) {
    return (
      <div className="imp"><div className="imp-card">
        <h2>Importer ma carte avec l'IA</h2>
        <p>Cette fonction n'est pas encore activée pour ce restaurant. Elle permettra d'envoyer une photo ou un PDF de votre carte pour pré-remplir vos produits.</p>
        <p className="muted">Pour l'activer, l'administrateur doit renseigner la clé du service d'analyse (<code>ANTHROPIC_API_KEY</code>) sur le serveur.</p>
      </div></div>
    );
  }

  if (step === 'done') {
    return (
      <div className="imp"><div className="imp-card center">
        <div className="imp-ok">✓</div>
        <h2>{result.created} produit{result.created > 1 ? 's' : ''} ajouté{result.created > 1 ? 's' : ''}</h2>
        <p>Ils sont <b>masqués</b> du site pour l'instant. Ajoutez leurs photos et leurs options, puis rendez-les visibles.</p>
        {result.skipped > 0 && <p className="muted">{result.skipped} produit{result.skipped > 1 ? 's' : ''} déjà présent{result.skipped > 1 ? 's' : ''} {result.skipped > 1 ? 'ont' : 'a'} été ignoré{result.skipped > 1 ? 's' : ''}.</p>}
        <div className="cr-actions" style={{ justifyContent: 'center' }}>
          <button className="cr-btn primary-ish" onClick={onDone}>Voir ma carte</button>
          <button className="cr-btn" onClick={() => { setStep('choose'); setFile(null); setCats([]); }}>Importer une autre page</button>
        </div>
      </div></div>
    );
  }

  if (step === 'review') {
    return (
      <div className="imp">
        <div className="imp-head">
          <div>
            <h2>Vérifiez avant d'ajouter</h2>
            <p className="muted">L'IA a lu votre carte et propose ces produits. Corrigez ce qui doit l'être : rien n'est publié, les produits seront ajoutés <b>masqués</b>.</p>
          </div>
          <div className="imp-actions">
            <button className="cr-btn" onClick={() => { setStep('choose'); setCats([]); }}>Annuler</button>
            <button className="cr-btn primary-ish" disabled={busy || !chosen.length || blocking.length > 0} onClick={apply}>
              {busy ? 'Ajout…' : `Ajouter ${chosen.length} produit${chosen.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
        {toCheck > 0 && <div className="imp-note warn">⚠ {toCheck} ligne{toCheck > 1 ? 's' : ''} à vérifier (en jaune) : prix absent ou texte peu lisible. Les prix sont à saisir, l'IA ne les devine pas.</div>}
        {blocking.length > 0 && <div className="imp-note bad">Il manque un nom ou un prix valide sur {blocking.length} produit{blocking.length > 1 ? 's' : ''} coché{blocking.length > 1 ? 's' : ''}.</div>}
        {notes.length > 0 && (
          <div className="imp-note">
            <b>Repéré mais non importé</b> (suppléments, options, mentions…) : à saisir dans « Options » :
            <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        <div className="imp-list">
          {cats.map((c, ci) => (
            <section key={ci} className="imp-cat">
              <header>
                <input type="checkbox" aria-label="Tout sélectionner" checked={c.items.every((it) => it.include)} onChange={(e) => toggleCat(ci, e.target.checked)} />
                <input className="imp-catname" value={c.name} onChange={(e) => setCatName(ci, e.target.value)} aria-label="Nom de la catégorie" />
                <span className="muted">{c.items.length} produit{c.items.length > 1 ? 's' : ''}</span>
              </header>
              {c.items.map((it, ii) => {
                const bad = it.include && priceOf(it) == null;
                return (
                  <div key={it.key} className={`imp-row ${it.include ? '' : 'off'} ${it.uncertain || priceOf(it) == null ? 'check' : ''} ${bad ? 'bad' : ''}`}>
                    <input type="checkbox" checked={it.include} onChange={(e) => setItem(ci, ii, { include: e.target.checked })} aria-label={`Ajouter ${it.name}`} />
                    <div className="imp-fields">
                      <input value={it.name} onChange={(e) => setItem(ci, ii, { name: e.target.value })} aria-label="Nom" />
                      <textarea rows={1} value={it.description} placeholder="Description (facultative)" onChange={(e) => setItem(ci, ii, { description: e.target.value })} aria-label="Description" />
                    </div>
                    <label className="imp-price">
                      <input value={it.price} inputMode="decimal" placeholder="Prix" onChange={(e) => setItem(ci, ii, { price: e.target.value })} aria-label="Prix en euros" /> €
                    </label>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="imp">
      <div className="imp-card">
        <h2>Importer ma carte avec l'IA</h2>
        <p>Envoyez une <b>photo</b> ou un <b>PDF</b> de votre carte. L'IA en extrait les catégories, les produits et les prix. <b>Vous vérifiez tout</b> avant l'ajout, et les produits sont créés masqués.</p>
        <div className={`imp-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }} onClick={() => input.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}>
          <Icon name="image" size={34} />
          {file ? <p><b>{file.name}</b><br /><span className="muted">{(file.size / 1024 / 1024).toFixed(1)} Mo</span></p>
            : <p><b>Glissez votre carte ici</b> ou touchez pour choisir un fichier<br /><span className="muted">JPG, PNG, WebP ou PDF · {MAX_MB} Mo maximum</span></p>}
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
        <div className="cr-actions" style={{ justifyContent: 'center' }}>
          <button className="cr-btn primary-ish" disabled={!file || step === 'analyzing'} onClick={analyze}>
            {step === 'analyzing' ? 'Lecture de la carte… (jusqu\'à une minute)' : 'Analyser ma carte'}
          </button>
        </div>
        <p className="muted small">Conseils : une photo bien éclairée, à plat, où le texte est net. Une carte très longue ? Envoyez-la en plusieurs fois (quelques pages à la fois). Seul le fichier de la carte est envoyé au service d'analyse, aucune donnée de client.</p>
      </div>
    </div>
  );
}

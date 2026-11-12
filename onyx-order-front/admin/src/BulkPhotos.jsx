import { useEffect, useMemo, useRef, useState } from 'react';
import { API, api, getSession } from '../../shared/session.js';
import { Icon } from './ui.jsx';
import { matchPhotos } from './util.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 12;

/**
 * Photos en lot : on dépose toutes les images d'un coup (ketchup.jpg, mayonnaise.png…) ;
 * chaque photo est rangée dans l'option du même nom, dans toutes les listes où elle existe.
 */
export default function BulkPhotos({ groups, say, onDone }) {
  const [files, setFiles] = useState([]);   // { file, key, options[] , manual? }
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const input = useRef();

  const allOptions = useMemo(() => groups.flatMap((g) => g.options.map((o) => ({ id: o.id, label: o.label, group: g.internal_name || g.title, hasPhoto: !!o.photo }))), [groups]);
  const urls = useRef(new Map());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const preview = (f) => { if (!urls.current.has(f)) urls.current.set(f, URL.createObjectURL(f)); return urls.current.get(f); };

  const add = (list) => {
    const ok = [];
    for (const f of list) {
      if (!TYPES.includes(f.type)) { say(`« ${f.name} » ignoré : format non pris en charge (JPG, PNG ou WebP).`, true); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { say(`« ${f.name} » ignoré : plus de ${MAX_MB} Mo.`, true); continue; }
      ok.push(f);
    }
    if (ok.length) setFiles((cur) => [...cur, ...matchPhotos(ok, groups)]);
  };
  const setManual = (i, optionId) => setFiles((cur) => cur.map((m, j) => (j !== i ? m : { ...m, options: allOptions.filter((o) => o.id === Number(optionId)) })));
  const remove = (i) => setFiles((cur) => cur.filter((_, j) => j !== i));

  const ready = files.filter((m) => m.options.length);
  const replacing = ready.reduce((n, m) => n + m.options.filter((o) => o.hasPhoto).length, 0);

  const send = async () => {
    setBusy(true); setReport(null);
    const token = getSession().token;
    let done = 0; const failed = [];
    for (const [i, m] of ready.entries()) {
      setProgress(`Envoi ${i + 1} / ${ready.length} : ${m.file.name}`);
      try {
        const [first, ...others] = m.options;
        const res = await fetch(`${API}/api/admin/options/${first.id}/photo`, { method: 'POST', headers: { 'Content-Type': m.file.type, Authorization: `Bearer ${token}` }, body: m.file });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'envoi impossible');
        // la même photo sert aux autres options du même nom (sans la renvoyer)
        for (const o of others) await api(`/api/admin/options/${o.id}`, { method: 'PATCH', body: { photo: j.photo } });
        done += m.options.length;
      } catch (e) { failed.push(`${m.file.name} (${e.message})`); }
    }
    setProgress(null); setBusy(false);
    setReport({ done, failed });
    setFiles((cur) => cur.filter((m) => !ready.includes(m) || failed.some((f) => f.startsWith(m.file.name))));
    say(failed.length ? `${done} option(s) mises à jour, ${failed.length} échec(s).` : `${done} photo(s) d'option enregistrée(s)`, failed.length > 0);
    onDone();
  };

  return (
    <div className="imp">
      <div className="imp-card">
        <h2>Photos des options en lot</h2>
        <p>Déposez toutes vos photos d'un coup. <b>Le nom du fichier doit être celui de l'option</b> (<code>ketchup.jpg</code>, <code>sauce algérienne.png</code>…) : les accents, les majuscules et le pluriel n'ont pas d'importance. Une photo est appliquée à toutes les options du même nom.</p>
        <div className={`imp-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }} onClick={() => input.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}>
          <Icon name="image" size={34} />
          <p><b>Glissez vos photos ici</b> ou touchez pour les choisir<br /><span className="muted">JPG, PNG ou WebP · {MAX_MB} Mo maximum chacune</span></p>
          <input ref={input} type="file" accept={TYPES.join(',')} multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
        </div>
      </div>

      {report && (
        <div className={`imp-note ${report.failed.length ? 'bad' : ''}`}>
          {report.done} option{report.done > 1 ? 's' : ''} mise{report.done > 1 ? 's' : ''} à jour.
          {report.failed.length > 0 && <ul>{report.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="imp-head">
            <div>
              <h2>{ready.length} photo{ready.length > 1 ? 's' : ''} prête{ready.length > 1 ? 's' : ''}{files.length > ready.length ? `, ${files.length - ready.length} sans option` : ''}</h2>
              {replacing > 0 && <p className="muted">⚠ {replacing} option{replacing > 1 ? 's ont' : ' a'} déjà une photo : elle sera remplacée.</p>}
            </div>
            <div className="imp-actions">
              <button className="cr-btn" disabled={busy} onClick={() => setFiles([])}>Tout retirer</button>
              <button className="cr-btn primary-ish" disabled={busy || !ready.length} onClick={send}>{busy ? (progress || 'Envoi…') : `Envoyer ${ready.length} photo${ready.length > 1 ? 's' : ''}`}</button>
            </div>
          </div>
          <div className="imp-cat">
            {files.map((m, i) => (
              <div key={`${m.file.name}-${i}`} className={`bp-row ${m.options.length ? '' : 'check'}`}>
                <img src={preview(m.file)} alt="" />
                <div className="bp-info">
                  <b>{m.file.name}</b>
                  {m.options.length > 0 ? (
                    <small>→ {m.options.map((o) => `${o.label} (${o.group})`).join(', ')}{m.options.some((o) => o.hasPhoto) ? ' · remplace la photo actuelle' : ''}</small>
                  ) : (
                    <select value="" onChange={(e) => setManual(i, e.target.value)} aria-label={`Choisir l'option pour ${m.file.name}`}>
                      <option value="">Aucune option de ce nom : choisir manuellement…</option>
                      {allOptions.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.group})</option>)}
                    </select>
                  )}
                </div>
                <button className="cr-mini" aria-label={`Retirer ${m.file.name}`} onClick={() => remove(i)} disabled={busy}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

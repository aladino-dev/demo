import { useCallback, useEffect, useRef, useState } from 'react';
import Login from '../../shared/Login.jsx';
import { API, api, getSession, saveSession, eur, time, MODE, STATUS } from '../../shared/session.js';

const COLS = ['new', 'preparing', 'ready', 'delivering'];
const NEXT = { new: 'preparing', preparing: 'ready', ready: (o) => (o.mode === 'delivery' ? 'delivering' : 'done'), delivering: 'done' };
const NEXT_LABEL = { preparing: 'Préparer', ready: 'Prête', delivering: 'En livraison', done: 'Terminée' };
const COL_ICON = { new: '', preparing: '', ready: '', delivering: '' }; // pas d'emoji : écran de travail sobre

// Âge d'une commande : « 3 min » ; devient orange après 10 min, rouge après 20 min (commande encore en cours)
function age(created, now) {
  const m = Math.max(0, Math.floor((now - new Date(created).getTime()) / 60000));
  return { m, label: m < 1 ? 'À l’instant' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`, tone: m >= 20 ? 'late' : m >= 10 ? 'warn' : 'ok' };
}

// Sonnerie : bip répété tant qu'il reste une commande « Nouvelle » (son activé par un geste, exigé par les navigateurs)
function useRinger() {
  const ctx = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const enable = () => {
    if (enabled) { setEnabled(false); return; } // 2e appui : couper le son
    try {
      ctx.current = ctx.current || new (window.AudioContext || window.webkitAudioContext)();
      ctx.current.resume();
      setEnabled(true);
      beep(ctx.current);
    } catch {}
  };
  const ring = useCallback(() => { if (enabled && ctx.current) beep(ctx.current); }, [enabled]);
  return { enabled, enable, ring };
}
function beep(ac) {
  const t = ac.currentTime;
  [0, 0.25, 0.5].forEach((d, i) => {
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'square'; o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
    o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.22);
  });
}

export default function App() {
  const [session, setSession] = useState(getSession());
  if (!session) return <Login title="Écran cuisine" onLogged={setSession} />;
  return <Board session={session} onLogout={() => { saveSession(null); setSession(null); }} />;
}

function Board({ session, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [live, setLive] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [tab, setTab] = useState('new'); // téléphone : une colonne à la fois
  const { enabled, enable, ring } = useRinger();
  // Rythme du rappel (3 bips à chaque fois) : « fast » toutes les 4 s, « calm » toutes les 30 s ; choix mémorisé sur l'appareil
  const [rhythm, setRhythm] = useState(() => { try { return localStorage.getItem('ringRhythm') === 'calm' ? 'calm' : 'fast'; } catch { return 'fast'; } });
  const toggleRhythm = () => setRhythm((r) => { const n = r === 'fast' ? 'calm' : 'fast'; try { localStorage.setItem('ringRhythm', n); } catch {} return n; });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const load = useCallback(() => api('/api/admin/orders?status=new,preparing,ready,delivering').then(setOrders).catch(() => {}), []);

  useEffect(() => {
    load();
    let es;
    let retry;
    const connect = () => {
      es = new EventSource(`${API}/api/admin/stream?t=${encodeURIComponent(session.token)}`);
      es.onopen = () => { setLive(true); load(); };
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        setOrders((xs) => {
          const rest = xs.filter((x) => x.id !== ev.order.id);
          return COLS.includes(ev.order.status) ? [ev.order, ...rest] : rest;
        });
      };
      es.onerror = () => { setLive(false); es.close(); retry = setTimeout(connect, 3000); };
    };
    connect();
    const poll = setInterval(load, 60000); // filet de sécurité
    return () => { es?.close(); clearTimeout(retry); clearInterval(poll); };
  }, [session.token, load]);

  const newIds = orders.filter((o) => o.status === 'new').map((o) => o.id).sort((a, b) => a - b).join(',');
  const hasNew = newIds !== '';
  const seen = useRef(new Set());
  // Chaque nouvelle commande sonne tout de suite (même si une autre attend déjà), puis rappel au rythme choisi
  useEffect(() => {
    if (!hasNew) return;
    const alert = () => { ring(); navigator.vibrate?.([200, 100, 200]); };
    const ids = newIds.split(',').map(Number);
    const fresh = ids.some((i) => !seen.current.has(i));
    seen.current = new Set(ids);
    if (fresh) alert();
    const t = setInterval(alert, rhythm === 'calm' ? 30000 : 4000);
    return () => clearInterval(t);
  }, [newIds, hasNew, ring, rhythm]);
  useEffect(() => { if (!hasNew) seen.current = new Set(); }, [hasNew]);

  const move = async (o, status) => {
    try {
      const u = await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: { status } });
      setOrders((xs) => (COLS.includes(u.status) ? xs.map((x) => (x.id === u.id ? u : x)) : xs.filter((x) => x.id !== u.id)));
    } catch (e) { alert(e.message); }
  };

  const print = (o) => { setTicket(o); setTimeout(() => window.print(), 50); };

  return (
    <div className="kitchen">
      <div className="top">
        <h1>{session.restaurant.name} <small>Cuisine</small></h1>
        <span className={`live ${live ? 'on' : 'off'}`}><i />{live ? 'En direct' : 'Reconnexion…'}</span>
        <button className={enabled ? 'on' : hasNew ? 'warn' : ''} onClick={enable}><span aria-hidden="true">{enabled ? '🔔' : '🔕'}</span><span className="lbl"> {enabled ? 'Son activé · couper' : 'Activer le son'}</span></button>
        <button onClick={toggleRhythm} title="Rythme du rappel tant qu'une commande n'est pas prise en charge"><span aria-hidden="true">⏱</span><span className="lbl"> Rappel {rhythm === 'calm' ? '30 s' : '4 s'}</span></button>
        <button onClick={onLogout} aria-label="Déconnexion"><span aria-hidden="true">⎋</span><span className="lbl"> Déconnexion</span></button>
      </div>
      <nav className="tabs" aria-label="Commandes par état">
        {COLS.map((c) => {
          const n = orders.filter((o) => o.status === c).length;
          return (
            <button key={c} className={`tab ${c}${tab === c ? ' on' : ''}${c === 'new' && n ? ' alert' : ''}`} onClick={() => setTab(c)} aria-pressed={tab === c}>
              <span className="ic" aria-hidden="true">{COL_ICON[c]}</span><span className="n">{n}</span><span className="t">{STATUS[c]}</span>
            </button>
          );
        })}
      </nav>
      <div className="board">
        {COLS.map((c) => {
          const list = orders.filter((o) => o.status === c).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          return (
            <div key={c} className={`col${tab === c ? " is-active" : ""}`}>
              <h2><span className="ci" aria-hidden="true">{COL_ICON[c]}</span>{STATUS[c]} <span className="cnt">{list.length}</span></h2>
              {list.length === 0 && <p className="empty">Aucune commande</p>}
              {list.map((o) => {
                const nx = typeof NEXT[c] === 'function' ? NEXT[c](o) : NEXT[c];
                const a = age(o.created_at, now);
                return (
                  <div key={o.id} className={`ord ${c}`}>
                    <div className="h"><span className="num">#{o.number}</span><span className={`age ${a.tone}`}>⏱ {a.label}</span><span className="mode">{MODE[o.mode]}{o.table_label ? ` · Table ${o.table_label}` : ''}</span></div>
                    <div className="who"><strong>{o.customer_name}</strong><span>{time(o.created_at)} · <a href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></span></div>
                    {o.mode === 'delivery' && <div>{o.address}, {o.postcode} {o.city}</div>}
                    <ul>
                      {o.items.map((i) => (
                        <li key={i.id}>
                          <strong>{i.quantity} × {i.name}</strong>
                          {i.options.length > 0 && <div className="o">{i.options.map((x) => x.label).join(', ')}</div>}
                        </li>
                      ))}
                    </ul>
                    {o.note && <div className="note">📝 {o.note}</div>}
                    <div className="tot"><strong>{eur(o.total_cents)}</strong><span>à régler sur place</span></div>
                    <div className="acts">
                      <button onClick={() => print(o)}>🖨 Ticket</button>
                      <button className="go" onClick={() => move(o, nx)}>{NEXT_LABEL[nx]}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {ticket && <Ticket o={ticket} name={session.restaurant.name} />}
    </div>
  );
}

function Ticket({ o, name }) {
  return (
    <div id="ticket">
      <div className="c">{name}</div>
      <h1>#{o.number}</h1>
      <div className="c">{MODE[o.mode].toUpperCase()}{o.table_label ? ` · TABLE ${o.table_label}` : ''} · {new Date(o.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</div>
      <hr />
      <div>{o.customer_name} · {o.customer_phone}</div>
      {o.mode === 'delivery' && <div>{o.address}, {o.postcode} {o.city}</div>}
      <hr />
      {o.items.map((i) => (
        <div key={i.id} style={{ marginBottom: 4 }}>
          <div className="r"><strong>{i.quantity} x {i.name}</strong><span>{eur(i.unit_price_cents * i.quantity)}</span></div>
          {i.options.map((x, k) => <div key={k}>  - {x.label}{x.price_cents ? ` +${eur(x.price_cents)}` : ''}</div>)}
        </div>
      ))}
      {o.note && (<><hr /><div>NOTE : {o.note}</div></>)}
      <hr />
      {o.discount_cents > 0 && <div className="r"><span>Remise {o.promo_code}</span><span>-{eur(o.discount_cents)}</span></div>}
      {o.fee_cents > 0 && <div className="r"><span>Livraison</span><span>{eur(o.fee_cents)}</span></div>}
      <div className="r" style={{ fontSize: 15 }}><strong>TOTAL</strong><strong>{eur(o.total_cents)}</strong></div>
      <div className="c">Paiement sur place</div>
    </div>
  );
}

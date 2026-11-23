import { useEffect, useState } from 'react';
import Login from '../../shared/Login.jsx';
import Carte from './Carte.jsx';
import Options from './Options.jsx';
import Today from './Today.jsx';
import Orders from './Orders.jsx';
import Availability from './Availability.jsx';
import { getSession, saveSession } from '../../shared/session.js';

// Menu du back-office : mots simples, une icône par entrée (barre latérale sur ordinateur, barre du bas sur téléphone)
const NAV = [
  { id: 'today', icon: '🏠', label: 'Aujourd’hui', short: 'Accueil' },
  { id: 'orders', icon: '🧾', label: 'Commandes', short: 'Commandes' },
  { id: 'stock', icon: '✅', label: 'Disponibilité', short: 'Dispo' },
  { id: 'catalog', icon: '🍔', label: 'Ma carte', short: 'Carte' },
  { id: 'options', icon: '🧂', label: 'Options', short: 'Options' },
];

export default function App() {
  const [session, setSession] = useState(getSession());
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('admin-tab') || 'today'; } catch { return 'today'; } });
  const go = (t) => { setTab(t); try { localStorage.setItem('admin-tab', t); } catch {} window.scrollTo(0, 0); };
  useEffect(() => { document.title = session ? `${session.restaurant.name} – Gestion` : 'Gestion – Onyx Order'; }, [session]);
  if (!session) return <Login title="Gestion du restaurant" onLogged={setSession} />;
  if (!['owner', 'manager'].includes(session.role)) {
    return <div className="login"><h1>Accès réservé</h1><p>Ce compte sert à l'écran cuisine.</p>
      <button className="primary" onClick={() => { saveSession(null); setSession(null); }}>Changer de compte</button></div>;
  }
  const logout = () => { saveSession(null); setSession(null); };
  const siteUrl = import.meta.env.VITE_SITE_URL || 'http://localhost:3000';
  return (
    <>
      <div className="top">
        <h1>{session.restaurant.name} <small>Gestion</small></h1>
        <a className="toplink" href={siteUrl} target="_blank" rel="noreferrer">Voir le site ↗</a>
        <button onClick={logout} aria-label="Déconnexion"><span aria-hidden="true">⎋</span><span className="lbl"> Déconnexion</span></button>
      </div>
      <div className="shell">
        <nav className="nav" aria-label="Menu principal">
          {NAV.map((n) => (
            <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => go(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
              <span className="ic" aria-hidden="true">{n.icon}</span>
              <span className="l-long">{n.label}</span><span className="l-short">{n.short}</span>
            </button>
          ))}
        </nav>
        <div className="page">
          {tab === 'today' ? <Today go={go} /> : tab === 'orders' ? <Orders /> : tab === 'stock' ? <Availability /> : tab === 'catalog' ? <Carte onOpenOptions={() => go('options')} /> : <Options />}
        </div>
      </div>
    </>
  );
}

// Session commune cuisine / back-office (jeton stocké dans le navigateur)
export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const KEY = 'onyx-session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function saveSession(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {}
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const s = getSession();
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { saveSession(null); location.reload(); throw new Error('Session expirée'); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

export const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
export const time = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
export const MODE = { pickup: 'Retrait', delivery: 'Livraison', dine_in: 'Sur place' };
export const STATUS = { new: 'Nouvelle', preparing: 'En préparation', ready: 'Prête', delivering: 'En livraison', done: 'Terminée', cancelled: 'Annulée' };

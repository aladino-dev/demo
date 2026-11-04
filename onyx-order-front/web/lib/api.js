export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const SLUG = process.env.NEXT_PUBLIC_RESTAURANT || 'fastcamion';
// côté serveur (Docker), l'API peut avoir une adresse interne différente
const SERVER_API = process.env.API_INTERNAL_URL || API;
export const photoUrl = (p) => (p ? (p.startsWith('http') ? p : API + p) : null);

export async function serverGet(path) {
  const res = await fetch(`${SERVER_API}/api/r/${SLUG}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(`${API}/api/r/${SLUG}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur, réessayez.');
  return data;
}

export async function apiGet(path) {
  const res = await fetch(`${API}/api/r/${SLUG}${path}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur, réessayez.');
  return data;
}

export const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';

export const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

'use client';
import { useEffect, useState } from 'react';

// Numéro de table : le QR code ouvre le site avec ?table=5. On le garde pour la durée de l'onglet.
const KEY = 'onyx-table';
const clean = (v) => String(v || '').trim().slice(0, 12);

/** À appeler une fois au chargement du site : retient ?table=… s'il est présent. */
export function captureTable() {
  try {
    const t = clean(new URLSearchParams(window.location.search).get('table'));
    if (t) sessionStorage.setItem(KEY, t);
  } catch {}
}

export function useTable() {
  const [table, setTableState] = useState('');
  useEffect(() => {
    captureTable();
    try { setTableState(sessionStorage.getItem(KEY) || ''); } catch {}
  }, []);
  const setTable = (v) => {
    const t = clean(v);
    setTableState(t);
    try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {}
  };
  return [table, setTable];
}

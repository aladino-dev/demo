'use client';
import { useEffect, useState } from 'react';

const KEY = 'onyx-delivery-beta-closed';

// Bandeau fin et fermable (jamais bloquant) : la livraison est affichée mais pas encore ouverte.
export default function BetaBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try { setShown(localStorage.getItem(KEY) !== '1'); } catch { setShown(true); }
  }, []);
  if (!shown) return null;
  const close = () => {
    setShown(false);
    try { localStorage.setItem(KEY, '1'); } catch {}
  };
  return (
    <div className="beta-banner" role="status">
      <span><b className="beta">BÊTA</b> La livraison arrive chez toi en test. Pour l&apos;instant : sur place ou Click &amp; Collect.</span>
      <button type="button" onClick={close} aria-label="Fermer">×</button>
    </div>
  );
}

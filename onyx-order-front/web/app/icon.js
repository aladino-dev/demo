import { ImageResponse } from 'next/og';
import { serverGet } from '../lib/api';

// Icône de l'onglet : l'initiale du restaurant servi par ce site, sur fond rouge (aucun nom écrit en dur)
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default async function Icon() {
  let letter = '•';
  try { const r = await serverGet(''); letter = (r?.name || '').trim().charAt(0).toUpperCase() || letter; } catch { /* API indisponible : pastille neutre */ }
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#DD2424', color: '#fff', fontSize: 42, fontWeight: 800, borderRadius: 14 }}>
        {letter}
      </div>
    ),
    size,
  );
}

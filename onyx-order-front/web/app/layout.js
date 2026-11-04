import './globals.css';
import { CartProvider } from '../lib/cart';
import { serverGet } from '../lib/api';

// Réglages du restaurant servi par ce site (aucun nom écrit en dur)
async function restaurant() {
  try { return await serverGet(''); } catch { return null; } // API indisponible : titre neutre
}

export async function generateMetadata() {
  const r = await restaurant();
  const name = r?.name || 'Commande en ligne';
  return {
    title: r ? `${name} – Commande en ligne` : name,
    description: r ? `Commandez en ligne chez ${name}${r.city ? ` à ${r.city}` : ''}. Retrait ou livraison, sans commission.` : 'Commande en ligne.',
    // restaurant de démonstration : jamais référencé par les moteurs de recherche
    ...(r?.settings?.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#111111' };

export default async function RootLayout({ children }) {
  const r = await restaurant();
  return (
    <html lang="fr">
      <body>
        {r?.settings?.demo && (
          <div className="demo-banner" role="note">Démonstration : aucune commande n&apos;est réellement préparée</div>
        )}
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}

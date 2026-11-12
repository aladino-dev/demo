import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { serverGet } from '../../lib/api';

export const dynamic = 'force-dynamic';
// page d'accès pour le restaurateur : jamais référencée par les moteurs de recherche
export const metadata = { title: 'Vos accès', robots: { index: false, follow: false } };

// Les 3 adresses du restaurant, déduites de l'adresse par laquelle cette page est ouverte (même code pour tous les restaurants)
const ACCES = [
  { path: '/', titre: 'Site de commande', texte: 'Ce que vos clients voient : la carte, le panier, la commande et le suivi.', bouton: 'Ouvrir le site' },
  { path: '/cuisine/', titre: 'Écran cuisine', texte: 'À ouvrir sur la tablette ou le téléphone de la cuisine : les commandes arrivent en direct et avancent d\'un geste.', bouton: 'Ouvrir la cuisine' },
  { path: '/admin/', titre: 'Gestion du restaurant', texte: 'Pour modifier votre carte, vos prix et vos photos.', bouton: 'Ouvrir la gestion' },
];

export default async function Acces() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (/^(localhost|127\.|192\.168\.)/.test(host) ? 'http' : 'https');
  const origin = `${proto}://${host}`;
  const info = await serverGet('').catch(() => null);
  // comptes publics d'une démonstration (settings.demo_accounts, posés par `npm run demo:accounts`) ; jamais pour un vrai restaurant
  const demo = info?.settings?.demo === true && Array.isArray(info.settings.demo_accounts) ? info.settings.demo_accounts : [];
  const cartes = await Promise.all(ACCES.map(async (a) => ({
    ...a,
    url: origin + a.path,
    qr: await QRCode.toString(origin + a.path, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
  })));

  return (
    <main className="wrap acces">
      <h1>{info?.name ? `${info.name} : vos 3 accès` : 'Vos 3 accès'}</h1>
      <p className="note">Scannez le code avec l&apos;appareil photo du téléphone, ou touchez le bouton. Enregistrez cette page dans vos favoris.</p>
      <div className="acces-grid">
        {cartes.map((c, i) => (
          <section key={c.path} className="panel acces-card">
            <h2><span className="acces-n">{i + 1}</span>{c.titre}</h2>
            <a className="qr" href={c.url} aria-label={`${c.titre} : ${c.url}`} dangerouslySetInnerHTML={{ __html: c.qr }} />
            <p className="note">{c.texte}</p>
            <a className="btn center" href={c.url}>{c.bouton}</a>
            <p className="acces-url">{c.url.replace(/^https?:\/\//, '')}</p>
          </section>
        ))}
      </div>
      {demo.length > 0 ? (
        <section className="panel acces-ids">
          <h2>Comptes de démonstration</h2>
          <p className="note">Pour vous connecter à l&apos;écran cuisine et à la gestion. Ce sont des comptes de test : vous pouvez tout essayer.</p>
          {demo.map((a) => (
            <div key={a.email} className="acces-id">
              <strong>{a.label}</strong>
              <span>Identifiant : <code>{a.email}</code></span>
              <span>Mot de passe : <code>{a.password}</code></span>
            </div>
          ))}
        </section>
      ) : (
        <p className="note">Vos identifiants de connexion (cuisine et gestion) vous sont envoyés séparément.</p>
      )}
    </main>
  );
}

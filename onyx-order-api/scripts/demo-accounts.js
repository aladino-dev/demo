// Comptes de démonstration PUBLICS d'un restaurant (cuisine + gestion), affichés sur sa page /acces.
// Usage : npm run demo:accounts -- <slug> [motdepasse]     (mot de passe par défaut : demo1234, comme la démo FastCamion)
// Garde-fou : réservé aux restaurants marqués « demo » (settings.demo) : un vrai restaurant n'a jamais de mot de passe public.
// Le mot de passe est écrit dans settings.demo_accounts (lisible par le site : c'est voulu pour une démo) ; sans effet sur les autres comptes.
import path from 'node:path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connect, q, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const slug = process.argv[2];
const password = process.argv[3] || 'demo1234';
if (!slug) { console.error('Indiquez le restaurant : npm run demo:accounts -- <slug>'); process.exit(1); }
await connect();
const { rows: [r] } = await q('SELECT id, settings FROM restaurants WHERE slug = $1', [slug]);
if (!r) { console.error(`Restaurant « ${slug} » introuvable.`); await close(); process.exit(1); }
if (r.settings?.demo !== true) { console.error(`Refusé : « ${slug} » n'est pas marqué comme démonstration (settings.demo).`); await close(); process.exit(1); }

const accounts = [
  { label: 'Écran cuisine', role: 'cuisine', email: 'demo-cuisine@onyx.demo', password },
  { label: 'Gestion du restaurant', role: 'owner', email: 'demo-admin@onyx.demo', password },
];
const hash = await bcrypt.hash(password, 10);
for (const a of accounts) {
  await q(
    `INSERT INTO users (restaurant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (restaurant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [r.id, a.email, hash, a.role]);
}
await q(`UPDATE restaurants SET settings = jsonb_set(settings, '{demo_accounts}', $2::jsonb) WHERE id = $1`, [r.id, JSON.stringify(accounts)]);
console.log(`Comptes de démonstration prêts pour ${slug} : ${accounts.map((a) => a.email).join(', ')}`);
await close();

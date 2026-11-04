// Génère un nouveau mot de passe pour un compte (affiché une seule fois dans ce terminal).
// Usage : npm run password -- cuisine@fastcamion.local [motdepasse]   (sans 2e argument : mot de passe aléatoire)
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connect, q, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const email = process.argv[2];
await connect();
if (!email) {
  const { rows } = await q('SELECT u.email, u.role, r.slug FROM users u JOIN restaurants r ON r.id = u.restaurant_id ORDER BY r.slug, u.role');
  console.log('Indiquez le compte : npm run password -- <e-mail>\nComptes existants :');
  for (const u of rows) console.log(`  ${u.slug}  ${u.role.padEnd(8)} ${u.email}`);
} else {
  const password = process.argv[3] || crypto.randomBytes(6).toString('base64url'); // 2e argument facultatif : mot de passe choisi
  const { rowCount } = await q('UPDATE users SET password_hash = $2 WHERE lower(email) = lower($1)', [email, await bcrypt.hash(password, 10)]);
  console.log(rowCount ? `Nouveau mot de passe pour ${email} : ${password}` : `Compte ${email} introuvable.`);
}
await close();

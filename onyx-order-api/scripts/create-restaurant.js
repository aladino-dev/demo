// Crée un restaurant vide (sans carte) et son compte propriétaire.
// Usage : npm run restaurant:create -- --slug chez-ali --name "Chez Ali" --owner ali@exemple.fr
//   facultatif : --cuisine cuisine@exemple.fr  --legal-name "..."  --address "..."  --postcode 78000  --city Versailles
//                --phone "01 ..."  --timezone Europe/Paris  --hours "11:30-14:30,18:00-23:55"  --days 1,2,3,4,5,6,0
// Aucune donnée n'est inventée : sans --hours, le restaurant est « fermé » tant que les horaires ne sont pas saisis.
// Les mots de passe générés s'affichent une seule fois dans ce terminal.
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connect, tx, close, ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}
const a = args(process.argv.slice(2));
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };

const slug = String(a.slug || '');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('--slug obligatoire : minuscules, chiffres et tirets (ex. chez-ali).');
if (!a.name || a.name === true) fail('--name obligatoire (ex. --name "Chez Ali").');
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e));
if (!emailOk(a.owner)) fail('--owner obligatoire : l\'e-mail du propriétaire.');
if (a.cuisine && !emailOk(a.cuisine)) fail('--cuisine : e-mail invalide.');

// horaires : « 11:30-14:30,18:00-23:55 » appliqués aux jours choisis (par défaut les 7 jours)
const ranges = a.hours && a.hours !== true ? String(a.hours).split(',').map((r) => {
  const m = r.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) fail(`--hours : « ${r} » invalide (format 11:30-14:30).`);
  const opens = `${m[1].padStart(2, '0')}:${m[2]}`;
  const closes = `${m[3].padStart(2, '0')}:${m[4]}`;
  if (opens >= closes) fail(`--hours : « ${r} » : l'ouverture doit précéder la fermeture.`);
  return { opens, closes };
}) : [];
const days = a.days && a.days !== true ? String(a.days).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail('--days : numéros de 0 (dimanche) à 6 (samedi).');

await connect();
const created = await tx(async (c) => {
  const { rows: [exists] } = await c.query('SELECT id FROM restaurants WHERE slug = $1', [slug]);
  if (exists) return null;
  const settings = {
    modes: ['pickup'], payment: ['on_site'], anti_bot: { max_orders: 5, window_minutes: 15 },
  };
  const str = (v) => (v && v !== true ? String(v) : null);
  const { rows: [r] } = await c.query(
    `INSERT INTO restaurants (slug, name, legal_name, address, postcode, city, phone, timezone, settings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [slug, String(a.name), str(a['legal-name']), str(a.address), str(a.postcode), str(a.city), str(a.phone), str(a.timezone) || 'Europe/Paris', settings]);
  for (const d of days) {
    for (const h of ranges) {
      await c.query('INSERT INTO opening_hours (restaurant_id, day_index, opens, closes, enabled) VALUES ($1,$2,$3,$4,true)', [r.id, d, h.opens, h.closes]);
    }
  }
  const accounts = [{ email: String(a.owner), role: 'owner' }];
  if (a.cuisine) accounts.push({ email: String(a.cuisine), role: 'cuisine' });
  for (const acc of accounts) {
    acc.password = crypto.randomBytes(9).toString('base64url');
    await c.query('INSERT INTO users (restaurant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)',
      [r.id, acc.email, await bcrypt.hash(acc.password, 10), acc.role]);
  }
  return { accounts };
});

if (!created) {
  console.error(`Le restaurant « ${slug} » existe déjà : rien n'a été modifié.`);
  await close();
  process.exit(1);
}
console.log(`Restaurant « ${a.name} » créé (slug : ${slug}), carte vide.`);
if (!ranges.length) console.log('Horaires non définis : le site affichera « fermé » tant qu\'ils ne sont pas saisis (option --hours, ou IGNORE_HOURS=true pour une démo).');
console.log('\nComptes créés (notez-les, ils ne seront plus affichés) :');
for (const acc of created.accounts) console.log(`  ${acc.role.padEnd(8)} ${acc.email}  mot de passe : ${acc.password}`);
await close();

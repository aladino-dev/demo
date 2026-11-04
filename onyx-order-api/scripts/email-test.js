// Vérifie la configuration SMTP en envoyant un e-mail de test. Usage : npm run email:test -- adresse@exemple.fr
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from '../src/db.js';

dotenv.config({ path: path.join(ROOT, '.env') });
const { sendTest, smtpConfig } = await import('../src/mailer.js');
const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error('Indiquez l\'adresse de destination : npm run email:test -- vous@exemple.fr');
  process.exit(1);
}
const cfg = smtpConfig();
if (cfg) console.log(`Envoi via ${cfg.host}:${cfg.port} (expéditeur : ${cfg.from}) …`);
try {
  await sendTest(to);
  console.log(`E-mail de test envoyé à ${to}. Vérifiez la boîte de réception (et les courriers indésirables).`);
} catch (e) {
  console.error(`Échec : ${e.message}`);
  process.exit(1);
}

// Arrête la base locale (PostgreSQL intégré) lancée par l'API. Usage : npm run db:stop
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT } from '../src/db.js';

const pidFile = path.join(ROOT, '.pgdata', 'postmaster.pid');
if (!fs.existsSync(pidFile)) {
  console.log('Aucune base locale en cours d\'exécution.');
  process.exit(0);
}
const pid = Number(fs.readFileSync(pidFile, 'utf8').split('\n')[0]);
try {
  // /T : arrête aussi les processus fils de PostgreSQL
  execSync(process.platform === 'win32' ? `taskkill /PID ${pid} /T /F` : `kill ${pid}`, { stdio: 'ignore' });
  console.log(`Base locale arrêtée (PID ${pid}).`);
} catch {
  console.log('La base ne tournait déjà plus.');
}

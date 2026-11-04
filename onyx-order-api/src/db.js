import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

let pool;
let embedded;

/** Démarre la base : DATABASE_URL si fourni, sinon PostgreSQL intégré (dossier .pgdata). */
export async function connect() {
  if (pool) return pool;
  let url = process.env.DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = Number(process.env.LOCAL_DB_PORT || 5433);
    const dir = path.join(ROOT, '.pgdata');
    const localUrl = `postgres://onyx:onyx@localhost:${port}/onyx`;
    // Base locale déjà lancée (par l'API, par exemple) : on la réutilise au lieu d'en démarrer une seconde.
    const probe = new pg.Client({ connectionString: localUrl, connectionTimeoutMillis: 2000 });
    const running = await probe.connect().then(() => true, () => false);
    await probe.end().catch(() => {});
    if (running) {
      pool = makePool(localUrl);
      await migrate();
      return pool;
    }
    const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
    embedded = new EmbeddedPostgres({
      databaseDir: dir, user: 'onyx', password: 'onyx', port, persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {}, onError: () => {},
    });
    if (fresh) {
      console.log('[base] Première utilisation : création de la base locale dans .pgdata …');
      await embedded.initialise();
    }
    try {
      await startDetached(dir, port);
    } catch (e) {
      const out = readLogTail();
      console.error(`\n[base] PostgreSQL n'a pas pu démarrer (port ${port}). Message de PostgreSQL :\n${out || '(aucun)'}\n`);
      if (/already in use|Address already|déjà utilisée|could not bind|10048/i.test(out)) {
        console.error(`[base] Le port ${port} est déjà pris : fermez l'autre terminal de l'API ou changez LOCAL_DB_PORT dans .env.`);
      }
      if (/postmaster\.pid|lock file/i.test(out)) {
        console.error('[base] Une ancienne base est restée ouverte : fermez les terminaux de l\'API, ou redémarrez le PC.');
      }
      throw new Error('Démarrage de la base locale impossible', { cause: e });
    }
    if (fresh) await embedded.createDatabase('onyx');
    url = `postgres://onyx:onyx@localhost:${port}/onyx`;
    console.log(`[base] PostgreSQL local démarré (port ${port}). Il reste actif entre deux redémarrages de l'API ; pour l'arrêter : npm run db:stop`);
  }
  pool = makePool(url);
  await migrate();
  return pool;
}

/** Pool de connexions ; une connexion inactive coupée (redémarrage de la base) ne doit pas faire tomber l'API. */
function makePool(connectionString) {
  const p = new pg.Pool({ connectionString, max: 10 });
  p.on('error', (e) => console.error('[base] connexion inactive coupée, elle sera rouverte :', e.code || e.message));
  return p;
}

const LOG_FILE = path.join(ROOT, '.pgdata.log');
const readLogTail = () => {
  try { return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-15).join('\n'); } catch { return ''; }
};

/**
 * Lance PostgreSQL sans lien avec l'API (aucun tube), journal dans .pgdata.log.
 * (Lancé par la bibliothèque, son journal passe par un tube relié à l'API : quand `node --watch`
 * tue l'API pour la recharger, le tube casse et la base se fige.) Elle survit donc aux redémarrages.
 */
async function startDetached(dir, port) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const { postgres: bin } = await import(`@embedded-postgres/${platform}-${process.arch}`);
  const fd = fs.openSync(LOG_FILE, 'a');
  // Pas de `detached` : sous Windows, chaque processus fils de PostgreSQL (un par connexion) ouvrirait sa propre fenêtre cmd.
  // `windowsHide` + journal dans un fichier : console cachée partagée, et la base survit quand même à l'arrêt de l'API.
  const child = spawn(bin, ['-D', dir, '-p', String(port)], { stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  child.unref();
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 60 && !exited; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const probe = new pg.Client({ connectionString: `postgres://onyx:onyx@localhost:${port}/postgres`, connectionTimeoutMillis: 1000 });
    const ok = await probe.connect().then(() => true, () => false);
    await probe.end().catch(() => {});
    if (ok) return;
  }
  throw new Error('PostgreSQL ne répond pas');
}

async function migrate() {
  const sql = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
}

export function q(text, params) {
  return pool.query(text, params);
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function close() {
  if (pool) await pool.end();
  if (embedded) await embedded.stop();
}

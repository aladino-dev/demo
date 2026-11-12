// Prépare l'installation d'un nouveau restaurant : dossier, .env avec secrets aléatoires, ports libres.
// Ne lance rien et ne touche à aucun autre restaurant. Usage :
//   node deploy/new-restaurant.mjs --slug chez-ali --name "Chez Ali" --site https://chez-ali.fr --api https://api.chez-ali.fr [--owner ali@exemple.fr]
// facultatif : --cpus-db 1 --mem-db 512m --cpus-api 0.5 --mem-api 384m --cpus-front 0.5 --mem-front 512m   (limites de ressources)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'deploy', 'restaurants');

const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };

const slug = String(a.slug || '');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('--slug obligatoire : minuscules, chiffres et tirets (ex. chez-ali).');
if (!a.name || a.name === true) fail('--name obligatoire.');
const url = (v, label) => {
  try { const u = new URL(String(v)); if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error(); return u.origin; }
  catch { return fail(`${label} obligatoire : adresse https complète (ex. https://chez-ali.fr).`); }
};
const site = url(a.site, '--site');
// --api facultatif : sans lui, le site et l'API partagent la même adresse (l'API est servie sous /api et /photos) : un seul enregistrement DNS
const api = a.api && a.api !== true ? url(a.api, '--api') : site;

const target = path.join(dir, slug);
if (fs.existsSync(path.join(target, '.env'))) fail(`« ${slug} » est déjà préparé (${path.relative(root, target)}). Rien n'a été modifié.`);

// ports déjà attribués aux autres restaurants (127.0.0.1 seulement : le proxy HTTPS fait le lien)
const used = { FRONT_PORT: new Set(), API_PORT: new Set() };
if (fs.existsSync(dir)) {
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, '.env');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^(FRONT_PORT|API_PORT)=(\d+)/);
      if (m) used[m[1]].add(Number(m[2]));
    }
  }
}
const free = (set, start) => { let p = start; while (set.has(p)) p++; return p; };
const frontPort = free(used.FRONT_PORT, 3100);
const apiPort = free(used.API_PORT, 4100);

const secret = (n) => crypto.randomBytes(n).toString('base64url');
const lim = (k, d) => (a[k] && a[k] !== true ? a[k] : d);
const env = `# Restaurant « ${a.name} » – généré le ${new Date().toISOString().slice(0, 10)}. NE PAS PARTAGER (secrets).
PROJECT=onyx-${slug}
RESTAURANT=${slug}
SITE_URL=${site}
API_URL=${api}
DB_PASSWORD=${secret(24)}
JWT_SECRET=${secret(48)}
IGNORE_HOURS=false
# Envoi des e-mails au client : à remplir avec le serveur SMTP du restaurant (vérifier : exec api npm run email:test -- vous@exemple.fr)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
# Import de la carte par IA : clé du service d'analyse (vide = désactivé). Ne jamais la partager.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
IMPORT_MAX_PER_HOUR=10
FRONT_PORT=${frontPort}
API_PORT=${apiPort}
# Limites de ressources de CE restaurant (un pic chez lui ne ralentit pas les autres)
DB_CPUS=${lim('cpus-db', '1.0')}
DB_MEM=${lim('mem-db', '512m')}
API_CPUS=${lim('cpus-api', '0.5')}
API_MEM=${lim('mem-api', '384m')}
FRONT_CPUS=${lim('cpus-front', '0.5')}
FRONT_MEM=${lim('mem-front', '512m')}
`;
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, '.env'), env, { mode: 0o600 });
fs.writeFileSync(path.join(dir, '.gitignore'), '*\n!.gitignore\n');

const host = (u) => new URL(u).host;
const owner = a.owner && a.owner !== true ? a.owner : 'proprietaire@exemple.fr';
// bloc Caddy du restaurant (un fichier par restaurant : en ajouter un n'interrompt pas les autres)
// « import securite » : en-têtes de sécurité communs, définis une fois dans le Caddyfile par server-setup.sh
const caddy = host(site) === host(api)
  ? `${host(site)} {
    import securite
    header Content-Security-Policy "frame-ancestors 'self'"
    encode gzip
    # l'API (commandes, back-office, cuisine en temps réel) et les photos passent par la même adresse que le site
    @api path /api/* /photos/*
    handle @api {
        reverse_proxy 127.0.0.1:${apiPort} {
            flush_interval -1
        }
    }
    handle {
        reverse_proxy 127.0.0.1:${frontPort}
    }
}
`
  : `${host(site)} {
    import securite
    header Content-Security-Policy "frame-ancestors 'self'"
    encode gzip
    reverse_proxy 127.0.0.1:${frontPort}
}
${host(api)} {
    import securite
    encode gzip
    reverse_proxy 127.0.0.1:${apiPort} {
        flush_interval -1
    }
}
`;
const hosts = [...new Set([host(site), host(api)])];
fs.writeFileSync(path.join(target, `${slug}.caddy`), caddy);
const compose = `docker compose -p onyx-${slug} --env-file deploy/restaurants/${slug}/.env`;
console.log(`Restaurant « ${a.name} » préparé : deploy/restaurants/${slug}/.env (secrets aléatoires, ports ${frontPort}/${apiPort}).

À faire sur le serveur, dans l'ordre :

1. Lancer ses 3 services (base, API, site), séparés des autres restaurants :
   ${compose} up -d --build

2. Créer le restaurant et le compte propriétaire (mot de passe affiché une seule fois) :
   ${compose} exec api node scripts/create-restaurant.js --slug ${slug} --name "${a.name}" --owner ${owner} --hours "HH:MM-HH:MM"
   (horaires à fournir par le restaurateur ; sans --hours le site affiche « fermé »)

3. Publier l'adresse avec le proxy HTTPS (Caddy). ${hosts.join(' et ')}
   ${hosts.length > 1 ? 'doivent' : 'doit'} d'abord pointer vers le serveur (enregistrement DNS de type A), puis :
   sudo cp deploy/restaurants/${slug}/${slug}.caddy /etc/caddy/sites/${slug}.caddy && sudo systemctl reload caddy

4. Sauvegarde quotidienne de SA base (cron) : bash deploy/backup.sh ${slug}

Le restaurateur remplit ensuite sa carte lui-même : ${site}/admin (Carte, Options).`);

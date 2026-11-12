# Onyx Order – architecture et où modifier quoi

Mis à jour le 11/11/2026. Complète `CLAUDE.md` (contexte, règles) et `docs/SPEC-BACKOFFICE.md` (spécification).

## 1. Vue d'ensemble

Un restaurant = **une installation séparée** (base, API, site, limites CPU/mémoire, ports, sauvegarde). Un incident ou un gros client ne touche pas les autres.

```
Client (téléphone)  ──►  Caddy (HTTPS)  ──►  site Next.js (web)      port FRONT_PORT
Cuisine / Admin     ──►  /cuisine, /admin (Vite, servis par web)
                         /api/*, /photos/*  ──►  API Express          port API_PORT  ──►  PostgreSQL (db)
```

- **Un seul domaine par restaurant** : le site, `/cuisine`, `/admin`, `/api` et `/photos` passent par la même adresse (fichier Caddy du restaurant).
- **Multi-restaurant dans le schéma** : toutes les tables portent `restaurant_id`, ce qui permet d'avoir plusieurs restaurants dans une base en local. Sur le serveur, chaque installation n'en contient qu'un.

## 2. Les deux projets

### `onyx-order-api/` (Express 5 + PostgreSQL, port 4000)
| Fichier | Rôle |
|---|---|
| `src/index.js` | routes publiques `/api/r/:slug/*`, connexion `/api/auth/login`, auth JWT (`rid`, `uid`, `role`), commandes `/api/admin/orders`, flux temps réel SSE `/api/admin/stream` |
| `src/menu.js` | construit la carte du site. **Les listes d'options obligatoires passent avant les facultatives** (fonction `obligatoiresD`) |
| `src/orders.js` | validation et calcul d'une commande (min/max des options, prix = produit + options, un prix d'option **peut être négatif** : « sans boisson ») |
| `src/catalog.js` | back-office de la carte : catégories, produits, listes d'options, photos. Rien ne se supprime : archivage (`archived_at`). `signedCents` autorise un prix d'option négatif |
| `src/audit.js` | journal des modifications (`audit_log`) |
| `src/mailer.js` | e-mails client (file `email_queue`), SMTP dans `.env` ; sans `SMTP_HOST` ils restent en attente |
| `src/menuImport.js` | import de carte par IA (désactivé sans `ANTHROPIC_API_KEY`) |
| `src/db.js` | connexion ; en local lance un PostgreSQL intégré (port 5433, dossier `.pgdata`) |
| `db/schema.sql` | schéma, appliqué à chaque démarrage (idempotent). Prix en centimes |

### `onyx-order-front/` (workspaces npm)
| Dossier | Rôle |
|---|---|
| `web/` | site client Next.js 16. **Mobile d'abord** (90 % des commandes). Le restaurant est choisi par `NEXT_PUBLIC_RESTAURANT` (voir §4) |
| `cuisine/` | écran cuisine (Vite + React). **Version téléphone** : onglets par état (Nouvelles / En préparation / Prêtes / En livraison), une colonne à la fois, gros boutons ; sur grand écran, 4 colonnes. Styles : `cuisine/src/style.css` (bloc « Téléphone » en bas) |
| `admin/` | back-office (Vite + React) : Carte, Options (dont « Photos en lot »), Importer ma carte, Archivés |
| `shared/` | code commun : `Login.jsx` (champ **Identifiant**, pas forcément un e-mail), `session.js`, `base.css`, aperçu produit |

## 3. Outils génériques (aucun code propre à un restaurant)

Tout se règle par des fichiers de configuration dans `onyx-order-api/data/`. Commandes `npm run …` dans `onyx-order-api` :

| Besoin | Commande | Fichier de config |
|---|---|---|
| Créer un restaurant vide + propriétaire | `restaurant:create -- --slug … --name … --owner …` | options en ligne de commande |
| Importer une carte (catégories, produits, prix) | `menu:csv -- --slug X --file data/menu-X.csv` | CSV `Categorie,Article,Prix` |
| Listes d'options et liens aux produits | `menu:options -- --slug X --file data/options-X.json` | JSON : `groups`, `links` (`category`, `only`, `except`), `expand` |
| Importer un dossier de photos | `menu:import-photos -- --slug X --dir <dossier> --file data/photos-X.json` | JSON `fichier -> produit(s)` ou option(s) ; WebP 800 px |
| Réutiliser les photos d'un autre restaurant | `menu:photos -- --from A --slug X --file …` | JSON `produit cible -> produit source` |
| Exporter / importer un restaurant entier | `node scripts/restaurant-export.js` / `restaurant-import.js` | JSON (carte + options + horaires, sans commandes ni secrets) |
| Changer un mot de passe | `password -- <identifiant> [motdepasse]` | – |

Règles : ces scripts **refusent d'écraser** (carte déjà présente, liste déjà existante). Photos : le même fichier peut servir plusieurs produits (`"fichier": ["Produit A", "Produit B"]`).
Un prix d'option négatif réduit le prix (exemple NS Grill : produit au tarif « menu », option « Sans boisson » à −1,00 €).

## 4. Tester un restaurant en local

1. API : `cd onyx-order-api && npm run dev` (PostgreSQL intégré démarré tout seul).
2. Site d'**un** restaurant : `cd onyx-order-front/web && npm run dev:restaurant -- <slug> <port>` (un dossier de build `.next-<slug>` par restaurant : plusieurs sites côte à côte). Le port 3000 (`npm run dev`) sert le restaurant de `onyx-order-front/.env`.
3. Cuisine `:5173`, back-office `:5174` (connectez-vous avec un compte du restaurant voulu). Sur téléphone : adresse du PC sur le réseau local, par exemple `http://192.168.x.x:5173`.

## 5. Déployer (serveur OVH)

Détails : `deploy/README.md` et la note mémoire « serveur OVH ». Résumé :

1. `powershell -ExecutionPolicy Bypass -File deploy\package.ps1` → archives dans `..\onyx-order-deploy\` (code, photos).
2. `scp` vers `ubuntu@serveur` (alias `ssh onyx`), extraire dans `/srv/onyx` (`tar … --warning=no-unknown-keyword`).
3. Mise à jour d'un restaurant : `docker compose -p onyx-<slug> --env-file deploy/restaurants/<slug>/.env up -d --build`.
4. Nouveau restaurant : `node deploy/new-restaurant.mjs …` (secrets aléatoires, ports libres), envoyer son `.env` et son `.caddy`, `up -d --build`, puis `restaurant-import.js` avec le JSON exporté, copier les photos dans `/data/photos/<slug>/` du conteneur API, copier le `.caddy` dans `/etc/caddy/sites/` et recharger Caddy.
5. Sauvegarde : `deploy/backup.sh <slug>` (cron 03:15). Faire une sauvegarde avant toute mise à jour.

Pièges connus : voir la note mémoire (`docker compose exec` dans un script envoyé par `ssh bash -s` avale la suite : ajouter `</dev/null` ; ne pas réécrire un `.sh` avec `Set-Content`, fins de ligne Windows).

## 6. Réglages par installation (`deploy/restaurants/<slug>/.env`, jamais dans Git)

`SITE_URL`, `API_URL`, ports, limites de ressources, SMTP (`SMTP_*`), `ANTHROPIC_*`, **`IGNORE_HOURS`** (`true` pour une démo testable à toute heure ; à remettre à `false` en service réel), et dans la base `restaurants.settings` : `modes`, `payment`, `demo` (bandeau « Démonstration »), `noindex`.

## 7. Où modifier quoi

| Je veux… | Je modifie |
|---|---|
| Changer l'ordre ou l'aspect des options sur le site | `web/app/Menu.js`, `web/app/globals.css` ; ordre des listes : `src/menu.js` |
| Règle de prix / contrôle de commande | `src/orders.js` |
| Écran cuisine (mobile ou grand écran) | `cuisine/src/App.jsx` et `style.css` |
| Écran de connexion | `shared/Login.jsx` |
| Une nouvelle table ou colonne | `db/schema.sql` (ALTER … IF NOT EXISTS), puis export/import si elle doit voyager (`restaurant-export.js` / `restaurant-import.js`) |
| Ajouter un restaurant | §3 et §5 ; aucun code à écrire |
| Un restaurant précis | sa carte, ses options et ses photos par fichiers de `data/` ; jamais du code spécifique |

## 7 bis. Livraison par coursiers Uber (option)

Pour les restaurants sans livreur : `onyx-order-api/src/uberDirect.js`, activé par `settings.delivery_provider = 'uber'`. Fonctionnement, réglages, compte de test et démo : `docs/UBER-DIRECT.md`.

## 8. Ce qui reste à construire

Copie des sauvegardes hors du serveur et sauvegarde des photos, anonymisation des commandes après 24 mois, configuration SMTP, paiement en ligne, CRM et fidélité, CI/CD léger. Détails et décisions commerciales : `docs/` et la mémoire du projet.

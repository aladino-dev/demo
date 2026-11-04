# Onyx Order – contexte pour Claude (VS Code)

Application de commande en ligne pour restaurants, sans commission (marque Onyx). Le restaurant de démo s'appelle **FastCamion** (slug `fastcamion`) : c'est l'ancien « Food Station » renommé le 04/11/2026 (même carte, même base, sauvegarde JSON dans `onyx-order-api/backups/`). Comptes locaux : `admin@fastcamion.local`, `cuisine@fastcamion.local`.
Poste : Windows, Node.js 24, **pas de Docker**, PowerShell dans VS Code.

## Structure (2 projets séparés, futurs 2 dépôts git / 2 pods)
- `onyx-order-api/` : Express 5 + PostgreSQL (`pg`). Port 4000.
  - `src/db.js` : sans `DATABASE_URL`, lance un PostgreSQL intégré (`embedded-postgres`, dossier `.pgdata`, port 5433, utilisateur/mot de passe/base `onyx`). Il est lancé **indépendamment de l'API** (journal dans `.pgdata.log`) : il survit aux redémarrages de `node --watch` et est réutilisé s'il tourne déjà. Pour l'arrêter : `npm run db:stop`.
  - `src/catalog.js` : routes `/api/admin` de la carte (catégories, produits, listes d'options `/option-groups`, options, photos). Rien ne se supprime : archivage (`archived_at`). Journal des modifications : `src/audit.js` → table `audit_log`.
  - `src/mailer.js` : envoi des e-mails au client (file `email_queue` : confirmation, commande prête, en livraison) via SMTP configuré dans `.env` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SITE_URL`). Sans `SMTP_HOST`, les e-mails restent en attente. Essais répétés puis abandon après 5 échecs ; jamais d'e-mail pour une commande de plus de 24 h. Test : `npm run email:test -- adresse`.
  - `db/schema.sql` : schéma (appliqué à chaque démarrage, idempotent). Prix en centimes.
  - `scripts/seed.js` : importe `data/seed-food-station.json` (19 catégories, 129 produits, 23 groupes d'options) et crée 2 comptes (owner, cuisine) dont les mots de passe s'affichent une seule fois dans le terminal. `--reset` remplace tout.
  - `scripts/photos.js` : convertit les photos de la sauvegarde WordPress (`…-uploads.zip`) en WebP dans `photos/`.
  - Routes : `/api/health`, `/api/r/:slug` (+ `/menu`, `/zone`, `/orders`, `/orders/:token`), `/api/auth/login`, `/api/admin/*` (JWT), flux temps réel `/api/admin/stream` (SSE).
- `onyx-order-front/` : workspaces npm.
  - `web/` Next.js 16 (site client, port 3000) : lit l'API via `NEXT_PUBLIC_API_URL` (fichier `onyx-order-front/.env`).
  - `cuisine/` Vite + React (port 5173), `admin/` Vite + React (port 5174), code commun dans `shared/`.
- `docker-compose.yml` + `deploy/` : serveur OVH (pas utilisé en local, Docker absent de ce PC). **Décision (04/11/2026) : un restaurant = une installation séparée** (base, API, site, limites CPU/mémoire, ports, sauvegarde) pour qu'un gros client ou un incident n'affecte pas les autres. `deploy/new-restaurant.mjs` prépare le `.env`, `onyx-order-api/scripts/create-restaurant.js` crée le restaurant et son propriétaire. Produit destiné à être **vendu** : une démo en ligne attractive est à prévoir.

## Documents
- `docs/SPEC-BACKOFFICE.md` : spécification du back-office à construire (principes, écrans, API, ordre de réalisation, critères de réussite).

## Lancer en local
Terminal 1 : `cd onyx-order-api` → `npm install` → `npm run seed` (1re fois) → `npm run dev`
Terminal 2 : `cd onyx-order-front` → `npm install` → `npm run dev`
Vérifier : http://localhost:4000/api/health puis http://localhost:4000/api/r/fastcamion

## Problèmes connus
- PowerShell lancé « en tant qu'administrateur » : PostgreSQL refuse de démarrer.
- « pre-existing shared memory block is still in use » : ancien `postgres.exe` resté ouvert → `taskkill /F /IM postgres.exe`.
- La base reste active après l'arrêt de l'API (DBeaver : `jdbc:postgresql://localhost:5433/onyx`, onyx/onyx) ; `npm run db:stop` l'arrête. Si elle ne répond plus (anciens processus) : `taskkill /F /IM postgres.exe`, puis relancer l'API.
- Mot de passe d'un compte : `npm run password -- <e-mail> [motdepasse]` (sans 2e argument, un mot de passe aléatoire s'affiche une seule fois).
- Page « Service momentanément indisponible » sur le site : l'API ne répond pas OU le restaurant `fastcamion` n'est pas importé (`npm run seed`).

## Règles de travail (Alaeddine)
- Réponses courtes, une étape à la fois, pas de récap inutile.
- Ne jamais demander ni afficher de mot de passe ou de clé dans le chat.
- Ne rien supprimer sans accord ; sauvegarder avant toute modification importante.
- Ne jamais modifier le dossier `Documents\foodstation-WS` (lecture seule).
- N'inventer aucune info (prix, horaires, produits) : demander.
- Rien en ligne sans « oui / publie ».

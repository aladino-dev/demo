# Onyx Order

Commande en ligne pour restaurants, sans commission. Deux projets indépendants (deux dépôts git, deux pods) :

| Projet | Rôle | Port local |
|---|---|---|
| `onyx-order-api` | API Express + PostgreSQL : carte, commandes, cuisine en temps réel, back-office, photos | 4000 |
| `onyx-order-front` | Site client Next.js + écran cuisine (`/cuisine`) + back-office (`/admin`) en React/Vite | 3000 (5173, 5174 en dev) |

Le front ne parle à l'API que par HTTP (`NEXT_PUBLIC_API_URL`). Aucun code partagé entre les deux.

## Lancer en local (Windows, Node.js 20 ou plus, sans Docker)

> Ouvrir PowerShell **normalement** (pas « en tant qu'administrateur »), sinon la base intégrée refuse de démarrer.

Deux terminaux (PowerShell).

**Terminal 1 – API**
```powershell
cd onyx-order-api
copy .env.example .env      # déjà fait si le fichier .env existe
npm install
npm run seed                # 1re fois : crée la base locale + importe la carte de démo FastCamion (ancien Food Station)
npm run dev
```
La base PostgreSQL est intégrée (dossier `.pgdata`, port 5433), rien à installer.
`npm run seed` affiche **une seule fois** les mots de passe des comptes `admin@fastcamion.local` (back-office) et `cuisine@fastcamion.local` (écran cuisine) : notez-les.

Photos des produits (facultatif, une fois) :
```powershell
npm run photos -- "C:\Users\Alaeddine\Documents\foodstation-WS\sauvegardes\backup_2026-11-04-1034_FOOD_STATION_Burgers_Tacos_a_e70daf384d96-uploads.zip"
```
(lit la sauvegarde sans la modifier, convertit en WebP dans `onyx-order-api/photos`).

**Terminal 2 – Front**
```powershell
cd onyx-order-front
copy .env.example .env
npm install
npm run dev
```

| Ouvrir | Adresse |
|---|---|
| Site client | http://localhost:3000 |
| Écran cuisine | http://localhost:5173 |
| Back-office | http://localhost:5174 |

En mode démo (`IGNORE_HOURS=true` dans l'API), les commandes sont acceptées même restaurant fermé.

Tout réimporter : `npm run seed -- --reset` (efface aussi les commandes de test).

## Mettre en ligne (serveur OVH) : un restaurant = une installation séparée

Chaque restaurant a **sa propre base, sa propre API et son propre site** (un « projet » Docker à lui, avec ses limites de processeur et de mémoire). Un gros client ou un incident chez l'un ne touche pas les autres.

```bash
# 1. préparer le restaurant (secrets aléatoires, ports libres) : affiche les commandes à suivre
node deploy/new-restaurant.mjs --slug chez-ali --name "Chez Ali" --site https://chez-ali.fr --api https://api.chez-ali.fr
# 2. lancer ses services
docker compose -p onyx-chez-ali --env-file deploy/restaurants/chez-ali/.env up -d --build
# 3. créer le restaurant et son propriétaire (mot de passe affiché une seule fois)
docker compose -p onyx-chez-ali --env-file deploy/restaurants/chez-ali/.env exec api node scripts/create-restaurant.js --slug chez-ali --name "Chez Ali" --owner ali@exemple.fr --hours "11:30-14:30,18:00-23:55"
# 4. sauvegarde quotidienne de sa base (cron)
bash deploy/backup.sh chez-ali
```
Les ports sont ouverts sur 127.0.0.1 seulement : un proxy HTTPS (Caddy) publie chaque site et chaque API (le bloc Caddy à copier est affiché par `new-restaurant.mjs`).
En production le front sert la cuisine sur `/cuisine` et le back-office sur `/admin`. Les secrets de chaque restaurant sont dans `deploy/restaurants/<slug>/.env` (jamais partagés ni versionnés).
Démo FastCamion (carte complète) : `docker compose ... exec api node scripts/seed.js`.
Local sans Docker : `npm run restaurant:create -- --slug ... --name ... --owner ...` dans `onyx-order-api`.

Pour deux pods séparés : construire chaque `Dockerfile` à part. L'API a besoin de `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS` et d'un volume sur `/data/photos` ; le front de `NEXT_PUBLIC_API_URL` (au build) et `API_INTERNAL_URL` (adresse interne de l'API).

## État (v0.1, 04/11/2026)
Fait : modules 1 à 3 et 5 en version de base (carte et options, panier et commande avec zones, promo et anti-robot, écran cuisine temps réel avec son et ticket 80 mm, back-office prix / visible / épuisé / commandes / CSV).
E-mails au client : actifs dès que le SMTP est renseigné dans `onyx-order-api/.env` (`npm run email:test -- vous@exemple.fr` pour vérifier).
À faire : édition des horaires dans le back-office, allergènes, vitrine, créneaux.

# Mise en ligne sur le VPS OVH

Serveur : `vps-24f42c2e.vps.ovh.net` (IP **51.254.130.80**). Un restaurant = une installation séparée (voir `README.md` à la racine).
Rien de ce qui suit n'est lancé sans vous : vous exécutez les commandes, aucun mot de passe n'est partagé.

## 0. Avant de commencer
- L'utilisateur SSH et le mot de passe (ou la clé) sont dans l'e-mail OVH d'installation du VPS (souvent `ubuntu`, `debian` ou `root`).
- Les adresses du site et de l'API (ex. `demo.byonyx.fr` et `api.demo.byonyx.fr`) doivent pointer vers le serveur :
  dans OVH → Noms de domaine → byonyx.fr → **Zone DNS** → ajouter deux enregistrements **A** vers `51.254.130.80`.
  (L'activation peut prendre quelques minutes.)

## 1. Envoyer le projet depuis Windows (PowerShell, dossier `onyx-order`)
```powershell
powershell -ExecutionPolicy Bypass -File deploy\package.ps1
scp ..\onyx-order-deploy\onyx-order.tgz ..\onyx-order-deploy\photos.tgz UTILISATEUR@vps-24f42c2e.vps.ovh.net:~
```

## 2. Sur le serveur (`ssh UTILISATEUR@vps-24f42c2e.vps.ovh.net`)
```bash
sudo mkdir -p /srv/onyx && sudo chown "$USER": /srv/onyx
tar -xzf ~/onyx-order.tgz -C /srv/onyx && cd /srv/onyx
sudo bash deploy/server-setup.sh        # Docker, Caddy (HTTPS), pare-feu, protection SSH : une seule fois
exit                                    # puis se reconnecter en SSH (groupe docker)
```

## 3. Créer le restaurant de démo
```bash
cd /srv/onyx
node deploy/new-restaurant.mjs --slug fastcamion --name FastCamion --site https://demo.byonyx.fr --api https://api.demo.byonyx.fr
# (Node n'est pas obligatoire sur le serveur : sinon lancez cette commande sur Windows et copiez deploy/restaurants/fastcamion/ avec scp)
```
Puis lancer **dans l'ordre** les commandes que ce script affiche : démarrage des 3 services, création du restaurant et du compte, bloc Caddy.
Remplir ensuite les lignes `SMTP_*` de `deploy/restaurants/fastcamion/.env` et relancer la première commande.

Pour la **démo FastCamion avec sa carte** :
```bash
docker compose -p onyx-fastcamion --env-file deploy/restaurants/fastcamion/.env exec api node scripts/seed.js
docker compose -p onyx-fastcamion --env-file deploy/restaurants/fastcamion/.env cp ~/photos.tgz api:/tmp/photos.tgz
docker compose -p onyx-fastcamion --env-file deploy/restaurants/fastcamion/.env exec -u root api sh -c "mkdir -p /data/photos && tar -xzf /tmp/photos.tgz -C /data/photos && chown -R node /data/photos"
```
(`seed.js` crée aussi les comptes `admin@fastcamion.local` et `cuisine@fastcamion.local` : leurs mots de passe s'affichent une seule fois.)

## 4. Vérifier
- `https://api.demo.byonyx.fr/api/health` doit répondre `{"ok":true}`.
- `https://demo.byonyx.fr` affiche la carte ; `/admin` le back-office ; `/cuisine` l'écran cuisine.
- Passer une commande test, la voir arriver sur l'écran cuisine.

## 5. Sauvegarde
`crontab -e` puis : `15 3 * * * cd /srv/onyx && bash deploy/backup.sh fastcamion`

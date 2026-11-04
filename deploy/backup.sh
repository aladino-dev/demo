#!/usr/bin/env bash
# Sauvegarde la base d'UN restaurant : bash deploy/backup.sh <slug> [dossier-de-sauvegarde]
# À mettre dans cron, par exemple chaque nuit :  15 3 * * *  cd /chemin/onyx-order && bash deploy/backup.sh chez-ali
# Garde les 14 dernières sauvegardes de ce restaurant (les autres restaurants ne sont pas touchés).
set -euo pipefail
slug="${1:?Indiquez le restaurant : bash deploy/backup.sh <slug>}"
cd "$(dirname "$0")/.."
envfile="deploy/restaurants/${slug}/.env"
[ -f "$envfile" ] || { echo "Restaurant inconnu : $envfile introuvable" >&2; exit 1; }
out="${2:-backups}/${slug}"
mkdir -p "$out"
file="${out}/onyx-${slug}-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -p "onyx-${slug}" --env-file "$envfile" exec -T db pg_dump -U onyx -d onyx --no-owner | gzip > "$file"
[ -s "$file" ] || { echo "Sauvegarde vide : $file" >&2; rm -f "$file"; exit 1; }
echo "Sauvegarde : $file"
# rotation : on garde les 14 plus récentes
ls -1t "${out}"/onyx-"${slug}"-*.sql.gz | tail -n +15 | xargs -r rm -f

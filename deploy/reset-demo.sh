#!/usr/bin/env bash
# Remet à zéro le restaurant de DÉMONSTRATION : carte d'origine, comptes de test, commandes effacées.
# Usage : bash deploy/reset-demo.sh fastcamion        (à mettre dans cron, chaque nuit)
# ⚠ Réservé au restaurant de démo : efface ses commandes. Ne jamais l'utiliser sur un vrai restaurant.
set -euo pipefail
slug="${1:?Indiquez le restaurant de démonstration : bash deploy/reset-demo.sh <slug>}"
cd "$(dirname "$0")/.."
envfile="deploy/restaurants/${slug}/.env"
[ -f "$envfile" ] || { echo "Restaurant inconnu : $envfile introuvable" >&2; exit 1; }
DC="sudo -n docker compose -p onyx-${slug} --env-file ${envfile}"
# garde-fou : seul un restaurant marqué « demo » peut être remis à zéro
is_demo=$($DC exec -T db psql -U onyx -d onyx -Atc "select coalesce((settings->>'demo')='true', false) from restaurants where slug='${slug}'" </dev/null || true)
if [ "${is_demo}" != "t" ]; then echo "Refusé : « ${slug} » n'est pas marqué comme démonstration (settings.demo)." >&2; exit 1; fi
$DC exec -T api node scripts/seed.js --reset </dev/null | grep -E "Import terminé|Erreur" || true
echo "$(date '+%F %T') démonstration « ${slug} » remise à zéro"

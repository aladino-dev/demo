#!/usr/bin/env bash
# Prépare un VPS Ubuntu/Debian neuf pour Onyx Order : Docker, Caddy (HTTPS automatique), pare-feu, protection SSH.
# À lancer UNE FOIS sur le serveur :  sudo bash deploy/server-setup.sh
# Sûr à relancer (ne réinstalle pas ce qui est déjà là). Ne touche à aucun restaurant existant.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lancez avec sudo : sudo bash deploy/server-setup.sh" >&2; exit 1; }
. /etc/os-release
case "${ID}" in ubuntu|debian) ;; *) echo "Système non prévu (${ID}). Ubuntu ou Debian attendu." >&2; exit 1 ;; esac
export DEBIAN_FRONTEND=noninteractive

echo "==> Paquets de base"
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades apt-transport-https

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Caddy (proxy HTTPS, certificats automatiques)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
# un fichier par restaurant dans /etc/caddy/sites : ajouter un restaurant n'interrompt pas les autres
mkdir -p /etc/caddy/sites
if ! grep -q 'import /etc/caddy/sites' /etc/caddy/Caddyfile 2>/dev/null; then
  [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)"
  cat > /etc/caddy/Caddyfile <<'CADDY'
# En-têtes de sécurité communs à tous les sites (appelés par « import securite »)
(securite) {
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }
}

# Un fichier par restaurant (voir deploy/new-restaurant.mjs)
import /etc/caddy/sites/*.caddy
CADDY
fi
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> Pare-feu (SSH, HTTP, HTTPS seulement)"
# (awk lit tout : un « exit » anticipé casserait le tube sous « set -o pipefail »)
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{p=$2} END{print p}' || true)"
SSH_PORT="${SSH_PORT:-22}"
ufw allow "${SSH_PORT}/tcp" >/dev/null   # d'abord SSH : on ne se coupe jamais l'accès
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "    ports ouverts : ${SSH_PORT} (SSH), 80, 443"

echo "==> Protection contre les tentatives de connexion SSH répétées + mises à jour de sécurité automatiques"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "==> Dossier de travail"
mkdir -p /srv/onyx
[ -n "${SUDO_USER:-}" ] && chown "${SUDO_USER}:${SUDO_USER}" /srv/onyx && usermod -aG docker "${SUDO_USER}" || true

echo
echo "Serveur prêt."
echo "- Docker : $(docker --version)"
echo "- Caddy  : $(caddy version | head -1)"
echo "Déconnectez-vous puis reconnectez-vous en SSH pour que le groupe « docker » soit pris en compte (docker sans sudo)."

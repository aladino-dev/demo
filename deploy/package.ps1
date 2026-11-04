# Prépare les deux archives à envoyer sur le serveur (depuis Windows, PowerShell, à la racine du projet) :
#   powershell -ExecutionPolicy Bypass -File deploy\package.ps1
# Crée  ..\onyx-order-deploy\onyx-order.tgz  (le code)  et  photos.tgz  (les photos des produits).
# Exclus : node_modules, base locale (.pgdata), fichiers .env (secrets), sauvegardes, builds.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path (Split-Path -Parent $root) 'onyx-order-deploy'
New-Item -ItemType Directory -Force $out | Out-Null

Write-Host 'Archive du code…'
tar -czf (Join-Path $out 'onyx-order.tgz') `
  --exclude=node_modules --exclude=.pgdata --exclude='.pgdata.*' --exclude=.next --exclude=dist `
  --exclude=backups --exclude=_archive --exclude=photos --exclude='.env' --exclude='*.bak*' `
  --exclude='deploy/restaurants' -C $root .

$photos = Join-Path $root 'onyx-order-api\photos'
if (Test-Path $photos) {
  Write-Host 'Archive des photos…'
  tar -czf (Join-Path $out 'photos.tgz') -C $photos .
}

Get-ChildItem $out -Filter *.tgz | ForEach-Object { '{0}  {1:N1} Mo' -f $_.FullName, ($_.Length / 1MB) }
Write-Host "`nÉtape suivante : voir deploy/README.md (envoi avec scp)."

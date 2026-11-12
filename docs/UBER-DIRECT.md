# Livraison par coursiers Uber (Uber Direct) : intégration et démo

Pour les restaurants **sans livreur** : quand le restaurant accepte une commande en livraison, un coursier Uber vient la chercher et la livre. **Le client paye le tarif de livraison Uber en entier** (aucune marge ni absorption par le restaurant). Option activable restaurant par restaurant ; sans elle, les zones et tarifs fixes actuels restent en place.

## 1. Parcours d'une commande

1. Le client saisit son adresse sur `/commande`. Après une pause de 0,6 s, le site demande le prix : `GET /api/r/:slug/zone?line=…&postcode=…&city=…`.
2. L'API demande un **devis** à Uber (adresse du restaurant → adresse du client), le garde en mémoire 14 min et renvoie `{ quote_id, fee_cents }`. Adresse non livrable : message « Nous ne livrons pas cette adresse », retrait toujours possible.
3. Le client commande : `POST /api/r/:slug/orders` avec `quote_id`. L'API vérifie que le devis existe, est du même restaurant, pour la même adresse et pas expiré. **Le prix vient du serveur, jamais du navigateur.**
4. La cuisine passe la commande en **« en préparation »** : l'API crée la course chez Uber (`uber_delivery_id`, lien de suivi) avec l'heure de préparation prévue.
5. Uber envoie des notifications (webhook) : coursier récupère le colis → commande **« en livraison »** ; livré → **« livrée »**. Le client voit « Suivre le coursier » sur sa page de suivi.
6. Commande **annulée** par la cuisine → la course est annulée chez Uber.

## 2. Où c'est dans le code

| Quoi | Fichier |
|---|---|
| Appels Uber (devis, course, annulation, signature), mode simulé | `onyx-order-api/src/uberDirect.js` |
| Prix Uber à la commande, lancement et annulation de la course | `onyx-order-api/src/orders.js` (`createOrder`, `setStatus`) |
| Route de prix `/zone` et webhook `POST /api/uber/webhook` | `onyx-order-api/src/index.js` |
| Colonnes `uber_quote_id`, `uber_delivery_id`, `tracking_url`, `courier_status`, `courier_error` | `onyx-order-api/db/schema.sql` |
| Prix en direct à la saisie de l'adresse | `onyx-order-front/web/app/commande/page.js` |
| Bouton « Suivre le coursier » | `onyx-order-front/web/app/suivi/[token]/page.js` |

## 3. Réglages

Dans le `.env` de l'API (jamais dans Git, jamais dans le chat) :

| Variable | Rôle |
|---|---|
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_CUSTOMER_ID` | identifiants du compte Uber Direct |
| `UBER_WEBHOOK_SECRET` | clé de signature des notifications |
| `UBER_MOCK=true` + `UBER_MOCK_FEE_CENTS=490` | simulation locale sans compte (prix fictif en centimes) |

Par restaurant (champ `settings` du restaurant) :
- `delivery_provider = 'uber'` : active Uber (retirer la clé = retour aux zones fixes).
- `uber_prep_minutes` : minutes avant l'arrivée du coursier (0 par défaut). À régler selon le restaurant.
- `modes` doit contenir `delivery`.

## 4. Obtenir le compte de test Uber

1. Créer un compte « entreprise » sur le tableau de bord Uber Direct.
2. Rester en **mode Test** (bandeau bleu en haut) : aucun vrai coursier, aucune facturation.
3. Onglet *Developer* (section *Management*) : relever le Customer ID, créer l'application de test et relever Client ID / Client secret.
4. Les mettre dans le `.env` de l'API, laisser `UBER_MOCK` vide, activer `delivery_provider = 'uber'`.
5. Passage en production : Uber demande une carte bancaire puis valide le compte.

Point à trancher : un compte Uber par restaurant (facturation directe au restaurant) ou un compte Onyx pour tous (refacturation à gérer).

## 5. À vérifier avec le bac à sable Uber

- Format d'adresse pour la France (champ `state` laissé vide pour l'instant).
- Nom de l'en-tête et méthode de la signature du webhook (`x-postmates-signature` supposé, HMAC-SHA256 du corps).
- Adresse d'API utilisée pour le mode test (le code appelle `api.uber.com`).

## 6. Faire une démo

### A. Démo locale, sans compte (simulation)
1. `.env` de l'API : `UBER_MOCK=true`, `UBER_MOCK_FEE_CENTS=490`. Activer `delivery_provider = 'uber'` sur le restaurant de démo.
2. Lancer l'API et le site (voir CLAUDE.md), commander en **Livraison** avec une adresse à 5 chiffres de code postal : le prix fictif s'affiche.
3. Écran cuisine : passer la commande en « en préparation » → course simulée créée.
4. Le coursier n'existe pas : la suite (en livraison, livrée) se fait à la main depuis la cuisine.

Dire clairement au restaurant que le prix est fictif.

### B. Démo avec le vrai bac à sable Uber
Même chose avec les identifiants de **test**. Le devis et la course sont créés chez Uber (visibles dans le tableau de bord, mode Test), sans coursier réel. Pour voir les changements de statut automatiques, brancher le webhook sur une adresse publique (serveur OVH).

### C. Démo en ligne (à faire seulement sur « oui / publie »)
1. Déployer l'API et le site sur la démo (installation séparée, voir `ARCHITECTURE.md` §5). Penser à NS Grill : toute modification doit y aller aussi.
2. Renseigner les identifiants de **test** dans le `.env` du serveur, activer Uber sur le restaurant de démo.
3. Dans le tableau de bord Uber, indiquer `https://<api-de-la-démo>/api/uber/webhook` et recopier la clé dans `UBER_WEBHOOK_SECRET`.
4. Scénario de présentation (5 min) : ouvrir le site sur téléphone → ajouter un plat → Livraison → saisir l'adresse → le prix Uber apparaît → commander → à la cuisine, « en préparation » → montrer la course dans le tableau Uber → page de suivi du client avec « Suivre le coursier ».

## 7. Limites connues et suite

- La cuisine n'affiche pas encore le coursier ni `courier_error` (course refusée par Uber).
- Devis gardés en mémoire : un redémarrage de l'API pendant une commande oblige le client à revalider l'adresse.
- Devis de plus de 15 min à la création de la course : Uber recalcule, l'écart est à la charge du restaurant.
- Pas d'écran d'administration pour activer Uber : réglage en base pour l'instant.
- Le montant minimum de commande n'est pas appliqué à la livraison Uber.

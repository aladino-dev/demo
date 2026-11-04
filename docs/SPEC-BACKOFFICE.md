# Onyx Order – Spécification du back-office (v0.2)

*04/11/2026. À lire avec `CLAUDE.md`. Objectif : un back-office aussi simple à prendre en main que celui d'Orderable (WordPress), sans ses défauts constatés chez Food Station : options en double, conditions cachées, réglages éparpillés entre WooCommerce, Orderable et des extraits de code.*

## 1. Principes (à respecter sur chaque écran)

1. **Un restaurateur, pas un informaticien.** Vocabulaire du métier : « Carte », « Options », « Horaires », « Livraison ». Jamais « groupe », « lien », « slug », « centimes ».
2. **Tout se modifie sur place.** Clic sur un prix → champ éditable ; Entrée ou clic ailleurs = enregistré. Pas de bouton « Enregistrer » global, pas de rechargement.
3. **Retour visible immédiat.** Petit message « Enregistré » en bas (2 s) ; en cas d'erreur, message clair et la valeur revient à l'ancienne.
4. **Aperçu client à côté.** Quand on modifie un produit ou ses options, on voit à droite la fenêtre produit telle que le client la verra (mêmes composants que le site).
5. **Glisser-déposer pour l'ordre.** Catégories, produits, options, groupes d'options : poignée ⋮⋮ à gauche, ordre enregistré au lâcher.
6. **Rien ne se supprime par erreur.** « Supprimer » = **Archiver** (masqué partout, restaurable dans un onglet « Archivés »). Confirmation obligatoire. Une commande n'est jamais supprimée.
7. **Les options sont réutilisables et on voit où elles servent.** Chaque liste d'options affiche « Utilisée par 12 produits » ; modifier une liste avertit : « Ce changement s'applique aux 12 produits. »
8. **Mobile et tablette d'abord** pour : disponibilité du jour, commandes, fermeture exceptionnelle. Le reste peut être pensé pour ordinateur.
9. **Euros à l'écran, centimes en base.** Saisie « 12,90 » ou « 12.90 » acceptée.
10. **Rôles.** `owner` : tout. `manager` : carte, disponibilité, commandes (pas comptes ni réglages SMTP). `cuisine` : écran cuisine seulement.

## 2. Navigation

Barre latérale (repliable sur tablette, barre du bas sur mobile) :

| Menu | Contenu |
|---|---|
| **Aujourd'hui** | Tableau de bord du jour |
| **Commandes** | Liste, recherche, détail, export |
| **Carte** | Catégories et produits |
| **Options** | Bibliothèque des listes d'options (sauces, boissons…) |
| **Disponibilité** | Épuisé aujourd'hui, ouvert/fermé maintenant, fermetures exceptionnelles |
| **Horaires** | Horaires d'ouverture et de commande en ligne |
| **Livraison** | Zones, frais, minimum |
| **Promotions** | Codes promo |
| **Réglages** | Restaurant, modes de commande, paiement, e-mails, comptes |

En haut : nom du restaurant, interrupteur **« Commandes en ligne : Ouvertes / En pause »** (pause immédiate, ex. rush ou panne), lien « Voir le site ».

## 3. Écrans

### 3.1 Aujourd'hui
- Cartes chiffres : commandes du jour, chiffre d'affaires, panier moyen, part livraison / retrait, en attente maintenant.
- Liste des 10 dernières commandes avec statut (clic → détail).
- Alertes : « 3 produits épuisés », « Restaurant fermé demain (fermeture exceptionnelle) », « 2 e-mails non envoyés ».

### 3.2 Commandes
- Filtres : période (aujourd'hui, hier, 7 j, 30 j, dates), statut, mode, recherche (n°, nom, téléphone).
- Tableau : n°, heure, mode, client, articles (résumé), total, statut (pastille couleur).
- **Détail** (panneau latéral) : client, adresse, articles avec options et prix figés, remarque, historique des statuts (qui, quand), boutons de statut, **Imprimer le ticket**, **Annuler** (avec motif).
- Export CSV de la sélection (déjà en place : `/api/admin/orders.csv`).

### 3.3 Carte (écran principal, inspiré d'Orderable)
Disposition en deux colonnes :
- **Gauche : catégories** (liste glissable) : nom, nombre de produits, œil (visible/masquée), menu ⋯ (renommer, archiver). Bouton « + Catégorie ».
- **Droite : produits de la catégorie** sous forme de lignes : poignée, photo miniature, nom, prix (éditable sur place), interrupteurs **Visible** et **Épuisé aujourd'hui**, résumé des options (« Sauces · Crudités · Boisson 33 cl »). Bouton « + Produit ». Recherche globale en haut.

**Fiche produit** (ouverte en panneau large, aperçu client à droite) :
1. **Infos** : nom, description (compteur de caractères), prix, catégorie, photo (glisser une image ou cliquer ; recadrage 4:3 ; conversion WebP côté API).
2. **Options** : liste ordonnée des listes d'options appliquées au produit.
   - Par défaut : « Hérite de la catégorie Burger » (affiché clairement, avec bouton « Personnaliser pour ce produit »).
   - « + Ajouter une liste d'options » → choisir dans la bibliothèque (recherche) ou « Créer une nouvelle liste ».
   - Pour chaque liste : titre, règle lisible (« Obligatoire · 1 à 2 choix »), poignée d'ordre, retirer.
3. **Allergènes** : 14 cases (Présent / Traces), module v1.
4. **Disponibilité** : visible, épuisé aujourd'hui, (plus tard) jours/horaires de vente.
Actions : Dupliquer, Archiver.

### 3.4 Options (bibliothèque)
- Liste des listes d'options : titre, règle, nombre d'options, « utilisée par N produits / catégories ».
- **Éditeur d'une liste** :
  - Titre affiché au client (« Choisissez vos sauces ») et nom interne (« Sauces 2 max »).
  - Règle avec langage simple : `Obligatoire ☐` · `Minimum [1]` · `Maximum [2] / illimité`. Phrase générée : « Le client doit choisir 1 à 2 sauces. »
  - Options : libellé, supplément (vide = gratuit), visible, poignée d'ordre. Ajout rapide : taper puis Entrée ajoute la ligne suivante.
  - Bloc « Utilisée par » : liste des produits et catégories, avec possibilité d'ajouter/retirer.
  - **Dupliquer** (ex. « Boisson 33 cl » → « Boisson supplémentaire » avec +2 € partout : action « Appliquer un supplément à toutes les options »).
- Contrôles : maximum ≥ minimum ; avertissement si une liste obligatoire n'a aucune option visible.

### 3.5 Disponibilité (tablette, usage quotidien)
- Recherche + liste de tous les produits par catégorie avec un grand interrupteur **Disponible / Épuisé aujourd'hui** (remis à « Disponible » automatiquement à 5 h).
- Options aussi : « Épuisé aujourd'hui » sur une option (ex. plus de merguez) → masquée chez le client.
- **Fermeture exceptionnelle** : choisir une date (ou plage) + motif affiché aux clients.
- **Pause des commandes** : 15 min / 30 min / 1 h / jusqu'à réouverture.

### 3.6 Horaires
- Grille des 7 jours : ouvert/fermé, une ou **plusieurs plages** par jour (ex. 11:30–14:30 et 18:00–23:55), bouton « Copier sur tous les jours ».
- Heure limite de commande en ligne (ex. 5 min avant fermeture).
- Délai de préparation affiché (« Prêt en 20 min environ »), délai de livraison.
- Aperçu : « Aujourd'hui mercredi : ouvert 11h30–23h55 ».

### 3.7 Livraison
- Zones en cartes : nom, codes postaux, villes (facultatif, pour séparer Andrésy et Chanteloup dans le 78570), frais, minimum, livraison offerte à partir de (facultatif), active/inactive.
- Testeur : saisir une adresse → « Zone Andrésy, frais 6,00 € ».
- Ordre des zones = priorité (glisser-déposer).

### 3.8 Promotions
- Codes : code, type (% ou €), valeur, 1re commande seulement, limite par client, dates, actif, nombre d'utilisations.

### 3.9 Réglages
- **Restaurant** : nom, adresse, téléphone, fuseau, logo, couleur principale, textes (bandeau « fermé », mention paiement).
- **Modes** : retrait, livraison, sur place (cases), paiement sur place (espèces, CB, titres-restaurant), paiement en ligne (v2).
- **E-mails** : SMTP du restaurant (mot de passe saisi une fois, jamais réaffiché, chiffré en base), bouton « Envoyer un e-mail de test », modèles (confirmation, prête, en livraison) avec aperçu.
- **Comptes** : liste, ajout (e-mail + rôle), réinitialiser le mot de passe (nouveau mot de passe affiché une seule fois), désactiver.
- **Anti-robot** : nombre max de commandes par adresse IP et par période.

## 4. API à ajouter (onyx-order-api)

Toutes sous `/api/admin`, JWT, filtrées par `restaurant_id` du jeton. Réponses JSON, erreurs `{ error: "message en français" }`.

| Méthode | Route | Rôle |
|---|---|---|
| GET/POST | `/categories` | lister / créer |
| PATCH | `/categories/:id` | renommer, visible |
| POST | `/categories/reorder` | `{ ids: [...] }` |
| POST | `/categories/:id/archive` · `/restore` | archiver / restaurer |
| GET/POST | `/products` | lister (avec archivés en option) / créer |
| GET/PATCH | `/products/:id` | détail / modifier (existe en partie) |
| POST | `/products/reorder`, `/products/:id/duplicate`, `/archive`, `/restore` | |
| POST | `/products/:id/photo` | envoi d'image (multipart), conversion WebP 800 px via `sharp`, stockée dans `PHOTOS_DIR` |
| PUT | `/products/:id/option-groups` | `{ group_ids: [...] }` ordonné ; `[]` + `inherit: true` = hériter de la catégorie |
| PUT | `/categories/:id/option-groups` | idem pour une catégorie |
| GET/POST | `/option-groups` | bibliothèque (avec `used_by`) / créer |
| GET/PATCH | `/option-groups/:id` | détail / modifier règle et titre |
| POST | `/option-groups/:id/duplicate`, `/archive` | |
| PUT | `/option-groups/:id/options` | remplace la liste ordonnée des options `[{ id?, label, price_cents, visible }]` (les options retirées sont archivées, pas supprimées) |
| PATCH | `/options/:id` | épuisé aujourd'hui, visible |
| GET/PUT | `/opening-hours` | grille complète (plusieurs plages par jour) |
| GET/POST/DELETE | `/closures` | fermetures exceptionnelles (DELETE autorisé : donnée de planning) |
| POST | `/pause` | `{ minutes }` ou `{ until: null }` |
| GET/POST/PATCH | `/delivery-zones` (+ `/reorder`, `/test?postcode=&city=`) | |
| GET/POST/PATCH | `/promo-codes` | |
| GET/PATCH | `/settings` | réglages restaurant (owner) |
| POST | `/settings/smtp/test` | e-mail de test |
| GET/POST/PATCH | `/users`, POST `/users/:id/reset-password` | owner seulement |
| GET | `/dashboard` | chiffres du jour |

Validation côté API systématique (min ≤ max, prix ≥ 0, champs obligatoires). Chaque modification de carte : enregistrer `updated_at` et l'auteur (table `audit_log` simple : qui, quoi, quand, avant/après en JSON).

### Migrations de schéma (`db/schema.sql`, idempotentes avec `ALTER TABLE … ADD COLUMN IF NOT EXISTS`)
- `archived_at timestamptz` sur `categories`, `products`, `option_groups`, `options`.
- `sold_out_until timestamptz` sur `options`.
- `internal_name text` sur `option_groups`.
- `opening_hours` : plusieurs lignes par jour déjà possibles (garder).
- `restaurants.settings` : `paused_until`, `prep_minutes`, `delivery_minutes`, `order_cutoff_minutes`, `brand_color`.
- `delivery_zones` : `free_from_cents int`, `active boolean default true`.
- `promo_codes` : compteur d'utilisations calculé (pas de colonne).
- Table `audit_log (id, restaurant_id, user_id, entity, entity_id, action, before jsonb, after jsonb, created_at)`.
- Le site client et `loadMenu` doivent ignorer tout ce qui est archivé ; `createOrder` doit refuser une option épuisée et respecter `paused_until`.

## 5. Front (onyx-order-front/admin)

- Garder Vite + React. Ajouter un routeur simple (`react-router-dom`) pour les menus.
- Glisser-déposer : `@dnd-kit/core` + `@dnd-kit/sortable`.
- Mises à jour optimistes (l'écran change tout de suite, retour arrière si l'API refuse).
- **Aperçu client** : extraire la fenêtre produit du site (`web/app/Menu.js`, composant `ProductModal`) dans `shared/` pour l'utiliser à l'identique dans l'admin, ou la recopier en gardant le même rendu.
- Styles : continuer `shared/base.css` (sobre, gros boutons tactiles ≥ 44 px, contrastes AA).
- Aucune donnée sensible dans le navigateur à part le jeton de session.

## 6. Ordre de réalisation

1. **Carte** : catégories + produits (création, édition sur place, ordre, archivage, photo). Aperçu client.
2. **Options** : bibliothèque, éditeur de liste, rattachement produit/catégorie avec héritage visible.
3. **Disponibilité** : épuisé (produits et options), pause des commandes, fermetures.
4. **Horaires** et **Livraison** (avec testeur d'adresse).
5. **Aujourd'hui**, **Commandes** (détail, annulation, ticket).
6. **Promotions**, **Réglages**, **Comptes**, journal des modifications.

Chaque étape : API + écran + test manuel décrit (scénario en 5 lignes) avant de passer à la suivante.

## 7. Critères de réussite (tests à faire à chaque étape)

- Créer « Menu Test » à 9,90 € dans Burger, lui ajouter « Sauces (2 max) » et « Boisson 33 cl » : il apparaît sur le site avec ces choix, en moins de 1 minute et sans aide.
- Passer « Sauce Algérienne » en épuisé : elle disparaît du site, la commande avec cette sauce est refusée.
- Changer le maximum de « Sauces » de 2 à 3 : l'avertissement indique combien de produits sont concernés ; le site applique 3.
- Réordonner les catégories par glisser-déposer : l'ordre change sur le site.
- Archiver un produit puis le restaurer : il revient à sa place, avec ses options.
- Mettre en pause 15 min : le site affiche « Commandes en pause » et refuse les commandes ; reprise automatique.
- Ajouter une fermeture exceptionnelle demain : le site l'annonce.
- Un compte `manager` ne voit ni Réglages > E-mails ni Comptes ; un compte `cuisine` n'accède pas au back-office.

## 8. Hors périmètre de cette étape
Statistiques avancées, paiement en ligne (Stripe), SMS, menus composés multi-étapes, programme de fidélité, multi-restaurants dans une même interface (le schéma le permet, l'interface viendra après).

## 9. Points ouverts (à demander à Alaeddine, ne pas inventer)
Les 9 décisions sur la carte Food Station sont listées dans le projet Claude « onyx » (`Onyx-Order-Demo-FoodStation.md`) : sauce des burgers, menus ou produits seuls, Savoyard, supplément Lassi, prix Biryani légumes, pièces Tex-Mex, sauces Fried Chicken, allergènes, crevettes. Le back-office doit permettre de les régler soi-même.

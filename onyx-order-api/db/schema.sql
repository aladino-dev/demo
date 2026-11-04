-- Onyx Order : schéma PostgreSQL (cahier des charges du 04/11/2026)
-- Toutes les tables portent restaurant_id. Prix en centimes (entier), figés dans les commandes.

CREATE TABLE IF NOT EXISTS restaurants (
  id            serial PRIMARY KEY,
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  legal_name    text,
  domain        text,
  address       text,
  postcode      text,
  city          text,
  phone         text,
  timezone      text NOT NULL DEFAULT 'Europe/Paris',
  currency      text NOT NULL DEFAULT 'EUR',
  smtp          jsonb,                       -- réglages SMTP (chiffrés côté API)
  modules       text[] NOT NULL DEFAULT '{carte,commande,cuisine,notifications,backoffice}',
  settings      jsonb NOT NULL DEFAULT '{}', -- modes, paiement, heure limite, anti-robot, mentions
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner','manager','cuisine')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, email)
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_index      int NOT NULL CHECK (day_index BETWEEN 0 AND 6), -- 0 = dimanche
  opens          time NOT NULL,
  closes         time NOT NULL,
  enabled        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS closures (            -- fermetures exceptionnelles
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date           date NOT NULL,
  reason         text
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id               serial PRIMARY KEY,
  restaurant_id    int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  postcodes        text[] NOT NULL DEFAULT '{}',
  cities           text[] NOT NULL DEFAULT '{}',  -- vide = toutes les villes du code postal
  fee_cents        int NOT NULL DEFAULT 0,
  min_order_cents  int NOT NULL DEFAULT 0,
  sort             int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  slug           text NOT NULL,
  sort           int NOT NULL DEFAULT 0,
  visible        boolean NOT NULL DEFAULT true,
  source_id      text
);

CREATE TABLE IF NOT EXISTS products (
  id              serial PRIMARY KEY,
  restaurant_id   int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id     int REFERENCES categories(id) ON DELETE SET NULL,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  price_cents     int NOT NULL CHECK (price_cents >= 0),
  photo           text,
  visible         boolean NOT NULL DEFAULT true,
  sold_out_until  timestamptz,                 -- « épuisé aujourd'hui »
  sort            int NOT NULL DEFAULT 0,
  source_id       text
);

CREATE TABLE IF NOT EXISTS option_groups (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  key            text NOT NULL,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  min_select     int NOT NULL DEFAULT 0,
  max_select     int,                          -- NULL = sans maximum
  required       boolean NOT NULL DEFAULT false,
  sort           int NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, key)
);

CREATE TABLE IF NOT EXISTS options (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  group_id       int NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  label          text NOT NULL,
  price_cents    int NOT NULL DEFAULT 0,
  sort           int NOT NULL DEFAULT 0,
  visible        boolean NOT NULL DEFAULT true
);

-- groupe rattaché à un produit OU à une catégorie ; un rattachement produit remplace ceux de la catégorie
CREATE TABLE IF NOT EXISTS option_group_links (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  group_id       int NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  product_id     int REFERENCES products(id) ON DELETE CASCADE,
  category_id    int REFERENCES categories(id) ON DELETE CASCADE,
  sort           int NOT NULL DEFAULT 0,
  CHECK ((product_id IS NULL) <> (category_id IS NULL))
);

CREATE TABLE IF NOT EXISTS allergens (
  id    serial PRIMARY KEY,
  code  text UNIQUE NOT NULL,
  name  text NOT NULL
);

CREATE TABLE IF NOT EXISTS product_allergens (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  allergen_id    int NOT NULL REFERENCES allergens(id),
  product_id     int REFERENCES products(id) ON DELETE CASCADE,
  option_id      int REFERENCES options(id) ON DELETE CASCADE,
  level          text NOT NULL DEFAULT 'presence' CHECK (level IN ('presence','traces'))
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id                  serial PRIMARY KEY,
  restaurant_id       int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('percent','amount')),
  value               int NOT NULL,            -- % ou centimes
  first_order_only    boolean NOT NULL DEFAULT false,
  per_customer_limit  int,
  valid_from          timestamptz,
  valid_until         timestamptz,
  active              boolean NOT NULL DEFAULT true,
  UNIQUE (restaurant_id, code)
);

CREATE TABLE IF NOT EXISTS orders (
  id               serial PRIMARY KEY,
  restaurant_id    int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  number           int NOT NULL,
  token            text NOT NULL UNIQUE,       -- lien de suivi client
  mode             text NOT NULL CHECK (mode IN ('pickup','delivery','dine_in')),
  status           text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','preparing','ready','delivering','done','cancelled')),
  customer_name    text NOT NULL,
  customer_phone   text NOT NULL,
  customer_email   text,
  address          text,
  postcode         text,
  city             text,
  zone_id          int REFERENCES delivery_zones(id),
  subtotal_cents   int NOT NULL,
  discount_cents   int NOT NULL DEFAULT 0,
  fee_cents        int NOT NULL DEFAULT 0,
  total_cents      int NOT NULL,
  promo_code       text,
  slot             text,
  note             text,
  ip               text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, number)
);

CREATE TABLE IF NOT EXISTS order_items (
  id               serial PRIMARY KEY,
  restaurant_id    int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id         int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       int REFERENCES products(id) ON DELETE SET NULL,
  name             text NOT NULL,              -- figé
  quantity         int NOT NULL CHECK (quantity > 0),
  unit_price_cents int NOT NULL,               -- figé (produit + options)
  note             text
);

CREATE TABLE IF NOT EXISTS order_item_options (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_item_id  int NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_title    text NOT NULL,
  label          text NOT NULL,
  price_cents    int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_events (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id       int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status         text NOT NULL,
  author         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_queue (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id       int REFERENCES orders(id) ON DELETE CASCADE,
  recipient      text NOT NULL,
  template       text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts       int NOT NULL DEFAULT 0,
  next_attempt   timestamptz NOT NULL DEFAULT now(),
  last_error     text
);

-- Back-office : archivage (rien ne se supprime), options épuisables, journal des modifications
ALTER TABLE categories    ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE products      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS internal_name text;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS sold_out_until timestamptz;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS photo text;

CREATE TABLE IF NOT EXISTS audit_log (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id        int,
  entity         text NOT NULL,
  entity_id      int,
  action         text NOT NULL,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_rest ON products(restaurant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_orders_rest_status ON orders(restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_links_rest ON option_group_links(restaurant_id);

INSERT INTO allergens (code, name) VALUES
 ('gluten','Gluten'),('crustaces','Crustacés'),('oeufs','Œufs'),('poissons','Poissons'),
 ('arachides','Arachides'),('soja','Soja'),('lait','Lait'),('fruits_coque','Fruits à coque'),
 ('celeri','Céleri'),('moutarde','Moutarde'),('sesame','Sésame'),('sulfites','Sulfites'),
 ('lupin','Lupin'),('mollusques','Mollusques')
ON CONFLICT (code) DO NOTHING;

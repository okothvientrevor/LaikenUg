-- Laiken Logistics schema. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS staff (
  email       text PRIMARY KEY,
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Only @laikenug.com addresses (plus vientrevor@gmail.com) may ever be staff.
DO $$ BEGIN
  ALTER TABLE staff ADD CONSTRAINT staff_email_domain
    CHECK (lower(email) LIKE '%@laikenug.com' OR lower(email) = 'vientrevor@gmail.com');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shipments (
  id               bigserial PRIMARY KEY,
  tracking_no      text NOT NULL UNIQUE,
  client_name      text NOT NULL,
  client_phone     text,
  client_email     text,
  mode             text NOT NULL CHECK (mode IN ('sea', 'air', 'road', 'rail')),
  origin           text NOT NULL,
  destination      text NOT NULL DEFAULT 'Kampala, Uganda',
  port             text,            -- Mombasa / Dar es Salaam / Entebbe (air)
  border           text,            -- Malaba / Busia / Mutukula / Elegu
  container_no     text,
  bl_awb_no        text,
  cargo_desc       text,
  packages         integer,
  weight_kg        numeric(12, 2),
  status           text NOT NULL DEFAULT 'booked' CHECK (status IN (
                     'booked', 'loaded_origin', 'at_sea', 'in_flight', 'arrived_port',
                     'customs_clearance', 'released', 'in_transit_road', 'at_border',
                     'arrived_kampala', 'delivered', 'on_hold')),
  current_location text,
  eta              date,
  free_days_end    date,            -- last free day before port storage / demurrage
  assigned_to      text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- House B/L (sea, issued by Laiken/BINTEC for consolidated cargo) or House AWB (air)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS house_bl_no text;

-- Tracking-number matching ignores case, spaces, dashes and other punctuation.
CREATE OR REPLACE FUNCTION lk_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g') $$;

-- container_no may hold several containers separated by commas, semicolons, slashes or new lines.
CREATE OR REPLACE FUNCTION lk_containers(t text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(array_agg(lk_norm(x)) FILTER (WHERE lk_norm(x) <> ''), '{}')
    FROM regexp_split_to_table(coalesce(t, ''), '[,;/\n]+') AS x
  $$;

CREATE INDEX IF NOT EXISTS shipments_status_idx  ON shipments (status);
CREATE INDEX IF NOT EXISTS shipments_updated_idx ON shipments (updated_at DESC);

CREATE TABLE IF NOT EXISTS shipment_events (
  id           bigserial PRIMARY KEY,
  shipment_id  bigint NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
  status       text NOT NULL,
  location     text,
  note         text,
  is_public    boolean NOT NULL DEFAULT true,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipment_events_shipment_idx ON shipment_events (shipment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS news_items (
  id            bigserial PRIMARY KEY,
  url           text NOT NULL UNIQUE,
  title         text NOT NULL,
  source        text,
  category      text NOT NULL DEFAULT 'trade',
  summary       text,
  image_url     text,
  published_at  timestamptz NOT NULL DEFAULT now(),
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

-- true once we've tried to find an image for the story (so we don't retry forever)
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS image_checked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS news_items_published_idx ON news_items (published_at DESC);
CREATE INDEX IF NOT EXISTS news_items_category_idx  ON news_items (category, published_at DESC);

CREATE TABLE IF NOT EXISTS quote_requests (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  phone       text NOT NULL,
  email       text,
  mode        text,
  origin      text,
  cargo       text,
  message     text,
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_meta (
  key    text PRIMARY KEY,
  value  text NOT NULL
);

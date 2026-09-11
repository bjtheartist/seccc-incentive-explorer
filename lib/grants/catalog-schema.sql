-- Source inventory. Imported completeness is not staff verification.
CREATE TABLE IF NOT EXISTS grants_active (
  id text PRIMARY KEY, source text NOT NULL, record_type text NOT NULL, chicago_relevance text NOT NULL,
  name text NOT NULL, sponsor text, level text, instrument text, status text NOT NULL, cadence text,
  opens_at date, closes_at date, closing_soon boolean NOT NULL DEFAULT false, days_to_close integer,
  amount_min bigint, amount_max bigint, amount_display text,
  entity_types text[] NOT NULL DEFAULT '{}', geography text, legitimacy text, cost_to_apply text, is_new boolean NOT NULL DEFAULT false,
  apply_url text, source_url text, verified_at date, tags text[] NOT NULL DEFAULT '{}', payload jsonb NOT NULL,
  match_readiness text NOT NULL DEFAULT 'needs_research', missing_fields text[] NOT NULL DEFAULT '{}', next_review_date date, staff_owner text, funding_source text, payment_timing text, required_contribution text, landlord_or_tenant text, operating_stage text, uses_eligible text[] NOT NULL DEFAULT '{}', uses_exclusions text[] NOT NULL DEFAULT '{}',
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(sponsor,'') || ' ' || coalesce(payload->'applicants'->>'summary','') || ' ' || coalesce(payload->'uses'->>'summary',''))) STORED,
  loaded_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS grants_active_status_idx ON grants_active (status);
CREATE INDEX IF NOT EXISTS grants_active_relevance_idx ON grants_active (chicago_relevance);
CREATE INDEX IF NOT EXISTS grants_active_closes_idx ON grants_active (closes_at);
CREATE INDEX IF NOT EXISTS grants_active_source_idx ON grants_active (source, record_type);
CREATE INDEX IF NOT EXISTS grants_active_tags_gin ON grants_active USING GIN (tags);
CREATE INDEX IF NOT EXISTS grants_active_entity_gin ON grants_active USING GIN (entity_types);
CREATE INDEX IF NOT EXISTS grants_active_search_gin ON grants_active USING GIN (search);
CREATE TABLE IF NOT EXISTS grants_active_loads (id serial PRIMARY KEY, as_of_date date NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now(), row_count integer NOT NULL, counts jsonb);
CREATE INDEX IF NOT EXISTS grants_active_uses_gin ON grants_active USING GIN(uses_eligible);

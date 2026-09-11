-- Additive, idempotent grants workspace migration. Existing users table is required.
CREATE TABLE IF NOT EXISTS grants_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS grants_activity (
  id BIGSERIAL PRIMARY KEY, resource TEXT NOT NULL, record_id TEXT NOT NULL,
  action TEXT NOT NULL, actor TEXT NOT NULL, before_data JSONB, after_data JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS grants_programs (
  id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_programs_url ON grants_programs ((data->>'sourceUrl'));
CREATE TABLE IF NOT EXISTS grants_rounds (
  id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  program_id TEXT GENERATED ALWAYS AS (data->>'programId') STORED REFERENCES grants_programs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_rounds_program ON grants_rounds(program_id);
CREATE UNIQUE INDEX IF NOT EXISTS grants_rounds_name ON grants_rounds(program_id, lower(data->>'name'));
CREATE TABLE IF NOT EXISTS grants_applicants (
  id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grants_sources (
  id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  program_id TEXT GENERATED ALWAYS AS (data->>'programId') STORED REFERENCES grants_programs(id),
  checked_at TIMESTAMPTZ, next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status TEXT NOT NULL DEFAULT 'never', last_error TEXT, last_hash TEXT,
  lease_until TIMESTAMPTZ, lease_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_sources_url ON grants_sources((data->>'url'));
CREATE INDEX IF NOT EXISTS grants_sources_due ON grants_sources(next_scan_at);
CREATE TABLE IF NOT EXISTS grants_matches (
  id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  applicant_id TEXT GENERATED ALWAYS AS (data->>'applicantId') STORED REFERENCES grants_applicants(id),
  round_id TEXT GENERATED ALWAYS AS (data->>'roundId') STORED REFERENCES grants_rounds(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL,
  UNIQUE(applicant_id, round_id)
);
CREATE TABLE IF NOT EXISTS grants_snapshots (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES grants_sources(id),
  url TEXT NOT NULL, content_hash TEXT NOT NULL, content TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grants_snapshots_source ON grants_snapshots(source_id, fetched_at DESC);
CREATE TABLE IF NOT EXISTS grants_findings (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES grants_sources(id),
  url TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('discovered','changed')),
  excerpt TEXT NOT NULL, previous_excerpt TEXT,
  snapshot_id TEXT NOT NULL REFERENCES grants_snapshots(id),
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dismissed','converted')),
  reviewed_by TEXT, reviewed_at TIMESTAMPTZ, program_id TEXT REFERENCES grants_programs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grants_findings_state ON grants_findings(state, created_at DESC);
CREATE OR REPLACE FUNCTION grants_audit_record() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO grants_activity(resource,record_id,action,actor,before_data,after_data)
  VALUES(TG_TABLE_NAME,NEW.id,TG_OP,NEW.updated_by,CASE WHEN TG_OP='UPDATE' THEN OLD.data ELSE NULL END,NEW.data);
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION grants_invalidate_matches() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE grants_matches SET data=jsonb_set(data,'{status}','"needs_information"'),version=version+1,updated_at=now(),updated_by=NEW.updated_by
  WHERE data->>'status' NOT IN ('archived','not_eligible') AND (
    (TG_TABLE_NAME='grants_rounds' AND round_id=NEW.id) OR
    (TG_TABLE_NAME='grants_applicants' AND applicant_id=NEW.id) OR
    (TG_TABLE_NAME='grants_programs' AND round_id IN (SELECT id FROM grants_rounds WHERE program_id=NEW.id))
  );
  RETURN NEW;
END; $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['grants_programs','grants_rounds','grants_applicants'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=t||'_invalidate_matches') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OF data ON %I FOR EACH ROW EXECUTE FUNCTION grants_invalidate_matches()',t||'_invalidate_matches',t);
    END IF;
  END LOOP;
END; $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['grants_programs','grants_rounds','grants_applicants','grants_sources','grants_matches'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=t||'_audit') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OF data ON %I FOR EACH ROW EXECUTE FUNCTION grants_audit_record()',t||'_audit',t);
    END IF;
  END LOOP;
END; $$;

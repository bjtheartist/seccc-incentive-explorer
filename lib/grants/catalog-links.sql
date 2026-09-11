CREATE UNIQUE INDEX IF NOT EXISTS grants_rounds_catalog_id ON grants_rounds((data->>'catalogId')) WHERE data->>'catalogId' IS NOT NULL;
CREATE OR REPLACE FUNCTION grants_catalog_invalidate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload THEN
    UPDATE grants_rounds SET data=jsonb_set(data,'{review}','"unverified"'), version=version+1, updated_at=now(), updated_by='catalog-import'
    WHERE data->>'catalogId'=NEW.id AND data->>'review'<>'archived';
  END IF;
  RETURN NEW;
END; $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='grants_catalog_changed') THEN
    CREATE TRIGGER grants_catalog_changed AFTER UPDATE OF payload ON grants_active FOR EACH ROW EXECUTE FUNCTION grants_catalog_invalidate();
  END IF;
END; $$;

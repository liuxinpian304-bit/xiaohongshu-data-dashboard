CREATE OR REPLACE FUNCTION normalize_legacy_observation_source()
RETURNS trigger AS $$
BEGIN
  IF NEW."source" = 'legacy' AND NEW."connectorType" IN ('self-scrape', 'official', 'mock', 'xiaohuohua', 'self-import') THEN
    NEW."source" := NEW."connectorType";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Account_normalize_legacy_observation_source"
BEFORE INSERT OR UPDATE OF "connectorType", "source" ON "Account"
FOR EACH ROW EXECUTE FUNCTION normalize_legacy_observation_source();

CREATE TRIGGER "Note_normalize_legacy_observation_source"
BEFORE INSERT OR UPDATE OF "connectorType", "source" ON "Note"
FOR EACH ROW EXECUTE FUNCTION normalize_legacy_observation_source();

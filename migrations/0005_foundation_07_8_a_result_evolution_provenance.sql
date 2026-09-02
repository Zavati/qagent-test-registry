-- QAgent 07.8-A — Result Feedback & Test Evolution
-- Additive provenance/idempotency metadata for immutable derived versions.
ALTER TABLE test_design_versions ADD COLUMN derivation_key TEXT;
ALTER TABLE test_design_versions ADD COLUMN version_origin_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_design_versions_derivation_key
ON test_design_versions (derivation_key) WHERE derivation_key IS NOT NULL;

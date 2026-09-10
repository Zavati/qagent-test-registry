-- Additive, immutable-version projections. Existing suites remain legacy (empty origins).
ALTER TABLE test_design_execution_inventory ADD COLUMN scenario_origins_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE test_suite_version_items ADD COLUMN scenario_origins_json TEXT NOT NULL DEFAULT '[]';

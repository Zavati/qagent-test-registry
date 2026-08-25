-- QAgent Foundation 07.7.10-B
-- Normalized immutable Suite execution items for bounded/paginated orchestration.

CREATE TABLE IF NOT EXISTS test_suite_version_items (
  suite_version_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL,
  test_design_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  test_design_version INTEGER NOT NULL,
  scenario_count INTEGER NOT NULL,
  scenario_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (suite_version_id, ordinal),
  UNIQUE (suite_version_id, endpoint_id),
  FOREIGN KEY (suite_version_id) REFERENCES test_suite_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_test_suite_version_items_scope
  ON test_suite_version_items (organization_id, project_id, suite_version_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_test_suite_version_items_tdv
  ON test_suite_version_items (test_design_version_id);

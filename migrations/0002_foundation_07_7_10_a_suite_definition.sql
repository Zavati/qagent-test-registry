CREATE TABLE IF NOT EXISTS test_suites (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    suite_type TEXT NOT NULL CHECK (suite_type IN ('AUTO_PROJECT_READY', 'USER_DEFINED')),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    latest_version INTEGER NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
    latest_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_suite_versions (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    source_type TEXT NOT NULL CHECK (source_type IN ('ZERO_CONFIG_PROJECT_READY', 'USER_DEFINED')),
    selection_policy TEXT NOT NULL,
    selection_policy_version TEXT NOT NULL,
    inventory_fingerprint TEXT NOT NULL,
    test_design_count INTEGER NOT NULL DEFAULT 0 CHECK (test_design_count >= 0),
    endpoint_count INTEGER NOT NULL DEFAULT 0 CHECK (endpoint_count >= 0),
    scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (scenario_count >= 0),
    selection_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (suite_id) REFERENCES test_suites(id),
    UNIQUE (suite_id, version),
    UNIQUE (suite_id, inventory_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_test_suites_project_type
ON test_suites (organization_id, project_id, suite_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_test_suites_auto_project_ready
ON test_suites (organization_id, project_id)
WHERE suite_type = 'AUTO_PROJECT_READY';

CREATE INDEX IF NOT EXISTS idx_test_suite_versions_suite_version
ON test_suite_versions (suite_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_test_suite_versions_project
ON test_suite_versions (organization_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS test_designs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'ACTIVE',

    latest_version INTEGER NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
    latest_version_id TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    UNIQUE (organization_id, project_id, endpoint_id)
);

CREATE TABLE IF NOT EXISTS test_design_versions (
    id TEXT PRIMARY KEY,
    test_design_id TEXT NOT NULL,

    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,

    version INTEGER NOT NULL CHECK (version >= 1),
    generation_request_id TEXT NOT NULL,

    context_fingerprint TEXT NOT NULL,

    contract_version TEXT NOT NULL,
    specification_version TEXT NOT NULL,

    provider TEXT,
    model TEXT,
    prompt_version TEXT,
    repair_prompt_version TEXT,
    guard_version TEXT,

    scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (scenario_count >= 0),
    ready_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
    review_required_count INTEGER NOT NULL DEFAULT 0 CHECK (review_required_count >= 0),

    specification_json TEXT NOT NULL,

    generation_metadata_json TEXT,
    safe_diagnostics_json TEXT,

    created_at TEXT NOT NULL,

    FOREIGN KEY (test_design_id)
        REFERENCES test_designs(id),

    UNIQUE (test_design_id, version),
    UNIQUE (generation_request_id)
);

CREATE INDEX IF NOT EXISTS idx_test_designs_tenant_project_endpoint
ON test_designs (
    organization_id,
    project_id,
    endpoint_id
);

CREATE INDEX IF NOT EXISTS idx_test_design_versions_design_version
ON test_design_versions (
    test_design_id,
    version DESC
);

CREATE INDEX IF NOT EXISTS idx_test_design_versions_context
ON test_design_versions (
    organization_id,
    project_id,
    endpoint_id,
    context_fingerprint
);

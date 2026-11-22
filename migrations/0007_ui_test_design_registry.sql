-- UI-TD-2: additive UI domain in the existing Registry. API tables are unchanged.
CREATE TABLE IF NOT EXISTS ui_test_designs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    latest_version INTEGER NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
    latest_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (organization_id, project_id, environment_id, capture_id)
);

CREATE TABLE IF NOT EXISTS ui_test_design_versions (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    test_design_id TEXT NOT NULL REFERENCES ui_test_designs(id),
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    bundle_version_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    compilation_hash TEXT NOT NULL CHECK (length(compilation_hash) = 64),
    compiler_version TEXT NOT NULL,
    source_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    compilation_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (test_design_id, version),
    UNIQUE (test_design_id, content_hash)
);

-- Every admitted publication retains its own provenance, including reuse of content.
CREATE TABLE IF NOT EXISTS ui_test_design_operations (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    generation_request_id TEXT NOT NULL,
    test_design_version_id TEXT NOT NULL REFERENCES ui_test_design_versions(id),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    compilation_hash TEXT NOT NULL CHECK (length(compilation_hash) = 64),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    created_by TEXT,
    created_by_account_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, project_id, environment_id, generation_request_id)
);

CREATE INDEX IF NOT EXISTS idx_ui_test_design_versions_scope_sequence
ON ui_test_design_versions (organization_id, project_id, environment_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_ui_test_design_operations_version
ON ui_test_design_operations (test_design_version_id);

CREATE TRIGGER IF NOT EXISTS ui_test_design_versions_no_update
BEFORE UPDATE ON ui_test_design_versions BEGIN
    SELECT RAISE(ABORT, 'UI_TEST_DESIGN_VERSION_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS ui_test_design_versions_no_delete
BEFORE DELETE ON ui_test_design_versions BEGIN
    SELECT RAISE(ABORT, 'UI_TEST_DESIGN_VERSION_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS ui_test_design_operations_no_update
BEFORE UPDATE ON ui_test_design_operations BEGIN
    SELECT RAISE(ABORT, 'UI_TEST_DESIGN_OPERATION_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS ui_test_design_operations_no_delete
BEFORE DELETE ON ui_test_design_operations BEGIN
    SELECT RAISE(ABORT, 'UI_TEST_DESIGN_OPERATION_IMMUTABLE');
END;

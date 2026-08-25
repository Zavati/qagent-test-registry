-- Foundation 07.7.10-A FIX-1
-- Immutable execution-eligibility projection for hot-path Project Test Inventory reads.
-- Historical Test Design versions are backfilled lazily by the service only when they become latest.

CREATE TABLE IF NOT EXISTS test_design_execution_inventory (
    test_design_version_id TEXT PRIMARY KEY,
    test_design_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    test_design_version INTEGER NOT NULL CHECK (test_design_version >= 1),

    title TEXT,
    target_method TEXT,
    target_path TEXT,
    api_service_key TEXT,

    scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (scenario_count >= 0),
    ready_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_scenario_count >= 0),
    review_required_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (review_required_scenario_count >= 0),
    needs_data_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (needs_data_scenario_count >= 0),
    needs_auth_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (needs_auth_scenario_count >= 0),
    blocked_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_scenario_count >= 0),

    execution_eligible_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (execution_eligible_scenario_count >= 0),
    policy_blocked_ready_scenario_count INTEGER NOT NULL DEFAULT 0 CHECK (policy_blocked_ready_scenario_count >= 0),

    ready_scenario_ids_json TEXT NOT NULL,
    execution_eligible_scenario_ids_json TEXT NOT NULL,
    policy_blocked_ready_scenario_ids_json TEXT NOT NULL,
    policy_blocked_reason_counts_json TEXT NOT NULL,
    eligibility_policy_version TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY (test_design_version_id) REFERENCES test_design_versions(id),
    FOREIGN KEY (test_design_id) REFERENCES test_designs(id)
);

CREATE INDEX IF NOT EXISTS idx_td_execution_inventory_project_endpoint
ON test_design_execution_inventory (organization_id, project_id, endpoint_id);

CREATE INDEX IF NOT EXISTS idx_td_execution_inventory_project_eligible
ON test_design_execution_inventory (
    organization_id,
    project_id,
    execution_eligible_scenario_count,
    endpoint_id
);

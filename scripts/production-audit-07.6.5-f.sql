-- QAgent Foundation 07.6.5-F — Production D1 invariant audit
-- Expected result for every SELECT below: zero rows (unless explicitly noted).

-- 1) One logical root per Organization + Project + Endpoint.
SELECT organization_id, project_id, endpoint_id, COUNT(*) AS duplicate_roots
FROM test_designs
GROUP BY organization_id, project_id, endpoint_id
HAVING COUNT(*) > 1;

-- 2) Version numbers are unique inside each Test Design.
SELECT test_design_id, version, COUNT(*) AS duplicate_versions
FROM test_design_versions
GROUP BY test_design_id, version
HAVING COUNT(*) > 1;

-- 3) generationRequestId is globally idempotent.
SELECT generation_request_id, COUNT(*) AS duplicate_generation_requests
FROM test_design_versions
GROUP BY generation_request_id
HAVING COUNT(*) > 1;

-- 4) Version scope must match its logical root scope.
SELECT
  v.id AS test_design_version_id,
  v.test_design_id,
  v.organization_id AS version_org,
  d.organization_id AS root_org,
  v.project_id AS version_project,
  d.project_id AS root_project,
  v.endpoint_id AS version_endpoint,
  d.endpoint_id AS root_endpoint
FROM test_design_versions v
JOIN test_designs d ON d.id = v.test_design_id
WHERE v.organization_id <> d.organization_id
   OR v.project_id <> d.project_id
   OR v.endpoint_id <> d.endpoint_id;

-- 5) latest_version/latest_version_id must point to the greatest immutable version.
SELECT
  d.id AS test_design_id,
  d.latest_version,
  d.latest_version_id,
  COALESCE(MAX(v.version), 0) AS expected_latest_version,
  COALESCE((
    SELECT v2.id
    FROM test_design_versions v2
    WHERE v2.test_design_id = d.id
    ORDER BY v2.version DESC
    LIMIT 1
  ), '') AS expected_latest_version_id
FROM test_designs d
LEFT JOIN test_design_versions v ON v.test_design_id = d.id
GROUP BY d.id
HAVING d.latest_version <> COALESCE(MAX(v.version), 0)
    OR COALESCE(d.latest_version_id, '') <> COALESCE((
      SELECT v3.id
      FROM test_design_versions v3
      WHERE v3.test_design_id = d.id
      ORDER BY v3.version DESC
      LIMIT 1
    ), '');

-- 6) Persisted contracts must remain frozen on v1 during Foundation 07.6.5.
SELECT id, contract_version, specification_version
FROM test_design_versions
WHERE contract_version <> 'qagent.test-design.v1'
   OR specification_version <> 'qagent.test-spec.v1';

-- 7) safe_diagnostics_json is reserved and must remain NULL in this Foundation.
SELECT id, test_design_id, version
FROM test_design_versions
WHERE safe_diagnostics_json IS NOT NULL;

-- 8) SQLite/D1 foreign-key integrity. Expected: zero rows.
PRAGMA foreign_key_check;

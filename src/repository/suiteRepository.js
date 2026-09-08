import { TestRegistryError } from "../domain/errors.js";
import { buildStableAutoProjectSuiteId, createTestSuiteVersionId } from "../domain/ids.js";
import {
  buildTestDesignExecutionProjection,
  projectionInsertStatement,
} from "../domain/executionEligibility.js";
import {
  AUTO_SUITE_SELECTION_POLICY,
  AUTO_SUITE_SELECTION_POLICY_VERSION,
  AUTO_SUITE_SOURCE_TYPE,
  AUTO_SUITE_TYPE,
  PROJECT_TEST_INVENTORY_CONTRACT_VERSION,
  SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION,
  SUITE_EXECUTION_SLICE_CONTRACT_VERSION,
  TEST_SUITE_CONTRACT_VERSION,
  TEST_SUITE_VERSION_CONTRACT_VERSION,
} from "../domain/suiteContracts.js";

const encoder = new TextEncoder();
const PROJECTION_BACKFILL_BATCH_SIZE = 50;
const SUITE_ITEM_BACKFILL_BATCH_SIZE = 50;
const EVOLUTION_AWARE_SNAPSHOT_CONTRACT_VERSION = "qagent.evolution-aware-regression-snapshot.v1";
const SNAPSHOT_CHANGE_LIMIT = 25;

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function parseJson(value, { code = "TEST_REGISTRY_CORRUPT_ARTIFACT", details = null, fallback = null } = {}) {
  if (value == null && fallback !== null) return fallback;
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new TestRegistryError("Persisted registry JSON is invalid.", {
      code,
      status: 500,
      retryable: false,
      details,
      cause,
    });
  }
}

function mapSuite(row) {
  if (!row) return null;
  return {
    suiteId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    suiteType: row.suite_type,
    name: row.name,
    description: row.description,
    status: row.status,
    latestVersion: row.latest_version,
    latestVersionId: row.latest_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSuiteVersion(row, { includeSelection = true } = {}) {
  if (!row) return null;
  return {
    contractVersion: TEST_SUITE_VERSION_CONTRACT_VERSION,
    suiteVersionId: row.id,
    suiteId: row.suite_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    version: row.version,
    sourceType: row.source_type,
    selectionPolicy: row.selection_policy,
    selectionPolicyVersion: row.selection_policy_version,
    inventoryFingerprint: row.inventory_fingerprint,
    testDesignCount: row.test_design_count,
    endpointCount: row.endpoint_count,
    scenarioCount: row.scenario_count,
    selectionIncluded: includeSelection,
    selection: includeSelection
      ? parseJson(row.selection_json, { details: { field: "selection_json", suiteVersionId: row.id } })
      : [],
    createdAt: row.created_at,
  };
}

function mapProjection(row, { includeAuxScenarioIds = true } = {}) {
  if (!row) return null;
  return {
    endpointId: row.endpoint_id,
    testDesignId: row.test_design_id,
    testDesignVersionId: row.test_design_version_id,
    testDesignVersion: row.test_design_version,
    title: row.title,
    method: row.target_method,
    path: row.target_path,
    apiServiceKey: row.api_service_key,
    scenarioCount: row.scenario_count,
    readyScenarioCount: row.ready_scenario_count,
    reviewRequiredScenarioCount: row.review_required_scenario_count,
    needsDataScenarioCount: row.needs_data_scenario_count,
    needsAuthScenarioCount: row.needs_auth_scenario_count,
    blockedScenarioCount: row.blocked_scenario_count,
    executionEligibleScenarioCount: row.execution_eligible_scenario_count,
    policyBlockedReadyScenarioCount: row.policy_blocked_ready_scenario_count,
    readyScenarioIds: includeAuxScenarioIds ? parseJson(row.ready_scenario_ids_json, {
      details: { field: "ready_scenario_ids_json", testDesignVersionId: row.test_design_version_id }, fallback: [],
    }) : [],
    executionEligibleScenarioIds: parseJson(row.execution_eligible_scenario_ids_json, {
      details: { field: "execution_eligible_scenario_ids_json", testDesignVersionId: row.test_design_version_id }, fallback: [],
    }),
    policyBlockedReadyScenarioIds: includeAuxScenarioIds ? parseJson(row.policy_blocked_ready_scenario_ids_json, {
      details: { field: "policy_blocked_ready_scenario_ids_json", testDesignVersionId: row.test_design_version_id }, fallback: [],
    }) : [],
    policyBlockedReasonCounts: parseJson(row.policy_blocked_reason_counts_json, {
      details: { field: "policy_blocked_reason_counts_json", testDesignVersionId: row.test_design_version_id }, fallback: {},
    }),
    eligibilityPolicyVersion: row.eligibility_policy_version,
    createdAt: row.created_at,
  };
}

function projectionAsDbRow(projection) {
  return {
    test_design_version_id: projection.testDesignVersionId,
    test_design_id: projection.testDesignId,
    organization_id: projection.organizationId,
    project_id: projection.projectId,
    endpoint_id: projection.endpointId,
    test_design_version: projection.testDesignVersion,
    title: projection.title,
    target_method: projection.method,
    target_path: projection.path,
    api_service_key: projection.apiServiceKey,
    scenario_count: projection.scenarioCount,
    ready_scenario_count: projection.readyScenarioCount,
    review_required_scenario_count: projection.reviewRequiredScenarioCount,
    needs_data_scenario_count: projection.needsDataScenarioCount,
    needs_auth_scenario_count: projection.needsAuthScenarioCount,
    blocked_scenario_count: projection.blockedScenarioCount,
    execution_eligible_scenario_count: projection.executionEligibleScenarioCount,
    policy_blocked_ready_scenario_count: projection.policyBlockedReadyScenarioCount,
    ready_scenario_ids_json: JSON.stringify(projection.readyScenarioIds),
    execution_eligible_scenario_ids_json: JSON.stringify(projection.executionEligibleScenarioIds),
    policy_blocked_ready_scenario_ids_json: JSON.stringify(projection.policyBlockedReadyScenarioIds),
    policy_blocked_reason_counts_json: JSON.stringify(projection.policyBlockedReasonCounts),
    eligibility_policy_version: projection.eligibilityPolicyVersion,
    created_at: projection.createdAt,
  };
}

function isUniqueConstraintError(error) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(String(error?.message || error || ""));
}

function parseVersionOrigin(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function emptySnapshot({ state, suiteInventoryFingerprint = null, currentInventoryFingerprint = null, reason = null } = {}) {
  return {
    contractVersion: EVOLUTION_AWARE_SNAPSHOT_CONTRACT_VERSION,
    state,
    outdatedReason: reason,
    suiteInventoryFingerprint,
    currentInventoryFingerprint,
    changedTestDesignCount: 0,
    evolvedTestDesignCount: 0,
    versionChangedTestDesignCount: 0,
    addedTestDesignCount: 0,
    removedTestDesignCount: 0,
    noLongerReadyTestDesignCount: 0,
    changesIncluded: true,
    changesTruncated: false,
    changes: [],
  };
}

function aggregateReasonCounts(target, source) {
  for (const [reason, count] of Object.entries(source || {})) {
    target[reason] = (target[reason] || 0) + Number(count || 0);
  }
}

export function compactProjectInventory(inventory, { itemLimit = 50 } = {}) {
  const limit = Math.max(1, Math.min(Number(itemLimit) || 50, 200));
  const items = inventory.items.slice(0, limit).map((item) => ({
    ...item,
    readyScenarioIds: [],
    executionEligibleScenarioIds: [],
    policyBlockedReadyScenarioIds: [],
    scenarioIdsIncluded: false,
  }));
  return {
    ...inventory,
    items,
    itemsTotal: inventory.items.length,
    itemsReturned: items.length,
    itemsTruncated: inventory.items.length > items.length,
    selectionIncluded: false,
    selection: [],
  };
}

export function compactAutoSuiteResult(result, { itemLimit = 50 } = {}) {
  const version = result?.version ? { ...result.version, selectionIncluded: false, selection: [] } : result?.version;
  const inventory = result?.inventory ? compactProjectInventory(result.inventory, { itemLimit }) : result?.inventory;
  return { ...result, version, inventory };
}

export function createSuiteRepository(db, {
  now = () => new Date(),
  suiteVersionIdFactory = createTestSuiteVersionId,
  maxVersionRetries = 3,
} = {}) {
  if (!db?.prepare || !db?.batch) {
    throw new TestRegistryError("TEST_REGISTRY_DB binding is unavailable.", {
      code: "TEST_REGISTRY_DB_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  }

  async function loadLatestProjectionRows({ organizationId, projectId, compact = false }) {
    const auxScenarioColumns = compact ? "" : `,
        p.ready_scenario_ids_json,
        p.policy_blocked_ready_scenario_ids_json`;
    const response = await db.prepare(`
      SELECT
        d.id AS root_test_design_id,
        d.endpoint_id AS root_endpoint_id,
        d.latest_version,
        d.latest_version_id,
        p.test_design_version_id,
        p.test_design_id,
        p.organization_id,
        p.project_id,
        p.endpoint_id,
        p.test_design_version,
        p.title,
        p.target_method,
        p.target_path,
        p.api_service_key,
        p.scenario_count,
        p.ready_scenario_count,
        p.review_required_scenario_count,
        p.needs_data_scenario_count,
        p.needs_auth_scenario_count,
        p.blocked_scenario_count,
        p.execution_eligible_scenario_count,
        p.policy_blocked_ready_scenario_count,
        p.execution_eligible_scenario_ids_json,
        p.policy_blocked_reason_counts_json${auxScenarioColumns},
        p.eligibility_policy_version,
        p.created_at
      FROM test_designs d
      LEFT JOIN test_design_execution_inventory p
        ON p.test_design_version_id = d.latest_version_id
      WHERE d.organization_id = ? AND d.project_id = ?
        AND d.status = 'ACTIVE' AND d.latest_version > 0
      ORDER BY d.endpoint_id ASC
    `).bind(organizationId, projectId).all();
    return response?.results || [];
  }

  async function backfillMissingLatestProjections({ organizationId, projectId }) {
    const response = await db.prepare(`
      SELECT v.id, v.test_design_id, v.organization_id, v.project_id, v.endpoint_id,
             v.version, v.specification_json, v.created_at
      FROM test_designs d
      JOIN test_design_versions v ON v.id = d.latest_version_id
      LEFT JOIN test_design_execution_inventory p ON p.test_design_version_id = v.id
      WHERE d.organization_id = ? AND d.project_id = ?
        AND d.status = 'ACTIVE' AND d.latest_version > 0
        AND p.test_design_version_id IS NULL
      ORDER BY d.endpoint_id ASC
    `).bind(organizationId, projectId).all();

    const rows = response?.results || [];
    if (rows.length === 0) return new Map();

    const projections = rows.map((row) => buildTestDesignExecutionProjection({
      specificationJson: row.specification_json,
      testDesignVersionId: row.id,
      testDesignId: row.test_design_id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      endpointId: row.endpoint_id,
      testDesignVersion: row.version,
      createdAt: row.created_at,
    }));

    for (let offset = 0; offset < projections.length; offset += PROJECTION_BACKFILL_BATCH_SIZE) {
      const chunk = projections.slice(offset, offset + PROJECTION_BACKFILL_BATCH_SIZE);
      await db.batch(chunk.map((projection) => projectionInsertStatement(db, projection)));
    }

    return new Map(projections.map((projection) => [projection.testDesignVersionId, mapProjection(projectionAsDbRow(projection))]));
  }

  async function buildProjectInventory({ organizationId, projectId, compact = false }) {
    let projectionRows = await loadLatestProjectionRows({ organizationId, projectId, compact });
    let backfilled = new Map();
    if (projectionRows.some((row) => !row.test_design_version_id)) {
      backfilled = await backfillMissingLatestProjections({ organizationId, projectId });
    }

    const items = projectionRows.map((row) => {
      if (row.test_design_version_id) return mapProjection(row, { includeAuxScenarioIds: !compact });
      const projected = backfilled.get(row.latest_version_id);
      if (!projected) {
        throw new TestRegistryError("Latest Test Design execution projection could not be materialized.", {
          code: "TEST_REGISTRY_EXECUTION_PROJECTION_MISSING",
          status: 500,
          retryable: true,
          details: { testDesignVersionId: row.latest_version_id },
        });
      }
      return projected;
    });

    const readyItems = items.filter((item) => item.readyScenarioCount > 0);
    const executableItems = items.filter((item) => item.executionEligibleScenarioCount > 0);
    // Foundation 07.7.10-B FIX-2: Suite definition expresses immutable test intent.
    // Environment-specific execution eligibility belongs to Gateway/Run Control Plane.
    const selection = readyItems.map((item) => ({
      endpointId: item.endpointId,
      testDesignId: item.testDesignId,
      testDesignVersionId: item.testDesignVersionId,
      testDesignVersion: item.testDesignVersion,
      scenarioIds: [...item.readyScenarioIds],
    }));
    // Fingerprint stays compact and deterministic even when view=compact omits scenario IDs.
    // tdv_* is immutable, so (tdv + ready count) uniquely pins the READY selection for that version.
    const fingerprintSelection = readyItems.map((item) => ({
      endpointId: item.endpointId,
      testDesignVersionId: item.testDesignVersionId,
      readyScenarioCount: item.readyScenarioCount,
    }));
    const inventoryFingerprint = await sha256Hex(JSON.stringify({
      selectionPolicyVersion: AUTO_SUITE_SELECTION_POLICY_VERSION,
      selection: fingerprintSelection,
    }));

    const totals = items.reduce((acc, item) => {
      acc.scenarioCount += item.scenarioCount;
      acc.readyScenarioCount += item.readyScenarioCount;
      acc.reviewRequiredScenarioCount += item.reviewRequiredScenarioCount;
      acc.needsDataScenarioCount += item.needsDataScenarioCount;
      acc.needsAuthScenarioCount += item.needsAuthScenarioCount;
      acc.blockedScenarioCount += item.blockedScenarioCount;
      acc.executionEligibleScenarioCount += item.executionEligibleScenarioCount;
      acc.policyBlockedReadyScenarioCount += item.policyBlockedReadyScenarioCount;
      aggregateReasonCounts(acc.policyBlockedReasonCounts, item.policyBlockedReasonCounts);
      return acc;
    }, {
      scenarioCount: 0,
      readyScenarioCount: 0,
      reviewRequiredScenarioCount: 0,
      needsDataScenarioCount: 0,
      needsAuthScenarioCount: 0,
      blockedScenarioCount: 0,
      executionEligibleScenarioCount: 0,
      policyBlockedReadyScenarioCount: 0,
      policyBlockedReasonCounts: {},
    });

    return {
      contractVersion: PROJECT_TEST_INVENTORY_CONTRACT_VERSION,
      organizationId,
      projectId,
      inventoryFingerprint,
      eligibilityPolicyVersion: SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION,
      selectionPolicyVersion: AUTO_SUITE_SELECTION_POLICY_VERSION,
      testDesignCount: items.length,
      endpointWithReadyCount: readyItems.length,
      endpointWithExecutionEligibleCount: executableItems.length,
      ...totals,
      executable: totals.readyScenarioCount > 0,
      readyAvailable: totals.readyScenarioCount > 0,
      items,
      itemsTotal: items.length,
      itemsReturned: items.length,
      itemsTruncated: false,
      selectionIncluded: true,
      selection,
      projection: {
        mode: "IMMUTABLE_TEST_DESIGN_EXECUTION_PROJECTION",
        lazyBackfilledCount: backfilled.size,
      },
      computedAt: now().toISOString(),
    };
  }

  async function getAutoSuiteRoot({ organizationId, projectId }) {
    const row = await db.prepare(`
      SELECT id, organization_id, project_id, suite_type, name, description, status,
             latest_version, latest_version_id, created_at, updated_at
      FROM test_suites
      WHERE organization_id = ? AND project_id = ? AND suite_type = ?
      LIMIT 1
    `).bind(organizationId, projectId, AUTO_SUITE_TYPE).first();
    return mapSuite(row);
  }

  async function getVersionById({ organizationId, projectId, suiteVersionId, includeSelection = true }) {
    const selectionColumn = includeSelection ? ", selection_json" : "";
    const row = await db.prepare(`
      SELECT id, suite_id, organization_id, project_id, version, source_type,
             selection_policy, selection_policy_version, inventory_fingerprint,
             test_design_count, endpoint_count, scenario_count, created_at${selectionColumn}
      FROM test_suite_versions
      WHERE id = ? AND organization_id = ? AND project_id = ?
      LIMIT 1
    `).bind(suiteVersionId, organizationId, projectId).first();
    return mapSuiteVersion(row, { includeSelection });
  }

  async function getLatestAutoSuite({ organizationId, projectId, includeSelection = true }) {
    const selectionColumn = includeSelection ? ", v.selection_json AS version_selection_json" : "";
    const row = await db.prepare(`
      SELECT
        s.id AS suite_id_value, s.organization_id AS suite_organization_id,
        s.project_id AS suite_project_id, s.suite_type, s.name, s.description,
        s.status, s.latest_version, s.latest_version_id, s.created_at AS suite_created_at,
        s.updated_at AS suite_updated_at,
        v.id AS version_id, v.suite_id AS version_suite_id,
        v.organization_id AS version_organization_id, v.project_id AS version_project_id,
        v.version AS version_number, v.source_type, v.selection_policy,
        v.selection_policy_version, v.inventory_fingerprint, v.test_design_count,
        v.endpoint_count, v.scenario_count, v.created_at AS version_created_at${selectionColumn}
      FROM test_suites s
      LEFT JOIN test_suite_versions v ON v.id = s.latest_version_id
      WHERE s.organization_id = ? AND s.project_id = ? AND s.suite_type = ?
      LIMIT 1
    `).bind(organizationId, projectId, AUTO_SUITE_TYPE).first();

    if (!row) return { exists: false, suite: null, version: null };
    const suite = mapSuite({
      id: row.suite_id_value,
      organization_id: row.suite_organization_id,
      project_id: row.suite_project_id,
      suite_type: row.suite_type,
      name: row.name,
      description: row.description,
      status: row.status,
      latest_version: row.latest_version,
      latest_version_id: row.latest_version_id,
      created_at: row.suite_created_at,
      updated_at: row.suite_updated_at,
    });

    if (!suite.latestVersionId || suite.latestVersion < 1) return { exists: false, suite, version: null };
    if (!row.version_id) {
      throw new TestRegistryError("Latest Test Suite pointer is inconsistent.", {
        code: "TEST_SUITE_LATEST_POINTER_INVALID",
        status: 500,
        retryable: false,
      });
    }
    const version = mapSuiteVersion({
      id: row.version_id,
      suite_id: row.version_suite_id,
      organization_id: row.version_organization_id,
      project_id: row.version_project_id,
      version: row.version_number,
      source_type: row.source_type,
      selection_policy: row.selection_policy,
      selection_policy_version: row.selection_policy_version,
      inventory_fingerprint: row.inventory_fingerprint,
      test_design_count: row.test_design_count,
      endpoint_count: row.endpoint_count,
      scenario_count: row.scenario_count,
      selection_json: row.version_selection_json,
      created_at: row.version_created_at,
    }, { includeSelection });
    if (version.suiteId !== suite.suiteId || version.version !== suite.latestVersion) {
      throw new TestRegistryError("Latest Test Suite pointer is inconsistent.", {
        code: "TEST_SUITE_LATEST_POINTER_INVALID",
        status: 500,
        retryable: false,
      });
    }
    return { exists: true, suite, version };
  }


  async function getLatestAutoSuiteWithSnapshot({ organizationId, projectId, includeSelection = true, changeLimit = SNAPSHOT_CHANGE_LIMIT }) {
    const latest = await getLatestAutoSuite({ organizationId, projectId, includeSelection });
    if (!latest.exists || !latest.version) {
      return {
        ...latest,
        snapshot: emptySnapshot({ state: "NOT_MATERIALIZED" }),
      };
    }

    const inventory = await buildProjectInventory({ organizationId, projectId, compact: true });
    const suiteVersion = latest.version;
    const policyChanged = suiteVersion.selectionPolicyVersion !== inventory.selectionPolicyVersion;
    if (!policyChanged && suiteVersion.inventoryFingerprint === inventory.inventoryFingerprint) {
      return {
        ...latest,
        snapshot: emptySnapshot({
          state: "CURRENT",
          suiteInventoryFingerprint: suiteVersion.inventoryFingerprint,
          currentInventoryFingerprint: inventory.inventoryFingerprint,
        }),
      };
    }

    await ensureSuiteVersionItems({ organizationId, projectId, version: suiteVersion });
    const response = await db.prepare(`
      SELECT
        i.ordinal,
        i.endpoint_id AS suite_endpoint_id,
        i.test_design_id AS suite_test_design_id,
        i.test_design_version_id AS suite_test_design_version_id,
        i.test_design_version AS suite_test_design_version,
        i.scenario_count AS suite_scenario_count,
        d.status AS current_test_design_status,
        d.latest_version_id AS current_test_design_version_id,
        d.latest_version AS current_test_design_version,
        v.version_origin_json AS current_version_origin_json,
        v.derivation_key AS current_derivation_key,
        p.ready_scenario_count AS current_ready_scenario_count
      FROM test_suite_version_items i
      LEFT JOIN test_designs d
        ON d.id = i.test_design_id
       AND d.organization_id = i.organization_id
       AND d.project_id = i.project_id
      LEFT JOIN test_design_versions v
        ON v.id = d.latest_version_id
      LEFT JOIN test_design_execution_inventory p
        ON p.test_design_version_id = d.latest_version_id
      WHERE i.organization_id = ? AND i.project_id = ? AND i.suite_version_id = ?
      ORDER BY i.ordinal ASC
    `).bind(organizationId, projectId, suiteVersion.suiteVersionId).all();

    const rows = response?.results || [];
    const currentItemsByDesignId = new Map(inventory.items.map((item) => [item.testDesignId, item]));
    const suiteDesignIds = new Set();
    const changes = [];
    let evolvedTestDesignCount = 0;
    let versionChangedTestDesignCount = 0;
    let addedTestDesignCount = 0;
    let removedTestDesignCount = 0;
    let noLongerReadyTestDesignCount = 0;

    const pushChange = (change) => {
      if (changes.length < Math.max(1, Math.min(Number(changeLimit) || SNAPSHOT_CHANGE_LIMIT, 100))) changes.push(change);
    };

    for (const row of rows) {
      suiteDesignIds.add(row.suite_test_design_id);
      const current = currentItemsByDesignId.get(row.suite_test_design_id) || null;
      if (!current || row.current_test_design_status !== "ACTIVE") {
        removedTestDesignCount += 1;
        pushChange({
          changeType: "TEST_DESIGN_REMOVED",
          endpointId: row.suite_endpoint_id,
          testDesignId: row.suite_test_design_id,
          from: { testDesignVersionId: row.suite_test_design_version_id, testDesignVersion: Number(row.suite_test_design_version) },
          to: null,
          evolution: null,
        });
        continue;
      }
      if (current.readyScenarioCount <= 0) {
        noLongerReadyTestDesignCount += 1;
        pushChange({
          changeType: "TEST_DESIGN_NO_LONGER_READY",
          endpointId: current.endpointId,
          testDesignId: current.testDesignId,
          from: { testDesignVersionId: row.suite_test_design_version_id, testDesignVersion: Number(row.suite_test_design_version) },
          to: { testDesignVersionId: current.testDesignVersionId, testDesignVersion: current.testDesignVersion, readyScenarioCount: current.readyScenarioCount },
          evolution: null,
        });
        continue;
      }
      if (row.suite_test_design_version_id !== current.testDesignVersionId) {
        const origin = parseVersionOrigin(row.current_version_origin_json);
        const evolved = origin?.type === "RESULT_EVOLUTION";
        if (evolved) evolvedTestDesignCount += 1; else versionChangedTestDesignCount += 1;
        pushChange({
          changeType: evolved ? "TEST_DESIGN_EVOLVED" : "TEST_DESIGN_VERSION_CHANGED",
          endpointId: current.endpointId,
          testDesignId: current.testDesignId,
          from: { testDesignVersionId: row.suite_test_design_version_id, testDesignVersion: Number(row.suite_test_design_version) },
          to: { testDesignVersionId: current.testDesignVersionId, testDesignVersion: current.testDesignVersion, readyScenarioCount: current.readyScenarioCount },
          evolution: evolved ? {
            proposalId: typeof origin.proposalId === "string" ? origin.proposalId : null,
            sourceTestDesignVersionId: typeof origin.sourceTestDesignVersionId === "string" ? origin.sourceTestDesignVersionId : null,
          } : null,
        });
      }
    }

    for (const current of inventory.items) {
      if (current.readyScenarioCount <= 0 || suiteDesignIds.has(current.testDesignId)) continue;
      addedTestDesignCount += 1;
      pushChange({
        changeType: "TEST_DESIGN_ADDED",
        endpointId: current.endpointId,
        testDesignId: current.testDesignId,
        from: null,
        to: { testDesignVersionId: current.testDesignVersionId, testDesignVersion: current.testDesignVersion, readyScenarioCount: current.readyScenarioCount },
        evolution: null,
      });
    }

    const changedTestDesignCount = evolvedTestDesignCount + versionChangedTestDesignCount + addedTestDesignCount + removedTestDesignCount + noLongerReadyTestDesignCount;
    const outdatedReason = evolvedTestDesignCount > 0
      ? "TEST_DESIGN_EVOLVED"
      : policyChanged
        ? "SELECTION_POLICY_CHANGED"
        : "PROJECT_TEST_INVENTORY_CHANGED";

    return {
      ...latest,
      snapshot: {
        contractVersion: EVOLUTION_AWARE_SNAPSHOT_CONTRACT_VERSION,
        state: "OUTDATED",
        outdatedReason,
        suiteInventoryFingerprint: suiteVersion.inventoryFingerprint,
        currentInventoryFingerprint: inventory.inventoryFingerprint,
        changedTestDesignCount,
        evolvedTestDesignCount,
        versionChangedTestDesignCount,
        addedTestDesignCount,
        removedTestDesignCount,
        noLongerReadyTestDesignCount,
        selectionPolicyChanged: policyChanged,
        suiteSelectionPolicyVersion: suiteVersion.selectionPolicyVersion,
        currentSelectionPolicyVersion: inventory.selectionPolicyVersion,
        changesIncluded: true,
        changesTruncated: changes.length < changedTestDesignCount,
        changes,
      },
    };
  }

  async function ensureSuiteVersionItems({ organizationId, projectId, version }) {
    if (!version?.suiteVersionId) {
      throw new TestRegistryError("Suite version is required for execution item materialization.", {
        code: "TEST_SUITE_VERSION_REQUIRED", status: 400, retryable: false,
      });
    }
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS item_count
      FROM test_suite_version_items
      WHERE organization_id = ? AND project_id = ? AND suite_version_id = ?
    `).bind(organizationId, projectId, version.suiteVersionId).first();
    const existingCount = Number(countRow?.item_count || 0);
    if (existingCount === Number(version.endpointCount || 0)) return { backfilled: false, itemCount: existingCount };

    // Legacy suite versions are normalized lazily once. selection_json remains the immutable source of truth.
    const full = version.selectionIncluded ? version : await getVersionById({
      organizationId, projectId, suiteVersionId: version.suiteVersionId, includeSelection: true,
    });
    if (!full || !Array.isArray(full.selection)) {
      throw new TestRegistryError("Immutable Suite selection is unavailable.", {
        code: "TEST_SUITE_SELECTION_MISSING", status: 500, retryable: false,
      });
    }
    const createdAt = full.createdAt || now().toISOString();
    const statements = full.selection.map((item, ordinal) => db.prepare(`
      INSERT OR IGNORE INTO test_suite_version_items (
        suite_version_id, suite_id, organization_id, project_id, ordinal,
        endpoint_id, test_design_id, test_design_version_id, test_design_version,
        scenario_count, scenario_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      full.suiteVersionId, full.suiteId, organizationId, projectId, ordinal,
      item.endpointId, item.testDesignId, item.testDesignVersionId, item.testDesignVersion,
      Array.isArray(item.scenarioIds) ? item.scenarioIds.length : 0,
      JSON.stringify(Array.isArray(item.scenarioIds) ? item.scenarioIds : []),
      createdAt,
    ));
    for (let offset = 0; offset < statements.length; offset += SUITE_ITEM_BACKFILL_BATCH_SIZE) {
      await db.batch(statements.slice(offset, offset + SUITE_ITEM_BACKFILL_BATCH_SIZE));
    }
    return { backfilled: true, itemCount: full.selection.length };
  }

  async function warmSuiteVersionItemsIfAvailable({ organizationId, projectId, version }) {
    try {
      return await ensureSuiteVersionItems({ organizationId, projectId, version });
    } catch (error) {
      // Rolling deploy compatibility: 07.7.10-A code/tests can run before migration 0004 exists.
      // Only the absence of the new projection table is tolerated; every other error stays fail-closed.
      if (/no such table:\s*test_suite_version_items/i.test(String(error?.message || error || ""))) {
        return { backfilled: false, itemCount: 0, unavailable: true };
      }
      throw error;
    }
  }

  async function getSuiteExecutionSlice({ organizationId, projectId, suiteVersionId, offset = 0, limit = 10 }) {
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));
    const version = await getVersionById({ organizationId, projectId, suiteVersionId, includeSelection: false });
    if (!version) {
      throw new TestRegistryError("Test Suite version not found.", {
        code: "TEST_SUITE_VERSION_NOT_FOUND", status: 404, retryable: false,
      });
    }
    if (version.selectionPolicy !== AUTO_SUITE_SELECTION_POLICY || version.selectionPolicyVersion !== AUTO_SUITE_SELECTION_POLICY_VERSION) {
      throw new TestRegistryError("Suite version is not eligible for automatic execution.", {
        code: "TEST_SUITE_EXECUTION_POLICY_UNSUPPORTED", status: 409, retryable: false,
      });
    }
    const normalized = await ensureSuiteVersionItems({ organizationId, projectId, version });
    const response = await db.prepare(`
      SELECT i.ordinal, i.endpoint_id, i.test_design_id, i.test_design_version_id,
             i.test_design_version, i.scenario_count, i.scenario_ids_json,
             p.target_method, p.target_path
      FROM test_suite_version_items i
      LEFT JOIN test_design_execution_inventory p
        ON p.test_design_version_id = i.test_design_version_id
      WHERE i.organization_id = ? AND i.project_id = ? AND i.suite_version_id = ?
      ORDER BY i.ordinal ASC
      LIMIT ? OFFSET ?
    `).bind(organizationId, projectId, suiteVersionId, safeLimit, safeOffset).all();
    const items = (response?.results || []).map((row) => ({
      ordinal: Number(row.ordinal), endpointId: row.endpoint_id, testDesignId: row.test_design_id,
      testDesignVersionId: row.test_design_version_id, testDesignVersion: Number(row.test_design_version),
      method: row.target_method || null, path: row.target_path || null,
      scenarioCount: Number(row.scenario_count), scenarioIds: parseJson(row.scenario_ids_json, {
        details: { field: "scenario_ids_json", suiteVersionId, ordinal: Number(row.ordinal) }, fallback: [],
      }),
    }));
    const totalItems = Number(version.endpointCount || 0);
    const nextOffset = safeOffset + items.length;
    return {
      contractVersion: SUITE_EXECUTION_SLICE_CONTRACT_VERSION,
      organizationId, projectId,
      suite: {
        suiteId: version.suiteId, suiteVersionId: version.suiteVersionId, version: version.version,
        inventoryFingerprint: version.inventoryFingerprint, selectionPolicy: version.selectionPolicy,
        selectionPolicyVersion: version.selectionPolicyVersion, endpointCount: version.endpointCount,
        scenarioCount: version.scenarioCount,
      },
      offset: safeOffset, limit: safeLimit, totalItems, items,
      nextOffset, hasMore: nextOffset < totalItems,
      projection: { mode: "NORMALIZED_IMMUTABLE_SUITE_ITEMS", lazyBackfilled: normalized.backfilled },
    };
  }

  async function materializeAutoReadySuite({ organizationId, projectId }) {
    const inventory = await buildProjectInventory({ organizationId, projectId });
    if (!inventory.readyAvailable) {
      throw new TestRegistryError("Project has no semantic READY scenarios to materialize.", {
        code: "TEST_SUITE_NO_READY_SCENARIOS",
        status: 409,
        retryable: false,
        details: {
          testDesignCount: inventory.testDesignCount,
          scenarioCount: inventory.scenarioCount,
          readyScenarioCount: inventory.readyScenarioCount,
          policyBlockedReadyScenarioCount: inventory.policyBlockedReadyScenarioCount,
        },
      });
    }

    const suiteId = await buildStableAutoProjectSuiteId({ organizationId, projectId });
    const stamp = now().toISOString();
    await db.prepare(`
      INSERT OR IGNORE INTO test_suites (
        id, organization_id, project_id, suite_type, name, description, status,
        latest_version, latest_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, NULL, ?, ?)
    `).bind(
      suiteId,
      organizationId,
      projectId,
      AUTO_SUITE_TYPE,
      "Regressão automática",
      "Snapshot zero-config de todos os cenários semanticamente READY dos Test Designs mais recentes do projeto.",
      stamp,
      stamp,
    ).run();

    for (let attempt = 0; attempt <= maxVersionRetries; attempt += 1) {
      const suite = await getAutoSuiteRoot({ organizationId, projectId });
      if (!suite || suite.suiteId !== suiteId) {
        throw new TestRegistryError("Auto suite identity could not be established.", {
          code: "TEST_SUITE_ROOT_IDENTITY_INVALID",
          status: 500,
          retryable: false,
        });
      }

      if (suite.latestVersionId) {
        const latest = await getVersionById({ organizationId, projectId, suiteVersionId: suite.latestVersionId });
        if (latest?.inventoryFingerprint === inventory.inventoryFingerprint) {
          // Foundation 07.7.10-B: explicit materialization also warms the normalized
          // immutable execution projection. Legacy Suite versions pay this cost once;
          // orchestration then reads only bounded rows.
          await warmSuiteVersionItemsIfAvailable({ organizationId, projectId, version: latest });
          return {
            contractVersion: TEST_SUITE_CONTRACT_VERSION,
            created: false,
            unchanged: true,
            suite,
            version: latest,
            inventory,
          };
        }
      }

      const nextVersion = suite.latestVersion + 1;
      const suiteVersionId = suiteVersionIdFactory();
      const createdAt = now().toISOString();
      const insert = db.prepare(`
        INSERT INTO test_suite_versions (
          id, suite_id, organization_id, project_id, version, source_type,
          selection_policy, selection_policy_version, inventory_fingerprint,
          test_design_count, endpoint_count, scenario_count, selection_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        suiteVersionId,
        suite.suiteId,
        organizationId,
        projectId,
        nextVersion,
        AUTO_SUITE_SOURCE_TYPE,
        AUTO_SUITE_SELECTION_POLICY,
        AUTO_SUITE_SELECTION_POLICY_VERSION,
        inventory.inventoryFingerprint,
        inventory.testDesignCount,
        inventory.endpointWithReadyCount,
        inventory.readyScenarioCount,
        JSON.stringify(inventory.selection),
        createdAt,
      );
      const update = db.prepare(`
        UPDATE test_suites
        SET latest_version = CASE WHEN latest_version < ? THEN ? ELSE latest_version END,
            latest_version_id = CASE WHEN latest_version < ? THEN ? ELSE latest_version_id END,
            updated_at = CASE WHEN latest_version < ? THEN ? ELSE updated_at END
        WHERE id = ?
      `).bind(nextVersion, nextVersion, nextVersion, suiteVersionId, nextVersion, createdAt, suite.suiteId);

      try {
        await db.batch([insert, update]);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const current = await getLatestAutoSuite({ organizationId, projectId });
        if (current.exists && current.version.inventoryFingerprint === inventory.inventoryFingerprint) {
          await warmSuiteVersionItemsIfAvailable({ organizationId, projectId, version: current.version });
          return {
            contractVersion: TEST_SUITE_CONTRACT_VERSION,
            created: false,
            unchanged: true,
            suite: current.suite,
            version: current.version,
            inventory,
          };
        }
        if (attempt < maxVersionRetries) continue;
        throw new TestRegistryError("Could not allocate immutable Test Suite version after retries.", {
          code: "TEST_SUITE_VERSION_CONFLICT",
          status: 409,
          retryable: true,
        });
      }

      const persisted = await getVersionById({ organizationId, projectId, suiteVersionId });
      if (!persisted) {
        throw new TestRegistryError("Persisted Test Suite version could not be verified.", {
          code: "TEST_SUITE_VERSION_VERIFY_FAILED",
          status: 500,
          retryable: true,
        });
      }
      // New Suite versions are normalized at write time so future fan-out never
      // reparses a large selection_json on the orchestration hot path.
      await warmSuiteVersionItemsIfAvailable({ organizationId, projectId, version: persisted });
      const refreshedSuite = await getAutoSuiteRoot({ organizationId, projectId });
      return {
        contractVersion: TEST_SUITE_CONTRACT_VERSION,
        created: true,
        unchanged: false,
        suite: refreshedSuite,
        version: persisted,
        inventory,
      };
    }

    throw new TestRegistryError("Suite version allocation failed.", {
      code: "TEST_SUITE_VERSION_CONFLICT",
      status: 409,
      retryable: true,
    });
  }

  return {
    buildProjectInventory,
    getAutoSuiteRoot,
    getLatestAutoSuite,
    getLatestAutoSuiteWithSnapshot,
    getVersionById,
    getSuiteExecutionSlice,
    materializeAutoReadySuite,
  };
}

import { TestRegistryError } from "../domain/errors.js";
import { buildStableAutoProjectSuiteId, createTestSuiteVersionId } from "../domain/ids.js";
import {
  AUTO_SUITE_SELECTION_POLICY,
  AUTO_SUITE_SELECTION_POLICY_VERSION,
  AUTO_SUITE_SOURCE_TYPE,
  AUTO_SUITE_TYPE,
  PROJECT_TEST_INVENTORY_CONTRACT_VERSION,
  TEST_SUITE_CONTRACT_VERSION,
  TEST_SUITE_VERSION_CONTRACT_VERSION,
} from "../domain/suiteContracts.js";

const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function parseJson(value, { code = "TEST_REGISTRY_CORRUPT_ARTIFACT", details = null } = {}) {
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

function normalizeTarget(scenario) {
  const target = scenario?.spec?.target;
  return {
    method: typeof target?.method === "string" ? target.method : null,
    path: typeof target?.path === "string" ? target.path : null,
    apiServiceKey: typeof target?.apiServiceKey === "string" ? target.apiServiceKey : null,
  };
}

function summarizeVersion(row) {
  const specification = parseJson(row.specification_json, {
    details: { field: "specification_json", versionId: row.id },
  });
  const scenarios = Array.isArray(specification?.scenarios) ? specification.scenarios : [];
  const ready = scenarios.filter((scenario) => scenario?.automation?.readiness === "READY");
  const reviewRequired = scenarios.filter((scenario) => scenario?.automation?.readiness === "REVIEW_REQUIRED");
  const needsData = scenarios.filter((scenario) => scenario?.automation?.readiness === "NEEDS_DATA");
  const needsAuth = scenarios.filter((scenario) => scenario?.automation?.readiness === "NEEDS_AUTH");
  const firstTarget = normalizeTarget(ready[0] || scenarios[0]);

  return {
    endpointId: row.endpoint_id,
    testDesignId: row.test_design_id,
    testDesignVersionId: row.id,
    testDesignVersion: row.version,
    title: typeof specification?.title === "string" ? specification.title : null,
    method: firstTarget.method,
    path: firstTarget.path,
    apiServiceKey: firstTarget.apiServiceKey,
    scenarioCount: scenarios.length,
    readyScenarioCount: ready.length,
    reviewRequiredScenarioCount: reviewRequired.length,
    needsDataScenarioCount: needsData.length,
    needsAuthScenarioCount: needsAuth.length,
    blockedScenarioCount: Math.max(0, scenarios.length - ready.length),
    readyScenarioIds: ready
      .map((scenario) => scenario?.scenarioId)
      .filter((value) => typeof value === "string" && value.length > 0),
    createdAt: row.created_at,
  };
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

function mapSuiteVersion(row) {
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
    selection: parseJson(row.selection_json, {
      details: { field: "selection_json", suiteVersionId: row.id },
    }),
    createdAt: row.created_at,
  };
}

function isUniqueConstraintError(error) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(String(error?.message || error || ""));
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

  async function buildProjectInventory({ organizationId, projectId }) {
    const response = await db.prepare(`
      SELECT v.id, v.test_design_id, v.endpoint_id, v.version, v.specification_json, v.created_at
      FROM test_designs d
      JOIN test_design_versions v ON v.id = d.latest_version_id
      WHERE d.organization_id = ? AND d.project_id = ?
        AND d.status = 'ACTIVE' AND d.latest_version > 0
      ORDER BY d.endpoint_id ASC
    `).bind(organizationId, projectId).all();

    const items = (response?.results || []).map(summarizeVersion);
    const executableItems = items.filter((item) => item.readyScenarioCount > 0);
    const selection = executableItems.map((item) => ({
      endpointId: item.endpointId,
      testDesignId: item.testDesignId,
      testDesignVersionId: item.testDesignVersionId,
      testDesignVersion: item.testDesignVersion,
      scenarioIds: [...item.readyScenarioIds],
    }));
    const inventoryFingerprint = await sha256Hex(JSON.stringify(selection));

    const totals = items.reduce((acc, item) => {
      acc.scenarioCount += item.scenarioCount;
      acc.readyScenarioCount += item.readyScenarioCount;
      acc.reviewRequiredScenarioCount += item.reviewRequiredScenarioCount;
      acc.needsDataScenarioCount += item.needsDataScenarioCount;
      acc.needsAuthScenarioCount += item.needsAuthScenarioCount;
      acc.blockedScenarioCount += item.blockedScenarioCount;
      return acc;
    }, {
      scenarioCount: 0,
      readyScenarioCount: 0,
      reviewRequiredScenarioCount: 0,
      needsDataScenarioCount: 0,
      needsAuthScenarioCount: 0,
      blockedScenarioCount: 0,
    });

    return {
      contractVersion: PROJECT_TEST_INVENTORY_CONTRACT_VERSION,
      organizationId,
      projectId,
      inventoryFingerprint,
      testDesignCount: items.length,
      endpointWithReadyCount: executableItems.length,
      ...totals,
      executable: totals.readyScenarioCount > 0,
      items,
      selection,
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

  async function getVersionById({ organizationId, projectId, suiteVersionId }) {
    const row = await db.prepare(`
      SELECT id, suite_id, organization_id, project_id, version, source_type,
             selection_policy, selection_policy_version, inventory_fingerprint,
             test_design_count, endpoint_count, scenario_count, selection_json, created_at
      FROM test_suite_versions
      WHERE id = ? AND organization_id = ? AND project_id = ?
      LIMIT 1
    `).bind(suiteVersionId, organizationId, projectId).first();
    return mapSuiteVersion(row);
  }

  async function getLatestAutoSuite({ organizationId, projectId }) {
    const suite = await getAutoSuiteRoot({ organizationId, projectId });
    if (!suite || suite.latestVersion < 1 || !suite.latestVersionId) {
      return { exists: false, suite, version: null };
    }
    const version = await getVersionById({ organizationId, projectId, suiteVersionId: suite.latestVersionId });
    if (!version || version.suiteId !== suite.suiteId || version.version !== suite.latestVersion) {
      throw new TestRegistryError("Latest Test Suite pointer is inconsistent.", {
        code: "TEST_SUITE_LATEST_POINTER_INVALID",
        status: 500,
        retryable: false,
      });
    }
    return { exists: true, suite, version };
  }

  async function materializeAutoReadySuite({ organizationId, projectId }) {
    const inventory = await buildProjectInventory({ organizationId, projectId });
    if (!inventory.executable) {
      throw new TestRegistryError("Project has no READY scenarios to materialize.", {
        code: "TEST_SUITE_NO_READY_SCENARIOS",
        status: 409,
        retryable: false,
        details: { testDesignCount: inventory.testDesignCount, scenarioCount: inventory.scenarioCount },
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
      "Snapshot zero-config de todos os cenários READY dos Test Designs mais recentes do projeto.",
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
    getVersionById,
    materializeAutoReadySuite,
  };
}

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { handleRequest } from "../src/index.js";
import { buildStableAutoProjectSuiteId } from "../src/domain/ids.js";
import { appendPayload, sampleSpecification } from "./fixtures.mjs";
import { SQLiteD1 } from "./helpers/sqliteD1.mjs";

const migration1 = fs.readFileSync(new URL("../migrations/0001_test_registry_foundation.sql", import.meta.url), "utf8");
const migration2 = fs.readFileSync(new URL("../migrations/0002_foundation_07_7_10_a_suite_definition.sql", import.meta.url), "utf8");
const migration3 = fs.readFileSync(new URL("../migrations/0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql", import.meta.url), "utf8");

function headers(org = "org_test", project = "prj_test") {
  return {
    "content-type": "application/json",
    "x-qagent-organization-id": org,
    "x-qagent-project-id": project,
  };
}

function env(db) { return { ENVIRONMENT: "test", TEST_REGISTRY_DB: db }; }

async function append(db, payload) {
  return handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions", {
    method: "POST", headers: headers(), body: JSON.stringify(payload),
  }), env(db));
}

function spec({ endpointId, methods, readiness = [] }) {
  const base = sampleSpecification({ endpointId, contextFingerprint: "f".repeat(64) });
  base.scenarios = methods.map((method, index) => {
    const scenario = structuredClone(base.scenarios[0]);
    scenario.scenarioId = `test_${String(index + 1).padStart(3, "0")}`;
    scenario.spec.target.catalogEndpointId = endpointId;
    scenario.spec.target.method = method;
    scenario.spec.target.path = `/api/${endpointId}`;
    scenario.automation.readiness = readiness[index] || "READY";
    scenario.automation.blockers = scenario.automation.readiness === "READY" ? [] : ["blocked"];
    return scenario;
  });
  base.summary.scenarioCount = base.scenarios.length;
  base.summary.readyCount = base.scenarios.filter((scenario) => scenario.automation.readiness === "READY").length;
  base.summary.byReadiness = {};
  for (const scenario of base.scenarios) {
    base.summary.byReadiness[scenario.automation.readiness] = (base.summary.byReadiness[scenario.automation.readiness] || 0) + 1;
  }
  return base;
}

function payload({ endpointId, requestId, specification }) {
  const contextFingerprint = requestId.includes("old") ? "a".repeat(64) : "b".repeat(64);
  specification.generation.contextFingerprint = contextFingerprint;
  return appendPayload({
    endpointId,
    generationRequestId: requestId,
    contextFingerprint,
    specification,
  });
}

test("07.7.10-A FIX-1 migration adds the immutable execution inventory projection and project indexes", () => {
  const db = new SQLiteD1();
  try {
    db.exec(migration1); db.exec(migration2); db.exec(migration3);
    const table = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_design_execution_inventory'").get();
    assert.equal(table.name, "test_design_execution_inventory");
    const indexes = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_td_execution_inventory_%' ORDER BY name").all();
    assert.deepEqual(indexes.map((row) => row.name), [
      "idx_td_execution_inventory_project_eligible",
      "idx_td_execution_inventory_project_endpoint",
    ]);
  } finally { db.close(); }
});

test("READY is not equal to execution-eligible: safe methods enter the Suite and mutations remain policy-blocked", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const response = await append(db, payload({
      endpointId: "cep_mix",
      requestId: "tdg_fix1_mixed_0001",
      specification: spec({ endpointId: "cep_mix", methods: ["GET", "PUT", "HEAD", "POST", "TRACE"] }),
    }));
    assert.equal(response.status, 201);

    const inventoryResponse = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db));
    assert.equal(inventoryResponse.status, 200);
    const inventory = (await inventoryResponse.json()).data;
    assert.equal(inventory.readyScenarioCount, 5);
    assert.equal(inventory.executionEligibleScenarioCount, 2);
    assert.equal(inventory.policyBlockedReadyScenarioCount, 3);
    assert.equal(inventory.endpointWithReadyCount, 1);
    assert.equal(inventory.endpointWithExecutionEligibleCount, 1);
    assert.deepEqual(inventory.selection[0].scenarioIds, ["test_001", "test_003"]);
    assert.deepEqual(inventory.items[0].policyBlockedReasonCounts, {
      MUTATION_EXECUTION_DISABLED: 2,
      HTTP_METHOD_UNSUPPORTED: 1,
    });
    assert.equal(inventory.eligibilityPolicyVersion, "qagent.suite-execution-eligibility.v1");
    assert.equal(inventory.selectionPolicyVersion, "qagent.suite-selection-policy.v1.1");

    const suiteResponse = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize", { method: "POST", headers: headers() }), env(db));
    assert.equal(suiteResponse.status, 201);
    const suite = (await suiteResponse.json()).data;
    assert.equal(suite.version.scenarioCount, 2);
    assert.equal(suite.version.selectionPolicy, "LATEST_TEST_DESIGNS_EXECUTION_ELIGIBLE_SCENARIOS");
    assert.equal(suite.version.selectionPolicyVersion, "qagent.suite-selection-policy.v1.1");
    assert.deepEqual(suite.version.selection[0].scenarioIds, ["test_001", "test_003"]);
  } finally { db.close(); }
});

test("a project with only READY mutations fails closed instead of creating a predictably rejected Suite", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    await append(db, payload({
      endpointId: "cep_mutation",
      requestId: "tdg_fix1_mutation_01",
      specification: spec({ endpointId: "cep_mutation", methods: ["POST", "PUT", "PATCH", "DELETE"] }),
    }));
    const inventory = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db))).json()).data;
    assert.equal(inventory.readyScenarioCount, 4);
    assert.equal(inventory.executionEligibleScenarioCount, 0);
    assert.equal(inventory.policyBlockedReadyScenarioCount, 4);
    assert.equal(inventory.executable, false);

    const materialize = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize", { method: "POST", headers: headers() }), env(db));
    assert.equal(materialize.status, 409);
    assert.equal((await materialize.json()).code, "TEST_SUITE_NO_EXECUTION_ELIGIBLE_SCENARIOS");
  } finally { db.close(); }
});

test("new Test Design versions persist the compact projection in the same write path", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const response = await append(db, payload({
      endpointId: "cep_fast",
      requestId: "tdg_fix1_projection_1",
      specification: spec({ endpointId: "cep_fast", methods: ["GET", "PUT", "OPTIONS"] }),
    }));
    assert.equal(response.status, 201);
    const stored = db.raw.prepare(`
      SELECT target_method, scenario_count, ready_scenario_count,
             execution_eligible_scenario_count, policy_blocked_ready_scenario_count,
             eligibility_policy_version
      FROM test_design_execution_inventory
      WHERE endpoint_id = 'cep_fast'
    `).get();
    assert.equal(stored.target_method, "GET");
    assert.equal(stored.scenario_count, 3);
    assert.equal(stored.ready_scenario_count, 3);
    assert.equal(stored.execution_eligible_scenario_count, 2);
    assert.equal(stored.policy_blocked_ready_scenario_count, 1);
    assert.equal(stored.eligibility_policy_version, "qagent.suite-execution-eligibility.v1");

    const inventory = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db))).json()).data;
    assert.equal(inventory.projection.lazyBackfilledCount, 0);
  } finally { db.close(); }
});

test("historical latest versions are lazily backfilled once after migration 0003", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2);
  try {
    const response = await append(db, payload({
      endpointId: "cep_old",
      requestId: "tdg_fix1_old_000001",
      specification: spec({ endpointId: "cep_old", methods: ["GET", "PUT"] }),
    }));
    assert.equal(response.status, 201);
    db.exec(migration3);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS c FROM test_design_execution_inventory").get().c, 0);

    const first = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db))).json()).data;
    assert.equal(first.projection.lazyBackfilledCount, 1);
    assert.equal(first.executionEligibleScenarioCount, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS c FROM test_design_execution_inventory").get().c, 1);

    const second = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db))).json()).data;
    assert.equal(second.projection.lazyBackfilledCount, 0);
  } finally { db.close(); }
});

test("compact hot-path reads omit large scenario selections while preserving totals and fingerprint", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    await append(db, payload({
      endpointId: "cep_compact",
      requestId: "tdg_fix1_compact_01",
      specification: spec({ endpointId: "cep_compact", methods: ["GET", "GET", "PUT"] }),
    }));
    const full = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db))).json()).data;
    const compact = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory?view=compact", { headers: headers() }), env(db))).json()).data;
    assert.equal(compact.inventoryFingerprint, full.inventoryFingerprint);
    assert.equal(compact.executionEligibleScenarioCount, 2);
    assert.equal(compact.selectionIncluded, false);
    assert.deepEqual(compact.selection, []);
    assert.equal(compact.items[0].scenarioIdsIncluded, false);
    assert.deepEqual(compact.items[0].executionEligibleScenarioIds, []);

    await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize?view=compact", { method: "POST", headers: headers() }), env(db));
    const latest = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/latest?view=compact", { headers: headers() }), env(db))).json()).data;
    assert.equal(latest.exists, true);
    assert.equal(latest.version.selectionIncluded, false);
    assert.deepEqual(latest.version.selection, []);
  } finally { db.close(); }
});

test("steady-state inventory and latest Suite reads stay O(1) in D1 round-trips (no per-endpoint N+1)", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    for (let i = 0; i < 12; i += 1) {
      const endpointId = `cep_scale_${String(i).padStart(2, "0")}`;
      await append(db, payload({
        endpointId,
        requestId: `tdg_fix1_scale_${String(i).padStart(8, "0")}`,
        specification: spec({ endpointId, methods: ["GET", "PUT", "GET"] }),
      }));
    }

    const originalPrepare = db.prepare.bind(db);
    let prepareCount = 0;
    db.prepare = (sql) => { prepareCount += 1; return originalPrepare(sql); };

    const inventoryResponse = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory?view=compact", { headers: headers() }), env(db));
    assert.equal(inventoryResponse.status, 200);
    const inventory = (await inventoryResponse.json()).data;
    assert.equal(inventory.executionEligibleScenarioCount, 24);
    assert.equal(inventory.policyBlockedReadyScenarioCount, 12);
    assert.equal(prepareCount, 1, "steady-state inventory must use one project projection query regardless of endpoint count");

    // Materialization is a write path and may use multiple statements. The hot latest read
    // after it must still be one joined query and must not load selection_json in compact mode.
    db.prepare = originalPrepare;
    await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize?view=compact", { method: "POST", headers: headers() }), env(db));
    prepareCount = 0;
    db.prepare = (sql) => { prepareCount += 1; return originalPrepare(sql); };
    const latest = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/latest?view=compact", { headers: headers() }), env(db));
    assert.equal(latest.status, 200);
    assert.equal((await latest.json()).data.exists, true);
    assert.equal(prepareCount, 1, "latest Suite summary must use one joined query");
  } finally { db.close(); }
});

test("an existing 07.7.10-A Suite v1 becomes OUTDATED and materializes v2 under the safe eligibility policy", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    await append(db, payload({
      endpointId: "cep_upgrade",
      requestId: "tdg_fix1_upgrade_01",
      specification: spec({ endpointId: "cep_upgrade", methods: ["GET", "PUT"] }),
    }));
    const root = db.raw.prepare("SELECT id, latest_version_id FROM test_designs WHERE endpoint_id='cep_upgrade'").get();
    const suiteId = await buildStableAutoProjectSuiteId({ organizationId: "org_test", projectId: "prj_test" });
    const oldSelection = [{ endpointId: "cep_upgrade", testDesignId: root.id, testDesignVersionId: root.latest_version_id, testDesignVersion: 1, scenarioIds: ["test_001", "test_002"] }];
    const stamp = "2026-08-24T20:00:00.000Z";
    db.raw.prepare(`INSERT INTO test_suites (id,organization_id,project_id,suite_type,name,status,latest_version,latest_version_id,created_at,updated_at)
      VALUES (?,?,?,'AUTO_PROJECT_READY','Regressão automática','ACTIVE',1,'suitev_old',?,?)`).run(suiteId,"org_test","prj_test",stamp,stamp);
    db.raw.prepare(`INSERT INTO test_suite_versions (id,suite_id,organization_id,project_id,version,source_type,selection_policy,selection_policy_version,inventory_fingerprint,test_design_count,endpoint_count,scenario_count,selection_json,created_at)
      VALUES ('suitev_old',?,?,?,1,'ZERO_CONFIG_PROJECT_READY','LATEST_TEST_DESIGNS_READY_SCENARIOS','qagent.suite-selection-policy.v1',?,1,1,2,?,?)`)
      .run(suiteId,"org_test","prj_test","0".repeat(64),JSON.stringify(oldSelection),stamp);

    const inventory = (await (await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory?view=compact", { headers: headers() }), env(db))).json()).data;
    assert.notEqual(inventory.inventoryFingerprint, "0".repeat(64));
    assert.equal(inventory.executionEligibleScenarioCount, 1);

    const response = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize", { method: "POST", headers: headers() }), env(db));
    assert.equal(response.status, 201);
    const result = (await response.json()).data;
    assert.equal(result.version.version, 2);
    assert.equal(result.version.scenarioCount, 1);
    assert.equal(result.version.selectionPolicyVersion, "qagent.suite-selection-policy.v1.1");
    assert.deepEqual(result.version.selection[0].scenarioIds, ["test_001"]);
  } finally { db.close(); }
});

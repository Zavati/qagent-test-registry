import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { handleRequest } from "../src/index.js";
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

function env(db) {
  return { ENVIRONMENT: "test", TEST_REGISTRY_DB: db };
}

async function append(db, payload) {
  return handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  }), env(db));
}

function specWithScenarios({ endpointId, ready = 1, review = 0, needsData = 0, generationFingerprint = "a".repeat(64) }) {
  const base = sampleSpecification({ endpointId, contextFingerprint: generationFingerprint });
  const scenarios = [];
  let seq = 1;
  for (const readiness of [
    ...Array(ready).fill("READY"),
    ...Array(review).fill("REVIEW_REQUIRED"),
    ...Array(needsData).fill("NEEDS_DATA"),
  ]) {
    const scenario = structuredClone(base.scenarios[0]);
    scenario.scenarioId = `test_${String(seq++).padStart(3, "0")}`;
    scenario.automation.readiness = readiness;
    scenario.automation.blockers = readiness === "READY" ? [] : [`${readiness} blocker`];
    scenario.spec.target.catalogEndpointId = endpointId;
    scenario.spec.target.path = `/api/${endpointId}/{id}`;
    scenarios.push(scenario);
  }
  base.scenarios = scenarios;
  base.summary.scenarioCount = scenarios.length;
  base.summary.readyCount = scenarios.filter((s) => s.automation.readiness === "READY").length;
  base.summary.byReadiness = Object.fromEntries([...new Set(scenarios.map((s) => s.automation.readiness))].map((key) => [key, scenarios.filter((s) => s.automation.readiness === key).length]));
  return base;
}

test("07.7.10-A migration creates immutable Suite definition tables", () => {
  const db = new SQLiteD1();
  try {
    db.exec(migration1);
    db.exec(migration2);
    db.exec(migration3);
    const rows = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('test_suites','test_suite_versions') ORDER BY name").all();
    assert.deepEqual(rows.map((r) => r.name), ["test_suite_versions", "test_suites"]);
  } finally { db.close(); }
});


test("07.7.10-A schema reserves multiple future USER_DEFINED suites while keeping one auto suite per project", () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const stamp = "2026-08-24T20:00:00.000Z";
    const sql = "INSERT INTO test_suites (id, organization_id, project_id, suite_type, name, status, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)";
    db.raw.prepare(sql).run("suite_user_a", "org_test", "prj_test", "USER_DEFINED", "Smoke", stamp, stamp);
    db.raw.prepare(sql).run("suite_user_b", "org_test", "prj_test", "USER_DEFINED", "Critical", stamp, stamp);
    db.raw.prepare(sql).run("suite_auto_a", "org_test", "prj_test", "AUTO_PROJECT_READY", "Auto", stamp, stamp);
    assert.throws(() => db.raw.prepare(sql).run("suite_auto_b", "org_test", "prj_test", "AUTO_PROJECT_READY", "Auto 2", stamp, stamp), /UNIQUE constraint failed/);
  } finally { db.close(); }
});

test("Project Test Inventory uses only latest Test Design versions and exposes READY ids without request data", async () => {
  const db = new SQLiteD1();
  db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const first = appendPayload({
      endpointId: "cep_a",
      generationRequestId: "tdg_inventory_00000001",
      contextFingerprint: "a".repeat(64),
      specification: specWithScenarios({ endpointId: "cep_a", ready: 2, review: 1, generationFingerprint: "a".repeat(64) }),
    });
    assert.equal((await append(db, first)).status, 201);

    const second = appendPayload({
      endpointId: "cep_b",
      generationRequestId: "tdg_inventory_00000002",
      contextFingerprint: "b".repeat(64),
      specification: specWithScenarios({ endpointId: "cep_b", ready: 0, needsData: 2, generationFingerprint: "b".repeat(64) }),
    });
    assert.equal((await append(db, second)).status, 201);

    const response = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory", { headers: headers() }), env(db));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.contractVersion, "qagent.project-test-inventory.v1");
    assert.equal(body.data.testDesignCount, 2);
    assert.equal(body.data.endpointWithReadyCount, 1);
    assert.equal(body.data.scenarioCount, 5);
    assert.equal(body.data.readyScenarioCount, 2);
    assert.equal(body.data.blockedScenarioCount, 3);
    assert.deepEqual(body.data.selection.map((x) => x.endpointId), ["cep_a"]);
    assert.deepEqual(body.data.selection[0].scenarioIds, ["test_001", "test_002"]);
    const serialized = JSON.stringify(body.data);
    assert.doesNotMatch(serialized, /pathParams|request\"|Authorization|password|token/i);
  } finally { db.close(); }
});

test("Auto Project READY suite is stable, immutable and does not create a new version when inventory is unchanged", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const payload = appendPayload({
      endpointId: "cep_a",
      generationRequestId: "tdg_suite_00000001",
      contextFingerprint: "c".repeat(64),
      specification: specWithScenarios({ endpointId: "cep_a", ready: 2, review: 1, generationFingerprint: "c".repeat(64) }),
    });
    await append(db, payload);

    const url = "https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize";
    const first = await handleRequest(new Request(url, { method: "POST", headers: headers() }), env(db));
    assert.equal(first.status, 201);
    const one = await first.json();
    assert.equal(one.data.created, true);
    assert.equal(one.data.version.version, 1);
    assert.match(one.data.suite.suiteId, /^suite_[0-9a-f]{64}$/);
    assert.match(one.data.version.suiteVersionId, /^suitev_/);
    assert.equal(one.data.version.scenarioCount, 2);

    const replay = await handleRequest(new Request(url, { method: "POST", headers: headers() }), env(db));
    assert.equal(replay.status, 200);
    const two = await replay.json();
    assert.equal(two.data.created, false);
    assert.equal(two.data.unchanged, true);
    assert.equal(two.data.version.suiteVersionId, one.data.version.suiteVersionId);

    const updated = appendPayload({
      endpointId: "cep_a",
      generationRequestId: "tdg_suite_00000002",
      contextFingerprint: "d".repeat(64),
      specification: specWithScenarios({ endpointId: "cep_a", ready: 3, review: 0, generationFingerprint: "d".repeat(64) }),
    });
    await append(db, updated);
    const next = await handleRequest(new Request(url, { method: "POST", headers: headers() }), env(db));
    assert.equal(next.status, 201);
    const three = await next.json();
    assert.equal(three.data.version.version, 2);
    assert.equal(three.data.version.scenarioCount, 3);
    assert.notEqual(three.data.version.inventoryFingerprint, one.data.version.inventoryFingerprint);

    const v1 = db.raw.prepare("SELECT selection_json FROM test_suite_versions WHERE suite_id = ? AND version = 1").get(one.data.suite.suiteId);
    const v2 = db.raw.prepare("SELECT selection_json FROM test_suite_versions WHERE suite_id = ? AND version = 2").get(one.data.suite.suiteId);
    assert.deepEqual(JSON.parse(v1.selection_json)[0].scenarioIds, ["test_001", "test_002"]);
    assert.deepEqual(JSON.parse(v2.selection_json)[0].scenarioIds, ["test_001", "test_002", "test_003"]);
  } finally { db.close(); }
});

test("Auto suite materialization fails closed when the project has no READY scenarios and is tenant isolated", async () => {
  const db = new SQLiteD1(); db.exec(migration1); db.exec(migration2); db.exec(migration3);
  try {
    const payload = appendPayload({
      endpointId: "cep_blocked",
      generationRequestId: "tdg_suite_blocked01",
      contextFingerprint: "e".repeat(64),
      specification: specWithScenarios({ endpointId: "cep_blocked", ready: 0, review: 1, generationFingerprint: "e".repeat(64) }),
    });
    await append(db, payload);
    const response = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize", { method: "POST", headers: headers() }), env(db));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "TEST_SUITE_NO_EXECUTION_ELIGIBLE_SCENARIOS");

    const wrong = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_other/test-inventory", { headers: headers("org_test", "prj_test") }), env(db));
    assert.equal(wrong.status, 403);
  } finally { db.close(); }
});

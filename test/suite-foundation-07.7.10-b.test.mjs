import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { handleRequest } from "../src/index.js";
import { appendPayload, sampleSpecification } from "./fixtures.mjs";
import { SQLiteD1 } from "./helpers/sqliteD1.mjs";

const m1 = fs.readFileSync(new URL("../migrations/0001_test_registry_foundation.sql", import.meta.url), "utf8");
const m2 = fs.readFileSync(new URL("../migrations/0002_foundation_07_7_10_a_suite_definition.sql", import.meta.url), "utf8");
const m3 = fs.readFileSync(new URL("../migrations/0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql", import.meta.url), "utf8");
const m4 = fs.readFileSync(new URL("../migrations/0004_foundation_07_7_10_b_suite_execution_items.sql", import.meta.url), "utf8");

function headers(org="org_test", project="prj_test") { return {"content-type":"application/json","x-qagent-organization-id":org,"x-qagent-project-id":project}; }
function env(db) { return { TEST_REGISTRY_DB: db, ENVIRONMENT:"test" }; }
function spec(endpointId) {
  const base = sampleSpecification({ endpointId, contextFingerprint: "b".repeat(64) });
  base.scenarios = [0,1].map((i) => {
    const s = structuredClone(base.scenarios[0]);
    s.scenarioId = `test_00${i+1}`;
    s.spec.target.catalogEndpointId = endpointId;
    s.spec.target.method = "GET";
    s.spec.target.path = `/api/${endpointId}`;
    s.automation.readiness = "READY";
    s.automation.blockers = [];
    return s;
  });
  base.summary.scenarioCount = 2; base.summary.readyCount = 2; base.summary.byReadiness = { READY: 2 };
  return base;
}
async function append(db, endpointId, requestId) {
  const specification = spec(endpointId);
  specification.generation.contextFingerprint = "b".repeat(64);
  const body = appendPayload({endpointId,generationRequestId:requestId,contextFingerprint:"b".repeat(64),specification});
  return handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions", {method:"POST",headers:headers(),body:JSON.stringify(body)}), env(db));
}

test("07.7.10-B execution slice contract is frozen", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("../contracts/qagent.suite-execution-slice.v1.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$id, "qagent.suite-execution-slice.v1");
  assert.equal(schema.properties.limit.maximum, 25);
});

test("07.7.10-B migration creates normalized immutable Suite execution items", () => {
  const db = new SQLiteD1();
  try { db.exec(m1); db.exec(m2); db.exec(m3); db.exec(m4);
    assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_suite_version_items'").get().name, "test_suite_version_items");
  } finally { db.close(); }
});

test("exact Suite execution slices are bounded, pinned and lazily normalize legacy selection once", async () => {
  const db = new SQLiteD1(); db.exec(m1); db.exec(m2); db.exec(m3); db.exec(m4);
  try {
    assert.equal((await append(db,"cep_a","tdg_7710b_a_0001")).status, 201);
    assert.equal((await append(db,"cep_b","tdg_7710b_b_0001")).status, 201);
    const materialized = await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize", {method:"POST",headers:headers()}), env(db));
    assert.equal(materialized.status, 201);
    const version = (await materialized.json()).data.version;
    assert.equal(db.raw.prepare("SELECT COUNT(*) c FROM test_suite_version_items").get().c, 2);

    // Simulate a Suite version created before 07.7.10-B: normalized rows are missing.
    db.raw.prepare("DELETE FROM test_suite_version_items WHERE suite_version_id = ?").run(version.suiteVersionId);
    assert.equal(db.raw.prepare("SELECT COUNT(*) c FROM test_suite_version_items").get().c, 0);

    const first = await handleRequest(new Request(`https://registry.internal/v1/test-registry/projects/prj_test/suite-versions/${version.suiteVersionId}/execution-slice?offset=0&limit=1`, {headers:headers()}), env(db));
    assert.equal(first.status, 200);
    const firstData = (await first.json()).data;
    assert.equal(firstData.contractVersion, "qagent.suite-execution-slice.v1");
    assert.equal(firstData.suite.suiteVersionId, version.suiteVersionId);
    assert.equal(firstData.items.length, 1);
    assert.equal(firstData.totalItems, 2);
    assert.equal(firstData.hasMore, true);
    assert.equal(firstData.nextOffset, 1);
    assert.equal(firstData.projection.lazyBackfilled, true);
    assert.equal(db.raw.prepare("SELECT COUNT(*) c FROM test_suite_version_items").get().c, 2);

    const second = await handleRequest(new Request(`https://registry.internal/v1/test-registry/projects/prj_test/suite-versions/${version.suiteVersionId}/execution-slice?offset=1&limit=1`, {headers:headers()}), env(db));
    const secondData = (await second.json()).data;
    assert.equal(secondData.items.length, 1);
    assert.equal(secondData.hasMore, false);
    assert.equal(secondData.projection.lazyBackfilled, false);
    assert.deepEqual(secondData.items[0].scenarioIds, ["test_001","test_002"]);

    const crossTenant = await handleRequest(new Request(`https://registry.internal/v1/test-registry/projects/prj_test/suite-versions/${version.suiteVersionId}/execution-slice`, {headers:headers("org_other","prj_test")}), env(db));
    assert.equal(crossTenant.status, 404);
  } finally { db.close(); }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { handleRequest } from "../src/index.js";
import { createTestDesignRepository } from "../src/repository/testDesignRepository.js";
import { validateAppendVersionInput } from "../src/validation/testDesignVersion.js";
import { appendPayload } from "./fixtures.mjs";
import { SQLiteD1 } from "./helpers/sqliteD1.mjs";

const migration = fs.readFileSync(new URL("../migrations/0001_test_registry_foundation.sql", import.meta.url), "utf8");

function headers(organizationId = "org_test", projectId = "prj_test") {
  return {
    "content-type": "application/json",
    "x-qagent-organization-id": organizationId,
    "x-qagent-project-id": projectId,
  };
}

function env(db) {
  return {
    ENVIRONMENT: "test",
    TEST_REGISTRY_DB: db,
    TEST_REGISTRY_MAX_SPEC_BYTES: "262144",
    TEST_REGISTRY_MAX_REQUEST_BYTES: "393216",
  };
}

async function post(db, payload, tenantHeaders = headers()) {
  return handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions", {
    method: "POST",
    headers: tenantHeaders,
    body: JSON.stringify(payload),
  }), env(db));
}

test("first append creates Version 1, second creates Version 2, replay is idempotent, and Version 1 stays readable", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const firstPayload = appendPayload({ generationRequestId: "tdg_generation_00000001" });
    const firstResponse = await post(db, firstPayload);
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.data.created, true);
    assert.equal(first.data.testDesign.version, 1);
    assert.match(first.data.testDesign.id, /^td_[0-9a-f]{64}$/);
    assert.match(first.data.testDesign.versionId, /^tdv_/);

    const secondPayload = appendPayload({
      generationRequestId: "tdg_generation_00000002",
      contextFingerprint: "b".repeat(64),
    });
    const secondResponse = await post(db, secondPayload);
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.equal(second.data.testDesign.id, first.data.testDesign.id);
    assert.equal(second.data.testDesign.version, 2);

    const replayResponse = await post(db, secondPayload);
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.data.created, false);
    assert.equal(replay.data.idempotentReplay, true);
    assert.equal(replay.data.testDesign.versionId, second.data.testDesign.versionId);
    assert.equal(replay.data.testDesign.version, 2);

    const latestResponse = await handleRequest(new Request(
      "https://registry.internal/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest",
      { headers: headers() },
    ), env(db));
    assert.equal(latestResponse.status, 200);
    const latest = await latestResponse.json();
    assert.equal(latest.data.exists, true);
    assert.equal(latest.data.version.version, 2);
    assert.equal(latest.data.version.specification.generation.contextFingerprint, "b".repeat(64));

    const exactResponse = await handleRequest(new Request(
      `https://registry.internal/v1/test-registry/test-designs/${first.data.testDesign.id}/versions/1`,
      { headers: headers() },
    ), env(db));
    assert.equal(exactResponse.status, 200);
    const exact = await exactResponse.json();
    assert.equal(exact.data.version.version, 1);
    assert.equal(exact.data.version.generationRequestId, "tdg_generation_00000001");
    assert.equal(exact.data.version.specification.generation.contextFingerprint, "a".repeat(64));

    const rows = db.raw.prepare("SELECT version, generation_request_id FROM test_design_versions ORDER BY version").all();
    assert.deepEqual(rows.map((row) => row.version), [1, 2]);
  } finally {
    db.close();
  }
});

test("latest returns exists=false for an endpoint without a persisted Test Design", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const response = await handleRequest(new Request(
      "https://registry.internal/v1/test-registry/projects/prj_test/endpoints/cep_missing/test-design/latest",
      { headers: headers() },
    ), env(db));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, { exists: false, testDesign: null, version: null });
  } finally {
    db.close();
  }
});

test("exact immutable retrieval is isolated by organization and project", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const createdResponse = await post(db, appendPayload({ generationRequestId: "tdg_generation_scope01" }));
    const created = await createdResponse.json();

    const wrongProject = await handleRequest(new Request(
      `https://registry.internal/v1/test-registry/test-designs/${created.data.testDesign.id}/versions/1`,
      { headers: headers("org_test", "prj_other") },
    ), env(db));
    assert.equal(wrongProject.status, 404);
    assert.equal((await wrongProject.json()).code, "TEST_DESIGN_VERSION_NOT_FOUND");

    const wrongOrganization = await handleRequest(new Request(
      `https://registry.internal/v1/test-registry/test-designs/${created.data.testDesign.id}/versions/1`,
      { headers: headers("org_other", "prj_test") },
    ), env(db));
    assert.equal(wrongOrganization.status, 404);
  } finally {
    db.close();
  }
});

test("same generationRequestId cannot be replayed into another endpoint scope", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const requestId = "tdg_generation_scope02";
    assert.equal((await post(db, appendPayload({ generationRequestId: requestId }))).status, 201);

    const other = appendPayload({
      endpointId: "cep_other",
      generationRequestId: requestId,
    });
    const response = await post(db, other);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "TEST_REGISTRY_IDEMPOTENCY_SCOPE_MISMATCH");
  } finally {
    db.close();
  }
});

test("version allocation retries after a concurrent unique version collision", async () => {
  let injected = false;
  const db = new SQLiteD1({
    beforeBatch(currentDb, _statements, batchCount) {
      if (injected || batchCount !== 1) return;
      injected = true;
      const root = currentDb.raw.prepare("SELECT * FROM test_designs LIMIT 1").get();
      const stamp = "2026-08-20T14:00:00.500Z";
      currentDb.raw.prepare(`
        INSERT INTO test_design_versions (
          id, test_design_id, organization_id, project_id, endpoint_id, version,
          generation_request_id, context_fingerprint, contract_version, specification_version,
          provider, model, scenario_count, ready_count, review_required_count,
          specification_json, generation_metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?)
      `).run(
        "tdv_concurrent",
        root.id,
        root.organization_id,
        root.project_id,
        root.endpoint_id,
        "tdg_concurrent_00000001",
        "f".repeat(64),
        "qagent.test-design.v1",
        "qagent.test-spec.v1",
        "openai",
        "gpt-4o-mini",
        JSON.stringify({ concurrent: true }),
        JSON.stringify({ provider: "openai", model: "gpt-4o-mini" }),
        stamp,
      );
      currentDb.raw.prepare("UPDATE test_designs SET latest_version = 1, latest_version_id = ?, updated_at = ? WHERE id = ?")
        .run("tdv_concurrent", stamp, root.id);
    },
  });
  db.exec(migration);

  try {
    let sequence = 0;
    const repository = createTestDesignRepository(db, {
      versionIdFactory: () => `tdv_local_${++sequence}`,
      now: () => new Date("2026-08-20T14:00:01.000Z"),
      maxVersionRetries: 2,
    });
    const normalized = validateAppendVersionInput(appendPayload({ generationRequestId: "tdg_generation_collision" }));
    const result = await repository.appendVersion(normalized);

    assert.equal(result.created, true);
    assert.equal(result.version.version, 2);
    assert.equal(db.batchCount, 2);
    const versions = db.raw.prepare("SELECT version FROM test_design_versions ORDER BY version").all();
    assert.deepEqual(versions.map((item) => item.version), [1, 2]);
  } finally {
    db.close();
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { RUNNER_TEST_ARTIFACT_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { handleRequest } from "../src/index.js";
import { appendPayload } from "./fixtures.mjs";
import { SQLiteD1 } from "./helpers/sqliteD1.mjs";

const migration = fs.readFileSync(new URL("../migrations/0001_test_registry_foundation.sql", import.meta.url), "utf8");
const schema = JSON.parse(fs.readFileSync(new URL("../contracts/qagent.runner-test-artifact.v1.schema.json", import.meta.url), "utf8"));

function tenantHeaders(organizationId = "org_test", projectId = "prj_test") {
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

async function persist(db, generationRequestId = "tdg_runner_contract_0001") {
  const response = await handleRequest(new Request(
    "https://registry.internal/v1/test-registry/test-designs/versions",
    {
      method: "POST",
      headers: tenantHeaders(),
      body: JSON.stringify(appendPayload({ generationRequestId })),
    },
  ), env(db));
  assert.equal(response.status, 201);
  return response.json();
}

test("Runner artifact contract is frozen as qagent.runner-test-artifact.v1", () => {
  assert.equal(RUNNER_TEST_ARTIFACT_CONTRACT_VERSION, "qagent.runner-test-artifact.v1");
  assert.equal(schema.$id, RUNNER_TEST_ARTIFACT_CONTRACT_VERSION);
  assert.equal(schema.properties.data.properties.contractVersion.const, RUNNER_TEST_ARTIFACT_CONTRACT_VERSION);
});

test("Runner retrieves an immutable TestSpecification by testDesignVersionId", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const persisted = await persist(db);
    const versionId = persisted.data.testDesign.versionId;

    const response = await handleRequest(new Request(
      `https://registry.internal/v1/test-registry/runner/test-design-versions/${versionId}`,
      { headers: tenantHeaders() },
    ), env(db));

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.data.contractVersion, RUNNER_TEST_ARTIFACT_CONTRACT_VERSION);
    assert.equal(body.data.artifact.testDesignVersionId, versionId);
    assert.equal(body.data.artifact.testDesignId, persisted.data.testDesign.id);
    assert.equal(body.data.artifact.version, 1);
    assert.equal(body.data.artifact.organizationId, "org_test");
    assert.equal(body.data.artifact.projectId, "prj_test");
    assert.equal(body.data.artifact.endpointId, "cep_orders");
    assert.equal(body.data.artifact.specificationVersion, "qagent.test-spec.v1");
    assert.equal(body.data.artifact.specification.specificationVersion, "qagent.test-spec.v1");
    assert.equal(body.data.artifact.specification.source.endpointId, "cep_orders");

    // Runner envelope is least-privilege: persistence/idempotency/AI diagnostics stay internal.
    assert.equal("generationRequestId" in body.data.artifact, false);
    assert.equal("provider" in body.data.artifact, false);
    assert.equal("model" in body.data.artifact, false);
    assert.equal("promptVersion" in body.data.artifact, false);
    assert.equal("repairPromptVersion" in body.data.artifact, false);
    assert.equal("guardVersion" in body.data.artifact, false);
    assert.equal("generationMetadata" in body.data.artifact, false);
    assert.equal("safeDiagnostics" in body.data.artifact, false);
  } finally {
    db.close();
  }
});

test("Runner lookup is isolated by organization and project without existence disclosure", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const persisted = await persist(db, "tdg_runner_contract_scope");
    const versionId = persisted.data.testDesign.versionId;

    for (const headers of [
      tenantHeaders("org_other", "prj_test"),
      tenantHeaders("org_test", "prj_other"),
    ]) {
      const response = await handleRequest(new Request(
        `https://registry.internal/v1/test-registry/runner/test-design-versions/${versionId}`,
        { headers },
      ), env(db));
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "TEST_DESIGN_VERSION_NOT_FOUND");
    }
  } finally {
    db.close();
  }
});

test("Runner lookup rejects malformed version ids and missing versions", async () => {
  const db = new SQLiteD1();
  db.exec(migration);
  try {
    const malformed = await handleRequest(new Request(
      "https://registry.internal/v1/test-registry/runner/test-design-versions/not-a-version-id",
      { headers: tenantHeaders() },
    ), env(db));
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "TEST_DESIGN_VERSION_ID_INVALID");

    const missing = await handleRequest(new Request(
      "https://registry.internal/v1/test-registry/runner/test-design-versions/tdv_missing_12345678",
      { headers: tenantHeaders() },
    ), env(db));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "TEST_DESIGN_VERSION_NOT_FOUND");
  } finally {
    db.close();
  }
});

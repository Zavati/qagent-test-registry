import assert from "node:assert/strict";
import test from "node:test";

import { validateAppendVersionInput } from "../src/validation/testDesignVersion.js";
import { appendPayload, sampleSpecification } from "./fixtures.mjs";

test("append validation accepts the real qagent.test-spec.v1 envelope and derives query counters", () => {
  const normalized = validateAppendVersionInput(appendPayload());
  assert.equal(normalized.contractVersion, "qagent.test-design.v1");
  assert.equal(normalized.specificationVersion, "qagent.test-spec.v1");
  assert.equal(normalized.scenarioCount, 1);
  assert.equal(normalized.readyCount, 1);
  assert.equal(normalized.reviewRequiredCount, 0);
  assert.equal(normalized.provider, "openai");
});

test("append validation rejects tenant/source mismatches", () => {
  const specification = sampleSpecification({ organizationId: "org_attacker" });
  assert.throws(
    () => validateAppendVersionInput(appendPayload({ specification })),
    (error) => error.code === "TEST_REGISTRY_SCOPE_MISMATCH" && error.status === 403,
  );
});

test("append validation rejects raw/unknown top-level material instead of persisting it", () => {
  const payload = appendPayload();
  payload.rawModelOutput = { anything: true };
  assert.throws(
    () => validateAppendVersionInput(payload),
    (error) => error.code === "TEST_REGISTRY_FORBIDDEN_FIELD",
  );
});

test("append validation rejects a divergent context fingerprint", () => {
  const payload = appendPayload();
  payload.contextFingerprint = "b".repeat(64);
  assert.throws(
    () => validateAppendVersionInput(payload),
    (error) => error.code === "TEST_REGISTRY_CONTEXT_MISMATCH",
  );
});

test("append validation enforces configured Test Specification byte limits", () => {
  const payload = appendPayload();
  payload.specification.objective = "x".repeat(3000);
  assert.throws(
    () => validateAppendVersionInput(payload, { TEST_REGISTRY_MAX_SPEC_BYTES: "1024" }),
    (error) => error.code === "TEST_REGISTRY_SPEC_TOO_LARGE" && error.status === 413,
  );
});

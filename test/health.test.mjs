import assert from "node:assert/strict";
import test from "node:test";

import worker, { buildHealthPayload, handleRequest } from "../src/index.js";

test("07.7.10-B health payload preserves the Test Artifact Plane identity", () => {
  assert.deepEqual(buildHealthPayload({ ENVIRONMENT: "development" }), {
    status: "ok",
    service: "qagent-test-registry",
    foundation: "07.7.10-B",
    role: "test-artifact-plane",
    environment: "development",
  });
});

test("GET /v1/test-registry/health returns 200 and no-store JSON", async () => {
  const response = await handleRequest(
    new Request("https://registry.internal/v1/test-registry/health"),
    { ENVIRONMENT: "development" },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "qagent-test-registry");
  assert.equal(body.foundation, "07.7.10-B");
  assert.equal(body.role, "test-artifact-plane");
});

test("default Worker export delegates to the same health handler", async () => {
  const response = await worker.fetch(
    new Request("https://registry.internal/v1/test-registry/health"),
    { ENVIRONMENT: "production" },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).environment, "production");
});

test("health rejects methods other than GET", async () => {
  const response = await handleRequest(
    new Request("https://registry.internal/v1/test-registry/health", {
      method: "POST",
    }),
    {},
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal((await response.json()).code, "TEST_REGISTRY_METHOD_NOT_ALLOWED");
});

test("internal append route rejects GET and advertises POST", async () => {
  const response = await handleRequest(
    new Request("https://registry.internal/v1/test-registry/test-designs/versions"),
    {},
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal((await response.json()).code, "TEST_REGISTRY_METHOD_NOT_ALLOWED");
});

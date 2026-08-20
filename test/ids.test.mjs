import assert from "node:assert/strict";
import test from "node:test";

import { buildStableTestDesignId, createTestDesignVersionId } from "../src/domain/ids.js";

test("stable Test Design ID is deterministic for organization/project/endpoint", async () => {
  const scope = { organizationId: "org_1", projectId: "prj_1", endpointId: "cep_1" };
  const first = await buildStableTestDesignId(scope);
  const second = await buildStableTestDesignId(scope);
  const other = await buildStableTestDesignId({ ...scope, endpointId: "cep_2" });

  assert.match(first, /^td_[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("Test Design Version IDs use independent tdv_ UUID identities", () => {
  const first = createTestDesignVersionId();
  const second = createTestDesignVersionId();
  assert.match(first, /^tdv_[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

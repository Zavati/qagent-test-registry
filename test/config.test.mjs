import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("wrangler config declares the dedicated Test Registry worker", () => {
  assert.match(wrangler, /"name"\s*:\s*"qagent-test-registry"/);
  assert.match(wrangler, /"main"\s*:\s*"src\/index\.js"/);
});

test("wrangler config declares TEST_REGISTRY_DB against the dev database", () => {
  assert.match(wrangler, /"binding"\s*:\s*"TEST_REGISTRY_DB"/);
  assert.match(wrangler, /"database_name"\s*:\s*"qagent-test-registry-dev"/);
  assert.match(wrangler, /"migrations_dir"\s*:\s*"migrations"/);
});

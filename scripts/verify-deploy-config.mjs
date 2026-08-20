import fs from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const config = fs.readFileSync(configPath, "utf8");

const failures = [];

if (!config.includes('"binding": "TEST_REGISTRY_DB"')) {
  failures.push("TEST_REGISTRY_DB binding is missing.");
}

if (!config.includes('"database_name": "qagent-test-registry-dev"')) {
  failures.push("qagent-test-registry-dev database name is missing.");
}

if (config.includes("REPLACE_WITH_QAGENT_TEST_REGISTRY_DEV_DATABASE_ID")) {
  failures.push(
    "D1 database_id is still the placeholder. Create qagent-test-registry-dev and paste its database_id into wrangler.jsonc.",
  );
}

if (failures.length > 0) {
  console.error("Deploy configuration is not ready:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deploy configuration OK.");

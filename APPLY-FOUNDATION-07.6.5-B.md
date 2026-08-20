# Apply — Foundation 07.6.5-B

## Important before replacing files

The delivery ZIP cannot know the real D1 UUID created in your Cloudflare account.

Your current deployed 07.6.5-A repository already has the correct value in:

```json
"database_id": "<YOUR_REAL_QAGENT_TEST_REGISTRY_DEV_DATABASE_ID>"
```

The snapshot ZIP still contains the safe placeholder. **Preserve/copy your real existing `database_id` into the new `wrangler.jsonc` before pushing.**

`npm run check:deploy-config` intentionally fails if the placeholder remains.

## 1. Replace the repository snapshot

Apply the B snapshot over `qagent-test-registry`, preserving your real D1 `database_id`.

Do not carry:

```text
node_modules/
.git/
.wrangler/
coverage/
dist/
.env
.dev.vars
```

## 2. Install and test

```bash
npm ci
npm test
```

Expected:

```text
21 passed
0 failed
```

## 3. Verify Cloudflare config

```bash
npm run check:deploy-config
```

Expected:

```text
Deploy configuration OK.
```

## 4. Apply migration remotely

If deploying manually:

```bash
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote
```

The GitHub Actions workflow now performs this migration automatically **before** Worker deploy as well.

Expected migration:

```text
0001_test_registry_foundation.sql
```

## 5. Verify D1 directly

Run:

```bash
npx wrangler d1 execute qagent-test-registry-dev --remote --command="SELECT name, type FROM sqlite_master WHERE name IN ('test_designs','test_design_versions','idx_test_designs_tenant_project_endpoint','idx_test_design_versions_design_version','idx_test_design_versions_context') ORDER BY type, name;"
```

Expected objects:

```text
test_designs
test_design_versions
idx_test_designs_tenant_project_endpoint
idx_test_design_versions_design_version
idx_test_design_versions_context
```

Initially the data tables should be empty:

```bash
npx wrangler d1 execute qagent-test-registry-dev --remote --command="SELECT COUNT(*) AS design_count FROM test_designs; SELECT COUNT(*) AS version_count FROM test_design_versions;"
```

Expected:

```text
design_count = 0
version_count = 0
```

That is correct: Gateway persistence is intentionally deferred to 07.6.5-C.

## 6. Deploy

```bash
npm run deploy
```

or push `main` and let the workflow execute migration + deploy.

## 7. Revalidate public health

Only the health route should remain publicly mapped:

```http
GET https://api.apiqagent.com/v1/test-registry/health
```

Expected:

```json
{
  "status": "ok",
  "service": "qagent-test-registry",
  "foundation": "07.6.5",
  "role": "test-artifact-plane",
  "environment": "development"
}
```

Do not add a public wildcard route for `/v1/test-registry/*`.

## 8. Foundation gate

07.6.5-B can be considered remotely validated when:

- migration 0001 is applied;
- both tables exist;
- all three indexes exist;
- tables are empty before C, as expected;
- Worker health still returns 200;
- no wildcard public Registry data route exists.

The behavioral append/version/idempotency gates are covered locally now and will be validated against real D1 automatically when 07.6.5-C connects the existing Test Design generation flow through Service Binding.

# Apply — Foundation 07.7.10-A FIX-1 / qagent-test-registry

Apply in this order:

```bash
npm ci
npm run check:07.7.10-a-fix-1
npx wrangler d1 migrations list TEST_REGISTRY_DB --remote
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote
npm run deploy
```

Do not edit or replay migrations `0001` or `0002`. The only new migration is:

```text
0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql
```

Verify remote schema:

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='test_design_execution_inventory';"
```

Expected row:

```text
test_design_execution_inventory
```

After the first Project Test Inventory request, legacy latest Test Design Versions are lazily projected. This is expected and is intentionally bounded; no historical full-table migration backfill is required.

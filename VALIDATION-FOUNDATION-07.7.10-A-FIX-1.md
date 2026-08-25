# Validation — Foundation 07.7.10-A FIX-1 / qagent-test-registry

Required validation:

```bash
npm run check:07.7.10-a-fix-1
```

The FIX gate validates:

- migration/indexes for `test_design_execution_inventory`;
- semantic READY remains distinct from execution eligibility;
- mutation-only inventory fails closed for Auto Suite selection;
- write-time projection for new immutable Test Design Versions;
- legacy lazy backfill occurs once and steady-state reads use projection;
- compact responses omit full Suite selection payloads;
- steady-state inventory avoids N+1 D1 reads;
- existing v1 Auto Suite remains immutable and materializes a v2 under selection policy v1.1 when required.

Production behavior:

```text
READY Scenario + GET/HEAD/OPTIONS -> execution eligible
READY Scenario + POST/PUT/PATCH/DELETE -> Policy Hold / MUTATION_EXECUTION_DISABLED
```

Audit projection rows after first inventory access if desired:

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --command="SELECT COUNT(*) AS projection_count FROM test_design_execution_inventory;"
```

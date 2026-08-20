# QAgent Foundation 07.6.5-F — Production Validation Runbook

## Goal

Close Foundation 07.6.5 with production evidence for persistence, immutable versioning, retrieval, Console hydration, isolation, and the frozen future Runner retrieval contract.

## Already validated during A–E

The project has already validated in production:

- Test Registry public health returns 200;
- D1 migration exists remotely;
- POST Test Design persisted Version 1;
- `test_designs.latest_version = 1` and `latest_version_id = tdv_*` were confirmed directly in D1;
- `test_design_versions` contains the matching immutable Version 1;
- Gateway GET returns persisted latest Test Design;
- Gateway GET returns `exists=false` for an endpoint without a Test Design;
- Console hydrates persisted Test Design on page load;
- Console displays the no-Test-Design state correctly;
- Console scenario cards can be expanded independently without changing the adjacent card height.

## Final production gates

### Gate 1 — Endpoint A persistence + reload

1. Open an endpoint with an existing Test Design.
2. Confirm the page performs GET retrieval without automatically calling AI POST.
3. Confirm Version N is rendered.
4. Leave the page and return.
5. Confirm the same Version N is rendered again.

### Gate 2 — Regeneration is N+1 and immutable

1. On Endpoint A click **Gerar novamente** once.
2. Confirm POST returns the same `testDesign.id`, a new `versionId`, and `version = N + 1`.
3. Refresh the page.
4. Confirm GET returns N+1.
5. Query D1 and confirm Version N still exists unchanged.

Suggested SQL:

```sql
SELECT id, latest_version, latest_version_id
FROM test_designs
WHERE endpoint_id = '<ENDPOINT_A>';

SELECT id, test_design_id, version, generation_request_id, context_fingerprint, created_at
FROM test_design_versions
WHERE test_design_id = '<TD_ID>'
ORDER BY version;
```

### Gate 3 — Endpoint B isolation

Use a different endpoint in the same Project.

Expected:

- it has its own stable `td_*` root if generated;
- it never reads Endpoint A's specification;
- if no Test Design exists, GET returns `exists=false`.

### Gate 4 — Project isolation

Attempt access through a user/session that is not authorized for the target Project.

Expected:

- Gateway denies before calling Registry;
- no TestSpecification is returned.

Do not weaken Registry isolation to perform this test.

### Gate 5 — Registry D1 invariants

Run:

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --file=scripts/production-audit-07.6.5-f.sql
```

Every invariant query must return zero rows.

The audit checks:

- duplicate logical roots;
- duplicate immutable version numbers;
- duplicate `generationRequestId` values;
- root/version tenant-scope mismatch;
- invalid latest pointers;
- unsupported contract versions;
- unexpected diagnostics persistence;
- foreign-key violations.

### Gate 6 — Idempotency acceptance

The production architecture must retain:

```text
UNIQUE(generation_request_id)
```

and automated integration coverage proving that replaying the same request returns the already persisted version rather than allocating N+1.

Do **not** expose Registry write routes publicly merely to replay an internal request in production.

### Gate 7 — Safe persistence/logging

Inspect representative Registry/Gateway logs and D1 rows.

Confirm absence of:

- raw system prompts;
- raw model output;
- API keys;
- auth tokens;
- credentials;
- full sensitive request/response payloads.

`safe_diagnostics_json` must remain NULL in Foundation 07.6.5.

### Gate 8 — Frozen Runner contract

After deploying the 07.6.5-F Registry snapshot, the following internal route exists for the future Runner:

```http
GET /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

It is deliberately not exposed through `api.apiqagent.com/v1/test-registry/*`.

Contract:

```text
qagent.runner-test-artifact.v1
```

See `RUNNER-CONTRACT-07.6.5-F.md`.

## Definition of Done

Foundation 07.6.5 is closed when:

- production Gates 1–7 are confirmed;
- Registry F tests are green;
- the Runner contract is deployed and frozen;
- Console/Gateway regressions remain green;
- no public Registry wildcard route exists;
- snapshots are archived without `node_modules`, `.git`, `.wrangler`, `.next`, `.env`, `.dev.vars`, secrets, or local logs.

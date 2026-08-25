# Foundation 07.7.10-A FIX-1 — Test Registry Execution Eligibility + Hot-Path Projection

This FIX separates semantic Test Design readiness from current zero-config Suite execution eligibility and removes full Test Design JSON parsing from the steady-state Automation hot path.

## Contract

- Eligibility contract: `qagent.suite-execution-eligibility.v1`
- Suite selection policy: `qagent.suite-selection-policy.v1.1`
- Safe methods in this policy: `GET`, `HEAD`, `OPTIONS`
- READY mutation methods `POST`, `PUT`, `PATCH`, `DELETE` are retained as READY in the Test Design but held from Auto Suite selection with `MUTATION_EXECUTION_DISABLED`.
- Unsupported/missing methods fail closed with `HTTP_METHOD_UNSUPPORTED` / `HTTP_METHOD_UNRESOLVED`.

## Storage

Migration `0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql` creates `test_design_execution_inventory`.

New immutable Test Design Versions persist a compact non-secret execution projection in the same D1 batch as version/root persistence. Legacy latest versions are lazily backfilled once in bounded batches when Project Test Inventory is read.

Migrations `0001` and `0002` remain immutable and unchanged.

## Performance boundary

Steady-state Project Test Inventory is one project-scoped D1 query regardless of endpoint count. It does not parse `specification_json`, issue per-endpoint queries, or issue per-scenario service calls.

Latest Auto Suite compact read is also one joined D1 query. Compact service views avoid transferring full Suite selections and scenario-id arrays that the Console does not need.

## Security / governance

The projection stores references, method/path metadata and counters only. It never stores request/response bodies, materialized parameter values, auth material, generated/fixed runtime values, Vault material or secrets.

Runner remains the final fail-closed execution authority. This Registry policy is deliberately stricter than runtime feature flags until durable mutation execution exists.

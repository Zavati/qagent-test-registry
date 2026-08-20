# QAgent Foundation 07.6.5-B — D1 Schema + Immutable Versioning

## Status

Implemented locally and ready for remote migration/deploy validation.

## Scope delivered

07.6.5-B turns the Test Registry bootstrap into the first real Test Artifact Plane persistence boundary.

Delivered:

- `migrations/0001_test_registry_foundation.sql`;
- `test_designs` root table with one logical design per `organizationId + projectId + endpointId`;
- `test_design_versions` immutable version table;
- deterministic `td_<sha256>` root identity;
- independent `tdv_<uuid>` immutable version identity;
- `UNIQUE(test_design_id, version)` version protection;
- `UNIQUE(generation_request_id)` idempotency protection;
- append-only Version N+1 allocation;
- small bounded retry after version collisions;
- same `generationRequestId` replay returns the already-created version;
- immutable exact-version retrieval;
- latest-version retrieval;
- tenant/project scoped reads;
- `qagent.test-design.v1` + `qagent.test-spec.v1` envelope checks;
- source scope / context fingerprint consistency checks;
- derived persisted counters (`scenario_count`, `ready_count`, `review_required_count`);
- specification byte limit (default 256 KiB);
- request body byte limit (default 384 KiB);
- `workers_dev: false` so internal data routes are not accidentally exposed through `workers.dev`;
- CI migration step before Worker deployment.

## Internal Registry routes introduced

These are Worker handlers intended for Cloudflare Service Binding access. They must not be mapped to a public wildcard route.

```http
POST /v1/test-registry/test-designs/versions
```

```http
GET /v1/test-registry/projects/:projectId/endpoints/:endpointId/test-design/latest
```

```http
GET /v1/test-registry/test-designs/:testDesignId/versions/:version
```

Internal calls carry:

```text
X-QAgent-Organization-Id
X-QAgent-Project-Id
```

The POST additionally carries tenant identity in the validated payload. Registry cross-checks headers and payload.

## Versioning invariants

1. The root Test Design ID is deterministic for the endpoint scope.
2. A persisted Test Design Version is never updated.
3. New generation = `latestVersion + 1`.
4. `generationRequestId` is globally unique and idempotent.
5. Replaying the same request ID in the same scope returns the existing version.
6. Reusing the same request ID in a different scope is rejected.
7. A version-number collision retries after re-reading the current root pointer.
8. Old versions remain addressable by exact immutable version retrieval.

## Stored artifact

The full validated artifact remains a single versioned document:

```text
specification_json -> qagent.test-spec.v1
```

We deliberately do not split scenario/assertion/DSL fields into separate relational tables in this Foundation.

Only query-useful metadata is projected into columns.

`safe_diagnostics_json` is reserved in the schema but remains `NULL` in 07.6.5-B. The write API intentionally does not accept diagnostics until a dedicated sanitized diagnostics contract is frozen; this prevents accidental persistence of raw model/prompt material.

## D1 schema

Root:

```text
test_designs
```

Immutable versions:

```text
test_design_versions
```

Indexes:

```text
idx_test_designs_tenant_project_endpoint
idx_test_design_versions_design_version
idx_test_design_versions_context
```

## Security boundary

Public ingress remains intentionally narrow:

```text
api.apiqagent.com/v1/test-registry/health
```

Do **not** create:

```text
api.apiqagent.com/v1/test-registry/*
```

The data handlers added in B are for the future path:

```text
Console -> Gateway -> TEST_REGISTRY_SERVICE -> qagent-test-registry
```

`workers_dev` is disabled in the repository configuration to avoid a second public ingress path for those data handlers.

## Validation performed

Local suite validates:

- migration objects/indexes;
- unique logical root;
- deterministic root ID;
- independent version IDs;
- real TestSpecification envelope acceptance;
- scope mismatch rejection;
- forbidden raw top-level field rejection;
- context fingerprint mismatch rejection;
- specification size enforcement;
- Version 1 creation;
- Version 2 creation;
- idempotent replay;
- latest retrieval;
- exact immutable Version 1 after Version 2 exists;
- organization/project isolation;
- generation request cross-scope rejection;
- forced concurrent version collision and successful retry.

Current local result:

```text
21 tests
21 passed
0 failed
```

## Explicitly not included

Still deferred:

- Gateway `TEST_REGISTRY_SERVICE` binding;
- persistence from the existing Console Test Design POST;
- Console-facing GET latest route;
- Console hydration;
- Runner;
- execution results;
- stale detection;
- history UI.

Those remain C/D/E/F work.

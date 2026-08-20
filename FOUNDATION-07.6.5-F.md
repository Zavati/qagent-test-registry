# QAgent Foundation 07.6.5-F
## Production Validation + Runner Contract Freeze

**Status:** Ready for production validation

## Purpose

Close the Test Registry Foundation and freeze the immutable artifact retrieval contract that the future Runner will consume.

## Changes in this snapshot

### 1. Runner lookup by immutable version identity

Added internal route:

```http
GET /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

This resolves the architectural mismatch between a future Execution Plan pinning `tdv_*` and the older diagnostic exact-version route that required `testDesignId + version`.

No D1 migration is required because `test_design_versions.id` is already the primary key.

### 2. Frozen envelope

Contract:

```text
qagent.runner-test-artifact.v1
```

Machine-readable schema:

```text
contracts/qagent.runner-test-artifact.v1.schema.json
```

### 3. Tenant isolation

Lookup requires trusted internal Organization/Project headers and intentionally returns the same 404 for missing and cross-scope versions.

### 4. Least privilege

The Runner envelope excludes Registry-only metadata such as `generationRequestId`, prompt versions, generation metadata, diagnostics, and latest pointers.

### 5. Production audit

Added:

```text
scripts/production-audit-07.6.5-f.sql
PRODUCTION-VALIDATION-07.6.5-F.md
```

The SQL audit checks D1 invariants without exposing internal Registry data routes.

## Tests

The Registry suite now covers:

- stable root IDs;
- immutable Version N allocation;
- idempotent replay;
- concurrent version collision retry;
- latest retrieval;
- exact historical retrieval;
- tenant/project isolation;
- v1 payload validation;
- Runner contract identifier freeze;
- Runner lookup by `testDesignVersionId`;
- least-privilege Runner response;
- cross-tenant non-disclosure;
- malformed/missing version IDs.

## Explicit non-goals

Still out of scope:

- HTTP execution;
- Runner service implementation;
- Execution Plan persistence;
- environment resolution;
- auth token acquisition;
- result persistence;
- scheduler;
- approval workflow;
- stale detection.

## Frozen architectural rule

The future Runner executes a **pinned immutable Test Design version**, never `latest`.

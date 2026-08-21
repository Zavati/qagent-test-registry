# qagent-test-registry

QAgent **Test Artifact Plane** introduced by Foundation **07.6.5**.

Current implementation level: **07.6.5-F — Production Validation + Runner Contract Freeze**.

## Responsibility

`qagent-test-registry` is the source of truth for immutable, versioned Test Designs (`qagent.test-spec.v1`).

It owns:

- one logical Test Design root per Organization + Project + Endpoint;
- immutable Version N artifacts;
- latest-version pointer for Console retrieval;
- deterministic Test Design identity;
- idempotency by `generationRequestId`;
- exact immutable historical retrieval;
- a frozen least-privilege immutable artifact contract for the future Runner.

It does not own AI generation, prompts, Catalog knowledge, execution, or execution results.

## Public health

```http
GET /v1/test-registry/health
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

## Internal data API

For Cloudflare Service Binding use only:

```http
POST /v1/test-registry/test-designs/versions
GET  /v1/test-registry/projects/:projectId/endpoints/:endpointId/test-design/latest
GET  /v1/test-registry/test-designs/:testDesignId/versions/:version
GET  /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

Internal requests use tenant scope headers:

```text
X-QAgent-Organization-Id
X-QAgent-Project-Id
```

Do not expose a public `/v1/test-registry/*` wildcard route.

`workers_dev` is disabled so data handlers are not reachable through a Worker development hostname after deploy.

## Future Runner contract — frozen v1


A future Runner pins one immutable:

```text
testDesignVersionId = tdv_...
```

and reads it with:

```http
GET /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

Envelope contract:

```text
qagent.runner-test-artifact.v1
```

The Runner must never resolve `latest` at execution time.

See:

```text
RUNNER-CONTRACT-07.6.5-F.md
contracts/qagent.runner-test-artifact.v1.schema.json
```

## D1

Binding:

```text
TEST_REGISTRY_DB
```

Development DB:

```text
qagent-test-registry-dev
```

Migration:

```text
migrations/0001_test_registry_foundation.sql
```

No new migration is required by 07.6.5-F.

## Persistence model

```text
test_designs
  -> logical root / latest pointer

test_design_versions
  -> immutable qagent.test-spec.v1 versions
```

A new real generation creates `Version N + 1`.

A retry of the same `generationRequestId` returns the already persisted version.

## Limits

Defaults:

```text
TEST_REGISTRY_MAX_SPEC_BYTES=262144
TEST_REGISTRY_MAX_REQUEST_BYTES=393216
```

## Local validation

```bash
npm ci
npm test
npm run check:deploy-config
```

## Production D1 invariant audit

```bash
npm run db:audit:remote
```

The audit must return zero rows for all invariant violations.

See `PRODUCTION-VALIDATION-07.6.5-F.md`.

## Deployment config

The distributable snapshot uses a database ID placeholder. Preserve/restore the real D1 UUID before deploy, then run:

```bash
npm run check:deploy-config
```

## Architecture

```text
Console
  -> Gateway
     -> Cloudflare Service Binding
        -> qagent-test-registry
           -> TEST_REGISTRY_DB

Future Runner
  -> Cloudflare Service Binding
     -> pinned tdv_* immutable artifact
```

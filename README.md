# qagent-test-registry

QAgent **Test Artifact Plane** introduced by Foundation **07.6.5**.

Current implementation level: **07.6.5-B — D1 Schema + Immutable Versioning**.

## Responsibility

`qagent-test-registry` is the source of truth for immutable, versioned Test Designs (`qagent.test-spec.v1`).

It owns:

- one logical Test Design root per Organization + Project + Endpoint;
- immutable Version N artifacts;
- latest-version pointer;
- deterministic Test Design identity;
- idempotency by `generationRequestId`;
- exact immutable version retrieval for the future Runner.

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

For Service Binding use only:

```http
POST /v1/test-registry/test-designs/versions
GET  /v1/test-registry/projects/:projectId/endpoints/:endpointId/test-design/latest
GET  /v1/test-registry/test-designs/:testDesignId/versions/:version
```

Internal requests use tenant scope headers:

```text
X-QAgent-Organization-Id
X-QAgent-Project-Id
```

Do not expose a public `/v1/test-registry/*` wildcard route.

`workers_dev` is disabled so internal data handlers are not reachable through a Worker development hostname after deploy.

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

Apply manually with:

```bash
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote
```

GitHub Actions also applies pending migrations before Worker deploy.

## Persistence model

```text
test_designs
  -> logical root / latest pointer

test_design_versions
  -> immutable qagent.test-spec.v1 versions
```

A new real generation creates:

```text
Version N + 1
```

A retry of the same:

```text
generationRequestId
```

returns the already persisted version.

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
```

## Deployment config

The repository snapshot uses a database ID placeholder. Replace it with the real existing D1 UUID before deploy, then run:

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
```

Gateway integration begins in **07.6.5-C**.

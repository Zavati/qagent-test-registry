# qagent-test-registry

QAgent Test Artifact Plane service introduced by Foundation **07.6.5**.

This repository starts with **07.6.5-A — Test Registry Service Foundation** only.

## Responsibility

The service will become the source of truth for immutable, versioned Test Designs (`qagent.test-spec.v1`).

In 07.6.5-A it contains only:

- Worker foundation;
- public health endpoint;
- dedicated D1 binding contract (`TEST_REGISTRY_DB`);
- safe default routing (no data routes yet);
- unit/config tests;
- GitHub Actions deployment workflow.

Persistence, immutable version allocation and retrieval are intentionally deferred to 07.6.5-B and later subphases.

The bootstrap Worker currently has no data routes. Before 07.6.5-B exposes internal data handlers, public ingress must be reviewed so those handlers remain Service-Binding-only (or otherwise explicitly protected).

## Health

```http
GET /v1/test-registry/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "qagent-test-registry",
  "foundation": "07.6.5",
  "role": "test-artifact-plane",
  "environment": "development"
}
```

## Local validation

```bash
npm ci
npm test
```

## D1 bootstrap before first deploy

Create the development database:

```bash
npx wrangler d1 create qagent-test-registry-dev
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing:

```text
REPLACE_WITH_QAGENT_TEST_REGISTRY_DEV_DATABASE_ID
```

Then validate deploy configuration:

```bash
npm run check:deploy-config
```

No schema migration is introduced in 07.6.5-A. `0001_test_registry_foundation.sql` belongs to 07.6.5-B.

## Deploy

```bash
npm run deploy
```

Do not expose future Registry data routes directly to the browser. The intended access path remains:

```text
Console -> Gateway -> Cloudflare Service Binding -> qagent-test-registry
```

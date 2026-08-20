# Apply — Foundation 07.6.5-A

## 1. Create the repository

Create a new Git repository named:

```text
qagent-test-registry
```

Copy the contents of this package to the repository root.

## 2. Create the D1 development database

From the repository root, authenticated with the intended Cloudflare account:

```bash
npx wrangler d1 create qagent-test-registry-dev
```

Wrangler returns a `database_id`.

## 3. Bind the database

Open `wrangler.jsonc` and replace:

```text
REPLACE_WITH_QAGENT_TEST_REGISTRY_DEV_DATABASE_ID
```

with the D1 database ID returned in step 2.

Do not rename the binding:

```text
TEST_REGISTRY_DB
```

## 4. Install and validate

```bash
npm ci
npm test
npm run check:deploy-config
```

Expected test result: all tests pass.

## 5. GitHub Actions secrets

Use the same Cloudflare deployment secret pattern already used by QAgent services:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## 6. Deploy

```bash
npm run deploy
```

or push `main` after the deploy configuration is complete.

## 7. Validate the gate

Call:

```http
GET /v1/test-registry/health
```

Expected HTTP 200:

```json
{
  "status": "ok",
  "service": "qagent-test-registry",
  "foundation": "07.6.5",
  "role": "test-artifact-plane",
  "environment": "development"
}
```

## 8. Stop here

Do not create the schema or Gateway integration yet. The next checkpoint is **07.6.5-B — D1 Schema + Immutable Versioning** after the remote health gate is validated.

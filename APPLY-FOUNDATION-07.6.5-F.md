# Apply — Foundation 07.6.5-F

## What to deploy

Only `qagent-test-registry` changes in this snapshot.

No new D1 migration is required.

Gateway 07.6.5-D and Console 07.6.5-E FIX-2 remain compatible and do not need code changes for this Runner contract freeze.

## Before deploy

Preserve the real production `database_id` from the current Registry `wrangler.jsonc`. The distributable snapshot intentionally keeps the placeholder.

Run:

```bash
npm ci
npm test
npm run check:deploy-config
```

Expected Registry tests: all green.

## Deploy

```bash
npm run deploy
```

Do not add a public wildcard route for `/v1/test-registry/*`.

Keep only the explicitly configured public health route if desired:

```text
api.apiqagent.com/v1/test-registry/health
```

All data and Runner routes remain Service-Binding-only.

## Production D1 audit

```bash
npm run db:audit:remote
```

Expected: every invariant query returns zero rows.

## Final acceptance

Follow:

```text
PRODUCTION-VALIDATION-07.6.5-F.md
```

The future Runner contract is documented in:

```text
RUNNER-CONTRACT-07.6.5-F.md
```

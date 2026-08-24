# Apply — Foundation 07.7.10-A / qagent-test-registry

```bash
npm ci
npm run check:07.7.10-a
npx wrangler d1 migrations list TEST_REGISTRY_DB --remote
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote
npm run deploy
```

Do not edit or replay migration `0001`. Apply the new `0002` normally through Wrangler.

Post-deploy health should identify Foundation `07.7.10-A`.

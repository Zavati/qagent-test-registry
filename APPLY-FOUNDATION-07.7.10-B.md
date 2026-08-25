# Apply — 07.7.10-B Test Registry

1. Preserve the existing `TEST_REGISTRY_DB` database ID.
2. `npm ci`
3. `npm run check:07.7.10-b`
4. `npx wrangler d1 migrations list TEST_REGISTRY_DB --remote`
5. `npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote`
6. Verify `test_suite_version_items` exists.
7. Deploy Test Registry before Gateway.

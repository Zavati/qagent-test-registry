# Validation — Foundation 07.7.10-A / qagent-test-registry

Required checks:

```bash
npm run check:07.7.10-a
```

Remote DB audit:

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('test_suites','test_suite_versions') ORDER BY name;"
```

Expected tables: `test_suite_versions`, `test_suites`.

Functional gate: inventory -> materialize -> unchanged replay -> Test Design change -> new immutable Suite version.

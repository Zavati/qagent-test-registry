# Foundation 07.6.5-A — Test Registry Service Foundation

## Goal

Establish the independent `qagent-test-registry` Worker as the QAgent Test Artifact Plane without introducing persistence behavior yet.

## Delivered

- Worker: `qagent-test-registry`.
- Role: `test-artifact-plane`.
- Health route: `GET /v1/test-registry/health`.
- Dedicated D1 binding name: `TEST_REGISTRY_DB`.
- Development D1 database name: `qagent-test-registry-dev`.
- `migrations/` reserved for 07.6.5-B.
- Safe 404/405 responses.
- No CORS/data browser surface.
- Node unit tests and static Wrangler binding checks.
- GitHub Actions CI/deploy workflow.

## Deliberately not implemented

- `test_designs` table.
- `test_design_versions` table.
- append/version APIs.
- latest retrieval.
- immutable-version retrieval.
- Gateway `TEST_REGISTRY_SERVICE` binding.
- Gateway persistence.
- Console hydration.

Those belong to 07.6.5-B through 07.6.5-E.

## Public ingress boundary

07.6.5-A exposes no Registry data route. Before 07.6.5-B adds append/retrieval handlers, review/disable public ingress for those handlers so the architectural path remains `Console -> Gateway -> Service Binding -> Registry`.

## Gate

The subphase is accepted when the remote worker responds:

```http
GET /v1/test-registry/health
```

with HTTP 200 and the expected service identity.

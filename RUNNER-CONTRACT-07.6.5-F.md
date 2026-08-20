# QAgent Runner Contract Freeze — Foundation 07.6.5-F

## Status

**Frozen v1** for future Runner implementation.

This Foundation does **not** implement the Runner. It freezes how a future Runner obtains one immutable Test Design version from the Test Registry.

## Architectural decision

Execution must pin an immutable `testDesignVersionId` (`tdv_*`).

The Runner must **never** resolve `latest` at execution time. Doing so would allow a regeneration between scheduling and execution to silently change the test being executed.

Future execution references should therefore contain at least:

```json
{
  "testDesignVersionId": "tdv_...",
  "environmentId": "env_...",
  "scenarioIds": ["test_001"]
}
```

## Internal Registry route — frozen v1

```http
GET /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

This is an **internal Service Binding route**. Do not create a public wildcard route for it.

Required internal scope headers:

```text
X-QAgent-Organization-Id
X-QAgent-Project-Id
```

The Registry returns `404 TEST_DESIGN_VERSION_NOT_FOUND` both when the version does not exist and when it exists outside the supplied Organization/Project scope. This prevents existence disclosure across tenants.

## Response contract

Contract identifier:

```text
qagent.runner-test-artifact.v1
```

Example:

```json
{
  "status": "ok",
  "data": {
    "contractVersion": "qagent.runner-test-artifact.v1",
    "artifact": {
      "testDesignId": "td_...",
      "testDesignVersionId": "tdv_...",
      "version": 2,
      "organizationId": "org_...",
      "projectId": "prj_...",
      "endpointId": "cep_...",
      "contextFingerprint": "...",
      "specificationVersion": "qagent.test-spec.v1",
      "createdAt": "2026-08-20T22:41:20.906Z",
      "specification": {}
    }
  }
}
```

Machine-readable envelope schema:

```text
contracts/qagent.runner-test-artifact.v1.schema.json
```

## Least-privilege response

The Runner envelope does not expose Registry persistence internals such as:

- `generationRequestId`;
- `promptVersion`;
- `repairPromptVersion`;
- Registry `safeDiagnostics`;
- Registry `generationMetadata`;
- latest-version pointers.

The immutable `specification` remains the complete `qagent.test-spec.v1` artifact and can include its own generation provenance as defined by that contract.

## Runner execution rules frozen now

The future Runner must:

1. receive a pinned `testDesignVersionId` from an authorized execution/control-plane flow;
2. fetch exactly that immutable version through Service Binding;
3. validate `qagent.runner-test-artifact.v1` and `qagent.test-spec.v1` before execution;
4. confirm Organization/Project scope from trusted internal context;
5. execute only explicitly selected scenarios;
6. execute automatically only scenarios whose `automation.readiness` is `READY`;
7. fail closed for `NEEDS_ENVIRONMENT`, `NEEDS_DATA`, `NEEDS_AUTH`, `REVIEW_REQUIRED`, unknown readiness, unknown DSL version, or unsupported assertion types;
8. never mutate the Test Design or its TestSpecification;
9. persist the exact `testDesignVersionId` with the future Run/Execution Result;
10. never replace a pinned version with `latest` during retries or execution.

## Compatibility rule

`qagent.runner-test-artifact.v1` is frozen.

Breaking changes require a new contract version (for example `qagent.runner-test-artifact.v2`) rather than silently changing the v1 envelope.

Additive internal implementation changes are allowed only if the v1 response remains valid and semantically identical.

## Existing exact route

The existing Registry route remains available for Registry-level diagnostics/tests:

```http
GET /v1/test-registry/test-designs/:testDesignId/versions/:version
```

It is **not** the Runner contract. The future Runner should use the pinned `testDesignVersionId` route above.

export function sampleSpecification({
  organizationId = "org_test",
  projectId = "prj_test",
  endpointId = "cep_orders",
  contextFingerprint = "a".repeat(64),
  readiness = "READY",
} = {}) {
  return {
    contractVersion: "qagent.test-design.v1",
    specificationVersion: "qagent.test-spec.v1",
    source: {
      type: "CATALOG_ENDPOINT",
      organizationId,
      projectId,
      endpointId,
    },
    title: "Orders API test design",
    objective: "Validate the observed Orders endpoint.",
    assumptions: [],
    summary: {
      scenarioCount: 1,
      readyCount: readiness === "READY" ? 1 : 0,
      byCategory: { HAPPY_PATH: 1 },
      byReadiness: { [readiness]: 1 },
      byGrounding: { OBSERVED: 1 },
    },
    scenarios: [
      {
        scenarioId: "test_001",
        title: "Returns an order",
        objective: "Validate the observed response.",
        category: "HAPPY_PATH",
        priority: "HIGH",
        confidence: "HIGH",
        grounding: {
          level: "OBSERVED",
          rationale: ["Observed in catalog evidence."],
          evidenceRefs: ["ev_1"],
          schemaRefs: [],
        },
        automation: {
          readiness,
          blockers: readiness === "READY" ? [] : ["Requires review."],
        },
        preconditions: [],
        spec: {
          dslVersion: "qagent.api-test-dsl.v1",
          type: "api",
          target: {
            catalogEndpointId: endpointId,
            apiServiceKey: "orders",
            method: "GET",
            path: "/orders/{id}",
          },
          auth: { requirement: "NONE", authProfileRef: null },
          request: { pathParams: { id: "1" }, query: {}, headers: {}, body: null },
          assertions: [{ type: "STATUS", expected: 200 }],
          extract: [],
        },
      },
    ],
    generation: {
      mode: "AI",
      provider: "openai",
      model: "gpt-4o-mini",
      generatedAt: "2026-08-20T14:00:00.000Z",
      contextFingerprint,
    },
  };
}

export function appendPayload(overrides = {}) {
  const organizationId = overrides.organizationId ?? "org_test";
  const projectId = overrides.projectId ?? "prj_test";
  const endpointId = overrides.endpointId ?? "cep_orders";
  const contextFingerprint = overrides.contextFingerprint ?? "a".repeat(64);
  const specification = overrides.specification ?? sampleSpecification({
    organizationId,
    projectId,
    endpointId,
    contextFingerprint,
    readiness: overrides.readiness ?? "READY",
  });

  return {
    organizationId,
    projectId,
    endpointId,
    generationRequestId: overrides.generationRequestId ?? "tdg_12345678-abcd-4abc-8def-123456789abc",
    contextFingerprint,
    specification,
    metadata: overrides.metadata ?? {
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "qagent.test-design-prompt.v5",
      repairPromptVersion: "qagent.test-design-repair-prompt.v1",
      guardVersion: "qagent.semantic-grounding-guard.v1.2",
    },
  };
}

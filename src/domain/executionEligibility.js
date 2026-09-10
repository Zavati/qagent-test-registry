import { TestRegistryError } from "./errors.js";

export const SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION = "qagent.suite-execution-eligibility.v1";
export const SUITE_SELECTION_POLICY_VERSION = "qagent.suite-selection-policy.v2";
export const SUITE_SELECTION_POLICY = "LATEST_TEST_DESIGNS_READY_SCENARIOS";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SIDE_EFFECT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseSpecification(specificationJson) {
  try {
    const specification = typeof specificationJson === "string"
      ? JSON.parse(specificationJson)
      : specificationJson;
    if (!specification || typeof specification !== "object") throw new Error("invalid specification");
    return specification;
  } catch (cause) {
    throw new TestRegistryError("Persisted Test Design specification is invalid.", {
      code: "TEST_REGISTRY_CORRUPT_ARTIFACT",
      status: 500,
      retryable: false,
      details: { field: "specification_json" },
      cause,
    });
  }
}

function normalizeMethod(value) {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "";
  return method || null;
}

function normalizeTarget(scenario) {
  const target = scenario?.spec?.target;
  return {
    method: normalizeMethod(target?.method),
    path: typeof target?.path === "string" && target.path.length > 0 ? target.path : null,
    apiServiceKey: typeof target?.apiServiceKey === "string" && target.apiServiceKey.length > 0
      ? target.apiServiceKey
      : null,
  };
}

export function classifySuiteExecutionEligibility(scenario) {
  if (scenario?.automation?.readiness !== "READY") {
    return { eligible: false, candidate: false, reason: null, method: normalizeMethod(scenario?.spec?.target?.method) };
  }
  const method = normalizeMethod(scenario?.spec?.target?.method);
  if (!method) {
    return { eligible: false, candidate: true, reason: "HTTP_METHOD_UNRESOLVED", method: null };
  }
  if (SAFE_METHODS.has(method)) {
    return { eligible: true, candidate: true, reason: null, method };
  }
  if (SIDE_EFFECT_METHODS.has(method)) {
    return { eligible: false, candidate: true, reason: "MUTATION_EXECUTION_DISABLED", method };
  }
  return { eligible: false, candidate: true, reason: "HTTP_METHOD_UNSUPPORTED", method };
}

export function buildTestDesignExecutionProjection({
  specificationJson,
  testDesignVersionId,
  testDesignId,
  organizationId,
  projectId,
  endpointId,
  testDesignVersion,
  createdAt,
}) {
  const specification = parseSpecification(specificationJson);
  const scenarios = Array.isArray(specification.scenarios) ? specification.scenarios : [];

  const scenarioOrigins = scenarios.map((scenario) => {
    const b = scenario.baseline;
    return {
      scenarioId: scenario.scenarioId,
      generationClass: scenario.generationClass || "LEGACY",
      readiness: scenario.automation?.readiness || "REVIEW_REQUIRED",
      ...(scenario.generationClass === "OBSERVED_BASELINE" && b ? {
        baselineId: b.baselineId, sourceEventId: b.source.eventId,
        sourceEvidenceId: b.source.evidenceId, observationSessionId: b.source.observationSessionId,
        environmentId: b.source.environmentId, observedAt: b.source.observedAt,
        expiresAt: b.expiresAt, schemaVersionId: b.responseSchemaVersionId,
        schemaHash: b.responseSchemaHash, comparisonMode: b.comparisonPolicy.mode,
        requestCoverage: b.requestCoverage.status, responseCoverage: b.responseCoverage.status,
        selfCheck: b.selfCheck,
      } : {}),
    };
  });
  const readyScenarioIds = [];
  const executionEligibleScenarioIds = [];
  const policyBlockedReadyScenarioIds = [];
  const policyBlockedReasonCounts = {};
  let reviewRequiredScenarioCount = 0;
  let needsDataScenarioCount = 0;
  let needsAuthScenarioCount = 0;
  let firstTarget = null;

  for (const scenario of scenarios) {
    const readiness = scenario?.automation?.readiness;
    if (readiness === "REVIEW_REQUIRED") reviewRequiredScenarioCount += 1;
    if (readiness === "NEEDS_DATA") needsDataScenarioCount += 1;
    if (readiness === "NEEDS_AUTH") needsAuthScenarioCount += 1;

    const target = normalizeTarget(scenario);
    if (!firstTarget && (target.method || target.path || target.apiServiceKey)) firstTarget = target;

    if (readiness !== "READY") continue;
    const scenarioId = typeof scenario?.scenarioId === "string" && scenario.scenarioId.length > 0
      ? scenario.scenarioId
      : null;
    if (!scenarioId) continue;

    readyScenarioIds.push(scenarioId);
    const eligibility = classifySuiteExecutionEligibility(scenario);
    if (eligibility.eligible) {
      executionEligibleScenarioIds.push(scenarioId);
      if (!firstTarget) firstTarget = target;
      continue;
    }
    policyBlockedReadyScenarioIds.push(scenarioId);
    const reason = eligibility.reason || "EXECUTION_POLICY_BLOCKED";
    policyBlockedReasonCounts[reason] = (policyBlockedReasonCounts[reason] || 0) + 1;
  }

  const blockedScenarioCount = Math.max(0, scenarios.length - readyScenarioIds.length);
  return {
    testDesignVersionId,
    testDesignId,
    organizationId,
    projectId,
    endpointId,
    testDesignVersion,
    title: typeof specification.title === "string" ? specification.title : null,
    method: firstTarget?.method || null,
    path: firstTarget?.path || null,
    apiServiceKey: firstTarget?.apiServiceKey || null,
    scenarioCount: scenarios.length,
    readyScenarioCount: readyScenarioIds.length,
    reviewRequiredScenarioCount,
    needsDataScenarioCount,
    needsAuthScenarioCount,
    blockedScenarioCount,
    executionEligibleScenarioCount: executionEligibleScenarioIds.length,
    policyBlockedReadyScenarioCount: policyBlockedReadyScenarioIds.length,
    scenarioOrigins,
    readyScenarioIds,
    executionEligibleScenarioIds,
    policyBlockedReadyScenarioIds,
    policyBlockedReasonCounts,
    eligibilityPolicyVersion: SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION,
    createdAt,
  };
}

export function projectionInsertStatement(db, projection) {
  return db.prepare(`
    INSERT OR IGNORE INTO test_design_execution_inventory (
      test_design_version_id, test_design_id, organization_id, project_id, endpoint_id,
      test_design_version, title, target_method, target_path, api_service_key,
      scenario_count, ready_scenario_count, review_required_scenario_count,
      needs_data_scenario_count, needs_auth_scenario_count, blocked_scenario_count,
      execution_eligible_scenario_count, policy_blocked_ready_scenario_count,
      ready_scenario_ids_json, execution_eligible_scenario_ids_json,
      policy_blocked_ready_scenario_ids_json, policy_blocked_reason_counts_json,
      eligibility_policy_version, created_at, scenario_origins_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    projection.testDesignVersionId,
    projection.testDesignId,
    projection.organizationId,
    projection.projectId,
    projection.endpointId,
    projection.testDesignVersion,
    projection.title,
    projection.method,
    projection.path,
    projection.apiServiceKey,
    projection.scenarioCount,
    projection.readyScenarioCount,
    projection.reviewRequiredScenarioCount,
    projection.needsDataScenarioCount,
    projection.needsAuthScenarioCount,
    projection.blockedScenarioCount,
    projection.executionEligibleScenarioCount,
    projection.policyBlockedReadyScenarioCount,
    JSON.stringify(projection.readyScenarioIds),
    JSON.stringify(projection.executionEligibleScenarioIds),
    JSON.stringify(projection.policyBlockedReadyScenarioIds),
    JSON.stringify(projection.policyBlockedReasonCounts),
    projection.eligibilityPolicyVersion,
    projection.createdAt,
    JSON.stringify(projection.scenarioOrigins || []),
  );
}

export function isSafeSuiteMethod(method) {
  return SAFE_METHODS.has(normalizeMethod(method));
}

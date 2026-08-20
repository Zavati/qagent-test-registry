import { TestRegistryError } from "../domain/errors.js";

export const TEST_DESIGN_CONTRACT_VERSION = "qagent.test-design.v1";
export const TEST_SPECIFICATION_VERSION = "qagent.test-spec.v1";
export const DEFAULT_MAX_SPEC_BYTES = 256 * 1024;
export const DEFAULT_MAX_REQUEST_BYTES = 384 * 1024;

const TOP_LEVEL_SPEC_KEYS = new Set([
  "contractVersion",
  "specificationVersion",
  "source",
  "title",
  "objective",
  "assumptions",
  "summary",
  "scenarios",
  "generation",
]);

const METADATA_KEYS = new Set([
  "provider",
  "model",
  "promptVersion",
  "repairPromptVersion",
  "guardVersion",
]);

function fail(message, path, code = "TEST_REGISTRY_PAYLOAD_INVALID", status = 400) {
  throw new TestRegistryError(message, { code, status, path });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail("Expected an object.", path);
  return value;
}

function assertString(value, path, { max = 256, pattern = null } = {}) {
  if (typeof value !== "string" || !value.trim()) fail("Expected a non-empty string.", path);
  const normalized = value.trim();
  if (normalized.length > max) fail(`String exceeds maximum length ${max}.`, path);
  if (pattern && !pattern.test(normalized)) fail("Invalid string format.", path);
  return normalized;
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`Unknown or forbidden field: ${key}.`, `${path}.${key}`, "TEST_REGISTRY_FORBIDDEN_FIELD");
    }
  }
}

function byteLengthJson(value, path) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("Value is not JSON serializable.", path);
  }

  if (serialized === undefined) fail("Value is not JSON serializable.", path);
  return { serialized, bytes: new TextEncoder().encode(serialized).byteLength };
}

function parsePositiveLimit(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function registryLimits(env = {}) {
  return {
    maxSpecBytes: parsePositiveLimit(env.TEST_REGISTRY_MAX_SPEC_BYTES, DEFAULT_MAX_SPEC_BYTES),
    maxRequestBytes: parsePositiveLimit(env.TEST_REGISTRY_MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES),
  };
}

function validateSummary(specification) {
  const summary = assertPlainObject(specification.summary, "specification.summary");
  const scenarios = specification.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length < 1 || scenarios.length > 20) {
    fail("Specification must contain between 1 and 20 scenarios.", "specification.scenarios");
  }

  const scenarioCount = scenarios.length;
  const readyCount = scenarios.filter((scenario) => scenario?.automation?.readiness === "READY").length;
  const reviewRequiredCount = scenarios.filter((scenario) => scenario?.automation?.readiness === "REVIEW_REQUIRED").length;

  if (!Number.isInteger(summary.scenarioCount) || summary.scenarioCount !== scenarioCount) {
    fail("summary.scenarioCount does not match scenarios.", "specification.summary.scenarioCount", "TEST_REGISTRY_SUMMARY_MISMATCH");
  }
  if (!Number.isInteger(summary.readyCount) || summary.readyCount !== readyCount) {
    fail("summary.readyCount does not match scenarios.", "specification.summary.readyCount", "TEST_REGISTRY_SUMMARY_MISMATCH");
  }

  return { scenarioCount, readyCount, reviewRequiredCount };
}

export function validateAppendVersionInput(input, env = {}) {
  const payload = assertPlainObject(input, "payload");
  assertKnownKeys(payload, new Set([
    "organizationId",
    "projectId",
    "endpointId",
    "generationRequestId",
    "contextFingerprint",
    "specification",
    "metadata",
  ]), "payload");

  const organizationId = assertString(payload.organizationId, "payload.organizationId", { max: 160 });
  const projectId = assertString(payload.projectId, "payload.projectId", { max: 160 });
  const endpointId = assertString(payload.endpointId, "payload.endpointId", { max: 200 });
  const generationRequestId = assertString(payload.generationRequestId, "payload.generationRequestId", {
    max: 128,
    pattern: /^tdg_[A-Za-z0-9_-]{8,124}$/,
  });
  const contextFingerprint = assertString(payload.contextFingerprint, "payload.contextFingerprint", {
    max: 64,
    pattern: /^[0-9a-f]{64}$/,
  });

  const specification = assertPlainObject(payload.specification, "payload.specification");
  assertKnownKeys(specification, TOP_LEVEL_SPEC_KEYS, "payload.specification");

  if (specification.contractVersion !== TEST_DESIGN_CONTRACT_VERSION) {
    fail(`contractVersion must be ${TEST_DESIGN_CONTRACT_VERSION}.`, "payload.specification.contractVersion", "TEST_REGISTRY_CONTRACT_UNSUPPORTED");
  }
  if (specification.specificationVersion !== TEST_SPECIFICATION_VERSION) {
    fail(`specificationVersion must be ${TEST_SPECIFICATION_VERSION}.`, "payload.specification.specificationVersion", "TEST_REGISTRY_SPECIFICATION_UNSUPPORTED");
  }

  const source = assertPlainObject(specification.source, "payload.specification.source");
  if (source.type !== "CATALOG_ENDPOINT") fail("Unsupported specification source type.", "payload.specification.source.type");
  if (source.organizationId !== organizationId) fail("organizationId differs from specification source.", "payload.specification.source.organizationId", "TEST_REGISTRY_SCOPE_MISMATCH", 403);
  if (source.projectId !== projectId) fail("projectId differs from specification source.", "payload.specification.source.projectId", "TEST_REGISTRY_SCOPE_MISMATCH", 403);
  if (source.endpointId !== endpointId) fail("endpointId differs from specification source.", "payload.specification.source.endpointId", "TEST_REGISTRY_SCOPE_MISMATCH", 403);

  const generation = assertPlainObject(specification.generation, "payload.specification.generation");
  if (generation.contextFingerprint !== contextFingerprint) {
    fail("contextFingerprint differs from specification generation metadata.", "payload.specification.generation.contextFingerprint", "TEST_REGISTRY_CONTEXT_MISMATCH");
  }

  const provider = assertString(generation.provider, "payload.specification.generation.provider", { max: 80 });
  const model = assertString(generation.model, "payload.specification.generation.model", { max: 160 });
  const counts = validateSummary(specification);

  const metadata = payload.metadata == null ? {} : assertPlainObject(payload.metadata, "payload.metadata");
  assertKnownKeys(metadata, METADATA_KEYS, "payload.metadata");
  if (metadata.provider != null && assertString(metadata.provider, "payload.metadata.provider", { max: 80 }) !== provider) {
    fail("metadata.provider differs from specification generation provider.", "payload.metadata.provider", "TEST_REGISTRY_GENERATION_METADATA_MISMATCH");
  }
  if (metadata.model != null && assertString(metadata.model, "payload.metadata.model", { max: 160 }) !== model) {
    fail("metadata.model differs from specification generation model.", "payload.metadata.model", "TEST_REGISTRY_GENERATION_METADATA_MISMATCH");
  }

  for (const key of ["promptVersion", "repairPromptVersion", "guardVersion"]) {
    if (metadata[key] != null) assertString(metadata[key], `payload.metadata.${key}`, { max: 160 });
  }

  const limits = registryLimits(env);
  const specJson = byteLengthJson(specification, "payload.specification");
  if (specJson.bytes > limits.maxSpecBytes) {
    throw new TestRegistryError("Test Specification exceeds persistence limit.", {
      code: "TEST_REGISTRY_SPEC_TOO_LARGE",
      status: 413,
      path: "payload.specification",
      details: { bytes: specJson.bytes, maxBytes: limits.maxSpecBytes },
    });
  }

  const normalizedMetadata = {
    provider,
    model,
    promptVersion: metadata.promptVersion ?? null,
    repairPromptVersion: metadata.repairPromptVersion ?? null,
    guardVersion: metadata.guardVersion ?? null,
  };

  return {
    organizationId,
    projectId,
    endpointId,
    generationRequestId,
    contextFingerprint,
    contractVersion: specification.contractVersion,
    specificationVersion: specification.specificationVersion,
    specification,
    specificationJson: specJson.serialized,
    generationMetadataJson: JSON.stringify(normalizedMetadata),
    safeDiagnosticsJson: null,
    provider,
    model,
    promptVersion: normalizedMetadata.promptVersion,
    repairPromptVersion: normalizedMetadata.repairPromptVersion,
    guardVersion: normalizedMetadata.guardVersion,
    ...counts,
  };
}

export function validateInternalTenantHeaders(request, expected = {}) {
  const organizationId = assertString(request.headers.get("x-qagent-organization-id"), "headers.x-qagent-organization-id", { max: 160 });
  const projectId = assertString(request.headers.get("x-qagent-project-id"), "headers.x-qagent-project-id", { max: 160 });

  if (expected.organizationId && organizationId !== expected.organizationId) {
    fail("Organization header differs from payload scope.", "headers.x-qagent-organization-id", "TEST_REGISTRY_SCOPE_MISMATCH", 403);
  }
  if (expected.projectId && projectId !== expected.projectId) {
    fail("Project header differs from payload/path scope.", "headers.x-qagent-project-id", "TEST_REGISTRY_SCOPE_MISMATCH", 403);
  }

  return { organizationId, projectId };
}

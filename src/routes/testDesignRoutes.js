import { TestRegistryError } from "../domain/errors.js";
import { createTestDesignRepository } from "../repository/testDesignRepository.js";
import {
  registryLimits,
  validateAppendVersionInput,
  validateInternalTenantHeaders,
} from "../validation/testDesignVersion.js";

export async function readJsonBody(request, env = {}) {
  const { maxRequestBytes } = registryLimits(env);
  const declaredLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    throw new TestRegistryError("Request body exceeds persistence limit.", {
      code: "TEST_REGISTRY_REQUEST_TOO_LARGE",
      status: 413,
      details: { maxBytes: maxRequestBytes },
    });
  }

  const text = await request.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxRequestBytes) {
    throw new TestRegistryError("Request body exceeds persistence limit.", {
      code: "TEST_REGISTRY_REQUEST_TOO_LARGE",
      status: 413,
      details: { bytes, maxBytes: maxRequestBytes },
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new TestRegistryError("Request body must be valid JSON.", {
      code: "TEST_REGISTRY_JSON_INVALID",
      status: 400,
    });
  }
}

export async function appendVersionRoute(request, env) {
  const body = await readJsonBody(request, env);
  const input = validateAppendVersionInput(body, env);
  validateInternalTenantHeaders(request, input);

  const repository = createTestDesignRepository(env.TEST_REGISTRY_DB);
  const result = await repository.appendVersion(input);

  return {
    status: result.created ? 201 : 200,
    body: {
      status: "ok",
      data: {
        created: result.created,
        idempotentReplay: result.idempotentReplay,
        testDesign: {
          id: result.version.testDesignId,
          versionId: result.version.id,
          version: result.version.version,
          organizationId: result.version.organizationId,
          projectId: result.version.projectId,
          endpointId: result.version.endpointId,
          contextFingerprint: result.version.contextFingerprint,
          createdAt: result.version.createdAt,
        },
      },
    },
  };
}

export async function latestVersionRoute(request, env, { projectId, endpointId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createTestDesignRepository(env.TEST_REGISTRY_DB);
  const result = await repository.getLatest({
    organizationId: scope.organizationId,
    projectId,
    endpointId,
  });

  return {
    status: 200,
    body: {
      status: "ok",
      data: result,
    },
  };
}

export async function exactVersionRoute(request, env, { testDesignId, version }) {
  const scope = validateInternalTenantHeaders(request);
  const parsedVersion = Number.parseInt(version, 10);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1 || String(parsedVersion) !== version) {
    throw new TestRegistryError("Version must be a positive integer.", {
      code: "TEST_REGISTRY_VERSION_INVALID",
      status: 400,
      path: "path.version",
    });
  }

  const repository = createTestDesignRepository(env.TEST_REGISTRY_DB);
  const artifact = await repository.getExactVersion({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    testDesignId,
    version: parsedVersion,
  });

  if (!artifact) {
    throw new TestRegistryError("Test Design version not found.", {
      code: "TEST_DESIGN_VERSION_NOT_FOUND",
      status: 404,
    });
  }

  return {
    status: 200,
    body: {
      status: "ok",
      data: { version: artifact },
    },
  };
}

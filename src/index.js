import { asTestRegistryError } from "./domain/errors.js";
import {
  appendVersionRoute,
  exactVersionRoute,
  latestVersionRoute,
  runnerArtifactRoute,
} from "./routes/testDesignRoutes.js";
import {
  latestAutoReadySuiteRoute,
  materializeAutoReadySuiteRoute,
  projectTestInventoryRoute,
} from "./routes/suiteRoutes.js";

const SERVICE_NAME = "qagent-test-registry";
const FOUNDATION = "07.7.10-A";
const ROLE = "test-artifact-plane";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function notFound() {
  return json(
    {
      status: "error",
      code: "TEST_REGISTRY_ROUTE_NOT_FOUND",
      message: "Route not found.",
    },
    { status: 404 },
  );
}

function methodNotAllowed(allowed) {
  return json(
    {
      status: "error",
      code: "TEST_REGISTRY_METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
    },
    {
      status: 405,
      headers: {
        allow: allowed.join(", "),
      },
    },
  );
}

function errorResponse(error) {
  const safe = asTestRegistryError(error);
  const body = {
    status: "error",
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable,
  };
  if (safe.path) body.path = safe.path;
  if (safe.details) body.details = safe.details;
  return json(body, { status: safe.status });
}

export function buildHealthPayload(env = {}) {
  return {
    status: "ok",
    service: SERVICE_NAME,
    foundation: FOUNDATION,
    role: ROLE,
    environment: String(env.ENVIRONMENT || "development"),
  };
}

function matchLatestRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/projects\/([^/]+)\/endpoints\/([^/]+)\/test-design\/latest$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]), endpointId: decodeURIComponent(match[2]) };
}

function matchExactVersionRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/test-designs\/([^/]+)\/versions\/([^/]+)$/);
  if (!match) return null;
  return { testDesignId: decodeURIComponent(match[1]), version: decodeURIComponent(match[2]) };
}

function matchRunnerArtifactRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/runner\/test-design-versions\/([^/]+)$/);
  if (!match) return null;
  return { testDesignVersionId: decodeURIComponent(match[1]) };
}


function matchProjectInventoryRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/projects\/([^/]+)\/test-inventory$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]) };
}

function matchAutoSuiteMaterializeRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/projects\/([^/]+)\/suites\/auto-ready\/materialize$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]) };
}

function matchAutoSuiteLatestRoute(pathname) {
  const match = pathname.match(/^\/v1\/test-registry\/projects\/([^/]+)\/suites\/auto-ready\/latest$/);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]) };
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/v1/test-registry/health") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return json(buildHealthPayload(env), { status: 200 });
    }

    if (url.pathname === "/v1/test-registry/test-designs/versions") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const result = await appendVersionRoute(request, env);
      return json(result.body, { status: result.status });
    }

    const inventoryParams = matchProjectInventoryRoute(url.pathname);
    if (inventoryParams) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const result = await projectTestInventoryRoute(request, env, inventoryParams);
      return json(result.body, { status: result.status });
    }

    const materializeParams = matchAutoSuiteMaterializeRoute(url.pathname);
    if (materializeParams) {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      const result = await materializeAutoReadySuiteRoute(request, env, materializeParams);
      return json(result.body, { status: result.status });
    }

    const latestSuiteParams = matchAutoSuiteLatestRoute(url.pathname);
    if (latestSuiteParams) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const result = await latestAutoReadySuiteRoute(request, env, latestSuiteParams);
      return json(result.body, { status: result.status });
    }

    const latestParams = matchLatestRoute(url.pathname);
    if (latestParams) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const result = await latestVersionRoute(request, env, latestParams);
      return json(result.body, { status: result.status });
    }

    const exactParams = matchExactVersionRoute(url.pathname);
    if (exactParams) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const result = await exactVersionRoute(request, env, exactParams);
      return json(result.body, { status: result.status });
    }

    const runnerParams = matchRunnerArtifactRoute(url.pathname);
    if (runnerParams) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const result = await runnerArtifactRoute(request, env, runnerParams);
      return json(result.body, { status: result.status });
    }

    return notFound();
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

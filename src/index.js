const SERVICE_NAME = "qagent-test-registry";
const FOUNDATION = "07.6.5";
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

export function buildHealthPayload(env = {}) {
  return {
    status: "ok",
    service: SERVICE_NAME,
    foundation: FOUNDATION,
    role: ROLE,
    environment: String(env.ENVIRONMENT || "development"),
  };
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);

  if (url.pathname === "/v1/test-registry/health") {
    if (request.method !== "GET") {
      return methodNotAllowed(["GET"]);
    }

    return json(buildHealthPayload(env), { status: 200 });
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

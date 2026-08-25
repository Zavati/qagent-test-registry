import {
  compactAutoSuiteResult,
  compactProjectInventory,
  createSuiteRepository,
} from "../repository/suiteRepository.js";
import { validateInternalTenantHeaders } from "../validation/testDesignVersion.js";

function compactRequested(request) {
  const view = new URL(request.url).searchParams.get("view");
  return view === "compact" || view === "summary";
}

export async function projectTestInventoryRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const compact = compactRequested(request);
  const inventory = await repository.buildProjectInventory({ organizationId: scope.organizationId, projectId, compact });
  const data = compact ? compactProjectInventory(inventory) : inventory;
  return { status: 200, body: { status: "ok", data } };
}

export async function materializeAutoReadySuiteRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const result = await repository.materializeAutoReadySuite({ organizationId: scope.organizationId, projectId });
  const data = compactRequested(request) ? compactAutoSuiteResult(result) : result;
  return { status: result.created ? 201 : 200, body: { status: "ok", data } };
}

export async function latestAutoReadySuiteRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const compact = compactRequested(request);
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const result = await repository.getLatestAutoSuite({
    organizationId: scope.organizationId,
    projectId,
    includeSelection: !compact,
  });
  return { status: 200, body: { status: "ok", data: result } };
}

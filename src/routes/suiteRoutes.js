import { createSuiteRepository } from "../repository/suiteRepository.js";
import { validateInternalTenantHeaders } from "../validation/testDesignVersion.js";

export async function projectTestInventoryRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const inventory = await repository.buildProjectInventory({ organizationId: scope.organizationId, projectId });
  return { status: 200, body: { status: "ok", data: inventory } };
}

export async function materializeAutoReadySuiteRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const result = await repository.materializeAutoReadySuite({ organizationId: scope.organizationId, projectId });
  return { status: result.created ? 201 : 200, body: { status: "ok", data: result } };
}

export async function latestAutoReadySuiteRoute(request, env, { projectId }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  const repository = createSuiteRepository(env.TEST_REGISTRY_DB);
  const result = await repository.getLatestAutoSuite({ organizationId: scope.organizationId, projectId });
  return { status: 200, body: { status: "ok", data: result } };
}

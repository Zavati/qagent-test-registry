import { createTestReadinessRepository } from '../repository/testReadinessRepository.js';
import { parseTestReadinessQuery, isReadinessId, validateTestReadinessEnvelope } from '../domain/testReadinessContracts.js';
import { validateInternalTenantHeaders } from '../validation/testDesignVersion.js';
import { TestRegistryError } from '../domain/errors.js';

async function read(request, env, { projectId, endpointId = null }) {
  const scope = validateInternalTenantHeaders(request, { projectId });
  if (!isReadinessId(projectId) || (endpointId && !isReadinessId(endpointId))) {
    throw new TestRegistryError('Invalid readiness scope.', { code: 'TEST_READINESS_QUERY_INVALID', status: 400 });
  }
  const start = Date.now();
  try {
    const query = parseTestReadinessQuery(new URL(request.url).searchParams, { detail: Boolean(endpointId) });
    const repo = createTestReadinessRepository(env.TEST_REGISTRY_DB);
    const input = { organizationId: scope.organizationId, projectId, endpointId, query };
    const data = endpointId ? await repo.scenarios(input) : await repo.list(input);
    validateTestReadinessEnvelope({status:'ok',data}, {...input, testDesignVersionId:query.testDesignVersionId}, {detail:Boolean(endpointId),query});
    console.log(JSON.stringify({ event: 'test_readiness_read', projectId, view: query.view, revision: data.readinessRevision, returnedCount: data.items.length, durationMs: Date.now() - start }));
    return { status: 200, body: { status: 'ok', data } };
  } catch (error) {
    if (error?.name === 'TestReadinessError') throw new TestRegistryError(error.message, { code: error.code, status: error.status, retryable: error.retryable });
    throw error;
  }
}
export const projectTestReadinessRoute = (request, env, params) => read(request, env, params);
export const endpointTestReadinessScenariosRoute = (request, env, params) => read(request, env, params);

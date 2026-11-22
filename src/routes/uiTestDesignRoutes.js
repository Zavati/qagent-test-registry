import { TestRegistryError } from '../domain/errors.js';
import { UI_APPEND_MAX_BYTES, parseUiJsonStrict } from '../domain/uiTestDesignCanonical.js';
import { verifyTestGenerationInternalRequest } from '../security/testGenerationInternalAuth.js';
import { createUiTestDesignRepository } from '../repository/uiTestDesignRepository.js';
import { validateUiScope } from '../validation/uiTestDesignVersion.js';

async function rawBodyWithinLimit(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > UI_APPEND_MAX_BYTES)) {
    throw new TestRegistryError('UI Registry request exceeds its byte limit.', { code: 'UI_TEST_REGISTRY_REQUEST_TOO_LARGE', status: 413 });
  }
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > UI_APPEND_MAX_BYTES) {
        await reader.cancel();
        throw new TestRegistryError('UI Registry request exceeds its byte limit.', { code: 'UI_TEST_REGISTRY_REQUEST_TOO_LARGE', status: 413 });
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
function authorizedScope(value, auth) {
  const scope = validateUiScope(value);
  if (scope.organizationId !== auth.organizationId || scope.projectId !== auth.projectId) {
    throw new TestRegistryError('UI Registry scope does not match its authenticated caller.', { code: 'UI_TEST_REGISTRY_SCOPE_MISMATCH', status: 403 });
  }
  return scope;
}
function query(request, allowed) {
  const params = new URL(request.url).searchParams;
  const seen = new Set();
  for (const [key] of params) {
    if (!allowed.includes(key) || seen.has(key)) throw new TestRegistryError('Unsupported or repeated UI Registry query parameter.', { code: 'UI_TEST_REGISTRY_QUERY_INVALID', status: 400 });
    seen.add(key);
  }
  return params;
}

export async function appendUiVersionRoute(request, env) {
  const rawBody = await rawBodyWithinLimit(request);
  // Authenticate the exact wire bytes/path before JSON parsing or evidence access.
  const auth = await verifyTestGenerationInternalRequest(request, env, { rawBody });
  query(request, []);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) {
    throw new TestRegistryError('UI Registry requires application/json.', { code: 'UI_TEST_REGISTRY_MEDIA_TYPE_INVALID', status: 415 });
  }
  const body = parseUiJsonStrict(rawBody);
  authorizedScope({ organizationId: body?.organizationId, projectId: body?.projectId, environmentId: body?.environmentId }, auth);
  const result = await createUiTestDesignRepository(env.TEST_REGISTRY_DB).appendVersion(body);
  return { status: result.status === 'persisted' ? 201 : 200, body: result };
}

export async function exactUiVersionRoute(request, env, { versionId }) {
  const auth = await verifyTestGenerationInternalRequest(request, env);
  const params = query(request, ['organizationId', 'projectId', 'environmentId']);
  const scope = authorizedScope({ organizationId: params.get('organizationId'), projectId: params.get('projectId'), environmentId: params.get('environmentId') }, auth);
  if (!/^uitdv_[a-f0-9]{64}$/.test(versionId)) throw new TestRegistryError('Invalid UI Test Design version id.', { code: 'UI_TEST_DESIGN_VERSION_ID_INVALID', status: 400 });
  const result = await createUiTestDesignRepository(env.TEST_REGISTRY_DB).getExact(scope, versionId);
  if (!result) throw new TestRegistryError('UI Test Design version not found.', { code: 'UI_TEST_DESIGN_VERSION_NOT_FOUND', status: 404 });
  return { status: 200, body: result };
}

export async function listUiVersionsRoute(request, env, { projectId }) {
  const auth = await verifyTestGenerationInternalRequest(request, env);
  const params = query(request, ['organizationId', 'environmentId', 'cursor', 'limit']);
  const scope = authorizedScope({ organizationId: params.get('organizationId'), projectId, environmentId: params.get('environmentId') }, auth);
  const rawLimit = params.get('limit') ?? '20';
  if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) throw new TestRegistryError('UI Registry limit must be between 1 and 50.', { code: 'UI_TEST_DESIGN_LIMIT_INVALID', status: 400 });
  const result = await createUiTestDesignRepository(env.TEST_REGISTRY_DB).listVersions(scope, { cursor: params.get('cursor') || '', limit: Number(rawLimit) });
  return { status: 200, body: result };
}

import { TestRegistryError } from '../domain/errors.js';
import { canonicalUiJson, uiByteLength, uiContentHash, uiSha256, UI_COMPILATION_MAX_BYTES } from '../domain/uiTestDesignCanonical.js';
import { validateUiScopeShape, validateUiSourceShape, validateUiSpecificationShape } from './uiTestDesignContract.js';

function contractError(error) {
  if (error instanceof TestRegistryError) throw error;
  throw new TestRegistryError('UI Test Design does not satisfy its declarative contract.', {
    code: error?.code || 'UI_TEST_DESIGN_CONTRACT_INVALID', status: error?.status || 422, path: error?.path || null,
  });
}
function fields(value, required, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new TestRegistryError('Invalid UI publication shape.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID', status: 422, path });
  }
}
function same(a, b, path) {
  if (canonicalUiJson(a) !== canonicalUiJson(b)) throw new TestRegistryError('UI source or summary does not match its specification.', { code: 'UI_TEST_DESIGN_SCOPE_OR_SOURCE_MISMATCH', status: 409, path });
}
export function validateUiScope(value) {
  try { validateUiScopeShape(value); return { organizationId: value.organizationId, projectId: value.projectId, environmentId: value.environmentId }; }
  catch (error) { contractError(error); }
}
export async function validateUiCompilation(compilation, scope) {
  fields(compilation, ['contractVersion', 'compilerVersion', 'outcome', 'source', 'specification', 'specificationHash', 'summary', 'executionPerformed'], [], 'compilation');
  const canonical = canonicalUiJson(compilation);
  if (uiByteLength(canonical) > UI_COMPILATION_MAX_BYTES) throw new TestRegistryError('UI compilation exceeds 768 KiB; dependencies must not be truncated.', { code: 'UI_TEST_DESIGN_COMPILATION_TOO_LARGE', status: 413 });
  if (compilation.contractVersion !== 'qagent.ui-test-design-compilation.v1' || compilation.compilerVersion !== 'qagent_ui_test_design_compiler_v1'
    || compilation.executionPerformed !== false) throw new TestRegistryError('Unsupported UI compilation contract.', { code: 'UI_TEST_DESIGN_CONTRACT_INVALID', status: 422 });
  if (compilation.outcome !== 'COMPILED') throw new TestRegistryError('Only a compiled UI Test Design can be versioned; NO_DESIGN remains a job outcome.', { code: 'UI_TEST_DESIGN_NOT_COMPILED', status: 422 });
  try { validateUiSourceShape(compilation.source); validateUiSpecificationShape(compilation.specification); }
  catch (error) { contractError(error); }
  same(compilation.source.scope, scope, 'compilation.source.scope');
  same(compilation.specification.scope, scope, 'compilation.specification.scope');
  same(compilation.source, compilation.specification.source, 'compilation.source');
  fields(compilation.summary, ['coverage', 'limitations', 'reasonCodes'], [], 'compilation.summary');
  same(compilation.summary.coverage, compilation.specification.coverage, 'compilation.summary.coverage');
  same(compilation.summary.limitations, compilation.specification.limitations, 'compilation.summary.limitations');
  same(compilation.summary.reasonCodes, [], 'compilation.summary.reasonCodes');
  if (uiByteLength(canonicalUiJson(compilation.summary)) > 65536) throw new TestRegistryError('UI compilation summary exceeds its limit.', { code: 'UI_TEST_DESIGN_SUMMARY_TOO_LARGE', status: 413 });
  const hash = await uiContentHash(compilation.specification);
  if (!/^[a-f0-9]{64}$/.test(compilation.specificationHash || '') || hash !== compilation.specificationHash) throw new TestRegistryError('UI specification hash does not match its canonical content.', { code: 'UI_TEST_DESIGN_HASH_MISMATCH', status: 409 });
  for (const fixture of compilation.specification.network.fixtures) {
    const request = fixture.request;
    const fingerprint = await uiContentHash({ service: request.logicalServiceKey, origin: request.origin, method: request.method,
      path: request.path, query: request.query, bodyHash: request.bodySha256, businessHeadersHash: request.businessHeadersSha256 });
    const matchingContext = { documentId: fixture.documentId, navigationId: fixture.navigationId, frameId: fixture.frameId, stepId: fixture.stepId, requestFingerprint: fingerprint };
    const occurrenceKey = await uiContentHash({ scope, captureId: compilation.source.captureId, ...matchingContext });
    const fixtureId = 'uif_' + await uiContentHash({ captureId: compilation.source.captureId, eventId: fixture.eventId, policy: 'qagent_ui_observed_fixture_match_v1' });
    if (fixture.match.requestFingerprint !== fingerprint || fixture.match.occurrenceKey !== occurrenceKey || fixture.fixtureId !== fixtureId) {
      throw new TestRegistryError('UI fixture identity or matching digest is inconsistent.', { code: 'UI_TEST_DESIGN_FIXTURE_IDENTITY_MISMATCH', status: 409 });
    }
  }
  return compilation;
}
export async function validateUiAppendInput(body) {
  fields(body, ['organizationId', 'projectId', 'environmentId', 'generationRequestId', 'compilation'], ['createdBy', 'createdByAccountId'], 'body');
  const scope = validateUiScope({ organizationId: body.organizationId, projectId: body.projectId, environmentId: body.environmentId });
  if (typeof body.generationRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(body.generationRequestId)) throw new TestRegistryError('Invalid UI generationRequestId.', { code: 'UI_TEST_DESIGN_GENERATION_REQUEST_ID_INVALID', status: 400 });
  for (const key of ['createdBy', 'createdByAccountId']) if (body[key] != null && (typeof body[key] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(body[key]))) {
    throw new TestRegistryError('Invalid UI publication actor.', { code: 'UI_TEST_DESIGN_ACTOR_INVALID', status: 400, path: key });
  }
  const compilation = await validateUiCompilation(body.compilation, scope);
  const compilationJson = canonicalUiJson(compilation), compilationHash = await uiSha256(compilationJson);
  const createdBy = body.createdBy ?? null, createdByAccountId = body.createdByAccountId ?? null;
  const requestHash = await uiContentHash({ scope, generationRequestId: body.generationRequestId, compilationHash, createdBy, createdByAccountId });
  return { scope, generationRequestId: body.generationRequestId, compilation, compilationJson, compilationHash,
    contentHash: compilation.specificationHash, requestHash, createdBy, createdByAccountId };
}

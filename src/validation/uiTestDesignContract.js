/** Portable UI-TD-1/2 declarative contract guard. No storage, network or evaluation.
 * Observed values remain data; executable operations and their parameters are closed sets.
 */
export const UI_TEST_DESIGN_GUARD_VERSION = 'qagent_ui_test_design_guard_v1';
export const UI_ACTION_OPERATORS = ['CLICK', 'FILL', 'SELECT', 'CHECK', 'NAVIGATE', 'SCROLL'];
export const UI_ASSERTION_OPERATORS = ['ELEMENT_PRESENT', 'ATTRIBUTE_EQUALS', 'TEXT_EQUALS', 'FORM_VALUE_EQUALS', 'CHECKED_EQUALS', 'BOUNDS_WITHIN_TOLERANCE', 'STYLE_EQUALS', 'URL_MATCHES', 'REQUEST_MATCHES', 'FIXTURE_CONSUMPTION_MATCHES'];
const MODES = ['UI_REPLAY', 'UI_LIVE'];
const ARTIFACT_KINDS = ['DOCUMENT_HTML', 'RENDERED_HTML', 'DOM_SNAPSHOT_JSON', 'LAYOUT_JSON', 'FORM_STATE_JSON', 'RESOURCE_MANIFEST_JSON', 'CSS_TEXT', 'SCRIPT_TEXT', 'ASSET_BINARY', 'HTTP_REQUEST_BODY', 'HTTP_RESPONSE_BODY', 'SCREENSHOT_PNG', 'ACTION_VALUE_JSON', 'HEADERS_JSON'];
const ATTRIBUTES = ['type', 'name', 'role', 'aria-label', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled', 'disabled', 'required', 'readonly', 'placeholder', 'title'];
const STYLES = ['display', 'visibility', 'position', 'width', 'height', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'margin', 'padding', 'border', 'border-radius', 'box-sizing', 'overflow', 'transform', 'opacity', 'z-index', 'text-align', 'white-space', 'flex', 'grid-template-columns'];
const CHECKPOINT_KEYS = ['stateId', 'checkpointId', 'checkpointEventId', 'documentId', 'navigationId', 'frameId', 'stepId', 'stateSequence', 'observedSequence', 'url', 'triggerKind', 'captureStartedUs', 'captureFinishedUs', 'stability', 'domRef', 'htmlRef', 'layoutRef', 'formStateRef', 'resourceManifestRef', 'screenshotRef', 'structuralReference', 'visualReference', 'reasonCodes', 'assertionsGenerated'];
const INTERACTION_KEYS = ['eventId', 'entryId', 'requestId', 'resourceId', 'requestSequence', 'observedSequence', 'redirectHop', 'documentId', 'navigationId', 'frameId', 'stepId', 'classification', 'resourceType', 'startedOffsetUs', 'finishedOffsetUs', 'correlationBasis', 'request', 'response', 'observedIssueCodes'];

function fail(path, message = 'Invalid declarative UI Test Design.') {
  const error = new Error(message); error.code = 'UI_TEST_DESIGN_CONTRACT_INVALID'; error.status = 422; error.path = path; throw error;
}
function object(value, required, path, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(path + '.' + key);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(path + '.' + key);
  return value;
}
function text(value, path, max = 4096, min = 0) { if (typeof value !== 'string' || value.length > max || value.length < min) fail(path); }
function id(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(value)) fail(path); }
function hash(value, path) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(path); }
function number(value, path, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true) { if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) fail(path); }
function boolean(value, path) { if (typeof value !== 'boolean') fail(path); }
function literal(value, expected, path) { if (value !== expected) fail(path); }
function choice(value, choices, path) { if (!choices.includes(value)) fail(path); }
function list(value, path, max, check = null) { if (!Array.isArray(value) || value.length > max) fail(path); if (check) value.forEach((item, index) => check(item, path + '[' + index + ']')); return value; }
function nullable(value, path, check) { if (value !== null) check(value, path); }
function codes(value, path) { list(value, path, 1500, (code, at) => { if (typeof code !== 'string' || !/^[A-Z0-9_]{1,128}$/.test(code)) fail(at); }); }
function stable(value) { if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'; return JSON.stringify(value); }
function same(a, b, path) { if (stable(a) !== stable(b)) fail(path); }
function url(value, path) { text(value, path, 8192, 1); try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) fail(path); } catch { fail(path); } }
function context(value, path) { object(value, ['documentId', 'navigationId', 'frameId', 'stepId'], path); for (const key of ['documentId', 'navigationId', 'frameId']) id(value[key], path + '.' + key); nullable(value.stepId, path + '.stepId', id); }
function fromContext(value) { return { documentId: value.documentId, navigationId: value.navigationId, frameId: value.frameId, stepId: value.stepId }; }
function locator(value, path, assertion = false) {
  object(value, assertion ? ['strategy', 'value', 'observedMatchCount', 'sourceNodeId'] : ['strategy', 'value'], path);
  choice(value.strategy, assertion ? ['TEST_ID', 'CSS'] : ['TEST_ID', 'CSS', 'TEXT', 'ROLE'], path + '.strategy'); text(value.value, path + '.value', 2048, 1);
  if (assertion) { literal(value.observedMatchCount, 1, path + '.observedMatchCount'); nullable(value.sourceNodeId, path + '.sourceNodeId', id); }
}
function viewport(value, path) { object(value, ['width', 'height', 'deviceScaleFactor', 'scrollX', 'scrollY'], path); for (const [key, n] of Object.entries(value)) number(n, path + '.' + key, 0, Number.MAX_SAFE_INTEGER, false); }
function finiteJson(value) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 48) fail('specification', 'UI contract exceeds structural limits.');
    if (item === null || ['string', 'boolean'].includes(typeof item)) return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (let index = 0; index < item.length; index += 1) { if (!Object.hasOwn(item, index)) fail('specification'); visit(item[index], depth + 1); } return; }
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      for (const [key, child] of Object.entries(item)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('specification'); visit(child, depth + 1); } return;
    }
    fail('specification', 'UI contract must contain finite JSON data.');
  }
  visit(value, 0);
}

export function validateUiScopeShape(scope, path = 'scope') { object(scope, ['organizationId', 'projectId', 'environmentId'], path); for (const [key, value] of Object.entries(scope)) id(value, path + '.' + key); return scope; }
export function validateUiSourceShape(source, path = 'source') { object(source, ['scope', 'captureId', 'bundleVersionId', 'sourceHash', 'manifestHash'], path); validateUiScopeShape(source.scope, path + '.scope'); id(source.captureId, path + '.captureId'); id(source.bundleVersionId, path + '.bundleVersionId'); hash(source.sourceHash, path + '.sourceHash'); hash(source.manifestHash, path + '.manifestHash'); return source; }
export function validateUiSpecificationShape(spec) {
  finiteJson(spec);
  const p = 'specification';
  object(spec, ['contractVersion', 'compilerVersion', 'templateVersion', 'adapterVersion', 'canonicalizerVersion', 'scope', 'source', 'profile', 'executionModes', 'entryUrl', 'sourceBuildRef', 'preparation', 'steps', 'checkpoints', 'timeline', 'assertions', 'bindings', 'network', 'evidence', 'coverage', 'exclusions', 'limitations', 'readiness', 'executionPerformed'], p);
  for (const [key, value] of Object.entries({ contractVersion: 'qagent.ui-test-design.v1', compilerVersion: 'qagent_ui_test_design_compiler_v1', templateVersion: 'qagent_ui_observed_templates_v1', adapterVersion: 'qagent_ui_page_evidence_adapter_v1', canonicalizerVersion: 'qagent.ui-canonical-json.v1' })) literal(spec[key], value, p + '.' + key);
  validateUiScopeShape(spec.scope, p + '.scope'); validateUiSourceShape(spec.source, p + '.source'); same(spec.scope, spec.source.scope, p + '.source.scope');
  same(spec.executionModes, MODES, p + '.executionModes'); literal(spec.executionPerformed, false, p + '.executionPerformed'); list(spec.bindings, p + '.bindings', 0);
  url(spec.entryUrl, p + '.entryUrl'); nullable(spec.sourceBuildRef, p + '.sourceBuildRef', id);
  const profile = spec.profile;
  object(profile, ['contractVersion', 'revision', 'comparisonPolicyVersion', 'layoutTolerancePx', 'maxChecks', 'maxNodes', 'maxArtifactBytes'], p + '.profile');
  literal(profile.contractVersion, 'qagent.ui-test-design-profile.v1', p + '.profile.contractVersion'); literal(profile.revision, 1, p + '.profile.revision'); literal(profile.comparisonPolicyVersion, 'qagent_ui_observed_comparison_v1', p + '.profile.comparisonPolicyVersion');
  number(profile.layoutTolerancePx, p + '.profile.layoutTolerancePx', 0, 20, false); number(profile.maxChecks, p + '.profile.maxChecks', 1, 5000); number(profile.maxNodes, p + '.profile.maxNodes', 1, 50000); number(profile.maxArtifactBytes, p + '.profile.maxArtifactBytes', 1024, 67108864);
  const prep = spec.preparation;
  object(prep, ['strategy', 'observedBootstrap', 'targetBuildPinRequired', 'freshContextPerMode', 'livePreparationRequired', 'observedResponsesRestoreWholeState'], p + '.preparation');
  literal(prep.strategy, 'EXECUTE_TARGET_BUILD', p + '.preparation.strategy');
  for (const key of ['targetBuildPinRequired', 'freshContextPerMode', 'livePreparationRequired']) literal(prep[key], true, p + '.preparation.' + key);
  literal(prep.observedResponsesRestoreWholeState, false, p + '.preparation.observedResponsesRestoreWholeState');
  object(prep.observedBootstrap, ['mode', 'authProfileRef'], p + '.preparation.observedBootstrap'); choice(prep.observedBootstrap.mode, ['NONE', 'CONTROLLED_SESSION', 'UNAVAILABLE'], p + '.preparation.observedBootstrap.mode'); nullable(prep.observedBootstrap.authProfileRef, p + '.preparation.observedBootstrap.authProfileRef', id);
  object(spec.evidence, ['artifacts', 'documents'], p + '.evidence');
  const artifacts = new Map();
  list(spec.evidence.artifacts, p + '.evidence.artifacts', 1024, (a, at) => {
    object(a, ['artifactId', 'kind', 'sha256', 'byteLength', 'contentType', 'representation', 'storedEncoding', 'completeness', 'privacyPolicyVersion', 'dataOrigin'], at);
    id(a.artifactId, at + '.artifactId'); if (artifacts.has(a.artifactId)) fail(at); hash(a.sha256, at + '.sha256'); number(a.byteLength, at + '.byteLength', 1, 16777216);
    choice(a.kind, ARTIFACT_KINDS, at + '.kind'); text(a.contentType, at + '.contentType', 128, 1); choice(a.representation, ['UTF8_TEXT', 'STRUCTURED_JSON', 'BINARY'], at + '.representation'); literal(a.storedEncoding, 'identity', at + '.storedEncoding'); choice(a.completeness, ['COMPLETE', 'TRUNCATED'], at + '.completeness');
    choice(a.dataOrigin, ['OBSERVED_SANITIZED', 'OBSERVED_ENVIRONMENT_MANAGED'], at + '.dataOrigin'); literal(a.privacyPolicyVersion, a.dataOrigin === 'OBSERVED_ENVIRONMENT_MANAGED' ? 'qagent.ui-page-environment-managed.v1' : 'qagent.ui-page-observed.v1', at + '.privacyPolicyVersion'); artifacts.set(a.artifactId, a);
  });
  function artifact(refId, at, kind = null, sha = null) { id(refId, at); const found = artifacts.get(refId); if (!found || (kind && found.kind !== kind) || (sha !== null && found.sha256 !== sha)) fail(at); return found; }
  function artifactPair(refId, sha, at, kind) { if ((refId === null) !== (sha === null)) fail(at); if (refId !== null) { hash(sha, at + '.sha256'); artifact(refId, at, kind, sha); } }
  const documentIds = new Set();
  list(spec.evidence.documents, p + '.evidence.documents', 2000, (d, at) => {
    object(d, ['documentId', 'frameId', 'parentDocumentId', 'initialNavigationId', 'initialUrl', 'origin', 'observedSequence', 'startedOffsetUs', 'sourceHtmlRef', 'evidenceSource'], at);
    id(d.documentId, at + '.documentId'); if (documentIds.has(d.documentId)) fail(at); documentIds.add(d.documentId); id(d.frameId, at + '.frameId'); nullable(d.parentDocumentId, at + '.parentDocumentId', id); nullable(d.initialNavigationId, at + '.initialNavigationId', id); nullable(d.initialUrl, at + '.initialUrl', url); nullable(d.origin, at + '.origin', url); nullable(d.observedSequence, at + '.observedSequence', number); nullable(d.startedOffsetUs, at + '.startedOffsetUs', number); if (d.sourceHtmlRef !== null) artifact(d.sourceHtmlRef, at + '.sourceHtmlRef', 'DOCUMENT_HTML'); choice(d.evidenceSource, ['RESOURCE_MANIFEST', 'CAPTURE_DESCRIPTOR_AND_EVENTS', 'EVENT_CONTEXT_ONLY'], at + '.evidenceSource');
  });
  const states = new Map(), checkpoints = new Map(), orders = new Set();
  list(spec.checkpoints, p + '.checkpoints', 200, (s, at) => {
    object(s, CHECKPOINT_KEYS, at); id(s.stateId, at + '.stateId'); id(s.checkpointId, at + '.checkpointId'); id(s.checkpointEventId, at + '.checkpointEventId'); context(fromContext(s), at + '.context'); if (!documentIds.has(s.documentId) || states.has(s.stateId) || checkpoints.has(s.checkpointId)) fail(at);
    number(s.stateSequence, at + '.stateSequence'); number(s.observedSequence, at + '.observedSequence'); if (orders.has(s.observedSequence)) fail(at + '.observedSequence'); orders.add(s.observedSequence);
    number(s.captureStartedUs, at + '.captureStartedUs'); number(s.captureFinishedUs, at + '.captureFinishedUs', s.captureStartedUs); nullable(s.url, at + '.url', url); if (s.triggerKind !== null) choice(s.triggerKind, ['INITIAL', 'NAVIGATION', 'ACTION', 'DOM_CHANGE', 'MANUAL', 'STOP'], at + '.triggerKind'); choice(s.stability, ['STABLE', 'UNSTABLE', 'UNKNOWN'], at + '.stability');
    for (const [key, kind] of Object.entries({ domRef: 'DOM_SNAPSHOT_JSON', htmlRef: 'RENDERED_HTML', layoutRef: 'LAYOUT_JSON', formStateRef: 'FORM_STATE_JSON', resourceManifestRef: 'RESOURCE_MANIFEST_JSON', screenshotRef: 'SCREENSHOT_PNG' })) if (s[key] !== null) artifact(s[key], at + '.' + key, kind);
    for (const key of ['structuralReference', 'visualReference']) { object(s[key], ['status', 'stable'], at + '.' + key); choice(s[key].status, ['AVAILABLE', 'UNAVAILABLE'], at + '.' + key + '.status'); boolean(s[key].stable, at + '.' + key + '.stable'); }
    literal(s.assertionsGenerated, false, at + '.assertionsGenerated'); codes(s.reasonCodes, at + '.reasonCodes'); states.set(s.stateId, s); checkpoints.set(s.checkpointId, s);
  });
  const steps = new Map();
  list(spec.steps, p + '.steps', 2000, (s, at) => {
    object(s, ['stepId', 'operator', 'sourceEventId', 'observedSequence', 'context', 'target', 'input', 'destination', 'checked', 'position', 'scrollTarget', 'clickCount', 'stateBeforeId', 'stateAfterId', 'availability', 'reasonCodes'], at);
    id(s.stepId, at + '.stepId'); id(s.sourceEventId, at + '.sourceEventId'); if (steps.has(s.stepId)) fail(at); steps.set(s.stepId, s); choice(s.operator, UI_ACTION_OPERATORS, at + '.operator'); context(s.context, at + '.context'); if (!documentIds.has(s.context.documentId)) fail(at + '.context.documentId'); number(s.observedSequence, at + '.observedSequence'); if (orders.has(s.observedSequence)) fail(at + '.observedSequence'); orders.add(s.observedSequence);
    choice(s.availability, ['SUPPORTED', 'UNSUPPORTED'], at + '.availability'); codes(s.reasonCodes, at + '.reasonCodes'); if ((s.availability === 'SUPPORTED') !== (s.reasonCodes.length === 0)) fail(at + '.availability');
    for (const key of ['stateBeforeId', 'stateAfterId']) if (s[key] !== null) { const state = states.get(s[key]); if (!state || state.documentId !== s.context.documentId || state.frameId !== s.context.frameId) fail(at + '.' + key); }
    if (s.target !== null) { object(s.target, ['primaryLocator', 'candidateLocators', 'observedMatchCount', 'framePath'], at + '.target'); locator(s.target.primaryLocator, at + '.target.primaryLocator'); list(s.target.candidateLocators, at + '.target.candidateLocators', 8, locator); number(s.target.observedMatchCount, at + '.target.observedMatchCount', 0, 100000); list(s.target.framePath, at + '.target.framePath', 32, id); }
    if (s.availability === 'SUPPORTED' && ['CLICK', 'FILL', 'SELECT', 'CHECK'].includes(s.operator) && (!s.target || s.target.observedMatchCount !== 1 || s.target.framePath.length || !['TEST_ID', 'CSS'].includes(s.target.primaryLocator.strategy))) fail(at + '.target');
    if (s.input !== null) { object(s.input, ['artifactId', 'sha256', 'value'], at + '.input'); artifact(s.input.artifactId, at + '.input.artifactId', 'ACTION_VALUE_JSON', s.input.sha256); if (s.input.value !== null && !['string', 'number', 'boolean'].includes(typeof s.input.value)) fail(at + '.input.value'); }
    if (s.availability === 'SUPPORTED' && ['FILL', 'SELECT'].includes(s.operator) && s.input === null) fail(at + '.input');
    nullable(s.destination, at + '.destination', url); nullable(s.checked, at + '.checked', boolean); nullable(s.scrollTarget, at + '.scrollTarget', id);
    if (s.position !== null) { object(s.position, ['x', 'y'], at + '.position'); for (const key of ['x', 'y']) number(s.position[key], at + '.position.' + key, 0, Number.MAX_SAFE_INTEGER, false); }
    if (s.clickCount !== null) number(s.clickCount, at + '.clickCount', 1, 2);
    if (s.availability === 'SUPPORTED' && ((s.operator === 'NAVIGATE' && s.destination === null) || (s.operator === 'CHECK' && s.checked === null))) fail(at);
  });
  const expectedTimeline = [...spec.steps.map(s => ({ kind: 'ACTION', id: s.stepId, observedSequence: s.observedSequence, causalProof: false })), ...spec.checkpoints.map(s => ({ kind: 'CHECKPOINT', id: s.checkpointId, observedSequence: s.observedSequence, causalProof: false }))].sort((a, b) => a.observedSequence - b.observedSequence);
  same(spec.timeline, expectedTimeline, p + '.timeline');
  object(spec.network, ['matching', 'fixtures', 'interactions', 'applicationResources'], p + '.network');
  same(spec.network.matching, { version: 'qagent_ui_observed_fixture_match_v1', queryPairs: 'PRESERVE_ORDER_AND_DUPLICATES', requestBody: 'EXACT_STORED_BYTES_SHA256', businessHeaders: 'EXACT_STORED_BYTES_SHA256', context: 'DOCUMENT_NAVIGATION_FRAME_STEP', occurrence: 'OBSERVED_REQUEST_SEQUENCE_WITHIN_CONTEXT', unmatchedRequest: 'BLOCK', exhaustedFixture: 'BLOCK', liveBusinessFallback: false }, p + '.network.matching');
  same(spec.network.applicationResources, { strategy: 'EXECUTE_TARGET_BUILD', observedCssJsAreFixtures: false, archiveExecutionAllowed: false }, p + '.network.applicationResources');
  const interactions = new Map();
  function interaction(n, at, fixture = false) {
    object(n, fixture ? [...INTERACTION_KEYS, 'fixtureId', 'match', 'consumption', 'availability', 'reasonCodes', 'meaning', 'testPassed'] : INTERACTION_KEYS, at);
    for (const key of ['eventId', 'entryId', 'requestId', 'resourceId']) id(n[key], at + '.' + key); context(fromContext(n), at + '.context'); if (!documentIds.has(n.documentId)) fail(at + '.documentId');
    for (const key of ['requestSequence', 'observedSequence', 'redirectHop', 'startedOffsetUs']) number(n[key], at + '.' + key); nullable(n.finishedOffsetUs, at + '.finishedOffsetUs', number);
    choice(n.classification, ['BUSINESS_API', 'APP_RESOURCE', 'BOOTSTRAP', 'AUXILIARY'], at + '.classification'); choice(n.resourceType, ['DOCUMENT', 'STYLESHEET', 'SCRIPT', 'IMAGE', 'FONT', 'MEDIA', 'XHR', 'FETCH', 'OTHER'], at + '.resourceType'); choice(n.correlationBasis, ['NAVIGATION_AND_STEP_WINDOW', 'TEMPORAL_ONLY'], at + '.correlationBasis'); codes(n.observedIssueCodes, at + '.observedIssueCodes');
    const q = n.request, r = n.response;
    object(q, ['logicalServiceKey', 'method', 'origin', 'path', 'query', 'bodyRef', 'bodySha256', 'businessHeadersRef', 'businessHeadersSha256'], at + '.request', ['observedHeadersRef', 'observedHeadersSha256']);
    id(q.logicalServiceKey, at + '.request.logicalServiceKey'); choice(q.method, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], at + '.request.method'); url(q.origin, at + '.request.origin'); text(q.path, at + '.request.path', 4096, 1); if (!q.path.startsWith('/') || q.path.startsWith('//') || /[?#]/.test(q.path)) fail(at + '.request.path');
    list(q.query, at + '.request.query', 256, (pair, pairPath) => { if (!Array.isArray(pair) || pair.length !== 2) fail(pairPath); text(pair[0], pairPath, 2048); text(pair[1], pairPath, 4096); });
    artifactPair(q.bodyRef, q.bodySha256, at + '.request.bodyRef', 'HTTP_REQUEST_BODY'); artifactPair(q.businessHeadersRef, q.businessHeadersSha256, at + '.request.businessHeadersRef', 'HEADERS_JSON');
    if (Object.hasOwn(q, 'observedHeadersRef') !== Object.hasOwn(q, 'observedHeadersSha256')) fail(at + '.request.observedHeadersRef'); if (Object.hasOwn(q, 'observedHeadersRef')) artifactPair(q.observedHeadersRef, q.observedHeadersSha256, at + '.request.observedHeadersRef', 'HEADERS_JSON');
    object(r, ['networkStatus', 'replayStatus', 'bodyState', 'bodySource', 'bodyRef', 'bodySha256', 'byteLength', 'contentType', 'headersRef', 'headersSha256', 'networkHeadersRef', 'cacheEvidence', 'representationEventId', 'cacheEvidenceVerified'], at + '.response');
    for (const key of ['networkStatus', 'replayStatus']) if (r[key] !== null) number(r[key], at + '.response.' + key, 100, 599);
    choice(r.bodyState, ['COMPLETE', 'EMPTY', 'MISSING', 'OMITTED', 'TRUNCATED'], at + '.response.bodyState'); choice(r.bodySource, ['NETWORK', 'CACHE', 'UNAVAILABLE'], at + '.response.bodySource');
    artifactPair(r.bodyRef, r.bodySha256, at + '.response.bodyRef', 'HTTP_RESPONSE_BODY'); artifactPair(r.headersRef, r.headersSha256, at + '.response.headersRef', 'HEADERS_JSON'); if (r.networkHeadersRef !== null) artifact(r.networkHeadersRef, at + '.response.networkHeadersRef', 'HEADERS_JSON');
    nullable(r.byteLength, at + '.response.byteLength', number); nullable(r.contentType, at + '.response.contentType', text); id(r.representationEventId, at + '.response.representationEventId'); boolean(r.cacheEvidenceVerified, at + '.response.cacheEvidenceVerified');
    if (r.bodyRef !== null && r.byteLength !== artifacts.get(r.bodyRef).byteLength) fail(at + '.response.byteLength');
    if (r.cacheEvidence !== null) { object(r.cacheEvidence, ['bodySha256', 'representationId', 'matchKeySha256'], at + '.response.cacheEvidence'); hash(r.cacheEvidence.bodySha256, at); hash(r.cacheEvidence.matchKeySha256, at); id(r.cacheEvidence.representationId, at); }
    if (r.cacheEvidenceVerified !== (r.cacheEvidence !== null) || (r.bodySource === 'CACHE') !== r.cacheEvidenceVerified) fail(at + '.response.cacheEvidence');
    if (r.bodySource === 'CACHE' && (r.networkStatus !== 304 || r.replayStatus !== 200 || r.bodyState !== 'COMPLETE' || r.bodySha256 !== r.cacheEvidence.bodySha256 || r.representationEventId !== r.cacheEvidence.representationId)) fail(at + '.response.cacheEvidence');
    if (r.bodySource !== 'CACHE' && r.replayStatus !== r.networkStatus) fail(at + '.response.replayStatus');
    if (['MISSING', 'OMITTED', 'EMPTY'].includes(r.bodyState) && r.bodyRef !== null) fail(at + '.response.bodyRef');
    if (['COMPLETE', 'TRUNCATED'].includes(r.bodyState) && r.bodyRef === null) fail(at + '.response.bodyRef');
  }
  list(spec.network.interactions, p + '.network.interactions', 10000, (n, at) => { interaction(n, at); if (interactions.has(n.eventId)) fail(at); interactions.set(n.eventId, n); });
  const fixtures = new Map();
  list(spec.network.fixtures, p + '.network.fixtures', 10000, (f, at) => {
    interaction(f, at, true); id(f.fixtureId, at + '.fixtureId'); if (fixtures.has(f.fixtureId) || !interactions.has(f.eventId)) fail(at); const observed = interactions.get(f.eventId); for (const key of INTERACTION_KEYS) same(f[key], observed[key], at + '.' + key); literal(f.classification, 'BUSINESS_API', at + '.classification');
    const m = f.match; object(m, ['policyVersion', 'documentId', 'navigationId', 'frameId', 'stepId', 'requestFingerprint', 'occurrenceKey', 'occurrenceIndex', 'orderBasis', 'causalProof'], at + '.match'); literal(m.policyVersion, 'qagent_ui_observed_fixture_match_v1', at + '.match.policyVersion'); same(fromContext(m), fromContext(f), at + '.match.context'); hash(m.requestFingerprint, at); hash(m.occurrenceKey, at); number(m.occurrenceIndex, at); literal(m.orderBasis, 'OBSERVED_REQUEST_DISPATCH', at); literal(m.causalProof, false, at + '.match.causalProof');
    object(f.consumption, ['required', 'minimum', 'maximum', 'reuseAfterExhaustion', 'liveFallback'], at + '.consumption'); boolean(f.consumption.required, at); number(f.consumption.minimum, at, 0, 100); number(f.consumption.maximum, at, 1, 100); if (f.consumption.minimum > f.consumption.maximum || f.consumption.required !== (f.consumption.minimum > 0)) fail(at + '.consumption'); literal(f.consumption.reuseAfterExhaustion, false, at); literal(f.consumption.liveFallback, false, at);
    choice(f.availability, ['READY', 'UNAVAILABLE'], at + '.availability'); codes(f.reasonCodes, at + '.reasonCodes'); literal(f.meaning, 'OBSERVED_RESPONSE_FIXTURE_NOT_AN_EXPECTED_BUSINESS_RULE', at + '.meaning'); literal(f.testPassed, false, at + '.testPassed');
    if (f.availability === 'READY' && (f.reasonCodes.length || !['COMPLETE', 'EMPTY'].includes(f.response.bodyState) || f.response.replayStatus === null || (f.response.networkStatus === 304 && !f.response.cacheEvidenceVerified))) fail(at + '.availability'); fixtures.set(f.fixtureId, f);
  });
  const assertionIds = new Set();
  list(spec.assertions, p + '.assertions', profile.maxChecks, (a, at) => {
    object(a, ['assertionId', 'operator', 'checkpointId', 'stateId', 'context', 'locator', 'expected', 'expectedSource', 'parameters', 'policies', 'required'], at); id(a.assertionId, at + '.assertionId'); if (assertionIds.has(a.assertionId)) fail(at); assertionIds.add(a.assertionId); choice(a.operator, UI_ASSERTION_OPERATORS, at + '.operator'); context(a.context, at + '.context');
    same(a.policies, { UI_REPLAY: 'FIXED', UI_LIVE: 'OBSERVED_DIFF' }, at + '.policies'); literal(a.required, true, at + '.required');
    object(a.expectedSource, ['artifactId', 'sha256', 'byteLength', 'jsonPointer'], at + '.expectedSource'); hash(a.expectedSource.sha256, at); text(a.expectedSource.jsonPointer, at + '.expectedSource.jsonPointer', 2048, 1); if (!a.expectedSource.jsonPointer.startsWith('/') || /~(?![01])/u.test(a.expectedSource.jsonPointer)) fail(at + '.expectedSource.jsonPointer');
    if (a.expectedSource.artifactId === null) { literal(a.expectedSource.sha256, spec.source.manifestHash, at + '.expectedSource.sha256'); literal(a.expectedSource.byteLength, null, at + '.expectedSource.byteLength'); }
    else { const ref = artifact(a.expectedSource.artifactId, at + '.expectedSource.artifactId', null, a.expectedSource.sha256); literal(a.expectedSource.byteLength, ref.byteLength, at + '.expectedSource.byteLength'); }
    const isNetwork = ['REQUEST_MATCHES', 'FIXTURE_CONSUMPTION_MATCHES'].includes(a.operator);
    const state = states.get(a.stateId);
    if (isNetwork) {
      literal(a.stateId, null, at + '.stateId'); literal(a.checkpointId, null, at + '.checkpointId'); literal(a.locator, null, at + '.locator'); literal(a.expectedSource.artifactId, null, at + '.expectedSource.artifactId');
      object(a.parameters, ['fixtureId'], at + '.parameters'); const f = fixtures.get(a.parameters.fixtureId); if (!f) fail(at + '.parameters.fixtureId'); same(a.context, fromContext(f), at + '.context');
      const index = spec.network.fixtures.indexOf(f), consumption = a.operator === 'FIXTURE_CONSUMPTION_MATCHES';
      same(a.expected, consumption ? f.consumption : { request: f.request, match: f.match }, at + '.expected'); literal(a.expectedSource.jsonPointer, '/bundle/fixtures/' + index + (consumption ? '/consumption' : ''), at + '.expectedSource.jsonPointer'); return;
    }
    if (!state || state.checkpointId !== a.checkpointId || state.stability !== 'STABLE') fail(at + '.stateId'); same(a.context, fromContext(state), at + '.context');
    if (a.operator === 'URL_MATCHES') { literal(a.locator, null, at + '.locator'); literal(a.expectedSource.artifactId, null, at); literal(a.expected, state.url, at + '.expected'); url(a.expected, at + '.expected'); same(a.parameters, { originMapping: 'EXPLICIT_REQUIRED' }, at + '.parameters'); if (!/^\/pageIndex\/states\/\d+\/url$/.test(a.expectedSource.jsonPointer)) fail(at); return; }
    locator(a.locator, at + '.locator', true);
    const refField = ['BOUNDS_WITHIN_TOLERANCE', 'STYLE_EQUALS'].includes(a.operator) ? 'layoutRef' : ['FORM_VALUE_EQUALS', 'CHECKED_EQUALS'].includes(a.operator) ? 'formStateRef' : 'domRef';
    if (a.expectedSource.artifactId === null || a.expectedSource.artifactId !== state[refField]) fail(at + '.expectedSource.artifactId');
    switch (a.operator) {
      case 'ELEMENT_PRESENT': literal(a.expected, true, at + '.expected'); same(a.parameters, { runtimeUniquenessRequired: true }, at + '.parameters'); break;
      case 'ATTRIBUTE_EQUALS': text(a.expected, at + '.expected', 1048576); object(a.parameters, ['attribute'], at + '.parameters'); choice(a.parameters.attribute, ATTRIBUTES, at + '.parameters.attribute'); break;
      case 'TEXT_EQUALS': text(a.expected, at + '.expected', 1048576); object(a.parameters, ['extraction', 'normalization', 'sourceTextNodeIds'], at + '.parameters'); literal(a.parameters.extraction, 'DIRECT_TEXT_CONTENT', at); literal(a.parameters.normalization, 'CAPTURE_CONTROL_CHAR_FILTER_V1', at); list(a.parameters.sourceTextNodeIds, at + '.parameters.sourceTextNodeIds', 10000, id); break;
      case 'FORM_VALUE_EQUALS': text(a.expected, at + '.expected', 1048576); object(a.parameters, ['fieldType'], at + '.parameters'); text(a.parameters.fieldType, at + '.parameters.fieldType', 128); if (a.parameters.fieldType === 'file') fail(at); break;
      case 'CHECKED_EQUALS': boolean(a.expected, at + '.expected'); object(a.parameters, [], at + '.parameters'); break;
      case 'BOUNDS_WITHIN_TOLERANCE': list(a.expected, at + '.expected', 4, (n, at) => number(n, at, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false)); if (a.expected.length !== 4) fail(at); object(a.parameters, ['tolerancePx', 'viewport', 'qualification', 'historicalRenderProfile'], at + '.parameters'); literal(a.parameters.tolerancePx, profile.layoutTolerancePx, at); viewport(a.parameters.viewport, at); literal(a.parameters.qualification, 'VIEWPORT_DPR_SCROLL_ONLY', at); literal(a.parameters.historicalRenderProfile, 'UNAVAILABLE', at); break;
      case 'STYLE_EQUALS': text(a.expected, at + '.expected', 1048576); object(a.parameters, ['property', 'viewport', 'historicalRenderProfile'], at + '.parameters'); choice(a.parameters.property, STYLES, at); viewport(a.parameters.viewport, at); literal(a.parameters.historicalRenderProfile, 'UNAVAILABLE', at); break;
      default: fail(at + '.operator');
    }
  });
  if (!spec.assertions.some(a => !['REQUEST_MATCHES', 'FIXTURE_CONSUMPTION_MATCHES', 'URL_MATCHES'].includes(a.operator))) fail(p + '.assertions');
  codes(spec.limitations, p + '.limitations');
  object(spec.coverage, ['actionsTotal', 'actionsSupported', 'checkpointsTotal', 'stableCheckpoints', 'nodesConsidered', 'checksGenerated', 'checksExcluded', 'actionsExcluded', 'checkpointsExcluded', 'nodesExcluded', 'capabilitiesExcluded', 'artifactsVerified', 'artifactBytesVerified', 'businessFixtures', 'usableFixtures', 'unavailableFixtures', 'assertionByteBudget'], p + '.coverage');
  for (const [key, n] of Object.entries(spec.coverage)) number(n, p + '.coverage.' + key);
  const counted = { actionsTotal: spec.steps.length, actionsSupported: spec.steps.filter(s => s.availability === 'SUPPORTED').length, checkpointsTotal: spec.checkpoints.length, stableCheckpoints: spec.checkpoints.filter(s => s.stability === 'STABLE').length, checksGenerated: spec.assertions.length, artifactsVerified: artifacts.size, artifactBytesVerified: [...artifacts.values()].reduce((n, a) => n + a.byteLength, 0), businessFixtures: fixtures.size, usableFixtures: [...fixtures.values()].filter(f => f.availability === 'READY').length, unavailableFixtures: [...fixtures.values()].filter(f => f.availability === 'UNAVAILABLE').length };
  for (const [key, n] of Object.entries(counted)) literal(spec.coverage[key], n, p + '.coverage.' + key);
  if (spec.coverage.artifactBytesVerified > profile.maxArtifactBytes) fail(p + '.coverage.artifactBytesVerified');
  list(spec.exclusions, p + '.exclusions', 10000, (e, at) => { object(e, ['kind', 'sourceId', 'reasonCode', 'count'], at); choice(e.kind, ['ACTION', 'CHECKPOINT', 'NODE', 'OPERATOR', 'CAPABILITY'], at); text(e.sourceId, at + '.sourceId', 512, 1); codes([e.reasonCode], at); number(e.count, at + '.count', 1); });
  for (const [field, kind] of Object.entries({ checksExcluded: 'OPERATOR', actionsExcluded: 'ACTION', checkpointsExcluded: 'CHECKPOINT', nodesExcluded: 'NODE', capabilitiesExcluded: 'CAPABILITY' })) {
    literal(spec.coverage[field], spec.exclusions.filter(e => e.kind === kind).reduce((n, e) => n + e.count, 0), p + '.coverage.' + field);
  }
  object(spec.readiness, MODES, p + '.readiness');
  for (const mode of MODES) { const r = spec.readiness[mode]; object(r, ['status', 'reasonCodes'], p + '.readiness.' + mode); choice(r.status, ['READY', 'REQUIRES_CONFIGURATION', 'BLOCKED'], p + '.readiness.' + mode + '.status'); codes(r.reasonCodes, p + '.readiness.' + mode + '.reasonCodes'); if (r.status === 'READY' && r.reasonCodes.length) fail(p + '.readiness.' + mode); }
  if (spec.steps.some(s => s.availability === 'UNSUPPORTED') && MODES.some(mode => spec.readiness[mode].status !== 'BLOCKED')) fail(p + '.readiness');
  if (spec.coverage.unavailableFixtures && spec.readiness.UI_REPLAY.status !== 'BLOCKED') fail(p + '.readiness.UI_REPLAY');
  return spec;
}

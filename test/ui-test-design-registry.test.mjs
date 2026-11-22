import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { createTestGenerationInternalSignature } from '../src/security/testGenerationInternalAuth.js';
import { canonicalUiJson, uiContentHash, UI_COMPILATION_MAX_BYTES } from '../src/domain/uiTestDesignCanonical.js';
import { validateUiCompilation } from '../src/validation/uiTestDesignVersion.js';
import { validateUiSpecificationShape } from '../src/validation/uiTestDesignContract.js';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';
import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import { appendPayload as apiAppendPayload } from './fixtures.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json', import.meta.url), 'utf8'));
const scope = golden.source.scope;
const secret = 'registry-ui-integration-secret-000000000000000000000000000000';
const base = 'https://qagent-test-registry.internal';
const appendPath = '/v1/test-registry/ui-test-designs/versions';
function fixtureDb(options) { const db = new SQLiteD1(options); applyCurrentMigrations(db); return db; }
function environment(db) { return { TEST_REGISTRY_DB: db, TEST_GENERATION_INTERNAL_HMAC_SECRET: secret }; }
function payload(generationRequestId = 'uitdg_operation_0001', compilation = structuredClone(golden)) { return { ...scope, generationRequestId, compilation, createdBy: 'usr_test', createdByAccountId: 'acc_test' }; }
async function request(path, { method = 'GET', body, rawBody, authScope = scope, timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  const text = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
  const url = base + path;
  const signature = await createTestGenerationInternalSignature({ secret, method, url, ...authScope, timestamp, rawBody: text });
  return new Request(url, { method, headers: { 'content-type': 'application/json',
    'X-QAgent-Organization-Id': authScope.organizationId, 'X-QAgent-Project-Id': authScope.projectId,
    'X-QAgent-Test-Generation-Timestamp': timestamp, 'X-QAgent-Test-Generation-Signature': signature },
  ...(method === 'POST' ? { body: text } : {}) });
}
async function append(db, body = payload()) { return handleRequest(await request(appendPath, { method: 'POST', body }), environment(db)); }
function exactPath(versionId, selected = scope) { return `/v1/test-registry/ui-test-designs/versions/${versionId}?${new URLSearchParams(selected)}`; }
function listPath({ selected = scope, cursor, limit = 20 } = {}) { const query = new URLSearchParams({ organizationId: selected.organizationId, environmentId: selected.environmentId, limit: String(limit) }); if (cursor) query.set('cursor', cursor); return `/v1/test-registry/projects/${selected.projectId}/ui-test-designs?${query}`; }
async function changedProfile(tolerance) { const c = structuredClone(golden); c.specification.profile.layoutTolerancePx = tolerance; for (const a of c.specification.assertions) if (a.operator === 'BOUNDS_WITHIN_TOLERANCE') a.parameters.tolerancePx = tolerance; c.specificationHash = await uiContentHash(c.specification); return c; }
const count = (db, table) => db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('UI Registry accepts the actual compiler fixture, preserves two modes and never executes', async () => {
  const db = fixtureDb();
  try {
    await validateUiCompilation(golden, scope);
    const longId = structuredClone(golden.specification);
    longId.scope.organizationId = longId.source.scope.organizationId = 'org_' + 'a'.repeat(176);
    assert.doesNotThrow(() => validateUiSpecificationShape(longId));
    longId.scope.organizationId = longId.source.scope.organizationId = 'org_' + 'a'.repeat(177);
    assert.throws(() => validateUiSpecificationShape(longId), /Invalid declarative/);
    assert.equal(new Set(golden.specification.assertions.map(a => a.operator)).size, 10);
    const response = await append(db);
    assert.equal(response.status, 201, await response.clone().text());
    const saved = await response.json();
    assert.equal(saved.status, 'persisted'); assert.equal(saved.version, 1); assert.equal(saved.domain, 'UI');
    assert.match(saved.testDesignId, /^uitd_[a-f0-9]{64}$/); assert.match(saved.testDesignVersionId, /^uitdv_[a-f0-9]{64}$/);
    assert.equal(saved.contentHash, golden.specificationHash);
    const read = await handleRequest(await request(exactPath(saved.testDesignVersionId)), environment(db));
    assert.equal(read.status, 200); const artifact = await read.json();
    assert.deepEqual(artifact.compilation, golden); assert.equal(artifact.executionPerformed, false);
    assert.deepEqual(artifact.compilation.specification.executionModes, ['UI_REPLAY', 'UI_LIVE']);
    assert.equal(count(db, 'test_designs'), 0); assert.equal(count(db, 'test_design_versions'), 0);
  } finally { db.close(); }
});

test('same operation replays exactly; new operation with same semantic content reuses version and retains provenance', async () => {
  const db = fixtureDb();
  try {
    const first = await (await append(db)).json();
    const repeatResponse = await append(db); assert.equal(repeatResponse.status, 200); const repeat = await repeatResponse.json();
    assert.equal(repeat.status, 'reused'); assert.equal(repeat.testDesignVersionId, first.testDesignVersionId);
    const other = payload('uitdg_operation_0002'); other.createdBy = 'usr_second';
    const reused = await (await append(db, other)).json(); assert.equal(reused.status, 'reused'); assert.equal(reused.testDesignVersionId, first.testDesignVersionId);
    assert.equal(count(db, 'ui_test_design_versions'), 1); assert.equal(count(db, 'ui_test_design_operations'), 2);
    assert.deepEqual(db.raw.prepare('SELECT created_by FROM ui_test_design_operations ORDER BY generation_request_id').all().map(r => r.created_by), ['usr_test', 'usr_second']);
    const changedActor = payload(); changedActor.createdBy = 'usr_forged';
    const conflictingActor = await append(db, changedActor); assert.equal(conflictingActor.status, 409);
  } finally { db.close(); }
});

test('profile revision appends immutable Version 2; same operation with different hash conflicts without an orphan', async () => {
  const db = fixtureDb();
  try {
    const first = await (await append(db)).json();
    const revision = await changedProfile(3);
    const conflict = await append(db, payload('uitdg_operation_0001', revision));
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'UI_TEST_DESIGN_IDEMPOTENCY_CONFLICT');
    assert.equal(count(db, 'ui_test_design_versions'), 1);
    const second = await (await append(db, payload('uitdg_operation_0002', revision))).json();
    assert.equal(second.version, 2); assert.equal(second.testDesignId, first.testDesignId); assert.notEqual(second.testDesignVersionId, first.testDesignVersionId);
    const historical = await handleRequest(await request(exactPath(first.testDesignVersionId)), environment(db));
    assert.deepEqual((await historical.json()).compilation, golden);
    assert.throws(() => db.raw.prepare('UPDATE ui_test_design_versions SET content_hash=? WHERE id=?').run('a'.repeat(64), first.testDesignVersionId), /IMMUTABLE/);
    assert.throws(() => db.raw.prepare('DELETE FROM ui_test_design_versions WHERE id=?').run(first.testDesignVersionId), /IMMUTABLE/);
    assert.throws(() => db.raw.prepare('UPDATE ui_test_design_operations SET created_by=?').run('usr_other'), /IMMUTABLE/);
  } finally { db.close(); }
});

test('lost acknowledgement after atomic commit is reconciled instead of generating another version', async () => {
  const db = fixtureDb();
  try {
    const originalBatch = db.batch.bind(db); let loseAck = true;
    db.batch = async statements => { const result = await originalBatch(statements); if (loseAck) { loseAck = false; throw new Error('transport ACK lost after COMMIT'); } return result; };
    const response = await append(db); assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json(); assert.equal(saved.status, 'reused'); assert.equal(saved.version, 1);
    const retry = await (await append(db)).json(); assert.equal(retry.testDesignVersionId, saved.testDesignVersionId);
    assert.equal(count(db, 'ui_test_design_versions'), 1); assert.equal(count(db, 'ui_test_design_operations'), 1);
  } finally { db.close(); }
});

test('racing publication of a conflicting operation rolls back the losing candidate version', async () => {
  let competing = false, competitor;
  const db = fixtureDb({ beforeBatch: async owner => { if (!competing) { competing = true; competitor = await append(owner, payload('uitdg_operation_0001', await changedProfile(4))); } } });
  try {
    const losing = await append(db);
    assert.equal(competitor.status, 201, await competitor.clone().text());
    assert.equal(losing.status, 409, await losing.clone().text());
    assert.equal(count(db, 'ui_test_design_versions'), 1); assert.equal(count(db, 'ui_test_design_operations'), 1);
    assert.equal(db.raw.prepare('SELECT latest_version FROM ui_test_designs').get().latest_version, 1);
  } finally { db.close(); }
});

test('UI auth covers raw body/path/query and is checked before JSON parsing', async () => {
  const db = fixtureDb();
  try {
    const bad = await request(appendPath, { method: 'POST', rawBody: '{not-json' });
    bad.headers.set('X-QAgent-Test-Generation-Signature', '0'.repeat(64));
    const authRejected = await handleRequest(bad, environment(db)); assert.equal(authRejected.status, 401);
    const validAuthInvalidJson = await handleRequest(await request(appendPath, { method: 'POST', rawBody: '{not-json' }), environment(db)); assert.equal(validAuthInvalidJson.status, 400);
    const duplicate = await handleRequest(await request(appendPath, { method: 'POST', rawBody: '{"organizationId":"org_a","organizationId":"org_b"}' }), environment(db)); assert.equal(duplicate.status, 400);
    const expired = await handleRequest(await request(appendPath, { method: 'POST', body: payload(), timestamp: '1700000000' }), environment(db)); assert.equal(expired.status, 401);
    const signed = await request(listPath());
    const tampered = new Request(signed.url.replace(encodeURIComponent(scope.environmentId), 'env_other'), signed);
    const result = await handleRequest(tampered, environment(db)); assert.equal(result.status, 401);
    const mismatch = await handleRequest(await request(appendPath, { method: 'POST', body: payload(), authScope: { ...scope, projectId: 'prj_other' } }), environment(db)); assert.equal(mismatch.status, 403);
    assert.equal(count(db, 'ui_test_design_versions'), 0);
  } finally { db.close(); }
});

test('exact reads and lists isolate organization, project and environment', async () => {
  const db = fixtureDb();
  try {
    const saved = await (await append(db)).json();
    for (const key of ['organizationId', 'projectId', 'environmentId']) {
      const another = { ...scope, [key]: key + '_other' };
      const read = await handleRequest(await request(exactPath(saved.testDesignVersionId, another), { authScope: another }), environment(db));
      assert.equal(read.status, 404, key);
      const listed = await handleRequest(await request(listPath({ selected: another }), { authScope: another }), environment(db));
      assert.equal(listed.status, 200); assert.deepEqual((await listed.json()).items, []);
    }
  } finally { db.close(); }
});

test('list pagination pins its first-page snapshot while newer versions are committed', async () => {
  const db = fixtureDb();
  try {
    for (let n = 1; n <= 3; n += 1) assert.ok((await append(db, payload('uitdg_list_' + n, await changedProfile(n)))).ok);
    const firstResponse = await handleRequest(await request(listPath({ limit: 1 })), environment(db));
    const first = await firstResponse.json(); assert.equal(first.items.length, 1); assert.equal(first.items[0].version, 3); assert.ok(first.nextCursor);
    assert.ok((await append(db, payload('uitdg_list_4', await changedProfile(4)))).ok);
    const versions = [first.items[0].version]; let cursor = first.nextCursor;
    while (cursor) { const page = await (await handleRequest(await request(listPath({ limit: 1, cursor })), environment(db))).json(); versions.push(...page.items.map(i => i.version)); cursor = page.nextCursor; }
    assert.deepEqual(versions, [3, 2, 1]);
    const other = { ...scope, environmentId: 'env_another' };
    const crossCursor = await handleRequest(await request(listPath({ selected: other, cursor: first.nextCursor }), { authScope: other }), environment(db)); assert.equal(crossCursor.status, 400);
    const all = await (await handleRequest(await request(listPath()), environment(db))).json(); assert.deepEqual(all.items.map(i => i.version), [4, 3, 2, 1]);
  } finally { db.close(); }
});

test('hash, evidence references, executable fields and fabricated execution are rejected', async () => {
  const db = fixtureDb();
  try {
    const cases = [
      c => { c.specification.entryUrl = 'https://changed.example/'; },
      c => { c.specification.assertions[0].expectedSource.sha256 = 'f'.repeat(64); },
      c => { c.specification.steps[0].operator = 'EVALUATE_JAVASCRIPT'; },
      c => { c.specification.steps[0].script = 'fetch("https://example.test")'; },
      c => { c.specification.assertions[0].parameters.execute = 'arbitrary'; },
      c => { c.specification.bindings = [{ expression: 'eval(code)' }]; },
      c => { c.executionPerformed = true; },
      c => { c.specification.readiness.UI_LIVE.status = 'PASSED'; },
      c => { c.source.scope.environmentId = 'env_other'; },
      c => { c.specification.network.matching.liveBusinessFallback = true; },
      c => { c.summary.coverage.checksGenerated += 1; },
    ];
    for (let n = 0; n < cases.length; n += 1) {
      const c = structuredClone(golden); cases[n](c);
      const response = await append(db, payload('uitdg_rejected_' + n, c));
      assert.ok([409, 422].includes(response.status), `${n}: ${await response.clone().text()}`);
    }
    assert.equal(count(db, 'ui_test_design_versions'), 0); assert.equal(count(db, 'ui_test_design_operations'), 0);
  } finally { db.close(); }
});

test('NO_DESIGN and oversized compilations produce explicit outcomes without truncated persistence', async () => {
  const db = fixtureDb();
  try {
    const none = { ...structuredClone(golden), outcome: 'NO_DESIGN', specification: null, specificationHash: null };
    const noDesign = await append(db, payload('uitdg_no_design', none)); assert.equal(noDesign.status, 422); assert.equal((await noDesign.json()).code, 'UI_TEST_DESIGN_NOT_COMPILED');
    const huge = structuredClone(golden); const textAssertion = huge.specification.assertions.find(a => a.operator === 'TEXT_EQUALS'); textAssertion.expected = 'x'.repeat(UI_COMPILATION_MAX_BYTES); huge.specificationHash = await uiContentHash(huge.specification);
    const excessive = await append(db, payload('uitdg_huge_design', huge)); assert.equal(excessive.status, 413);
    assert.equal(count(db, 'ui_test_design_versions'), 0);
    assert.ok(new TextEncoder().encode(canonicalUiJson(golden)).byteLength < UI_COMPILATION_MAX_BYTES);
  } finally { db.close(); }
});

test('additive migration preserves API append/retrieval and rejects UI in the API contract', async () => {
  const db = fixtureDb();
  try {
    const api = apiAppendPayload({ generationRequestId: 'tdg_api_compat_0001' });
    const apiRequest = new Request(base + '/v1/test-registry/test-designs/versions', { method: 'POST', headers: { 'content-type': 'application/json', 'X-QAgent-Organization-Id': api.organizationId, 'X-QAgent-Project-Id': api.projectId }, body: JSON.stringify(api) });
    const saved = await handleRequest(apiRequest, environment(db)); assert.equal(saved.status, 201, await saved.clone().text());
    const rejectUi = await handleRequest(new Request(base + '/v1/test-registry/test-designs/versions', { method: 'POST', headers: { 'content-type': 'application/json', 'X-QAgent-Organization-Id': scope.organizationId, 'X-QAgent-Project-Id': scope.projectId }, body: JSON.stringify(payload()) }), environment(db));
    assert.equal(rejectUi.status, 400); assert.equal(count(db, 'test_design_versions'), 1); assert.equal(count(db, 'ui_test_design_versions'), 0);
    assert.ok((await append(db)).ok); assert.equal(count(db, 'test_design_versions'), 1); assert.equal(count(db, 'ui_test_design_versions'), 1);
  } finally { db.close(); }
});

/** Real uploaded scenario + synthetic execution evidence. No live application. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';
import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import { appendPayload } from './fixtures.mjs';
import { validateAppendVersionInput } from '../src/validation/testDesignVersion.js';
import { validateDerivedVersionInput } from '../src/validation/testDesignEvolution.js';
import { createTestDesignRepository } from '../src/repository/testDesignRepository.js';
import { buildCoverageProof, applyCoverageToScenario } from '../src/learningCoverage.js';
import { confirmationHash } from '../src/learningConfirmation.js';
import { STATUS_COVERAGE_CONTRACT } from '../src/statusCoverage.js';
import { READINESS_DERIVATION_CONTRACT } from '../src/readiness/readinessReconciliation.js';
globalThis.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const raw = JSON.parse(readFileSync(new URL('./fixtures/status-coverage-source-08.1.7-c-fix2.json', import.meta.url), 'utf8'));
const scope = { ...raw.specification.source, environmentId: 'env_d3cf2d99-cea7-4c65-9d87-38c3291e05d2' };
delete scope.type;
function fixture(statusCode = 200) {
    const td = structuredClone(raw);
    const sourceVersion = { ...scope, id: td.versionId, testDesignId: td.id, version: td.version, createdAt: td.createdAt, specification: td.specification };
    const source = sourceVersion.specification.scenarios.find(s => s.scenarioId === 'validar_estrutura_meta');
    const resultSet = { ...scope, resultSetId: 'rset_status_fixture', runId: 'run_status_fixture', testDesignId: sourceVersion.testDesignId,
        testDesignVersionId: sourceVersion.id, testDesignVersion: sourceVersion.version, outcome: 'PASSED', completedAt: '2026-10-06T19:00:00.000Z', createdAt: '2026-10-06T19:00:01.000Z' };
    const scenario = { scenarioId: source.scenarioId, scenarioResultId: 'sres_status_fixture', outcome: 'PASSED', assertionCount: 2,
        assertionPassedCount: 2, assertionFailedCount: 0, assertionNotEvaluatedCount: 0,
        http: { method: 'GET', outcome: 'RESPONSE', origin: 'https://fixture.invalid', path: source.spec.target.path,
            statusCode, contentType: 'application/json', redirectCount: 0, truncated: false, headerNames: ['Cookie'], errorCode: null },
        assertions: source.spec.assertions.map((a, i) => ({ assertionResultId: 'ares_status_' + i, assertionIndex: i, type: a.type,
            outcome: 'PASSED', errorCode: null, ...(a.type === 'SCHEMA' ? { schemaRef: a.schemaRef, diagnostics: { schemaTruncated: false } } : { path: a.path, matchCount: 1 }) })),
        evidence: { contractVersion: 'qagent.sanitized-execution-evidence.v1', executionPurpose: 'LEARNING',
            expected: { testDataBindings: [] }, request: { method: 'GET', path: source.spec.target.path, pathParams: [], query: [],
                headers: [{ name: 'Cookie', source: 'AUTH_RUNTIME', redacted: true, value: '[REDACTED]' }], bodyFields: [], bodyBytes: 0 },
            response: { previewFormat: 'JSON', typesPreserved: true, previewTruncated: false, suppressionReason: null,
                redacted: true, bodyPreview: '{"meta":{},"private":"DO_NOT_COPY"}' } } };
    return { source, sourceVersion, resultSet, scenario, scenarios: [scenario], readinessV2Enabled: true, statusCoverageEnabled: true };
}
async function setup() {
    const db = new SQLiteD1();
    try {
        applyCurrentMigrations(db);
        const r = createTestDesignRepository(db), f = fixture();
        const first = await r.appendVersion(validateAppendVersionInput(appendPayload({ ...scope,
            metadata: { provider: raw.specification.generation.provider, model: raw.specification.generation.model, promptVersion: 'fixture', repairPromptVersion: 'fixture', guardVersion: 'fixture' },
            contextFingerprint: raw.contextFingerprint, specification: f.sourceVersion.specification })));
        f.sourceVersion = first.version;
        f.source = first.version.specification.scenarios.find(s => s.scenarioId === 'validar_estrutura_meta');
        Object.assign(f.resultSet, { testDesignId: first.version.testDesignId, testDesignVersionId: first.version.id, testDesignVersion: first.version.version, completedAt: new Date(Date.now() + 1000).toISOString() });
        const proof = await buildCoverageProof(f), e = proof.execution, proposalId = 'tep_status_fixture';
        const input = { organizationId: scope.organizationId, projectId: scope.projectId, sourceTestDesignVersionId: first.version.id,
            derivation: { type: 'RESULT_EVOLUTION', proposalId, sourceResultSetId: e.resultSetId, sourceScenarioResultId: e.scenarioResultId,
                approvedByUserId: 'usr_status_fixture', approvalReason: 'Synthetic reviewed evidence', readinessReconciliationContractVersion: READINESS_DERIVATION_CONTRACT },
            changes: [{ type: 'ASSERTION_COVERAGE_EXTENSION', scenarioId: f.source.scenarioId, assertionIndex: 0, coverageProof: proof,
                    learningSource: { proposalId, resultSetId: e.resultSetId, scenarioResultId: e.scenarioResultId, runId: e.runId, testDesignVersionId: e.testDesignVersionId, environmentId: e.environmentId } }] };
        return { db, r, f, proof, input };
    }
    catch (e) {
        db.close();
        throw e;
    }
}
const count = c => c.db.raw.prepare('SELECT COUNT(*) n FROM test_design_versions').get().n;
import { signAuthority, authorityHash, AUTHORITY_CONTRACT } from '../src/autonomousAuthority.js';
const key = { AUTONOMOUS_LEARNING_HMAC_SECRET: 'synthetic-application-authority-key-tests-only' };
async function delegate(c) { const e = c.proof.execution; const a = await signAuthority(key, { contractVersion: AUTHORITY_CONTRACT, kind: 'POLICY_DELEGATION', decisionId: 'alo_registry_apply', policyId: 'alp_registry_test', policyRevision: 1, policyHash: 'a'.repeat(64), cycleId: 'alc_registry_test', itemId: 'ali_registry_test', ...scope, sourceTestDesignVersionId: c.f.sourceVersion.id, delegatedByUserId: 'usr_owner', delegatedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), members: [{ proposalId: c.input.derivation.proposalId, scenarioId: c.f.source.scenarioId, changeId: 'tec_registry_test', changeType: 'ASSERTION_COVERAGE_EXTENSION', proofHash: await authorityHash(c.proof) }] }); c.input.derivation.approvedByUserId = null; c.input.derivation.approvalAuthorization = a; c.r = createTestDesignRepository(c.db, { authorityEnv: key }); return c; }
const apply = async (c) => c.r.appendDerivedVersion(validateDerivedVersionInput(c.input));
test('Registry appends policy-authorized STATUS extension as native pending, not human approved', async () => { const c = await delegate(await setup()); try {
    const before = structuredClone(c.f.sourceVersion.specification), out = await apply(c), s = out.version.specification.scenarios.find(s => s.scenarioId === c.f.source.scenarioId);
    assert.equal(s.learning.approvedByUserId, null);
    assert.equal(s.learning.approvalAuthority.kind, 'POLICY_DELEGATION');
    assert.equal(s.learning.approvalAuthority.reviewedByHuman, false);
    assert.equal(s.readinessV2.coverage.status, 'PARTIAL');
    assert.equal(s.readinessV2.regression.status, 'BLOCKED');
    assert.deepEqual(s.spec.assertions, [...c.f.source.spec.assertions, { type: 'STATUS', expectedStatusCodes: [200] }]);
    assert.equal((await apply(c)).version.id, out.version.id);
    assert.equal(count(c), 2);
    assert.deepEqual((await c.r.getExactVersion({ ...scope, testDesignId: c.f.sourceVersion.testDesignId, version: 1 })).specification, before);
    assert.ok(!JSON.stringify(out.version.specification).includes(c.input.derivation.approvalAuthorization.signature));
}
finally {
    c.db.close();
} });
for (const [name, mutate] of [
    ['forged signature', c => c.input.derivation.approvalAuthorization.signature = '0'.repeat(64)], ['forged environment', c => c.input.derivation.approvalAuthorization.environmentId = 'env_other'], ['missing C marker', c => delete c.input.derivation.readinessReconciliationContractVersion], ['forged source hash', c => c.proof.execution.sourceScenarioHash = '0'.repeat(64)], ['changed status', c => c.proof.additions[0].expectedStatusCodes = [201]], ['simulated human actor', c => c.input.derivation.approvedByUserId = 'usr_fake'], ['new member not authorized', c => c.input.changes.push({ ...c.input.changes[0], scenarioId: 'other' })], ['wrong lineage', c => c.input.changes[0].learningSource.proposalId = 'tep_other'], ['signature dropped', c => delete c.input.derivation.approvalAuthorization.signature]
])
    test('Registry rejects delegated ' + name + ' without append', async () => { const c = await delegate(await setup()); try {
        mutate(c);
        await assert.rejects(apply(c));
        assert.equal(count(c), 1);
    }
    finally {
        c.db.close();
    } });
test('Registry configured without matching secret refuses delegated writes', async () => { const c = await delegate(await setup()); try {
    c.r = createTestDesignRepository(c.db);
    await assert.rejects(apply(c));
    assert.equal(count(c), 1);
}
finally {
    c.db.close();
} });
test('Registry validates signature before even a persisted replay', async () => { const c = await delegate(await setup()); try {
    await apply(c);
    c.input.derivation.approvalAuthorization.signature = '0'.repeat(64);
    await assert.rejects(apply(c));
    assert.equal(count(c), 2);
}
finally {
    c.db.close();
} });

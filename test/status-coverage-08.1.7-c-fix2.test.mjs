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
globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
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
    assertions: source.spec.assertions.map((a,i) => ({ assertionResultId: 'ares_status_' + i, assertionIndex: i, type: a.type,
      outcome: 'PASSED', errorCode: null, ...(a.type === 'SCHEMA' ? { schemaRef: a.schemaRef, diagnostics: { schemaTruncated: false } } : { path: a.path, matchCount: 1 }) })),
    evidence: { contractVersion: 'qagent.sanitized-execution-evidence.v1', executionPurpose: 'LEARNING',
      expected: { testDataBindings: [] }, request: { method: 'GET', path: source.spec.target.path, pathParams: [], query: [],
        headers: [{ name: 'Cookie', source: 'AUTH_RUNTIME', redacted: true, value: '[REDACTED]' }], bodyFields: [], bodyBytes: 0 },
      response: { previewFormat: 'JSON', typesPreserved: true, previewTruncated: false, suppressionReason: null,
        redacted: true, bodyPreview: '{"meta":{},"private":"DO_NOT_COPY"}' } } };
  return { source, sourceVersion, resultSet, scenario, scenarios: [scenario], readinessV2Enabled: true, statusCoverageEnabled: true };
}

async function setup() {
 const db=new SQLiteD1();
 try {
  applyCurrentMigrations(db); const r=createTestDesignRepository(db), f=fixture();
  const first=await r.appendVersion(validateAppendVersionInput(appendPayload({...scope,
   metadata:{provider:raw.specification.generation.provider,model:raw.specification.generation.model,promptVersion:'fixture',repairPromptVersion:'fixture',guardVersion:'fixture'},
   contextFingerprint:raw.contextFingerprint, specification:f.sourceVersion.specification})));
  f.sourceVersion=first.version; f.source=first.version.specification.scenarios.find(s=>s.scenarioId==='validar_estrutura_meta');
  Object.assign(f.resultSet,{testDesignId:first.version.testDesignId,testDesignVersionId:first.version.id,testDesignVersion:first.version.version,completedAt:new Date(Date.now()+1000).toISOString()});
  const proof=await buildCoverageProof(f), e=proof.execution, proposalId='tep_status_fixture';
  const input={organizationId:scope.organizationId,projectId:scope.projectId,sourceTestDesignVersionId:first.version.id,
   derivation:{type:'RESULT_EVOLUTION',proposalId,sourceResultSetId:e.resultSetId,sourceScenarioResultId:e.scenarioResultId,
    approvedByUserId:'usr_status_fixture',approvalReason:'Synthetic reviewed evidence',readinessReconciliationContractVersion:READINESS_DERIVATION_CONTRACT},
   changes:[{type:'ASSERTION_COVERAGE_EXTENSION',scenarioId:f.source.scenarioId,assertionIndex:0,coverageProof:proof,
    learningSource:{proposalId,resultSetId:e.resultSetId,scenarioResultId:e.scenarioResultId,runId:e.runId,testDesignVersionId:e.testDesignVersionId,environmentId:e.environmentId}}]};
  return {db,r,f,proof,input};
 } catch(e){db.close();throw e;}
}
const count=c=>c.db.raw.prepare('SELECT COUNT(*) n FROM test_design_versions').get().n;
const apply=async c=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input));
test('STATUS-only extension appends exact observed status and creates native pending C snapshot',async()=>{
 const c=await setup();try {
  const before=structuredClone(c.f.sourceVersion.specification), out=await apply(c), s=out.version.specification.scenarios.find(s=>s.scenarioId===c.f.source.scenarioId);
  assert.deepEqual(s.spec.assertions,[...c.f.source.spec.assertions,{type:'STATUS',expectedStatusCodes:[200]}]);
  assert.deepEqual(s.spec.auth,c.f.source.spec.auth);assert.deepEqual(s.spec.request,c.f.source.spec.request);
  assert.equal(s.readinessV2.basis,'NATIVE_V2');assert.equal(s.readinessV2.expectation.status,'HYPOTHESIS');
  assert.equal(s.readinessV2.coverage.status,'PARTIAL');assert.deepEqual(s.readinessV2.coverage.gapCodes,['ASSERTION_COVERAGE_VERIFICATION_REQUIRED']);
  assert.equal(s.readinessV2.regression.status,'BLOCKED');assert.equal(s.learning.phase,'PENDING_VERIFICATION');
  assert.equal(s.learning.kind,'ASSERTION_COVERAGE_EXTENSION');assert.equal(s.automation.readiness,'REVIEW_REQUIRED');
  const rest=x=>x.scenarios.filter(s=>s.scenarioId!==c.f.source.scenarioId);assert.deepEqual(rest(out.version.specification),rest(before));
  assert.deepEqual((await c.r.getExactVersion({...scope,testDesignId:c.f.sourceVersion.testDesignId,version:1})).specification,before);
  assert.equal(count(c),2);assert.equal((await apply(c)).version.id,out.version.id);assert.equal(count(c),2);
  assert.equal(out.version.specification.summary.scenarioCount,6);
  assert.equal(out.version.specification.summary.readyCount,out.version.specification.scenarios.filter(s=>s.automation.readiness==='READY').length);
 }finally{c.db.close();}
});
for(const [name,edit] of [
 ['missing C derivation marker',c=>delete c.input.derivation.readinessReconciliationContractVersion],
 ['unknown C marker',c=>c.input.derivation.readinessReconciliationContractVersion='unknown'],
 ['forged source hash',c=>c.proof.execution.sourceScenarioHash='0'.repeat(64)],
 ['forged assertions hash',c=>c.proof.execution.assertionsHash='0'.repeat(64)],
 ['forged additions hash',c=>c.proof.additionsHash='0'.repeat(64)],
 ['status differs from execution',c=>c.proof.additions[0].expectedStatusCodes=[201]],
 ['multiple statuses',c=>c.proof.additions[0].expectedStatusCodes=[200,401]],
 ['schema index incorrect',c=>c.proof.observations[0].schemaAssertionIndexes=[0]],
 ['marker unknown',c=>c.proof.statusCoverageContractVersion='unknown'],
 ['marker removed',c=>delete c.proof.statusCoverageContractVersion],
 ['observation removed and marker stripped',c=>{delete c.proof.statusCoverageContractVersion;c.proof.observations=[];}],
 ['credential injection',c=>c.proof.observations[0].token='DO_NOT_COPY'],
 ['cross tenant',c=>c.input.organizationId='org_other'],
 ['cross project',c=>c.input.projectId='prj_other'],
 ['cross version',c=>c.input.sourceTestDesignVersionId='tdv_other'],
 ['cross scenario',c=>c.input.changes[0].scenarioId='validar_retorno_dados_subunidades'],
 ['source lineage environment',c=>c.input.changes[0].learningSource.environmentId='env_other'],
 ['source lineage result',c=>c.input.changes[0].learningSource.resultSetId='rset_other'],
 ['missing reviewer',c=>c.input.derivation.approvedByUserId=null],
 ['second change to source',c=>c.input.changes.push({type:'STATUS_EXPECTATION',scenarioId:c.f.source.scenarioId,assertionIndex:0,expectedStatusCodes:[200]})]
]) test('Registry rejects '+name+' without appending',async()=>{const c=await setup();try{edit(c);await assert.rejects(apply(c));assert.equal(count(c),1);}finally{c.db.close();}});
test('exact new marker is mandatory at append validation even with flags disabled',async()=>{const c=await setup();try{
 delete c.input.derivation.readinessReconciliationContractVersion;
 assert.throws(()=>validateDerivedVersionInput(c.input,{SCENARIO_READINESS_RECONCILIATION_ENABLED:'false'}),{code:'LEARNING_STATUS_DERIVATION_MARKER_REQUIRED'});
 assert.equal(count(c),1);
}finally{c.db.close();}});
test('source assertions and provenance mismatch cannot be repaired by rehashing additions',async()=>{
 const f=fixture(),p=await buildCoverageProof(f), before=structuredClone(f.source);
 for(const mutate of [s=>s.spec.assertions[0].path='$.other',s=>s.spec.auth.requirement='NONE',s=>s.objective='Get something else']){
  const source=structuredClone(before);mutate(source);await assert.rejects(applyCoverageToScenario(source,p,f.sourceVersion));
 }
 assert.deepEqual(f.source,before);
});
test('changing actual status to 401 and recomputing additions hash is rejected',async()=>{const c=await setup();try{
 c.proof.execution.actualStatusCode=401;c.proof.observations[0].actualStatusCode=401;c.proof.additions[0].expectedStatusCodes=[401];c.proof.additionsHash=await confirmationHash(c.proof.additions);
 await assert.rejects(apply(c));assert.equal(count(c),1);
}finally{c.db.close();}});

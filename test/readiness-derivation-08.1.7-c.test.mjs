import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, scope } from './confirmation-fixture-08.1.6-fix2-2.mjs';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';
import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import { appendPayload } from './fixtures.mjs';
import { validateAppendVersionInput } from '../src/validation/testDesignVersion.js';
import { validateDerivedVersionInput } from '../src/validation/testDesignEvolution.js';
import { createTestDesignRepository } from '../src/repository/testDesignRepository.js';
import { buildConfirmationProof, applyConfirmationToScenario } from '../src/learningConfirmation.js';
import { buildCoverageProof } from '../src/learningCoverage.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from '../src/readiness/scenarioReadinessFacts.js';
import { readScenarioReadinessV2 } from '../src/readiness/legacyReadinessAdapter.js';

globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
function native(s){s.readinessV2=evaluateScenarioReadinessV2({issues:collectScenarioReadinessIssues(s),expectation:{status:'HYPOTHESIS',basis:'AI_ASSUMED'},learningPolicyAllows:true});s.automation.readiness=projectLegacyReadiness(s.readinessV2);return s;}
async function setup({coverage=false,oldProof=false}={}){
 const db=new SQLiteD1();try{
 applyCurrentMigrations(db);const r=createTestDesignRepository(db),f=fixture();if(coverage){f.scenario=f.scenarios[1];f.sourceVersion.specification.scenarios[1].objective='$.meta.total deve ser number';}
 for(const s of f.sourceVersion.specification.scenarios){native(s);if(!oldProof)s.automation.blockers=['Apresentação pode mudar sem mudar a admissão'];}
 const spec=f.sourceVersion.specification;const counts={};for(const s of spec.scenarios)counts[s.automation.readiness]=(counts[s.automation.readiness]||0)+1;spec.summary={scenarioCount:spec.scenarios.length,readyCount:counts.READY||0,byReadiness:counts};
 const first=await r.appendVersion(validateAppendVersionInput(appendPayload({...scope,metadata:{provider:'synthetic',model:'fixture',promptVersion:'fixture',repairPromptVersion:'fixture',guardVersion:'fixture'},contextFingerprint:'f'.repeat(64),specification:spec})));
 f.sourceVersion=first.version;Object.assign(f.resultSet,{testDesignId:first.version.testDesignId,testDesignVersionId:first.version.id,testDesignVersion:1});f.readinessV2Enabled=!oldProof;
 const proof=await (coverage?buildCoverageProof:buildConfirmationProof)(f);const execution=coverage?proof.execution:proof;const proposalId=coverage?'tep_b_coverage':'tep_b_confirmation';
 const input={organizationId:scope.organizationId,projectId:scope.projectId,sourceTestDesignVersionId:first.version.id,derivation:{type:'RESULT_EVOLUTION',proposalId,sourceResultSetId:execution.resultSetId,sourceScenarioResultId:execution.scenarioResultId,approvedByUserId:'usr_b',approvalReason:'Review compatible evidence'},changes:[{type:coverage?'ASSERTION_COVERAGE_EXTENSION':'SCENARIO_READINESS_CONFIRMATION',scenarioId:f.scenario.scenarioId,assertionIndex:0,...(coverage?{coverageProof:proof}:{confirmationProof:proof}),learningSource:{proposalId,resultSetId:execution.resultSetId,scenarioResultId:execution.scenarioResultId,runId:execution.runId,testDesignVersionId:execution.testDesignVersionId,environmentId:execution.environmentId}}]};
 return {db,r,f,proof,execution,input};
 }catch(e){db.close();throw e;}
}
const count=c=>c.db.raw.prepare('SELECT COUNT(*) n FROM test_design_versions').get().n;

import { READINESS_DERIVATION_CONTRACT, reconcileReadinessFacts } from '../src/readiness/readinessReconciliation.js';
import { validateReadinessAttachments } from '../src/readiness/readinessDerivation.js';
test('C marker creates native pending derivative and preserves immutable parent/sibling',async()=>{
 const c=await setup();try{
 c.input.derivation.readinessReconciliationContractVersion=READINESS_DERIVATION_CONTRACT;
 const before=structuredClone(c.f.sourceVersion.specification),input=validateDerivedVersionInput(c.input),out=await c.r.appendDerivedVersion(input),next=out.version.specification.scenarios[0];
 assert.equal(next.readinessV2.basis,'NATIVE_V2');assert.equal(next.readinessV2.evaluationScope,'TEST_DESIGN_ONLY');assert.equal(next.readinessV2.execution.status,'READY');assert.equal(next.readinessV2.expectation.status,'HYPOTHESIS');assert.equal(next.readinessV2.expectation.basis,'DERIVATION_PENDING_VERIFICATION');assert.equal(next.readinessV2.regression.status,'BLOCKED');assert.equal(next.automation.readiness,'REVIEW_REQUIRED');assert.equal(next.learning.phase,'PENDING_VERIFICATION');
 assert.deepEqual(next.spec.assertions,before.scenarios[0].spec.assertions);assert.deepEqual(next.spec.auth,before.scenarios[0].spec.auth);assert.equal(next.spec.testData.bindings[0].source,'OBSERVED');assert.deepEqual(out.version.specification.scenarios[1],before.scenarios[1]);
 const old=await c.r.getExactVersion({testDesignId:c.f.sourceVersion.testDesignId,version:1,...scope});assert.deepEqual(old.specification,before);assert.equal((await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input))).version.id,out.version.id);assert.equal(count(c),2);
 assert.equal(out.version.readyScenarioCount||0,0);
 }finally{c.db.close();}
});
test('C coverage addition is native PARTIAL until version verification, no premature regression',async()=>{
 const c=await setup({coverage:true});try{c.input.derivation.readinessReconciliationContractVersion=READINESS_DERIVATION_CONTRACT;const before=structuredClone(c.f.sourceVersion.specification),out=await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)),next=out.version.specification.scenarios[1];
 assert.deepEqual(next.spec.assertions.slice(0,2),before.scenarios[1].spec.assertions);assert.equal(next.spec.assertions[2].type,'JSON_PATH_TYPE');assert.equal(next.readinessV2.coverage.status,'PARTIAL');assert.deepEqual(next.readinessV2.coverage.gapCodes,['ASSERTION_COVERAGE_VERIFICATION_REQUIRED']);assert.equal(next.readinessV2.expectation.status,'HYPOTHESIS');assert.equal(next.readinessV2.regression.status,'BLOCKED');assert.deepEqual(out.version.specification.scenarios[0],before.scenarios[0]);assert.equal(next.learning.phase,'PENDING_VERIFICATION');assert.equal(count(c),2);
 }finally{c.db.close();}
});
test('unmarked B approval retains selective invalidation, no reinterpretation on rollout',async()=>{const c=await setup();try{const out=await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input));assert.equal(out.version.specification.scenarios[0].readinessV2,undefined);assert.equal(out.version.specification.scenarios[0].automation.readiness,'READY');}finally{c.db.close();}});
test('persisted read overlay cannot be submitted as a new native snapshot',()=>{const s={readinessV2:{evaluationScope:'EVIDENCE_RECONCILED'}};assert.throws(()=>validateReadinessAttachments({scenarios:[s]}),{code:'SCENARIO_READINESS_V2_INVALID'});});
for(const marker of [null,'UNKNOWN',{},true])test('C unknown marker rejected '+JSON.stringify(marker),async()=>{const c=await setup();try{c.input.derivation.readinessReconciliationContractVersion=marker;await assert.rejects(async()=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)));assert.equal(count(c),1);}finally{c.db.close();}});
for(const [label,edit] of [['bad source hash',c=>c.input.changes[0].confirmationProof.sourceScenarioHash='0'.repeat(64)],['wrong tenant',c=>c.input.organizationId='org_other'],['different version',c=>c.input.sourceTestDesignVersionId='tdv_other'],['no human approval',c=>c.input.derivation.approvedByUserId=null],['expectation rewrite',c=>c.input.changes.push({type:'STATUS_EXPECTATION',scenarioId:'test_003',assertionIndex:0,expectedStatusCodes:[200]})]])test('C marker never bypasses '+label,async()=>{const c=await setup();try{c.input.derivation.readinessReconciliationContractVersion=READINESS_DERIVATION_CONTRACT;edit(c);await assert.rejects(async()=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)));assert.equal(count(c),1);}finally{c.db.close();}});
test('C storage counters remain actual legacy projection rather than inherited proof READY',async()=>{const c=await setup({coverage:true});try{c.input.derivation.readinessReconciliationContractVersion=READINESS_DERIVATION_CONTRACT;const out=await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)),ss=out.version.specification.scenarios;assert.equal(out.version.specification.summary.readyCount,ss.filter(s=>s.automation.readiness==='READY').length);assert.equal(out.version.specification.summary.scenarioCount,ss.length);}finally{c.db.close();}});

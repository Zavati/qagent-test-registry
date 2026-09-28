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
test('native marked proof appends immutable version, invalidates only changed v2, and is idempotent',async()=>{
 const c=await setup();try{
 const before=structuredClone(c.f.sourceVersion.specification);const input=validateDerivedVersionInput(c.input);assert.equal(input.changes[0].confirmationProof.admissionBasis,'STRUCTURED_READINESS_V2');
 const out=await c.r.appendDerivedVersion(input);assert.equal(out.version.version,2);const [changed,sibling]=out.version.specification.scenarios;
 assert.equal(changed.readinessV2,undefined);assert.deepEqual(sibling,before.scenarios[1]);assert.deepEqual(changed.spec.assertions,before.scenarios[0].spec.assertions);assert.deepEqual(changed.spec.auth,before.scenarios[0].spec.auth);assert.equal(changed.spec.testData.bindings[0].source,'OBSERVED');assert.equal(changed.learning.phase,'PENDING_VERIFICATION');
 const projected=readScenarioReadinessV2(changed,{derivedVersion:true});assert.equal(projected.basis,'LEGACY_PROJECTION');assert.equal(projected.execution.status,'READY');assert.equal(projected.expectation.status,'HYPOTHESIS');assert.equal(projected.regression.status,'BLOCKED');
 const old=await c.r.getExactVersion({testDesignId:c.f.sourceVersion.testDesignId,version:1,...scope});assert.deepEqual(old.specification,before);assert.equal((await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input))).version.id,out.version.id);assert.equal(count(c),2);
 }finally{c.db.close();}
});
test('native coverage proof preserves assertions, appends only supported additions, leaves verification pending',async()=>{
 const c=await setup({coverage:true});try{
 assert.equal(c.proof.execution.admissionBasis,'STRUCTURED_READINESS_V2');const before=structuredClone(c.f.sourceVersion.specification);const out=await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input));const changed=out.version.specification.scenarios[1];assert.deepEqual(out.version.specification.scenarios[0],before.scenarios[0]);assert.deepEqual(changed.spec.assertions.slice(0,2),before.scenarios[1].spec.assertions);assert.deepEqual(changed.spec.assertions[2],{type:'JSON_PATH_TYPE',path:'$.meta.total',expectedType:'number'});assert.equal(changed.readinessV2,undefined);assert.equal(changed.learning.phase,'PENDING_VERIFICATION');assert.equal(readScenarioReadinessV2(changed,{derivedVersion:true}).expectation.status,'HYPOTHESIS');assert.equal(count(c),2);
 }finally{c.db.close();}
});
test('unmarked pre-B proof remains applicable without changing its resolvedBlockers interpretation',async()=>{
 const c=await setup({oldProof:true});try{assert.equal(c.proof.admissionBasis,undefined);assert.ok(c.proof.resolvedBlockers.includes('LEARNING_UNAUTHENTICATED_INTENT'));const out=await c.r.appendDerivedVersion(validateDerivedVersionInput(c.input));assert.equal(out.version.version,2);assert.equal(out.version.specification.scenarios[0].learning.phase,'PENDING_VERIFICATION');}finally{c.db.close();}
});
for(const [name,edit] of [
 ['cross tenant',x=>x.changes[0].confirmationProof.organizationId='org_other'],['cross project',x=>x.changes[0].confirmationProof.projectId='prj_other'],['cross version',x=>x.changes[0].confirmationProof.testDesignVersionId='tdv_other'],['wrong source hash',x=>x.changes[0].confirmationProof.sourceScenarioHash='0'.repeat(64)],['wrong assertions hash',x=>x.changes[0].confirmationProof.assertionsHash='0'.repeat(64)],['altered status',x=>x.changes[0].confirmationProof.actualStatusCode=200],['tampered binding',x=>x.changes[0].confirmationProof.addedBindings[0].bindingKey='PATH_PARAM:id@9:0'],['extra credential',x=>x.changes[0].confirmationProof.password='NO_EXPOSURE'],['unknown admission basis',x=>x.changes[0].confirmationProof.admissionBasis='TRUST_AI'],['missing approval',x=>x.derivation.approvedByUserId=null],['mixed expectation rewrite',x=>x.changes.push({type:'STATUS_EXPECTATION',scenarioId:'test_003',assertionIndex:0,expectedStatusCodes:[200]})]
])test('Registry rejects '+name+' without append',async()=>{
 const c=await setup();try{edit(c.input);await assert.rejects(async()=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)));assert.equal(count(c),1);}finally{c.db.close();}
});
test('removing the structured proof marker does not downgrade an unknown native blocker',async()=>{
 const c=await setup();try{delete c.input.changes[0].confirmationProof.admissionBasis;await assert.rejects(async()=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)));assert.equal(count(c),1);}finally{c.db.close();}
});
test('marked proof cannot be replayed against a source without native v2',async()=>{
 const c=await setup();try{const source=structuredClone(c.f.sourceVersion.specification.scenarios[0]);delete source.readinessV2;await assert.rejects(applyConfirmationToScenario(source,c.proof,c.f.sourceVersion),{code:'LEARNING_CONFIRMATION_ADMISSION_SOURCE_MISMATCH'});}finally{c.db.close();}
});
test('coverage proof cannot add an undeclared assertion or reuse the wrong source',async()=>{
 for(const edit of [x=>x.changes[0].coverageProof.additions[0].path='$.other',x=>x.changes[0].coverageProof.execution.projectId='prj_other']){const c=await setup({coverage:true});try{edit(c.input);await assert.rejects(async()=>c.r.appendDerivedVersion(validateDerivedVersionInput(c.input)));assert.equal(count(c),1);}finally{c.db.close();}}
});

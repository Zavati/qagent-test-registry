// FIX-4: synthetic immutable baseline. No network, credentials or external execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateObservedBaseline,validateObservedBaselineScenario,observedBaselineReady,
 baselineExecutionReadiness,baselineLearningEligibility,assertNoProtectedBaselineChanges} from '../src/baselineContract.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x), baseline=()=>clone(fixture.specification.scenarios[0]);
const original=baseline(), b=original.baseline, expiredAt=Date.parse(b.expiresAt), after=expiredAt+86400000*366;
const scope={organizationId:b.source.organizationId,projectId:b.source.projectId,endpointId:b.source.endpointId,environmentId:b.source.environmentId};
const AGE='OBSERVED_BASELINE_SOURCE_EXPIRED';
for(const [name,at] of [['before',expiredAt-1],['at',expiredAt],['after',expiredAt+1],['year later',after]])
 test(`saved complete baseline is executable ${name} the old deadline`,()=>{
   const s=baseline(),before=JSON.stringify(s);validateObservedBaselineScenario(s,scope);
   assert.equal(observedBaselineReady(s.baseline,at),true);assert.equal(JSON.stringify(s),before);
 });
for(const [name,change] of [
 ['partial request',s=>s.baseline.requestCoverage.status='PARTIAL'],
 ['partial response',s=>{s.baseline.responseCoverage.status='PARTIAL';s.baseline.selfCheck='PARTIAL';}],
 ['failed self check',s=>s.baseline.selfCheck='FAILED']])
 test(`${name} is not made ready by removing age`,()=>{const s=baseline();change(s);assert.equal(observedBaselineReady(s.baseline,after),false);});
for(const key of ['organizationId','projectId','endpointId','environmentId'])
 test(`old baseline cannot cross ${key}`,()=>{assert.throws(()=>validateObservedBaselineScenario(baseline(),{...scope,[key]:'other'}));});
test('expiresAt provenance is retained and must remain a valid timestamp',()=>{
 const bad=clone(b);bad.expiresAt='not-a-date';assert.throws(()=>validateObservedBaseline(bad,scope));
 const impossible=clone(b);impossible.expiresAt=b.source.observedAt;assert.throws(()=>validateObservedBaseline(impossible,scope));
});
test('expected assertions and protected changes cannot be rewritten by age policy',()=>{
 const s=baseline();s.spec.assertions[0].expectedStatusCodes=[404];assert.throws(()=>validateObservedBaselineScenario(s,scope));
 assert.throws(()=>assertNoProtectedBaselineChanges(fixture.specification,[original.scenarioId]),{code:'OBSERVED_BASELINE_REBASELINE_REQUIRED'});
});
test('historical expiry-only label projects READY without rewriting the artifact',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};const before=JSON.stringify(s);
 assert.equal(baselineExecutionReadiness(s),'READY');assert.equal(JSON.stringify(s),before);
});
for(const code of ['OBSERVED_BASELINE_SOURCE_UNAVAILABLE','OBSERVED_BASELINE_REQUEST_INCOMPLETE','unknown blocker'])
 test(`expiry plus ${code} does not bypass the remaining blocker`,()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE,code]};assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
 });
test('non-baseline and incomplete baseline labels are not promoted',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};s.baseline.requestCoverage.status='PARTIAL';assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
 delete s.baseline;s.generationClass='AI_EXPLORATORY';assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
});

import {readScenarioReadinessV2} from '../src/readiness/legacyReadinessAdapter.js';
import {evaluateScenarioReadinessV2} from '../src/readiness/scenarioReadinessV2.js';
import {buildReadinessIssue} from '../src/readiness/readinessIssues.js';
import {collectScenarioReadinessIssues} from '../src/readiness/scenarioReadinessFacts.js';
import {reconcileReadinessFacts} from '../src/readiness/readinessReconciliation.js';
function snapshot(s,codes,expectation={status:'EVIDENCED',basis:'OBSERVED_BASELINE'}) {
 s.readinessV2=evaluateScenarioReadinessV2({basis:'NATIVE_V2',issues:codes.map(c=>buildReadinessIssue(c,'READINESS_EVALUATOR')),expectation,learningPolicyAllows:false});
 return s;
}
test('clock no longer introduces an expiry issue to facts',()=>{
 assert.deepEqual(collectScenarioReadinessIssues(original,{nowMs:after}),collectScenarioReadinessIssues(original,{nowMs:expiredAt-1}));
 assert.equal(collectScenarioReadinessIssues(original,{nowMs:after}).some(i=>i.code===AGE),false);
});
test('native expiry-only issue is removed in read projection, snapshot is immutable',()=>{
 const s=snapshot(baseline(),[AGE]),before=JSON.stringify(s),out=readScenarioReadinessV2(s,{nowMs:after});
 assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'READY');assert.equal(out.basis,'NATIVE_V2');assert.equal(out.expectation.status,'EVIDENCED');assert.deepEqual(out.issues,[]);assert.equal(JSON.stringify(s),before);
});
test('native expired plus genuinely unavailable data remains blocked',()=>{
 const s=snapshot(baseline(),[AGE,'OBSERVED_BASELINE_SOURCE_UNAVAILABLE']),out=readScenarioReadinessV2(s);
 assert.equal(out.execution.status,'BLOCKED');assert.deepEqual(out.issues.map(i=>i.code),['OBSERVED_BASELINE_SOURCE_UNAVAILABLE']);
});
test('expiry removal cannot verify an immature derivation',()=>{
 const s=snapshot(baseline(),[AGE,'EXPECTATION_REVALIDATION_REQUIRED'],{status:'HYPOTHESIS',basis:'DERIVATION_PENDING_VERIFICATION'});
 const out=readScenarioReadinessV2(s);assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'BLOCKED');assert.equal(out.expectation.status,'HYPOTHESIS');
});
test('legacy expiry-only issue does not create a replacement synthetic data blocker',()=>{
 const s=baseline();delete s.readinessV2;s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};
 const out=readScenarioReadinessV2(s,{nowMs:after});assert.equal(out.basis,'LEGACY_PROJECTION');assert.equal(out.execution.status,'READY');assert.equal(out.regression.status,'READY');assert.deepEqual(out.issues,[]);
});
test('legacy unknown cause still fails closed after ignoring age',()=>{
 const s=baseline();delete s.readinessV2;s.automation={readiness:'NEEDS_DATA',blockers:[AGE,'UNKNOWN_CUSTOM_BLOCKER']};
 assert.equal(readScenarioReadinessV2(s,{nowMs:after}).execution.status,'BLOCKED');
});
test('invalid present v2 is rejected, not silently adapted',()=>{
 const s=baseline();s.readinessV2={contractVersion:'bad',issues:[]};assert.throws(()=>readScenarioReadinessV2(s));
});
test('reconciliation removes old expiry from explicitly supplied base but never evolves a baseline',()=>{
 const s=snapshot(baseline(),[AGE]),before=JSON.stringify(s),out=reconcileReadinessFacts({scenario:s,base:s.readinessV2,nowMs:after,proposalAvailable:true,verificationMatched:true,evidence:{kind:'PASSED',coverageComplete:true}});
 assert.equal(out.state,'BASELINE_PROTECTED');assert.equal(out.readinessV2.regression.status,'READY');assert.equal(out.readinessV2.expectation.status,'EVIDENCED');assert.ok(out.resolvedIssueCodes.includes(AGE));assert.equal(JSON.stringify(s),before);
});
test('non-baseline expiry issue is not discarded by native reader',()=>{
 const s=snapshot(baseline(),[AGE]);delete s.baseline;s.generationClass='AI_EXPLORATORY';assert.equal(readScenarioReadinessV2(s).execution.status,'BLOCKED');
});

import {validateAppendVersionInput} from '../src/validation/testDesignVersion.js';
import {buildTestDesignExecutionProjection,classifySuiteExecutionEligibility} from '../src/domain/executionEligibility.js';
test('Registry accepts append containing a complete baseline past historical expiration',()=>{
 const input={organizationId:scope.organizationId,projectId:scope.projectId,endpointId:scope.endpointId,generationRequestId:'tdg_fix4_baseline',contextFingerprint:'a'.repeat(64),specification:clone(fixture.specification)};
 const before=JSON.stringify(input);assert.ok(validateAppendVersionInput(input));assert.equal(JSON.stringify(input),before);
});
test('Registry rejects READY if its real captured request coverage is incomplete',()=>{
 const input={organizationId:scope.organizationId,projectId:scope.projectId,endpointId:scope.endpointId,generationRequestId:'tdg_fix4_baseline',contextFingerprint:'a'.repeat(64),specification:clone(fixture.specification)};
 input.specification.scenarios[0].baseline.requestCoverage.status='PARTIAL';assert.throws(()=>validateAppendVersionInput(input));
});
test('inventory projection includes old expiry-only baseline while provenance stays historical',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[AGE]};const spec={...fixture.specification,scenarios:[s]},before=JSON.stringify(spec);
 const out=buildTestDesignExecutionProjection({specificationJson:spec,testDesignVersionId:'tdv_pinned',testDesignVersion:7,...scope});
 assert.deepEqual(out.readyScenarioIds,[s.scenarioId]);assert.equal(out.executionEligibleScenarioCount,1);assert.equal(out.scenarioOrigins[0].expiresAt,b.expiresAt);assert.equal(JSON.stringify(spec),before);
});
test('inventory projection does not release mutations',()=>{
 const s=baseline();s.spec.target.method='POST';assert.equal(classifySuiteExecutionEligibility(s).eligible,false);assert.equal(classifySuiteExecutionEligibility(s).reason,'MUTATION_EXECUTION_DISABLED');
});

test('malformed native issue list cannot release a historical expiry-only label',()=>{
 const s=baseline();s.automation={readiness:'NEEDS_DATA',blockers:[]};s.readinessV2={issues:{}};assert.equal(baselineExecutionReadiness(s),'NEEDS_DATA');
});

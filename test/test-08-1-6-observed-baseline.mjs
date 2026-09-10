// 08.1.6: public metadata guards, safe failure and source immutability. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateObservedBaseline,validateObservedBaselineScenario,observedBaselineReady,assertNoProtectedBaselineChanges,isApprovedBaselineRevision} from '../src/baselineContract.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json',import.meta.url),'utf8'));
const s=f.specification.scenarios[0],b=s.baseline;
const scope={organizationId:b.source.organizationId,projectId:b.source.projectId,endpointId:b.source.endpointId};
const now=Date.parse(b.source.observedAt)+60000;
test('public provenance validates exact scope and contains no request data',()=>{
 assert.equal(validateObservedBaseline(b,scope),b);assert.equal(validateObservedBaselineScenario(s,scope),s);
 assert.throws(()=>validateObservedBaseline({...b,request:{limit:50}},scope));
 assert.throws(()=>validateObservedBaseline(b,{...scope,projectId:'other'}));
 assert.throws(()=>validateObservedBaselineScenario({...s,spec:{...s.spec,assertions:[{type:'STATUS',expectedStatusCodes:[422]}]}},scope));
});
test('source expiry / incomplete evidence never becomes ready',()=>{
 assert.equal(observedBaselineReady(b,now),true);assert.equal(observedBaselineReady(b,Date.parse(b.expiresAt)+1),false);
 assert.equal(observedBaselineReady({...b,requestCoverage:{...b.requestCoverage,status:'PARTIAL'}},now),false);
});
test('ordinary repair cannot weaken baseline and explicit approval needs exact parent',()=>{
 assert.throws(()=>assertNoProtectedBaselineChanges(f.specification,[s.scenarioId]),{code:'OBSERVED_BASELINE_REBASELINE_REQUIRED'});
 const next=structuredClone(s);next.baseline.revision={previousBaselineId:b.baselineId,sourceTestDesignVersionId:'tdv_parent',approvedByUserId:'usr_test',approvedAt:new Date(now).toISOString(),reasonCode:'RECAPTURE_SOURCE'};
 assert.equal(isApprovedBaselineRevision(s,next,'tdv_parent'),true);assert.equal(isApprovedBaselineRevision(s,next,'tdv_other'),false);
});

import {validateAppendVersionInput} from '../src/validation/testDesignVersion.js';
test('Registry contract accepts system source but rejects inline values and forged expectation',()=>{
 const input={...scope,generationRequestId:'tdg_test_0816',contextFingerprint:'a'.repeat(64),specification:f.specification};assert.ok(validateAppendVersionInput(input));
 const modified=structuredClone(f.specification);modified.scenarios[0].spec.request.query.limit=123;assert.throws(()=>validateAppendVersionInput({...input,specification:modified}));
});

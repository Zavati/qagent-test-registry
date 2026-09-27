import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDb, seed, headers } from './helpers/readinessFixture.mjs';
import { sampleSpecification, appendPayload } from './fixtures.mjs';
import { createTestDesignRepository } from '../src/repository/testDesignRepository.js';
import { createTestReadinessRepository } from '../src/repository/testReadinessRepository.js';
import { validateAppendVersionInput } from '../src/validation/testDesignVersion.js';
import { parseTestReadinessQuery, validateTestReadinessEnvelope } from '../src/domain/testReadinessContracts.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../src/readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from '../src/readiness/scenarioReadinessFacts.js';
import { adaptLegacyScenarioReadiness } from '../src/readiness/legacyReadinessAdapter.js';
import { handleRequest } from '../src/index.js';
const scope={organizationId:'org_test',projectId:'prj_test',endpointId:'cep_orders'};
function nativeSpec({hypothesis=false,two=false}={}) {
 const spec=sampleSpecification(),s=spec.scenarios[0];s.spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]}];s.generationClass='AI_EXPLORATORY';
 if(hypothesis){s.grounding.level='ASSUMED';s.automation.blockers=['O cenário contém hipótese que precisa de revisão humana.'];}
 s.readinessV2=evaluateScenarioReadinessV2({expectation:hypothesis?{status:'HYPOTHESIS',basis:'AI_ASSUMED'}:{status:'EVIDENCED',basis:'OBSERVED_EVIDENCE'},issues:collectScenarioReadinessIssues(s),learningPolicyAllows:true});
 s.automation.readiness=projectLegacyReadiness(s.readinessV2);
 if(two){const b=structuredClone(s);b.scenarioId='test_002';spec.scenarios.push(b);}
 spec.summary.scenarioCount=spec.scenarios.length;spec.summary.readyCount=hypothesis?0:spec.scenarios.length;spec.summary.byReadiness={[s.automation.readiness]:spec.scenarios.length};spec.summary.byGrounding={[s.grounding.level]:spec.scenarios.length};
 return spec;
}
const append=(repo,spec=nativeSpec(),id='tdg_structured_base')=>repo.appendVersion(validateAppendVersionInput(appendPayload({specification:spec,generationRequestId:id})));
function detail(db,id,enabled=true,extra={}) {
 const query=parseTestReadinessQuery(new URLSearchParams(`testDesignVersionId=${id}`),{detail:true});
 return createTestReadinessRepository(db,{readinessV2Enabled:enabled}).scenarios({...scope,query,...extra});
}
const total=db=>db.raw.prepare('SELECT total_changes() n').get().n;
function stored(db,id){return db.raw.prepare('SELECT specification_json FROM test_design_versions WHERE id=?').get(id).specification_json;}
function lifecycle(id,operation){return {contractVersion:'qagent.scenario-lifecycle-registry.v1',...scope,sourceTestDesignVersionId:id,operation:{approvedByUserId:'usr_test',reason:'Phase A validation',...operation}};}
async function post(db,path,payload,enabled=true){return handleRequest(new Request('https://registry'+path,{method:'POST',headers:{...headers(),'content-type':'application/json'},body:JSON.stringify(payload)}),{TEST_REGISTRY_DB:db,SCENARIO_READINESS_V2_ENABLED:String(enabled)});}
test('Registry persists native v2 in immutable JSON and exposes it through detail',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),created=await append(repo),id=created.version.id;const before=stored(db,id),writes=total(db);
 const d=await detail(db,id);assert.deepEqual(d.items[0].readinessV2,JSON.parse(before).scenarios[0].readinessV2);assert.equal(d.items[0].readiness,'READY');assert.equal(total(db),writes);assert.equal(stored(db,id),before);
 validateTestReadinessEnvelope({status:'ok',data:d},{...scope,testDesignVersionId:id},{detail:true});
 const off=await detail(db,id,false);assert.ok(!Object.hasOwn(off.items[0],'readinessV2'));assert.equal(stored(db,id),before);
 }finally{db.close();}
});
test('native append is idempotent and uses existing versioned storage',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo,nativeSpec({hypothesis:true})),snapshot=stored(db,first.version.id);const replay=await append(repo,nativeSpec({hypothesis:true}));assert.equal(replay.idempotentReplay,true);assert.equal(replay.version.id,first.version.id);assert.equal(stored(db,first.version.id),snapshot);assert.equal(db.raw.prepare('SELECT count(*) n FROM test_design_versions').get().n,1);}finally{db.close();}
});
test('Registry rejects invalid native enums, safety flags, projection and future maturity even with flag off',async()=>{
 for(const edit of [s=>s.readinessV2.execution.status='RUN',s=>s.readinessV2.token='SECRET_SENTINEL',s=>s.automation.readiness='NEEDS_AUTH',s=>{s.spec.target.path='/orders/{missing}';s.spec.request.pathParams={};},s=>s.readinessV2.expectation={status:'VERIFIED',basis:'VERSION_VERIFICATION'}]) {
  const db=fixtureDb();try{const spec=nativeSpec();edit(spec.scenarios[0]);const res=await post(db,'/v1/test-registry/test-designs/versions',appendPayload({specification:spec}),false);assert.equal(res.status,400);assert.equal(db.raw.prepare('SELECT count(*) n FROM test_design_versions').get().n,0);assert.ok(!JSON.stringify(await res.json()).includes('SECRET_SENTINEL'));}finally{db.close();}
 }
});
test('Repository callers cannot bypass native contract validation',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),input=validateAppendVersionInput(appendPayload({specification:nativeSpec()}));const s=JSON.parse(input.specificationJson);s.scenarios[0].readinessV2=null;input.specificationJson=JSON.stringify(s);await assert.rejects(()=>repo.appendVersion(input),{code:'SCENARIO_READINESS_V2_INVALID'});assert.equal(total(db),0);}finally{db.close();}
});
test('legacy detail projects ASSUMED without changing history, filters, counts or stored label',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),spec=nativeSpec({hypothesis:true});delete spec.scenarios[0].readinessV2;const first=await append(repo,spec),before=stored(db,first.version.id),writes=total(db);const d=await detail(db,first.version.id);
 assert.equal(d.items[0].readiness,'REVIEW_REQUIRED');assert.equal(d.items[0].readinessV2.basis,'LEGACY_PROJECTION');assert.equal(d.items[0].readinessV2.execution.status,'READY');assert.equal(d.items[0].readinessV2.expectation.status,'HYPOTHESIS');assert.equal(total(db),writes);assert.equal(stored(db,first.version.id),before);
 const q=parseTestReadinessQuery(new URLSearchParams());assert.deepEqual(await createTestReadinessRepository(db).list({...scope,query:q,now:'2026-09-27T12:00:00Z'}),await createTestReadinessRepository(db,{readinessV2Enabled:true}).list({...scope,query:q,now:'2026-09-27T12:00:00Z'}));
 }finally{db.close();}
});
test('legacy SQL projection checks data and coverage without selecting raw values',async()=>{
 const db=fixtureDb();try{const s=sampleSpecification().scenarios[0];s.title='meta.total';s.objective='Assert $.meta.total is number';s.spec.request.pathParams={};s.spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]},{type:'JSON_PATH_EXISTS',path:'$.meta.total'}];s.automation={readiness:'NEEDS_DATA',blockers:[]};
 const x=seed(db,{endpoint:'cep_orders',path:'/orders/{id}',scenarios:[s]});const d=await detail(db,x.id);assert.equal(d.items[0].readinessV2.execution.status,'BLOCKED');assert.equal(d.items[0].readinessV2.coverage.status,'PARTIAL');assert.ok(d.items[0].readinessV2.issues.some(i=>i.code==='PATH_PARAM_UNRESOLVED'));
 }finally{db.close();}
});
test('read model redacts credentials/literal assertion values and fails closed on unknown reasons',async()=>{
 const db=fixtureDb();try{const s=sampleSpecification().scenarios[0];s.spec.request.headers={Authorization:'Bearer SECRET_SENTINEL'};s.spec.request.body={password:'SECRET_SENTINEL'};s.spec.assertions.push({type:'JSON_PATH_EQUALS',path:'$.value',expected:'SECRET_SENTINEL'});s.automation.blockers=['Unknown SECRET_SENTINEL'];
 const x=seed(db,{endpoint:'cep_orders',path:'/orders/{id}',scenarios:[s]});const d=await detail(db,x.id);assert.ok(!JSON.stringify(d).includes('SECRET_SENTINEL'));assert.equal(d.items[0].readinessV2.execution.status,'BLOCKED');assert.ok(d.items[0].readinessV2.issues.some(i=>i.code==='SECRET_REQUIRED'));assert.ok(d.items[0].readinessV2.issues.some(i=>i.code==='LEGACY_REASON_UNCLASSIFIED'));
 }finally{db.close();}
});
test('corrupt present v2 fails closed, but rollback can still read the old safe projection',async()=>{
 const db=fixtureDb();try{const s=sampleSpecification().scenarios[0];s.readinessV2={contractVersion:'evil',token:'SECRET_SENTINEL'};const x=seed(db,{endpoint:'cep_orders',scenarios:[s]});await assert.rejects(()=>detail(db,x.id),{code:'TEST_READINESS_CORRUPT_PROJECTION'});assert.ok(!JSON.stringify(await detail(db,x.id,false)).includes('SECRET_SENTINEL'));}finally{db.close();}
});
test('private tenant/project isolation and pinned historical versions are preserved',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo),second=await append(repo,nativeSpec({hypothesis:true}),'tdg_structured_second');const old=await detail(db,first.version.id);assert.equal(old.isLatest,false);assert.equal(old.items[0].readinessV2.expectation.status,'EVIDENCED');assert.equal((await detail(db,second.version.id)).items[0].readinessV2.expectation.status,'HYPOTHESIS');
 await assert.rejects(()=>detail(db,first.version.id,true,{organizationId:'org_other'}),{code:'TEST_READINESS_VERSION_NOT_FOUND'});await assert.rejects(()=>detail(db,first.version.id,true,{projectId:'prj_other'}),{code:'TEST_READINESS_VERSION_NOT_FOUND'});
 }finally{db.close();}
});
test('clone invalidates only copied v2, preserves parent/sibling and never inherits verification',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo,nativeSpec({two:true})),before=stored(db,first.version.id);
 const body=lifecycle(first.version.id,{operationId:'slo_structured_clone',action:'CLONE',scenarioId:'test_001',newScenarioId:'test_clone',title:'Clone'});const res=await post(db,'/internal/v1/test-registry/test-designs/scenario-lifecycle',body);assert.equal(res.status,201);const id=(await res.json()).data.testDesign.versionId;
 const spec=JSON.parse(stored(db,id)),clone=spec.scenarios.find(s=>s.scenarioId==='test_clone');assert.ok(!Object.hasOwn(clone,'readinessV2'));assert.equal(spec.scenarios[0].readinessV2.basis,'NATIVE_V2');assert.equal(spec.scenarios.at(-1).readinessV2.basis,'NATIVE_V2');assert.equal(stored(db,first.version.id),before);
 const d=await detail(db,id);assert.equal(d.items.find(s=>s.scenarioId==='test_clone').readinessV2.expectation.status,'HYPOTHESIS');assert.equal((await post(db,'/internal/v1/test-registry/test-designs/scenario-lifecycle',body)).status,200);
 }finally{db.close();}
});
test('rename preserves native readiness exactly; removing a scenario leaves old history intact',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo,nativeSpec({two:true})),before=stored(db,first.version.id);
 const response=await post(db,'/internal/v1/test-registry/test-designs/scenario-lifecycle',lifecycle(first.version.id,{operationId:'slo_structured_rename',action:'RENAME',scenarioId:'test_001',title:'Display-only renamed'}));assert.equal(response.status,201);const id=(await response.json()).data.testDesign.versionId;
 assert.deepEqual(JSON.parse(stored(db,id)).scenarios[0].readinessV2,JSON.parse(before).scenarios[0].readinessV2);const remove=await post(db,'/internal/v1/test-registry/test-designs/scenario-lifecycle',lifecycle(id,{operationId:'slo_structured_remove',action:'REMOVE',scenarioId:'test_002'}));assert.equal(remove.status,201);assert.equal(stored(db,first.version.id),before);
 }finally{db.close();}
});
test('request edit invalidates touched readiness after existing validation, preserving siblings and version boundaries',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo,nativeSpec({two:true})),before=stored(db,first.version.id);
 const payload={contractVersion:'qagent.scenario-request-edit-registry.v1',...scope,sourceTestDesignVersionId:first.version.id,edit:{editId:'sre_structured',scenarioId:'test_001',approvedByUserId:'usr_test',reason:'Resolve local path'},changes:[{type:'SET_FIXED_LOCAL',scenarioId:'test_001',target:'PATH_PARAM',selector:'id',valueType:'STRING',value:'2',bindingKey:'SCENARIO:test_001:PATH_PARAM:id'}]};
 const r=await post(db,'/internal/v1/test-registry/test-designs/scenario-request-edits',payload);assert.equal(r.status,201);const id=(await r.json()).data.testDesign.versionId,updated=JSON.parse(stored(db,id));assert.ok(!Object.hasOwn(updated.scenarios[0],'readinessV2'));assert.deepEqual(updated.scenarios[1].readinessV2,JSON.parse(before).scenarios[1].readinessV2);assert.equal(updated.scenarios[0].requestManagement.phase,'PENDING_VERIFICATION');assert.equal(stored(db,first.version.id),before);assert.equal((await detail(db,id)).items[0].readinessV2.expectation.status,'HYPOTHESIS');
 }finally{db.close();}
});
test('Registry HTTP route exposes optional v2 with the flag, without invoking services or AI',async()=>{
 const db=fixtureDb();try{const first=await append(createTestDesignRepository(db));const url=`https://registry/v1/test-registry/projects/prj_test/test-readiness/endpoints/cep_orders/scenarios?testDesignVersionId=${first.version.id}`;
 const writes=total(db);const r=await handleRequest(new Request(url,{headers:headers()}),{TEST_REGISTRY_DB:db,SCENARIO_READINESS_V2_ENABLED:'true',log:()=>{}});assert.equal(r.status,200);assert.equal((await r.json()).data.items[0].readinessV2.basis,'NATIVE_V2');assert.equal(total(db),writes);
 }finally{db.close();}
});

test('existing assertion derivation does not reuse native expectation maturity or weaken immutable parents',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),first=await append(repo,nativeSpec({two:true})),before=stored(db,first.version.id);
 const result=await repo.appendDerivedVersion({...scope,sourceTestDesignVersionId:first.version.id,derivation:{proposalId:'prp_structured_status',sourceResultSetId:'rset_test',sourceScenarioResultId:'sres_test',approvedByUserId:'usr_test',approvalReason:'Reviewed status change'},changes:[{type:'STATUS_EXPECTATION',scenarioId:'test_001',assertionIndex:0,expectedStatusCodes:[201]}]});
 assert.ok(!Object.hasOwn(result.version.specification.scenarios[0],'readinessV2'));assert.deepEqual(result.version.specification.scenarios[1].readinessV2,JSON.parse(before).scenarios[1].readinessV2);assert.equal(stored(db,first.version.id),before);
 const d=await detail(db,result.version.id),changed=d.items.find(s=>s.scenarioId==='test_001');assert.equal(changed.readiness,'READY');assert.equal(changed.readinessV2.expectation.status,'HYPOTHESIS');assert.equal(changed.readinessV2.regression.status,'BLOCKED');
 assert.equal(d.items.find(s=>s.scenarioId==='test_002').readinessV2.basis,'NATIVE_V2');
 }finally{db.close();}
});
test('existing human repair invalidates only touched v2 and does not confirm expectation',async()=>{
 const db=fixtureDb();try{const repo=createTestDesignRepository(db),spec=nativeSpec({two:true});spec.scenarios[0].spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.name',source:'OBSERVED',valueType:'STRING',bindingKey:'BODY:$.name',provenance:{origin:'OBSERVED'}}]};
 const first=await append(repo,spec),before=stored(db,first.version.id);const result=await repo.appendHumanRequestRepairVersion({...scope,sourceTestDesignVersionId:first.version.id,repair:{repairId:'hrr_structured',sourceResultSetId:'rset_test',sourceScenarioResultId:'sres_test',sourceScenarioId:'test_001',approvedByUserId:'usr_test',reason:'Reviewed data'},changes:[{type:'SET_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'BODY',selector:'$.name',currentSource:'OBSERVED',valueType:'STRING'}]});
 assert.equal(result.version.specification.scenarios[0].spec.testData.bindings[0].source,'FIXED');assert.ok(!Object.hasOwn(result.version.specification.scenarios[0],'readinessV2'));assert.equal(stored(db,first.version.id),before);assert.equal((await detail(db,result.version.id)).items[0].readinessV2.expectation.status,'HYPOTHESIS');
 }finally{db.close();}
});
test('legacy negative query strategy round-trip cannot sanitize an invalid strategy into a valid one',async()=>{
 for(const invalid of [false,true]) {
  const db=fixtureDb();try{const s=sampleSpecification().scenarios[0];s.title='Unknown sort value';s.objective='Validar query inválida para sort';s.category='NEGATIVE';s.spec.target.path='/orders';s.spec.request.pathParams={};s.spec.request.query={sort:'qagent_probe_sort_unobserved_v1'};s.spec.assertions=[{type:'STATUS',expectedStatusCodes:[422]}];
   s.spec.negativeStrategy={contractVersion:'qagent.negative-request-strategy.v1',operation:'QUERY_VALUE_PROBE',target:'QUERY',selector:'sort',sourcePath:'/orders',basis:'UNVERIFIED_VALUE_HYPOTHESIS',probeValue:'qagent_probe_sort_unobserved_v1',...(invalid?{inventedField:'SECRET_SENTINEL'}:{})};
   const x=seed(db,{endpoint:'cep_orders',path:'/orders',scenarios:[s]});const d=await detail(db,x.id),direct=adaptLegacyScenarioReadiness(s);assert.equal(d.items[0].readinessV2.execution.status,direct.execution.status);assert.ok(!JSON.stringify(d).includes('SECRET_SENTINEL'));assert.equal(d.items[0].readinessV2.execution.status,invalid?'BLOCKED':'READY');
  }finally{db.close();}
 }
});

test('existing confirmation proof/hash and approval remain valid with native v2 parents',async()=>{
 const {fixture,scope:sc}=await import('./confirmation-fixture-08.1.6-fix2-2.mjs');const {buildConfirmationProof}=await import('../src/learningConfirmation.js');const {validateDerivedVersionInput}=await import('../src/validation/testDesignEvolution.js');
 const db=fixtureDb();try{const f=fixture(),repo=createTestDesignRepository(db),spec=f.sourceVersion.specification;
 for(const s of spec.scenarios){s.readinessV2=evaluateScenarioReadinessV2({expectation:{status:'HYPOTHESIS',basis:'AI_ASSUMED'},issues:collectScenarioReadinessIssues(s),learningPolicyAllows:true});s.automation.readiness=projectLegacyReadiness(s.readinessV2);}
 spec.summary.byReadiness={};for(const s of spec.scenarios)spec.summary.byReadiness[s.automation.readiness]=(spec.summary.byReadiness[s.automation.readiness]||0)+1;
 const first=await repo.appendVersion(validateAppendVersionInput(appendPayload({...sc,metadata:{provider:'synthetic',model:'fixture'},contextFingerprint:'f'.repeat(64),specification:spec})));f.sourceVersion=first.version;Object.assign(f.resultSet,{testDesignId:first.version.testDesignId,testDesignVersionId:first.version.id,testDesignVersion:1});
 const before=stored(db,first.version.id),proof=await buildConfirmationProof(f),input={organizationId:sc.organizationId,projectId:sc.projectId,sourceTestDesignVersionId:first.version.id,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_native_proof',sourceResultSetId:proof.resultSetId,sourceScenarioResultId:proof.scenarioResultId,approvedByUserId:'usr_fixture',approvalReason:'Reviewed existing confirmation'},changes:[{type:'SCENARIO_READINESS_CONFIRMATION',scenarioId:'test_003',assertionIndex:0,confirmationProof:proof,learningSource:{proposalId:'tep_native_proof',resultSetId:proof.resultSetId,scenarioResultId:proof.scenarioResultId,runId:proof.runId,testDesignVersionId:proof.testDesignVersionId,environmentId:proof.environmentId}}]};
 const invalid=structuredClone(input);invalid.changes[0].confirmationProof.sourceScenarioHash='0'.repeat(64);await assert.rejects(()=>repo.appendDerivedVersion(validateDerivedVersionInput(invalid)));
 const next=await repo.appendDerivedVersion(validateDerivedVersionInput(input));assert.equal(next.version.version,2);assert.equal(next.version.specification.scenarios[0].learning.phase,'PENDING_VERIFICATION');assert.ok(!Object.hasOwn(next.version.specification.scenarios[0],'readinessV2'));assert.deepEqual(next.version.specification.scenarios[1].readinessV2,first.version.specification.scenarios[1].readinessV2);assert.equal(stored(db,first.version.id),before);
 const query=parseTestReadinessQuery(new URLSearchParams(`testDesignVersionId=${next.version.id}`),{detail:true});const d=await createTestReadinessRepository(db,{readinessV2Enabled:true}).scenarios({...sc,query});assert.equal(d.items.find(s=>s.scenarioId==='test_003').readinessV2.expectation.status,'HYPOTHESIS');assert.notEqual(d.items.find(s=>s.scenarioId==='test_003').readinessV2.expectation.status,'VERIFIED');
 }finally{db.close();}
});

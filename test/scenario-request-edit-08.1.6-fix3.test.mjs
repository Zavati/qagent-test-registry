import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';
import { appendPayload, sampleSpecification } from './fixtures.mjs';
import { handleRequest } from '../src/index.js';

const headers={'content-type':'application/json','x-qagent-organization-id':'org_test','x-qagent-project-id':'prj_test'};
const env=db=>({TEST_REGISTRY_DB:db,TEST_REGISTRY_MAX_SPEC_BYTES:'262144',TEST_REGISTRY_MAX_REQUEST_BYTES:'393216'});

function sourceSpec(){
  const spec=sampleSpecification({readiness:'NEEDS_DATA'});
  const a=spec.scenarios[0];
  a.scenarioId='scenario_a';
  a.automation={readiness:'NEEDS_DATA',blockers:['Test Data: configure FIXED para BODY $.name no escopo apropriado.']};
  a.spec.target.path='/orders/{id}';
  a.spec.request={pathParams:{},query:{},headers:{},body:{}};
  a.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'PATH_PARAM',selector:'id',source:'OBSERVED',valueType:'STRING',bindingKey:'PATH_PARAM:id@1:0',provenance:{origin:'OBSERVED'}}]};
  const b=structuredClone(a);b.scenarioId='scenario_b';b.title='Sibling';b.automation={readiness:'READY',blockers:[]};b.spec.testData.bindings=[{target:'BODY',selector:'$.name',source:'FIXED',valueType:'STRING',bindingKey:'BODY:$.name',provenance:{origin:'LEGACY_UNKNOWN'}}];
  spec.scenarios=[a,b];spec.summary.scenarioCount=2;spec.summary.readyCount=1;spec.summary.byReadiness={NEEDS_DATA:1,READY:1};
  return spec;
}

async function createBase(db){
  const base=appendPayload({generationRequestId:'tdg_scenario_request_edit_base',specification:sourceSpec()});
  const res=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
  assert.equal(res.status,201);return (await res.json()).data.testDesign;
}

test('08.1.6 FIX-3 edits only selected scenario and reconciles data readiness',async()=>{const db=new SQLiteD1();applyCurrentMigrations(db);try{
  const first=await createBase(db);
  const payload={contractVersion:'qagent.scenario-request-edit-registry.v1',organizationId:'org_test',projectId:'prj_test',endpointId:'cep_orders',sourceTestDesignVersionId:first.versionId,edit:{editId:'sre_test_001',scenarioId:'scenario_a',approvedByUserId:'usr_1',reason:'Scenario-only request data'},changes:[
    {type:'SET_FIXED_LOCAL',scenarioId:'scenario_a',target:'BODY',selector:'$.quantity',valueType:'INTEGER',value:7,bindingKey:'SCENARIO:scenario_a:BODY:$.quantity'},
    {type:'SET_GENERATED',scenarioId:'scenario_a',target:'BODY',selector:'$.name',valueType:'STRING',generator:{kind:'FULL_NAME',config:{}}},
    {type:'SET_GENERATED',scenarioId:'scenario_a',target:'BODY',selector:'$.executionDate',valueType:'STRING',generator:{kind:'CURRENT_DATE',config:{timezone:'America/Sao_Paulo',offsetDays:0}}},
  ]};
  const req=()=>new Request('https://r/internal/v1/test-registry/test-designs/scenario-request-edits',{method:'POST',headers,body:JSON.stringify(payload)});
  const edited=await handleRequest(req(),env(db));assert.equal(edited.status,201);const out=(await edited.json()).data;assert.equal(out.testDesign.version,2);
  const replay=await handleRequest(req(),env(db));assert.equal(replay.status,200);assert.equal((await replay.json()).data.testDesign.versionId,out.testDesign.versionId);
  const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
  const spec=(await latest.json()).data.version.specification;const a=spec.scenarios.find(s=>s.scenarioId==='scenario_a'),b=spec.scenarios.find(s=>s.scenarioId==='scenario_b');
  assert.equal(a.automation.readiness,'READY');assert.deepEqual(a.automation.blockers,[]);
  const qty=a.spec.testData.bindings.find(x=>x.selector==='$.quantity');assert.equal(qty.source,'FIXED');assert.equal(qty.fixedValue,7);assert.equal(qty.bindingKey,'SCENARIO:scenario_a:BODY:$.quantity');assert.equal(qty.provenance.origin,'USER_DEFINED');
  assert.equal(a.spec.testData.bindings.find(x=>x.selector==='$.name').generator.kind,'FULL_NAME');
  assert.deepEqual(a.spec.testData.bindings.find(x=>x.selector==='$.executionDate').generator.config,{timezone:'America/Sao_Paulo',offsetDays:0});
  assert.equal(a.requestManagement.contractVersion,'qagent.scenario-request-management.v1');assert.equal(a.requestManagement.sourceTestDesignVersionId,first.versionId);assert.equal(a.requestManagement.phase,'PENDING_VERIFICATION');
  assert.deepEqual(b,sourceSpec().scenarios.find(s=>s.scenarioId==='scenario_b'));
  assert.equal(spec.summary.readyCount,2);
}finally{db.close();}});

test('08.1.6 FIX-3 blocks path omission and sensitive local literals',async()=>{const db=new SQLiteD1();applyCurrentMigrations(db);try{
  const first=await createBase(db);
  for(const change of [
    {type:'OMIT',scenarioId:'scenario_a',target:'PATH_PARAM',selector:'id'},
    {type:'SET_FIXED_LOCAL',scenarioId:'scenario_a',target:'BODY',selector:'$.password',valueType:'STRING',value:'x',bindingKey:'SCENARIO:scenario_a:BODY:$.password'},
  ]){
    const payload={contractVersion:'qagent.scenario-request-edit-registry.v1',organizationId:'org_test',projectId:'prj_test',endpointId:'cep_orders',sourceTestDesignVersionId:first.versionId,edit:{editId:`sre_bad_${change.selector}`,scenarioId:'scenario_a',approvedByUserId:'usr_1',reason:'bad'},changes:[change]};
    const res=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/scenario-request-edits',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));assert.ok(res.status>=400);
  }
}finally{db.close();}});

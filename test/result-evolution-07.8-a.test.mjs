import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import { handleRequest } from '../src/index.js';import { appendPayload } from './fixtures.mjs';import { SQLiteD1 } from './helpers/sqliteD1.mjs';
const m1=fs.readFileSync(new URL('../migrations/0001_test_registry_foundation.sql',import.meta.url),'utf8');const m3=fs.readFileSync(new URL('../migrations/0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql',import.meta.url),'utf8');const m5=fs.readFileSync(new URL('../migrations/0005_foundation_07_8_a_result_evolution_provenance.sql',import.meta.url),'utf8');
const headers={'content-type':'application/json','x-qagent-organization-id':'org_test','x-qagent-project-id':'prj_test'};const env=db=>({TEST_REGISTRY_DB:db,TEST_REGISTRY_MAX_SPEC_BYTES:'262144',TEST_REGISTRY_MAX_REQUEST_BYTES:'393216'});
test('07.8-A creates one immutable derived version and replays proposal idempotently',async()=>{const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);try{const base=appendPayload({generationRequestId:'tdg_evolution_base_0001'});base.specification.scenarios[0].spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]},{type:'CONTENT_TYPE',expected:['application/json']}];const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_1234567890abcdef',sourceResultSetId:'rset_1',sourceScenarioResultId:'sres_1',approvedByUserId:'usr_1',approvalReason:'Validated product behavior'},changes:[{type:'STATUS_EXPECTATION',scenarioId:'test_001',assertionIndex:0,expectedStatusCodes:[422]}]};const req=()=>new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)});const evolved=await handleRequest(req(),env(db));assert.equal(evolved.status,201);const e=(await evolved.json()).data.testDesign;assert.equal(e.version,2);const replay=await handleRequest(req(),env(db));assert.equal(replay.status,200);assert.equal((await replay.json()).data.testDesign.versionId,e.versionId);
const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));assert.deepEqual((await old.json()).data.version.specification.scenarios[0].spec.assertions[0].expectedStatusCodes,[200]);assert.deepEqual((await latest.json()).data.version.specification.scenarios[0].spec.assertions[0].expectedStatusCodes,[422]);assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM test_design_versions').get().c,2);
}finally{db.close();}});

test('07.8-A6 evolves a SCHEMA assertion to a Catalog version ref without mutating v1',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_evolution_schema_0001'});
    base.specification.scenarios[0].grounding.schemaRefs=['csv_response_old'];
    base.specification.scenarios[0].spec.assertions=[{type:'STATUS',expectedStatusCodes:[200]},{type:'SCHEMA',schemaRef:'csv_response_old'}];
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_schema_1234567890',sourceResultSetId:'rset_schema_1',sourceScenarioResultId:'sres_schema_1',approvedByUserId:'usr_1',approvalReason:'Schema behavior validated'},changes:[{type:'SCHEMA_EXPECTATION',scenarioId:'test_001',assertionIndex:1,schemaRef:'csv_response_new'}]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldScenario=(await old.json()).data.version.specification.scenarios[0];
    const latestScenario=(await latest.json()).data.version.specification.scenarios[0];
    assert.equal(oldScenario.spec.assertions[1].schemaRef,'csv_response_old');
    assert.deepEqual(oldScenario.grounding.schemaRefs,['csv_response_old']);
    assert.equal(latestScenario.spec.assertions[1].schemaRef,'csv_response_new');
    assert.deepEqual(latestScenario.grounding.schemaRefs,['csv_response_new']);
  }finally{db.close();}
});

test('08.1 learning evolution appends a JSON_PATH_EQUALS assertion without mutating the source version',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_evolution_learning_0001'});
    base.specification.scenarios[0].automation.evolutionState='LEARNING';
    base.specification.scenarios[0].spec.assertions=[{type:'STATUS',expectedStatusCodes:[400]}];
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_learning_1234567890',sourceResultSetId:'rset_learning_1',sourceScenarioResultId:'sres_learning_1',approvedByUserId:null,approvalReason:'QAgent AUTO_SAFE learned stable validation message'},changes:[{type:'ADD_JSON_PATH_EQUALS_ASSERTION',scenarioId:'test_001',assertionIndex:1,path:'$.message',expected:'email is required'}]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldScenario=(await old.json()).data.version.specification.scenarios[0];
    const latestScenario=(await latest.json()).data.version.specification.scenarios[0];
    assert.deepEqual(oldScenario.spec.assertions,[{type:'STATUS',expectedStatusCodes:[400]}]);
    assert.equal(oldScenario.automation.evolutionState,'LEARNING');
    assert.deepEqual(latestScenario.spec.assertions,[{type:'STATUS',expectedStatusCodes:[400]},{type:'JSON_PATH_EQUALS',path:'$.message',expected:'email is required'}]);
    assert.equal(latestScenario.automation.evolutionState,'STABLE');
  }finally{db.close();}
});

test('08.1.1 request-aware evolution repairs GENERATED Test Data in vN+1 without mutating source',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_request_aware_0001'});
    base.specification.scenarios[0].spec.testData={
      contractVersion:'qagent.test-data-bindings.v1',
      bindings:[
        {target:'QUERY',selector:'limit',source:'GENERATED',valueType:'STRING',generator:{kind:'TEXT',config:{}}},
        {target:'QUERY',selector:'offset',source:'GENERATED',valueType:'STRING',generator:{kind:'TEXT',config:{}}},
      ],
    };
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_request_aware_123456',sourceResultSetId:'rset_request_aware_1',sourceScenarioResultId:'sres_request_aware_1',approvedByUserId:null,approvalReason:'QAgent AUTO_SAFE repaired invalid generated query data'},changes:[
      {type:'TEST_DATA_BINDING',scenarioId:'test_001',bindingIndex:0,target:'QUERY',selector:'limit',currentSource:'GENERATED',source:'GENERATED',valueType:'INTEGER',generatorKind:'INTEGER',generatorConfig:{schema:{type:'integer',minimum:10,maximum:50}}},
      {type:'TEST_DATA_BINDING',scenarioId:'test_001',bindingIndex:1,target:'QUERY',selector:'offset',currentSource:'GENERATED',source:'GENERATED',valueType:'INTEGER',generatorKind:'INTEGER'},
    ]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldBindings=(await old.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    const nextBindings=(await latest.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    assert.equal(oldBindings[0].valueType,'STRING');assert.equal(oldBindings[0].generator.kind,'TEXT');
    assert.equal(nextBindings[0].valueType,'INTEGER');assert.equal(nextBindings[0].generator.kind,'INTEGER');assert.deepEqual(nextBindings[0].generator.config,{schema:{type:'integer',minimum:10,maximum:50}});
    assert.equal(nextBindings[1].valueType,'INTEGER');assert.equal(nextBindings[1].generator.kind,'INTEGER');
  }finally{db.close();}
});

test('08.1.3-C adds a generated BODY field immutably for request payload evolution',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_payload_add_0813c'});
    const scenario=base.specification.scenarios[0];
    scenario.spec.request.body={firstName:'placeholder'};
    scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.firstName',source:'GENERATED',valueType:'STRING',generator:{kind:'TEXT',config:{}}}]};
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_payload_add_0813c',sourceResultSetId:'rset_payload_add',sourceScenarioResultId:'sres_payload_add',approvedByUserId:'usr_1',approvalReason:'Required request field confirmed by successful evidence'},changes:[{type:'REQUEST_BODY_FIELD_ADD',scenarioId:'test_001',bindingIndex:1,target:'BODY',selector:'$.lastName',source:'GENERATED',valueType:'STRING',generatorKind:'TEXT',generatorConfig:{schema:{type:'string',minLength:4,maxLength:8}}}]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldBindings=(await old.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    const nextBindings=(await latest.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    assert.equal(oldBindings.length,1);
    assert.equal(nextBindings.length,2);
    assert.deepEqual(nextBindings[1],{target:'BODY',selector:'$.lastName',source:'GENERATED',valueType:'STRING',generator:{kind:'TEXT',config:{schema:{type:'string',minLength:4,maxLength:8}}},provenance:{origin:'RESULT_EVOLUTION'}});
  }finally{db.close();}
});

test('08.1.3-C removes only the reviewed generated BODY field and preserves source version',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_payload_remove_0813c'});
    const scenario=base.specification.scenarios[0];
    scenario.spec.request.body={name:'placeholder',legacyFlag:true};
    scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.name',source:'GENERATED',valueType:'STRING',generator:{kind:'TEXT',config:{}}},{target:'BODY',selector:'$.legacyFlag',source:'GENERATED',valueType:'BOOLEAN',generator:{kind:'BOOLEAN',config:{}}}]};
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_payload_remove_0813c',sourceResultSetId:'rset_payload_remove',sourceScenarioResultId:'sres_payload_remove',approvedByUserId:'usr_1',approvalReason:'Unexpected generated field rejected by API'},changes:[{type:'REQUEST_BODY_FIELD_REMOVE',scenarioId:'test_001',bindingIndex:1,target:'BODY',selector:'$.legacyFlag',source:'GENERATED'}]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldScenario=(await old.json()).data.version.specification.scenarios[0];
    const nextScenario=(await latest.json()).data.version.specification.scenarios[0];
    assert.equal(oldScenario.spec.testData.bindings.length,2);
    assert.equal(oldScenario.spec.request.body.legacyFlag,true);
    assert.equal(nextScenario.spec.testData.bindings.length,1);
    assert.equal(Object.hasOwn(nextScenario.spec.request.body,'legacyFlag'),false);
  }finally{db.close();}
});


test('08.1.3-C FIX-1 evolves reviewed FIXED request data to OBSERVED without overwriting source',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_fixed_observed_0813c_fix1'});
    const scenario=base.specification.scenarios[0];
    scenario.spec.request.body={leaveTypeId:'configured'};
    scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.leaveTypeId',source:'FIXED',valueType:'STRING',bindingKey:'BODY:$.leaveTypeId',provenance:{origin:'USER_DEFINED'}}]};
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    assert.equal(created.status,201);const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_fixed_observed_0813c_fix1',sourceResultSetId:'rset_fixed_observed',sourceScenarioResultId:'sres_fixed_observed',approvedByUserId:'usr_1',approvalReason:'Successful evidence shows configured fixed value is stale'},changes:[{type:'TEST_DATA_BINDING',scenarioId:'test_001',bindingIndex:0,target:'BODY',selector:'$.leaveTypeId',currentSource:'FIXED',source:'OBSERVED',valueType:'STRING'}]};
    const evolved=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(evolved.status,201);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldBinding=(await old.json()).data.version.specification.scenarios[0].spec.testData.bindings[0];
    const nextBinding=(await latest.json()).data.version.specification.scenarios[0].spec.testData.bindings[0];
    assert.equal(oldBinding.source,'FIXED');
    assert.equal(oldBinding.provenance.origin,'USER_DEFINED');
    assert.equal(nextBinding.source,'OBSERVED');
    assert.equal(nextBinding.bindingKey,'BODY:$.leaveTypeId');
    assert.equal(nextBinding.valueType,'STRING');
    assert.equal(nextBinding.generator,undefined);
    assert.deepEqual(nextBinding.provenance,{origin:'RESULT_EVOLUTION'});
  }finally{db.close();}
});

test('08.1.3-C FIX-1 rejects stale FIXED source identity during derived version apply',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);
  try{
    const base=appendPayload({generationRequestId:'tdg_fixed_mismatch_0813c_fix1'});
    const scenario=base.specification.scenarios[0];
    scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.leaveTypeId',source:'FIXED',valueType:'STRING',bindingKey:'BODY:$.leaveTypeId'}]};
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,derivation:{type:'RESULT_EVOLUTION',proposalId:'tep_fixed_mismatch_0813c_fix1',sourceResultSetId:'rset_fixed_mismatch',sourceScenarioResultId:'sres_fixed_mismatch',approvedByUserId:'usr_1',approvalReason:'stale source test'},changes:[{type:'TEST_DATA_BINDING',scenarioId:'test_001',bindingIndex:0,target:'BODY',selector:'$.leaveTypeId',currentSource:'GENERATED',source:'OBSERVED',valueType:'STRING'}]};
    const response=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/derived-versions',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));
    assert.equal(response.status,409);
    const json=await response.json();assert.equal(json.code||json?.error?.code,'TEST_REGISTRY_EVOLUTION_TEST_DATA_MISMATCH');
  }finally{db.close();}
});

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

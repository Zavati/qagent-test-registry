import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import { handleRequest } from '../src/index.js';import { appendPayload } from './fixtures.mjs';import { SQLiteD1 } from './helpers/sqliteD1.mjs';
const m1=fs.readFileSync(new URL('../migrations/0001_test_registry_foundation.sql',import.meta.url),'utf8');const m3=fs.readFileSync(new URL('../migrations/0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql',import.meta.url),'utf8');const m5=fs.readFileSync(new URL('../migrations/0005_foundation_07_8_a_result_evolution_provenance.sql',import.meta.url),'utf8');
const headers={'content-type':'application/json','x-qagent-organization-id':'org_test','x-qagent-project-id':'prj_test'};const env=db=>({TEST_REGISTRY_DB:db,TEST_REGISTRY_MAX_SPEC_BYTES:'262144',TEST_REGISTRY_MAX_REQUEST_BYTES:'393216'});

test('08.1.3-C FIX-3 creates immutable USER_DEFINED FIXED version and preserves source',async()=>{const db=new SQLiteD1();applyCurrentMigrations(db);
  try{
  const base=appendPayload({generationRequestId:'tdg_human_repair_fix3'});const scenario=base.specification.scenarios[0];scenario.spec.request.body={leaveTypeId:'old'};scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[{target:'BODY',selector:'$.leaveTypeId',source:'OBSERVED',valueType:'STRING',bindingKey:'BODY:$.leaveTypeId',provenance:{origin:'OBSERVED'}}]};
  const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));const first=(await created.json()).data.testDesign;
  const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,repair:{repairId:'hrr_fix3_12345678',sourceResultSetId:'rset_1',sourceScenarioResultId:'sres_1',sourceScenarioId:'test_001',approvedByUserId:'usr_1',reason:'Human corrected rejected request field'},changes:[{type:'SET_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'BODY',selector:'$.leaveTypeId',currentSource:'OBSERVED',valueType:'STRING'}]};
  const req=()=>new Request('https://r/internal/v1/test-registry/test-designs/human-request-repairs',{method:'POST',headers,body:JSON.stringify(payload)});
  const repaired=await handleRequest(req(),env(db));assert.equal(repaired.status,201);const repairedData=(await repaired.json()).data;assert.equal(repairedData.testDesign.version,2);
  const replay=await handleRequest(req(),env(db));assert.equal(replay.status,200);assert.equal((await replay.json()).data.testDesign.versionId,repairedData.testDesign.versionId);
  const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
  const oldBinding=(await old.json()).data.version.specification.scenarios[0].spec.testData.bindings[0];const nextBinding=(await latest.json()).data.version.specification.scenarios[0].spec.testData.bindings[0];
  assert.equal(oldBinding.source,'OBSERVED');assert.equal(nextBinding.source,'FIXED');assert.equal(nextBinding.bindingKey,'BODY:$.leaveTypeId');assert.deepEqual(nextBinding.provenance,{origin:'USER_DEFINED'});assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM test_design_versions').get().c,2);
}finally{db.close();}});

test('08.1.3-C FIX-3 rejects sensitive selectors',async()=>{const db=new SQLiteD1();applyCurrentMigrations(db);
  try{
  const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:'tdv_any',repair:{repairId:'hrr_fix3_sensitive',sourceResultSetId:'rset_1',sourceScenarioResultId:'sres_1',sourceScenarioId:'test_001',approvedByUserId:'usr_1',reason:'x'},changes:[{type:'SET_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'BODY',selector:'$.password',currentSource:'FIXED',valueType:'STRING'}]};
  const res=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/human-request-repairs',{method:'POST',headers,body:JSON.stringify(payload)}),env(db));assert.equal(res.status,400);const out=await res.json();assert.equal(out.code||out?.error?.code,'TEST_REGISTRY_HUMAN_REPAIR_FORBIDDEN_FIELD');
}finally{db.close();}});

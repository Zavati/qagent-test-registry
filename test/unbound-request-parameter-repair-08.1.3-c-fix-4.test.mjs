import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { appendPayload } from './fixtures.mjs';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';

const m1=fs.readFileSync(new URL('../migrations/0001_test_registry_foundation.sql',import.meta.url),'utf8');
const m3=fs.readFileSync(new URL('../migrations/0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql',import.meta.url),'utf8');
const m5=fs.readFileSync(new URL('../migrations/0005_foundation_07_8_a_result_evolution_provenance.sql',import.meta.url),'utf8');
const headers={'content-type':'application/json','x-qagent-organization-id':'org_test','x-qagent-project-id':'prj_test'};
const env=db=>({TEST_REGISTRY_DB:db,TEST_REGISTRY_MAX_SPEC_BYTES:'262144',TEST_REGISTRY_MAX_REQUEST_BYTES:'393216'});

test('08.1.3-C FIX-4 adds an immutable USER_DEFINED QUERY binding for an unbound request parameter',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);try{
    const base=appendPayload({generationRequestId:'tdg_unbound_query_fix4'});
    const scenario=base.specification.scenarios[0];
    scenario.spec.target.method='GET';
    scenario.spec.request={};
    scenario.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[]};
    const created=await handleRequest(new Request('https://r/v1/test-registry/test-designs/versions',{method:'POST',headers,body:JSON.stringify(base)}),env(db));
    const first=(await created.json()).data.testDesign;
    const payload={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:first.versionId,repair:{repairId:'hrr_fix4_query_date',sourceResultSetId:'rset_1',sourceScenarioResultId:'sres_1',sourceScenarioId:'test_001',approvedByUserId:'usr_1',reason:'Human confirmed date query parameter'},changes:[{type:'ADD_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'QUERY',selector:'date',valueType:'STRING'}]};
    const request=()=>new Request('https://r/internal/v1/test-registry/test-designs/human-request-repairs',{method:'POST',headers,body:JSON.stringify(payload)});
    const repaired=await handleRequest(request(),env(db));assert.equal(repaired.status,201);const repairedData=(await repaired.json()).data;assert.equal(repairedData.testDesign.version,2);
    const replay=await handleRequest(request(),env(db));assert.equal(replay.status,200);assert.equal((await replay.json()).data.testDesign.versionId,repairedData.testDesign.versionId);
    const old=await handleRequest(new Request(`https://r/v1/test-registry/test-designs/${first.id}/versions/1`,{headers}),env(db));
    const latest=await handleRequest(new Request('https://r/v1/test-registry/projects/prj_test/endpoints/cep_orders/test-design/latest',{headers}),env(db));
    const oldBindings=(await old.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    const nextBindings=(await latest.json()).data.version.specification.scenarios[0].spec.testData.bindings;
    assert.equal(oldBindings.length,0);
    assert.equal(nextBindings.length,1);
    assert.deepEqual(nextBindings[0],{target:'QUERY',selector:'date',source:'FIXED',valueType:'STRING',bindingKey:'QUERY:date',provenance:{origin:'USER_DEFINED'}});
  }finally{db.close();}
});

test('08.1.3-C FIX-4 rejects sensitive and non-QUERY structural additions',async()=>{
  const db=new SQLiteD1();db.exec(m1);db.exec(m3);db.exec(m5);try{
    const common={organizationId:'org_test',projectId:'prj_test',sourceTestDesignVersionId:'tdv_any',repair:{repairId:'hrr_fix4_invalid',sourceResultSetId:'rset_1',sourceScenarioResultId:'sres_1',sourceScenarioId:'test_001',approvedByUserId:'usr_1',reason:'x'}};
    for(const change of [
      {type:'ADD_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'QUERY',selector:'token',valueType:'STRING'},
      {type:'ADD_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'PATH_PARAM',selector:'date',valueType:'STRING'},
    ]){
      const res=await handleRequest(new Request('https://r/internal/v1/test-registry/test-designs/human-request-repairs',{method:'POST',headers,body:JSON.stringify({...common,changes:[change]})}),env(db));
      assert.equal(res.status,400);
    }
  }finally{db.close();}
});

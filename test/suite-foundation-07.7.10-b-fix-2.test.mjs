import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { handleRequest } from "../src/index.js";
import { appendPayload, sampleSpecification } from "./fixtures.mjs";
import { SQLiteD1 } from "./helpers/sqliteD1.mjs";
import { SUITE_SELECTION_POLICY, SUITE_SELECTION_POLICY_VERSION } from "../src/domain/executionEligibility.js";

const migrations=[1,2,3,4].map((n)=>fs.readFileSync(new URL(`../migrations/000${n}${n===1?'_test_registry_foundation':n===2?'_foundation_07_7_10_a_suite_definition':n===3?'_foundation_07_7_10_a_fix_1_execution_inventory_projection':'_foundation_07_7_10_b_suite_execution_items'}.sql`,import.meta.url),"utf8"));
function headers(){return {"content-type":"application/json","x-qagent-organization-id":"org_test","x-qagent-project-id":"prj_test"};}
function env(db){return {TEST_REGISTRY_DB:db,ENVIRONMENT:"test"};}
function mixedSpec(endpointId){
 const base=sampleSpecification({endpointId,contextFingerprint:"c".repeat(64)});
 const make=(id,method)=>{const s=structuredClone(base.scenarios[0]);s.scenarioId=id;s.spec.target.catalogEndpointId=endpointId;s.spec.target.method=method;s.spec.target.path=`/api/${endpointId}`;s.automation.readiness="READY";s.automation.blockers=[];return s;};
 base.scenarios=[make("test_001","GET"),make("test_002","POST"),make("test_003","PUT")];
 base.summary.scenarioCount=3;base.summary.readyCount=3;base.summary.byReadiness={READY:3};
 return base;
}

test("FIX-2 freezes Suite intent as all semantic READY scenarios",async()=>{
 assert.equal(SUITE_SELECTION_POLICY,"LATEST_TEST_DESIGNS_READY_SCENARIOS");
 assert.equal(SUITE_SELECTION_POLICY_VERSION,"qagent.suite-selection-policy.v2");
 const db=new SQLiteD1();try{migrations.forEach((m)=>db.exec(m));const specification=mixedSpec("cep_mut");const body=appendPayload({endpointId:"cep_mut",generationRequestId:"tdg_fix2_0001",contextFingerprint:"c".repeat(64),specification});assert.equal((await handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions",{method:"POST",headers:headers(),body:JSON.stringify(body)}),env(db))).status,201);
 const materialized=await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize",{method:"POST",headers:headers()}),env(db));assert.equal(materialized.status,201);const data=(await materialized.json()).data;assert.equal(data.version.scenarioCount,3);assert.equal(data.version.endpointCount,1);assert.equal(data.version.selectionPolicyVersion,"qagent.suite-selection-policy.v2");assert.deepEqual(data.version.selection[0].scenarioIds,["test_001","test_002","test_003"]);
 const slice=await handleRequest(new Request(`https://registry.internal/v1/test-registry/projects/prj_test/suite-versions/${data.version.suiteVersionId}/execution-slice?offset=0&limit=10`,{headers:headers()}),env(db));const sd=(await slice.json()).data;assert.equal(sd.items[0].method,"GET"); // target method projection is endpoint-level and comes from first scenario; Gateway validates actual run artifact too.
 assert.deepEqual(sd.items[0].scenarioIds,["test_001","test_002","test_003"]);
 }finally{db.close();}
});

test("FIX-2 compact and full inventory fingerprints remain identical without shipping scenario IDs",async()=>{
 const db=new SQLiteD1();try{migrations.forEach((m)=>db.exec(m));const specification=mixedSpec("cep_fp");const body=appendPayload({endpointId:"cep_fp",generationRequestId:"tdg_fix2_0002",contextFingerprint:"c".repeat(64),specification});await handleRequest(new Request("https://registry.internal/v1/test-registry/test-designs/versions",{method:"POST",headers:headers(),body:JSON.stringify(body)}),env(db));
 const full=await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory",{headers:headers()}),env(db));const compact=await handleRequest(new Request("https://registry.internal/v1/test-registry/projects/prj_test/test-inventory?view=compact",{headers:headers()}),env(db));const a=(await full.json()).data,b=(await compact.json()).data;assert.equal(a.inventoryFingerprint,b.inventoryFingerprint);assert.equal(b.selectionIncluded,false);assert.deepEqual(b.selection,[]);
 }finally{db.close();}
});

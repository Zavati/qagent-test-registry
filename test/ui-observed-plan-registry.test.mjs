import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../src/index.js';
import { createTestGenerationInternalSignature } from '../src/security/testGenerationInternalAuth.js';
import { uiContentHash } from '../src/domain/uiTestDesignCanonical.js';
import { validateUiCompilation } from '../src/validation/uiTestDesignVersion.js';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';
import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';

const golden=JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v2.json',import.meta.url),'utf8'));
const legacy=JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json',import.meta.url),'utf8'));
const scope=golden.source.scope,secret='observed-plan-test-secret-at-least-32-bytes';
const appendPath='/v1/test-registry/ui-test-designs/versions';
function setup(){const db=new SQLiteD1();applyCurrentMigrations(db);return {db,env:{TEST_REGISTRY_DB:db,TEST_GENERATION_INTERNAL_HMAC_SECRET:secret},close:()=>db.close()};}
async function request(path,{method='GET',body,authScope=scope}={}){
  const rawBody=body===undefined?'':JSON.stringify(body),url='https://registry.invalid'+path,timestamp=String(Math.floor(Date.now()/1000));
  const signature=await createTestGenerationInternalSignature({secret,method,url,...authScope,timestamp,rawBody});
  return new Request(url,{method,headers:{'content-type':'application/json','X-QAgent-Organization-Id':authScope.organizationId,'X-QAgent-Project-Id':authScope.projectId,'X-QAgent-Test-Generation-Timestamp':timestamp,'X-QAgent-Test-Generation-Signature':signature},...(method==='POST'?{body:rawBody}:{})});
}
async function append(c,operation,compilation=golden){return handleRequest(await request(appendPath,{method:'POST',body:{...scope,generationRequestId:operation,compilation}}),c.env);}
async function read(c,id){return handleRequest(await request(`/v1/test-registry/ui-test-designs/versions/${id}?${new URLSearchParams(scope)}`),c.env);}
async function changed(mutate){const c=structuredClone(golden);mutate(c);c.specificationHash=await uiContentHash(c.specification);return c;}

test('Registry stores the actual compact v2 compiler output with exact source and coverage',async()=>{
  const c=setup();try{
    assert.equal(golden.specification.network,undefined);assert.equal(golden.specification.assertions,undefined);
    await validateUiCompilation(golden,scope);
    const response=await append(c,'uitdg_plan_first');assert.equal(response.status,201,await response.clone().text());
    const receipt=await response.json(),version=await (await read(c,receipt.testDesignVersionId)).json();
    assert.deepEqual(version.compilation,golden);assert.equal(version.executionPerformed,false);assert.equal(receipt.contentHash,golden.specificationHash);
    assert.equal(c.db.raw.prepare('SELECT COUNT(*) AS n FROM test_design_versions').get().n,0);
    assert.equal(golden.specification.coverage.validationUnitsExecuted,0);
  }finally{c.close();}
});

test('v2 appends alongside immutable v1 history, reuses content and rejects operation conflicts',async()=>{
  const c=setup();try{
    const old=await (await append(c,'uitdg_legacy_first',legacy)).json();
    const response=await append(c,'uitdg_plan_next');assert.equal(response.status,201,await response.clone().text());
    const next=await response.json();assert.equal(next.version,old.version+1);assert.equal(next.testDesignId,old.testDesignId);
    assert.deepEqual((await (await read(c,old.testDesignVersionId)).json()).compilation,legacy);
    const again=await (await append(c,'uitdg_plan_next')).json();assert.equal(again.status,'reused');assert.equal(again.testDesignVersionId,next.testDesignVersionId);
    const other=await (await append(c,'uitdg_plan_alias')).json();assert.equal(other.testDesignVersionId,next.testDesignVersionId);
    const modified=await changed(x=>{x.specification.profile.layoutTolerancePx=3;});
    const conflict=await append(c,'uitdg_plan_next',modified);assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'UI_TEST_DESIGN_IDEMPOTENCY_CONFLICT');
    assert.equal(c.db.raw.prepare('SELECT COUNT(*) AS n FROM ui_test_design_versions').get().n,2);
  }finally{c.close();}
});

test('v2 lost acknowledgement reconciles a single immutable version',async()=>{
  const c=setup();try{
    const batch=c.db.batch.bind(c.db);let lost=true;
    c.db.batch=async rows=>{const result=await batch(rows);if(lost){lost=false;throw Error('ACK lost after COMMIT');}return result;};
    const response=await append(c,'uitdg_plan_ack');assert.equal(response.status,200,await response.clone().text());
    const first=await response.json(),again=await (await append(c,'uitdg_plan_ack')).json();
    assert.equal(first.status,'reused');assert.equal(again.testDesignVersionId,first.testDesignVersionId);
    assert.equal(c.db.raw.prepare('SELECT COUNT(*) AS n FROM ui_test_design_versions').get().n,1);
  }finally{c.close();}
});

test('Registry rejects changed or omitted plan coverage even when a new hash is supplied',async()=>{
  for(const mutation of [
    x=>{x.specification.plan.sections.pop();},
    x=>{x.specification.plan.selection='SAMPLE';},
    x=>{x.specification.plan.pendingCannotPass=false;},
    x=>{x.specification.plan.completion='ANY_SECTION';},
    x=>{x.specification.plan.sections[0].pointer='/different';},
    x=>{x.specification.plan.sections[0].rule='EVAL_JS';},
    x=>{x.specification.coverage.actionsPlanned--;},
    x=>{x.specification.coverage.validationUnitsExecuted=1;},
    x=>{x.specification.evidenceVerification.artifactBytesRecheckedDuringCompilation=true;},
    x=>{x.summary.coverage={...x.summary.coverage,checksGenerated:1};},
    x=>{x.specification.readiness.UI_REPLAY.status='READY';},
    x=>{x.specification.extraExecutableCode='alert(1)';},
  ])await assert.rejects(validateUiCompilation(await changed(mutation),scope));
  const corrupted=structuredClone(golden);corrupted.specificationHash='f'.repeat(64);
  await assert.rejects(validateUiCompilation(corrupted,scope),{code:'UI_TEST_DESIGN_HASH_MISMATCH'});
});

test('v2 cannot downgrade contract, cross tenant scope or claim execution at publication',async()=>{
  for(const override of [{contractVersion:'qagent.ui-test-design-compilation.v1'},{compilerVersion:'unknown'},{executionPerformed:true}])await assert.rejects(validateUiCompilation({...golden,...override},scope));
  await assert.rejects(validateUiCompilation(golden,{...scope,environmentId:'env_other'}),{code:'UI_TEST_DESIGN_SCOPE_OR_SOURCE_MISMATCH'});
  const c=setup();try{
    const signedCrossed=await request(appendPath,{method:'POST',authScope:{...scope,organizationId:'org_other'},body:{...scope,generationRequestId:'uitdg_crossed_plan',compilation:golden}});
    const result=await handleRequest(signedCrossed,c.env);assert.equal(result.status,403);
    assert.equal(c.db.raw.prepare('SELECT COUNT(*) AS n FROM ui_test_design_versions').get().n,0);
  }finally{c.close();}
});

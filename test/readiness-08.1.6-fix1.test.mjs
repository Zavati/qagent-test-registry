import test from 'node:test';import assert from 'node:assert/strict';
import {fixtureDb,seed,scenario,headers} from './helpers/readinessFixture.mjs';
import {handleRequest} from '../src/index.js';
import {createTestReadinessRepository} from '../src/repository/testReadinessRepository.js';
import {parseTestReadinessQuery as parse,validateTestReadinessEnvelope,encodeReadinessCursor,baselineGapOf} from '../src/domain/testReadinessContracts.js';
const scope={organizationId:'org_test',projectId:'prj_test'};
const read=(db,q='')=>createTestReadinessRepository(db).list({...scope,query:parse(new URLSearchParams(q))});
const call=(db,q='',opts={})=>handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/test-readiness'+q,{headers:headers(),...opts}),{TEST_REGISTRY_DB:db});
const b=(id,readiness='NEEDS_DATA',req='COMPLETE',res='PARTIAL')=>{const s=scenario(id,readiness,'OBSERVED_BASELINE');s.baseline.requestCoverage.status=req;s.baseline.responseCoverage.status=res;s.baseline.selfCheck=res==='PARTIAL'?'PARTIAL':'PASSED';return s;};

test('all five states; OR inside one field and AND on the same scenario',async()=>{const db=fixtureDb();try{
 seed(db,{endpoint:'cep_a',scenarios:[scenario('ready'),scenario('data','NEEDS_DATA'),scenario('review','REVIEW_REQUIRED'),scenario('auth','NEEDS_AUTH'),scenario('env','NEEDS_ENVIRONMENT')]});
 const d=await read(db,'readiness=NEEDS_DATA,NEEDS_AUTH');assert.equal(d.filteredSummary.matchingScenarioCount,2);assert.equal(d.items.length,1);assert.equal(d.projectSummary.needsEnvironmentScenarioCount,1);assert.equal(d.projectSummary.scenarioCount,5);
 validateTestReadinessEnvelope({status:'ok',data:d},scope,{query:parse(new URLSearchParams('readiness=NEEDS_DATA,NEEDS_AUTH'))});
 seed(db,{endpoint:'cep_b',scenarios:[b('baselineReady','READY','COMPLETE','COMPLETE'),scenario('other','NEEDS_DATA')]});
 const baseline=await read(db,'readiness=NEEDS_DATA&generationClass=OBSERVED_BASELINE');assert.equal(baseline.items.length,0);
}finally{db.close();}});

test('mutually exclusive baseline buckets, NO_BODY, ready metadata not invented',async()=>{const db=fixtureDb();try{
 seed(db,{scenarios:[b('r'),b('q','NEEDS_DATA','PARTIAL','COMPLETE'),b('both','NEEDS_DATA','PARTIAL','PARTIAL'),b('none','NEEDS_DATA','PARTIAL','NO_BODY'),b('other','NEEDS_DATA','COMPLETE','COMPLETE'),b('ready','READY','COMPLETE','COMPLETE')]});
 const d=await read(db);const buckets=Object.fromEntries(d.projectSummary.baselineBuckets.map(x=>[x.key,x.scenarioCount]));assert.deepEqual([buckets.READY,buckets.RESPONSE_PARTIAL,buckets.REQUEST_PARTIAL,buckets.BOTH_PARTIAL,buckets.OTHER],[1,1,2,1,1]);validateTestReadinessEnvelope({status:'ok',data:d},scope);
 assert.equal((await read(db,'readiness=NEEDS_DATA&generationClass=OBSERVED_BASELINE&baselineGap=RESPONSE_PARTIAL')).filteredSummary.matchingScenarioCount,1);
}finally{db.close();}});

test('filter first, then group and paginate beyond 50 endpoints',async()=>{const db=fixtureDb();try{
 for(let i=0;i<77;i++)seed(db,{endpoint:'cep_'+String(i).padStart(3,'0'),scenarios:[scenario('a',i>50?'NEEDS_DATA':'READY'),scenario('b',i>50?'NEEDS_DATA':'READY')]});
 let d=await read(db,'readiness=NEEDS_DATA&limit=10');assert.equal(d.filteredSummary.matchingEndpointCount,26);assert.equal(d.filteredSummary.matchingScenarioCount,52);assert.equal(d.items[0].endpointId,'cep_051');assert.equal(d.items[0].matchingScenarioCount,2);
 const ids=[...d.items.map(r=>r.endpointId)];while(d.page.hasMore){d=await read(db,'readiness=NEEDS_DATA&limit=10&cursor='+d.page.nextCursor);ids.push(...d.items.map(r=>r.endpointId));}
 assert.equal(new Set(ids).size,26);assert.equal(d.projectSummary.testDesignCount,77);
}finally{db.close();}});

test('pending-only new version changes revision; stale / scope / filter cursors rejected',async()=>{const db=fixtureDb();try{
 seed(db,{endpoint:'cep_a',scenarios:[scenario('a','NEEDS_DATA')]});seed(db,{endpoint:'cep_b'});
 const d=await read(db,'limit=1');assert.ok(d.page.nextCursor);
 await assert.rejects(()=>read(db,'limit=1&readiness=READY&cursor='+d.page.nextCursor),{code:'TEST_READINESS_CURSOR_INVALID'});
 await assert.rejects(()=>createTestReadinessRepository(db).list({...scope,organizationId:'org_other',query:parse(new URLSearchParams('limit=1&cursor='+d.page.nextCursor))}),{code:'TEST_READINESS_CURSOR_INVALID'});
 seed(db,{endpoint:'cep_a',version:2,scenarios:[scenario('b','REVIEW_REQUIRED')]});
 await assert.rejects(()=>read(db,'limit=1&cursor='+d.page.nextCursor),{code:'TEST_READINESS_CURSOR_STALE'});
 const next=await read(db);assert.notEqual(next.readinessRevision,d.readinessRevision);assert.equal(next.projectSummary.scenarioCount,2);
}finally{db.close();}});

test('query rejects invalid/contradictory/oversized inputs; search is literal',async()=>{const db=fixtureDb();try{
 for(const q of ['readiness=REVIEW','generationClass=AI','readiness=READY&baselineGap=OTHER','limit=101','limit=1.1','limit=01','cursor=x'.repeat(500),'organizationId=org_other','readiness=READY&readiness=NEEDS_DATA','baselineEnvironmentId=env_test'])assert.throws(()=>parse(new URLSearchParams(q)));
 seed(db,{path:'/literal_%_title'});seed(db,{endpoint:'cep_b',path:'/literal_AB_title'});
 assert.equal((await read(db,'q='+encodeURIComponent('_%_'))).items.length,1);assert.equal((await read(db,'q='+encodeURIComponent("' OR 1=1 --"))).items.length,0);
}finally{db.close();}});

test('legacy fallback is read-only and origin is not upgraded',async()=>{const db=fixtureDb();try{
 seed(db,{projection:false,scenarios:[scenario('old','NEEDS_ENVIRONMENT','LEGACY')]});const before=db.raw.prepare('SELECT total_changes() AS n').get().n;
 const d=await read(db);assert.equal(d.projectSummary.legacyScenarioCount,1);assert.equal(d.projectSummary.needsEnvironmentScenarioCount,1);assert.equal(d.integrity.fallbackVersionCount,1);
 assert.equal(db.raw.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(db.raw.prepare('SELECT count(*) n FROM test_design_execution_inventory').get().n,0);
}finally{db.close();}});

test('empty historical origins fall back without writes; malformed projection fails closed',async()=>{const db=fixtureDb();try{
 seed(db,{origins:[],scenarios:[scenario('s','NEEDS_AUTH','LEGACY')]});const before=db.raw.prepare('SELECT total_changes() n').get().n;assert.equal((await read(db)).integrity.fallbackVersionCount,1);assert.equal(db.raw.prepare('SELECT total_changes() n').get().n,before);
 db.raw.prepare('UPDATE test_design_execution_inventory SET scenario_origins_json=?').run('{broken');
 await assert.rejects(()=>read(db),e=>['TEST_READINESS_CORRUPT_PROJECTION','TEST_READINESS_READ_UNAVAILABLE'].includes(e.code));
}finally{db.close();}});

test('summary no page/details and unknown states stay visible in denominator',async()=>{const db=fixtureDb();try{
 seed(db,{scenarios:[scenario('s','FUTURE_READINESS','FUTURE_ORIGIN')]});const d=await read(db,'view=summary');assert.equal(d.items.length,0);assert.equal(d.projectSummary.scenarioCount,1);assert.equal(d.integrity.unknownReadinessScenarioCount,1);assert.equal(d.integrity.unknownOriginScenarioCount,1);
 validateTestReadinessEnvelope({status:'ok',data:d},scope);assert.ok(!JSON.stringify(d).includes('DO_NOT_EXPOSE'));
}finally{db.close();}});

test('duplicate/mismatching projection and cross-tenant version pointer fail closed',async()=>{const db=fixtureDb();try{
 const s=seed(db,{scenarios:[scenario('a'),scenario('b')]});db.raw.prepare('UPDATE test_design_execution_inventory SET scenario_origins_json=? WHERE test_design_version_id=?').run(JSON.stringify([{scenarioId:'same',readiness:'READY',generationClass:'AI_EXPLORATORY'},{scenarioId:'same',readiness:'READY',generationClass:'AI_EXPLORATORY'}]),s.id);
 await assert.rejects(()=>read(db),{code:'TEST_READINESS_CORRUPT_PROJECTION'});
}finally{db.close();}});

test('detail pinned version, safe codes, on demand and pagination',async()=>{const db=fixtureDb();try{
 const a=b('a');a.baseline.responseCoverage.reasons=['ARRAY_SAMPLE_LIMIT'];a.automation.blockers=['OBSERVED_BASELINE_RESPONSE_INCOMPLETE','password=DO_NOT_EXPOSE'];a.title='password=DO_NOT_EXPOSE';
 const old=seed(db,{scenarios:[a,b('b')]});seed(db,{version:2,scenarios:[scenario('latest')]});
 const q=parse(new URLSearchParams(`testDesignVersionId=${old.id}&readiness=NEEDS_DATA&generationClass=OBSERVED_BASELINE&limit=1`),{detail:true});
 const repo=createTestReadinessRepository(db);const d=await repo.scenarios({...scope,endpointId:'cep_a',query:q});assert.equal(d.isLatest,false);assert.equal(d.matchingScenarioCount,2);assert.equal(d.page.hasMore,true);assert.equal(d.items[0].diagnosticsOmitted,true);assert.ok(!JSON.stringify(d).includes('DO_NOT_EXPOSE'));assert.deepEqual(d.items[0].responseReasons,['ARRAY_SAMPLE_LIMIT']);
 validateTestReadinessEnvelope({status:'ok',data:d},{...scope,endpointId:'cep_a',testDesignVersionId:old.id},{detail:true,query:q});
 const second=await repo.scenarios({...scope,endpointId:'cep_a',query:{...q,cursor:d.page.nextCursor}});assert.equal(second.items[0].scenarioId,'b');
 await assert.rejects(()=>repo.scenarios({...scope,endpointId:'cep_wrong',query:q}),{code:'TEST_READINESS_VERSION_NOT_FOUND'});
}finally{db.close();}});

test('tenant headers/path required, method contract and error response without data',async()=>{const db=fixtureDb();try{
 seed(db);assert.equal((await call(db)).status,200);assert.equal((await call(db,'',{headers:{}})).status,400);assert.equal((await call(db,'',{headers:headers('org_test','prj_other')})).status,403);assert.equal((await call(db,'',{method:'POST'})).status,405);
 assert.equal((await call(db,'?readiness=NO')).status,400);
 const other=await call(db,'',{headers:headers('org_other')});assert.equal((await other.json()).data.projectSummary.scenarioCount,0);
}finally{db.close();}});

test('no execution/generation side effects, latest only and archive reflected',async()=>{const db=fixtureDb();try{
 seed(db);seed(db,{version:2,scenarios:[scenario('current','REVIEW_REQUIRED')]});let d=await read(db);assert.equal(d.projectSummary.readyScenarioCount,0);assert.equal(d.projectSummary.scenarioCount,1);
 db.raw.prepare("UPDATE test_designs SET status='ARCHIVED'").run();assert.equal((await read(db)).projectSummary.testDesignCount,0);
}finally{db.close();}});

test('strict response rejects unexpected spec values and inconsistent counts',async()=>{const db=fixtureDb();try{
 seed(db);const d=await read(db);assert.throws(()=>validateTestReadinessEnvelope({status:'ok',data:{...d,specification:{password:'x'}}},scope));
 const bad=structuredClone(d);bad.projectSummary.scenarioCount=42;assert.throws(()=>validateTestReadinessEnvelope({status:'ok',data:bad},scope));
}finally{db.close();}});

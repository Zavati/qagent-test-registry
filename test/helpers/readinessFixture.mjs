import { SQLiteD1 } from './sqliteD1.mjs';
import { applyCurrentMigrations } from './currentMigrations.mjs';
import { buildTestDesignExecutionProjection, projectionInsertStatement } from '../../src/domain/executionEligibility.js';
/** SQLite adapter exercises actual SQL. D1 returns result rows for SELECTs in a batch. */
export class ReadinessSQLiteD1 extends SQLiteD1 {
  async batch(statements) {
    this.batchCount++;
    if(this.beforeBatch)await this.beforeBatch(this,statements,this.batchCount);
    this.raw.exec('BEGIN');
    try{const out=statements.map(s=>/^\s*(?:WITH|SELECT)\b/i.test(s.sql)?s.all():s.run());this.raw.exec('COMMIT');return out;}
    catch(e){this.raw.exec('ROLLBACK');throw e;}
  }
}
export function fixtureDb(){const db=new ReadinessSQLiteD1();applyCurrentMigrations(db);return db;}
export function seed(db,{org='org_test',project='prj_test',endpoint='cep_a',version=1,scenarios=[scenario('s1')],projection=true,path='/api/'+endpoint,title='Test Design',method='GET',origins=null}={}){
  const design=`td_${org}_${project}_${endpoint}`,id=`tdv_${org}_${project}_${endpoint}_${version}`,date='2026-09-10T20:00:00.000Z';
  const spec={source:{organizationId:org,projectId:project,endpointId:endpoint},title,scenarios:scenarios.map(s=>({...s,spec:{...s.spec,target:{...(s.spec?.target||{}),path,method,apiServiceKey:'api-test'}}}))};
  db.raw.prepare(`INSERT INTO test_designs(id,organization_id,project_id,endpoint_id,latest_version,latest_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET latest_version=excluded.latest_version,latest_version_id=excluded.latest_version_id`).run(design,org,project,endpoint,version,id,date,date);
  db.raw.prepare(`INSERT INTO test_design_versions(id,test_design_id,organization_id,project_id,endpoint_id,version,generation_request_id,context_fingerprint,contract_version,specification_version,scenario_count,ready_count,review_required_count,specification_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,design,org,project,endpoint,version,'tdg_'+id,'a'.repeat(64),'qagent.test-design.v1','qagent.test-spec.v1',scenarios.length,scenarios.filter(s=>s.automation.readiness==='READY').length,scenarios.filter(s=>s.automation.readiness==='REVIEW_REQUIRED').length,JSON.stringify(spec),date);
  if(projection){
    const p=buildTestDesignExecutionProjection({specificationJson:spec,testDesignVersionId:id,testDesignId:design,organizationId:org,projectId:project,endpointId:endpoint,testDesignVersion:version,createdAt:date});
    if(origins)p.scenarioOrigins=origins;
    projectionInsertStatement(db,p).run();
  }
  return {id,design,spec};
}
export function scenario(id,readiness='READY',origin='AI_EXPLORATORY',overrides={}){
  const s={scenarioId:id,title:'Cenário '+id,generationClass:origin,automation:{readiness,blockers:[]},spec:{target:{method:'GET'},request:{headers:{Authorization:'Bearer DO_NOT_EXPOSE'},body:{password:'DO_NOT_EXPOSE'}}}};
  if(origin==='LEGACY')delete s.generationClass;
  if(origin==='OBSERVED_BASELINE')s.baseline={baselineId:'obl_'+id,source:{environmentId:'env_test',eventId:'evt_'+id,evidenceId:'ev_'+id,observationSessionId:'obs_test',observedAt:'2026-09-10T14:00:00Z'},expiresAt:'2026-10-10T14:00:00Z',responseSchemaVersionId:'csv_test',responseSchemaHash:'sch_test',comparisonPolicy:{mode:'STRUCTURE'},requestCoverage:{status:'COMPLETE',reasons:[]},responseCoverage:{status:'COMPLETE',reasons:[]},selfCheck:'PASSED'};
  return {...s,...overrides};
}
export const headers=(org='org_test',project='prj_test')=>({'x-qagent-organization-id':org,'x-qagent-project-id':project});

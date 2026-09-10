import {
  READINESS_CONTRACT, READINESS_DETAIL_CONTRACT, READINESS_PROJECTION_VERSION,
  READINESS_STATES, GENERATION_CLASSES, BASELINE_BUCKETS, readinessError, readinessHash,
  decodeReadinessCursor, encodeReadinessCursor, safeReadinessText, safeReadinessPath,
  isReadinessId, safeReasonCodes, COVERAGE_REASONS, READINESS_BLOCKERS,
} from '../domain/testReadinessContracts.js';
import { SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION } from '../domain/executionEligibility.js';

// All predicates are evaluated in the Registry DB, before grouping and LIMIT.
// CASE guards keep corrupt JSON from becoming a successful empty result.
const ROOTS = `WITH roots AS (
 SELECT d.id AS design_id, d.organization_id, d.project_id, d.endpoint_id,
        d.latest_version_id AS version_id, d.latest_version AS version,
        v.created_at, v.scenario_count AS version_count,
        CASE WHEN json_valid(v.specification_json) THEN v.specification_json ELSE '{}' END AS spec_json,
        CASE WHEN p.test_design_version_id IS NULL OR
                  (CASE WHEN json_valid(p.scenario_origins_json) THEN json_type(p.scenario_origins_json)='array' AND json_array_length(p.scenario_origins_json)=0 ELSE 0 END)
             THEN 1 ELSE 0 END AS fallback,
        CASE WHEN json_valid(p.scenario_origins_json) THEN CASE WHEN json_type(p.scenario_origins_json)='array' THEN p.scenario_origins_json ELSE '[]' END ELSE '[]' END AS origins_json,
        CASE WHEN json_valid(p.execution_eligible_scenario_ids_json) THEN p.execution_eligible_scenario_ids_json ELSE '[]' END AS eligible_ids,
        p.title AS p_title, p.target_method AS p_method, p.target_path AS p_path, p.api_service_key AS p_service,
        p.created_at AS projection_created_at,
        CASE WHEN v.id IS NULL OR v.organization_id<>d.organization_id OR v.project_id<>d.project_id
             OR v.endpoint_id<>d.endpoint_id OR v.test_design_id<>d.id OR v.version<>d.latest_version
             OR NOT json_valid(v.specification_json) OR v.scenario_count<1
             OR (p.test_design_version_id IS NOT NULL AND (
                 p.organization_id<>d.organization_id OR p.project_id<>d.project_id OR p.endpoint_id<>d.endpoint_id
                 OR p.test_design_id<>d.id OR p.test_design_version<>d.latest_version
                 OR CASE WHEN json_valid(p.scenario_origins_json) THEN json_type(p.scenario_origins_json)<>'array' ELSE 1 END
                 OR CASE WHEN json_valid(p.execution_eligible_scenario_ids_json) THEN json_type(p.execution_eligible_scenario_ids_json)<>'array' ELSE 1 END
                 OR p.scenario_count<>v.scenario_count
                 OR CASE WHEN json_valid(p.scenario_origins_json) THEN (json_array_length(p.scenario_origins_json)>0 AND json_array_length(p.scenario_origins_json)<>v.scenario_count) ELSE 1 END))
             THEN 1 ELSE 0 END AS root_invalid
 FROM test_designs d
 LEFT JOIN test_design_versions v ON v.id=d.latest_version_id
 LEFT JOIN test_design_execution_inventory p ON p.test_design_version_id=d.latest_version_id
 WHERE d.organization_id=? AND d.project_id=? AND d.status='ACTIVE' AND d.latest_version>0
), sources AS (
 SELECT *,
   CASE WHEN fallback=1 THEN json_extract(spec_json,'$.title') ELSE p_title END AS title,
   UPPER(CASE WHEN fallback=1 THEN json_extract(spec_json,'$.scenarios[0].spec.target.method') ELSE p_method END) AS method,
   CASE WHEN fallback=1 THEN json_extract(spec_json,'$.scenarios[0].spec.target.path') ELSE p_path END AS path,
   CASE WHEN fallback=1 THEN json_extract(spec_json,'$.scenarios[0].spec.target.apiServiceKey') ELSE p_service END AS api_service_key,
   CASE WHEN fallback=1 AND json_type(spec_json,'$.scenarios')='array' THEN json_extract(spec_json,'$.scenarios')
        WHEN fallback=0 THEN origins_json ELSE '[]' END AS scenario_json
 FROM roots
), raw_scenarios AS (
 SELECT r.*, j.key AS ordinal,
   CASE WHEN j.type='object' THEN j.value ELSE '{}' END AS obj,
   CASE WHEN j.type='object' THEN json_extract(j.value,'$.scenarioId') END AS scenario_id,
   CASE WHEN j.type='object' THEN COALESCE(json_extract(j.value,'$.generationClass'),'LEGACY') ELSE 'UNKNOWN' END AS raw_origin,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.automation.readiness' ELSE '$.readiness' END) END AS raw_readiness,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.requestCoverage.status' ELSE '$.requestCoverage' END) END AS request_coverage,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.responseCoverage.status' ELSE '$.responseCoverage' END) END AS response_coverage,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.selfCheck' ELSE '$.selfCheck' END) END AS self_check,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.source.environmentId' ELSE '$.environmentId' END) END AS environment_id,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.baselineId' ELSE '$.baselineId' END) END AS baseline_id,
   CASE WHEN j.type='object' THEN json_extract(j.value,CASE WHEN r.fallback=1 THEN '$.baseline.expiresAt' ELSE '$.expiresAt' END) END AS expires_at,
   UPPER(CASE WHEN r.fallback=1 AND j.type='object' THEN json_extract(j.value,'$.spec.target.method') ELSE r.method END) AS scenario_method
 FROM sources r, json_each(r.scenario_json) j
), normalized AS (
 SELECT *,
   CASE WHEN fallback=0 AND (
     scenario_id IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].scenarioId')
     OR raw_origin IS NOT COALESCE(json_extract(spec_json,'$.scenarios['||ordinal||'].generationClass'),'LEGACY')
     OR raw_readiness IS NOT COALESCE(json_extract(spec_json,'$.scenarios['||ordinal||'].automation.readiness'),'REVIEW_REQUIRED')
     OR (raw_origin='OBSERVED_BASELINE' AND (
       baseline_id IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].baseline.baselineId')
       OR environment_id IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].baseline.source.environmentId')
       OR request_coverage IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].baseline.requestCoverage.status')
       OR response_coverage IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].baseline.responseCoverage.status')
       OR self_check IS NOT json_extract(spec_json,'$.scenarios['||ordinal||'].baseline.selfCheck')
     ))) THEN 1 ELSE 0 END AS projection_invalid,
   CASE WHEN raw_origin IN ('OBSERVED_BASELINE','AI_EXPLORATORY','LEGACY') THEN raw_origin ELSE 'UNKNOWN' END AS origin,
   CASE WHEN raw_readiness IN ('READY','NEEDS_DATA','REVIEW_REQUIRED','NEEDS_AUTH','NEEDS_ENVIRONMENT') THEN raw_readiness ELSE 'UNKNOWN' END AS readiness,
   CASE WHEN fallback=0 THEN EXISTS (SELECT 1 FROM json_each(eligible_ids) e WHERE e.value=scenario_id)
        ELSE raw_readiness='READY' AND scenario_method IN ('GET','HEAD','OPTIONS') END AS eligible
 FROM raw_scenarios
), scenarios AS (
 SELECT *,
   CASE WHEN origin='OBSERVED_BASELINE' AND readiness='NEEDS_DATA' THEN
      CASE WHEN request_coverage='PARTIAL' AND response_coverage='PARTIAL' THEN 'BOTH_PARTIAL'
           WHEN request_coverage='COMPLETE' AND response_coverage='PARTIAL' THEN 'RESPONSE_PARTIAL'
           WHEN request_coverage='PARTIAL' AND response_coverage IN ('COMPLETE','NO_BODY') THEN 'REQUEST_PARTIAL'
           ELSE 'OTHER' END END AS gap,
   CASE WHEN readiness='READY' AND eligible=0 THEN
      CASE WHEN scenario_method IS NULL OR scenario_method='' THEN 'HTTP_METHOD_UNRESOLVED'
           WHEN scenario_method IN ('POST','PUT','PATCH','DELETE') THEN 'MUTATION_EXECUTION_DISABLED'
           ELSE 'HTTP_METHOD_UNSUPPORTED' END END AS policy_reason
 FROM normalized
)`;

const n = v => Number(v || 0);
const countsFor = (row, prefix = '') => Object.fromEntries(READINESS_STATES.concat('UNKNOWN').map(state => [state, n(row[prefix + state])]));
const aggregateReadiness = alias => READINESS_STATES.concat('UNKNOWN').map(k => `SUM(CASE WHEN ${alias}readiness='${k}' THEN 1 ELSE 0 END) AS ${k}`).join(',');
const aggregateOrigins = alias => GENERATION_CLASSES.concat('UNKNOWN').map(k => `SUM(CASE WHEN ${alias}origin='${k}' THEN 1 ELSE 0 END) AS origin_${k}`).join(',');
function metadataInvalid() { return readinessError('TEST_READINESS_CORRUPT_PROJECTION', 'Metadados de prontidão inconsistentes. Nenhum teste foi alterado.', 500); }
function whereFor(filters) {
  const clauses = [], args = [];
  for (const [key, column] of [['readiness','readiness'],['generationClass','origin']]) {
    if (filters[key].length) { clauses.push(`${column} IN (${filters[key].map(() => '?').join(',')})`); args.push(...filters[key]); }
  }
  if (filters.baselineGap) { clauses.push('gap=?'); args.push(filters.baselineGap); }
  if (filters.baselineEnvironmentId) { clauses.push('environment_id=?'); args.push(filters.baselineEnvironmentId); }
  if (filters.method) { clauses.push('method=?'); args.push(filters.method); }
  if (filters.apiServiceKey) { clauses.push('api_service_key=?'); args.push(filters.apiServiceKey); }
  // instr implements literal substring search: %, _, quotes and backslashes are not operators.
  if (filters.q) { clauses.push('(instr(lower(COALESCE(path,\'\')),lower(?))>0 OR instr(lower(COALESCE(title,\'\')),lower(?))>0)'); args.push(filters.q, filters.q); }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', args };
}
async function batchRead(db, statements) {
  try {
    const results = await db.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length || results.some(r => r.success === false || !Array.isArray(r.results))) throw Error();
    return results.map(r => r.results);
  } catch (cause) {
    if (cause?.name === 'TestReadinessError') throw cause;
    throw readinessError('TEST_READINESS_READ_UNAVAILABLE', 'Não foi possível ler a prontidão no Test Registry. Confira o serviço e as migrations anteriores.', 503);
  }
}
function integrityFor(row, roots) {
  const fallbackVersionCount = roots.filter(r => r.fallback === 1).length;
  return { fallbackVersionCount, unknownReadinessScenarioCount: n(row.UNKNOWN), unknownOriginScenarioCount: n(row.origin_UNKNOWN), incompleteBaselineMetadataCount: n(row.incomplete_baseline_metadata) };
}
function normalizeBucketRows(rows) {
  return BASELINE_BUCKETS.map(key => {
    const row = rows.find(r => r.bucket === key) || {};
    return {
      key, readiness: ['RESPONSE_PARTIAL','REQUEST_PARTIAL','BOTH_PARTIAL','OTHER'].includes(key) ? 'NEEDS_DATA' : key,
      baselineGap: ['RESPONSE_PARTIAL','REQUEST_PARTIAL','BOTH_PARTIAL','OTHER'].includes(key) ? key : null,
      scenarioCount: n(row.scenario_count), endpointCount: n(row.endpoint_count),
      requestCoverageCounts: { COMPLETE:n(row.req_complete), PARTIAL:n(row.req_partial), UNKNOWN:n(row.req_unknown) },
      responseCoverageCounts: { COMPLETE:n(row.res_complete), PARTIAL:n(row.res_partial), NO_BODY:n(row.res_none), UNKNOWN:n(row.res_unknown) },
      selfCheckCounts: { PASSED:n(row.self_pass), PARTIAL:n(row.self_partial), FAILED:n(row.self_failed), NO_BODY:n(row.self_none), UNKNOWN:n(row.self_unknown) },
    };
  });
}
function summaryFor(row, roots, buckets) {
  return {
    testDesignCount: roots.length,
    scenarioCount:n(row.scenario_count), observedBaselineScenarioCount:n(row.origin_OBSERVED_BASELINE), aiExploratoryScenarioCount:n(row.origin_AI_EXPLORATORY), legacyScenarioCount:n(row.origin_LEGACY),
    readyScenarioCount:n(row.READY), needsDataScenarioCount:n(row.NEEDS_DATA), reviewRequiredScenarioCount:n(row.REVIEW_REQUIRED), needsAuthScenarioCount:n(row.NEEDS_AUTH), needsEnvironmentScenarioCount:n(row.NEEDS_ENVIRONMENT), unknownReadinessScenarioCount:n(row.UNKNOWN), unknownOriginScenarioCount:n(row.origin_UNKNOWN),
    pendingScenarioCount:n(row.NEEDS_DATA)+n(row.REVIEW_REQUIRED)+n(row.NEEDS_AUTH)+n(row.NEEDS_ENVIRONMENT),
    executionEligibleScenarioCount:n(row.eligible_count), policyBlockedReadyScenarioCount:n(row.policy_blocked),
    eligibilityPolicyVersion:SUITE_EXECUTION_ELIGIBILITY_POLICY_VERSION,
    eligibilityBasis:'INVENTORY_POLICY_NOT_RUNTIME_AUTHORIZATION',
    baselineBuckets:normalizeBucketRows(buckets),
  };
}
function safeMethod(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,15}$/.test(value) ? value : null; }

export function createTestReadinessRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw readinessError('TEST_READINESS_READ_UNAVAILABLE','Test Registry database binding indisponível.',503);

  async function list({organizationId,projectId,query,now = new Date().toISOString()}) {
    if (!isReadinessId(organizationId)||!isReadinessId(projectId)) throw metadataInvalid();
    const { filters, limit, cursor, view } = query;
    const filterHash = await readinessHash(JSON.stringify(filters));
    const context={kind:'endpoints',organizationId,projectId,filterHash,limit,versionId:null};
    const decoded = await decodeReadinessCursor(cursor,context);
    const f=whereFor(filters), scope=[organizationId,projectId];
    const stmt=(sql,args=[])=>db.prepare(ROOTS+sql).bind(...scope,...args);
    // A single read-only D1 batch makes project totals, filtered totals and the page consistent.
    const statements=[
      stmt(`SELECT endpoint_id,version_id,version,created_at,projection_created_at,fallback,root_invalid,version_count,
                 json_array_length(scenario_json) AS actual_count, json_type(spec_json,'$.scenarios') AS specification_type, json_array_length(spec_json,'$.scenarios') AS specification_count
            FROM sources ORDER BY endpoint_id`),
      stmt(`SELECT COUNT(*) AS scenario_count,COUNT(DISTINCT json_array(version_id,scenario_id)) AS distinct_scenarios,
             SUM(CASE WHEN scenario_id IS NULL OR typeof(scenario_id)<>'text' OR length(scenario_id) NOT BETWEEN 1 AND 200 OR scenario_id GLOB '*[^A-Za-z0-9_.:-]*' THEN 1 ELSE 0 END) AS invalid_ids,
             SUM(projection_invalid) AS invalid_projection,
             ${aggregateReadiness('')},${aggregateOrigins('')},
             SUM(CASE WHEN readiness='READY' AND eligible=1 THEN 1 ELSE 0 END) AS eligible_count,
             SUM(CASE WHEN readiness='READY' AND eligible=0 THEN 1 ELSE 0 END) AS policy_blocked,
             SUM(CASE WHEN origin='OBSERVED_BASELINE' AND (baseline_id IS NULL OR environment_id IS NULL OR request_coverage IS NULL OR response_coverage IS NULL OR self_check IS NULL) THEN 1 ELSE 0 END) AS incomplete_baseline_metadata
            FROM scenarios`),
      stmt(`SELECT COALESCE(gap,readiness) AS bucket,COUNT(*) AS scenario_count,COUNT(DISTINCT endpoint_id) AS endpoint_count,
          SUM(request_coverage='COMPLETE') AS req_complete,SUM(request_coverage='PARTIAL') AS req_partial,SUM(CASE WHEN request_coverage IS NULL OR request_coverage NOT IN ('COMPLETE','PARTIAL') THEN 1 ELSE 0 END) AS req_unknown,
          SUM(response_coverage='COMPLETE') AS res_complete,SUM(response_coverage='PARTIAL') AS res_partial,SUM(response_coverage='NO_BODY') AS res_none,SUM(CASE WHEN response_coverage IS NULL OR response_coverage NOT IN ('COMPLETE','PARTIAL','NO_BODY') THEN 1 ELSE 0 END) AS res_unknown,
          SUM(self_check='PASSED') AS self_pass,SUM(self_check='PARTIAL') AS self_partial,SUM(self_check='FAILED') AS self_failed,SUM(self_check='NO_BODY') AS self_none,SUM(CASE WHEN self_check IS NULL OR self_check NOT IN ('PASSED','PARTIAL','FAILED','NO_BODY') THEN 1 ELSE 0 END) AS self_unknown
         FROM scenarios WHERE origin='OBSERVED_BASELINE' GROUP BY COALESCE(gap,readiness)`),
      stmt(`SELECT COUNT(*) AS matchingScenarioCount,COUNT(DISTINCT endpoint_id) AS matchingEndpointCount,${aggregateReadiness('')},${aggregateOrigins('')}
            FROM scenarios WHERE ${f.sql}`,f.args),
    ];
    if(view==='endpoints') statements.push(stmt(`SELECT endpoint_id,design_id,version_id,version,title,method,path,api_service_key,created_at,
       COUNT(*) AS matching_count,json_group_array(scenario_id) AS scenario_ids,${aggregateReadiness('')},${aggregateOrigins('')},
       json_group_array(DISTINCT gap) AS signals
       FROM scenarios WHERE ${f.sql} AND endpoint_id>? GROUP BY endpoint_id,design_id,version_id
       ORDER BY endpoint_id ASC LIMIT ?`, [...f.args,decoded?.last||'',limit+1]));
    const [roots,totals,buckets,filtered,pageRows=[]]=await batchRead(db,statements);
    const total=totals[0]||{}, filteredRow=filtered[0]||{};
    if(roots.some(r=>r.root_invalid||r.actual_count!==r.version_count||r.specification_type!=='array'||r.specification_count!==r.version_count)||n(total.invalid_ids)||n(total.invalid_projection)||n(total.distinct_scenarios)!==n(total.scenario_count)) throw metadataInvalid();
    const readinessRevision='rrev_'+await readinessHash(JSON.stringify([READINESS_PROJECTION_VERSION,organizationId,projectId,roots.map(r=>[r.endpoint_id,r.version_id,r.version,r.projection_created_at,r.fallback])]));
    if(decoded&&decoded.revision!==readinessRevision) throw readinessError('TEST_READINESS_CURSOR_STALE','As versões dos testes mudaram. Atualize os resultados.',409);
    const items=pageRows.slice(0,limit).map(r=>{
      const ids=JSON.parse(r.scenario_ids); if(ids.some(s=>!isReadinessId(s)))throw metadataInvalid();
      return {endpointId:r.endpoint_id,method:safeMethod(r.method),path:safeReadinessPath(r.path),apiServiceKey:isReadinessId(r.api_service_key)?r.api_service_key:null,
        testDesignId:r.design_id,testDesignVersionId:r.version_id,testDesignVersion:r.version,title:safeReadinessText(r.title),createdAt:r.created_at,
        matchingScenarioCount:n(r.matching_count),matchingScenarioIds:ids.slice(0,5),scenarioPreviewTruncated:ids.length>5,
        matchedReadinessCounts:countsFor(r),matchedOriginCounts:Object.fromEntries(GENERATION_CLASSES.concat('UNKNOWN').map(k=>[k,n(r['origin_'+k])])),
        coverageSignals:JSON.parse(r.signals).filter(v=>v!==null),};
    });
    const hasMore=view==='endpoints'&&pageRows.length>limit;
    const nextCursor=hasMore?await encodeReadinessCursor({...context,version:1,revision:readinessRevision,last:items.at(-1).endpointId}):null;
    return {contractVersion:READINESS_CONTRACT,organizationId,projectId,view,readinessRevision,computedAt:now,readinessBasis:'LATEST_PERSISTED_TEST_DESIGN',filters,
      projectSummary:summaryFor(total,roots,buckets),filteredSummary:{matchingEndpointCount:n(filteredRow.matchingEndpointCount),matchingScenarioCount:n(filteredRow.matchingScenarioCount),readinessCounts:countsFor(filteredRow)},
      integrity:integrityFor(total,roots),page:{limit,hasMore,nextCursor},items};
  }

  async function scenarios({organizationId,projectId,endpointId,query,now=new Date().toISOString()}) {
    if(![organizationId,projectId,endpointId].every(isReadinessId))throw metadataInvalid();
    const {testDesignVersionId,filters,limit,cursor}=query;
    const filterHash=await readinessHash(JSON.stringify([endpointId,filters]));
    const context={kind:'scenarios',organizationId,projectId,filterHash,limit,versionId:testDesignVersionId};
    const decoded=await decodeReadinessCursor(cursor,context);
    // Pinned version lookup. Projection fields are extracted in SQL; request/assertion values never leave the DB.
    const querySql=`SELECT v.id, v.test_design_id,v.endpoint_id,v.version,v.created_at,d.latest_version_id,
       CASE WHEN json_valid(v.specification_json) THEN json_extract(v.specification_json,'$.title') END AS title,
       CASE WHEN json_valid(v.specification_json) THEN json_extract(v.specification_json,'$.scenarios[0].spec.target.method') END AS method,
       CASE WHEN json_valid(v.specification_json) THEN json_extract(v.specification_json,'$.scenarios[0].spec.target.path') END AS path,
       CASE WHEN json_valid(v.specification_json) THEN json_extract(v.specification_json,'$.scenarios[0].spec.target.apiServiceKey') END AS api_service_key,
       CASE WHEN json_valid(v.specification_json) AND json_type(v.specification_json,'$.scenarios')='array'
       THEN (SELECT json_group_array(json_object(
          'scenarioId',json_extract(j.value,'$.scenarioId'),'title',json_extract(j.value,'$.title'),
          'generationClass',COALESCE(json_extract(j.value,'$.generationClass'),'LEGACY'),'readiness',json_extract(j.value,'$.automation.readiness'),
          'blockers',json_extract(j.value,'$.automation.blockers'),
          'baselineId',json_extract(j.value,'$.baseline.baselineId'),'environmentId',json_extract(j.value,'$.baseline.source.environmentId'),
          'sourceEventId',json_extract(j.value,'$.baseline.source.eventId'),'sourceEvidenceId',json_extract(j.value,'$.baseline.source.evidenceId'),
          'observationSessionId',json_extract(j.value,'$.baseline.source.observationSessionId'),'observedAt',json_extract(j.value,'$.baseline.source.observedAt'),
          'expiresAt',json_extract(j.value,'$.baseline.expiresAt'),'schemaVersionId',json_extract(j.value,'$.baseline.responseSchemaVersionId'),
          'schemaHash',json_extract(j.value,'$.baseline.responseSchemaHash'),'comparisonMode',json_extract(j.value,'$.baseline.comparisonPolicy.mode'),
          'requestCoverage',json_extract(j.value,'$.baseline.requestCoverage.status'),'responseCoverage',json_extract(j.value,'$.baseline.responseCoverage.status'),
          'requestReasons',json_extract(j.value,'$.baseline.requestCoverage.reasons'),'responseReasons',json_extract(j.value,'$.baseline.responseCoverage.reasons'),
          'selfCheck',json_extract(j.value,'$.baseline.selfCheck')
       )) FROM json_each(v.specification_json,'$.scenarios') j) END AS metadata_json
      FROM test_design_versions v JOIN test_designs d ON d.id=v.test_design_id AND d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.endpoint_id=v.endpoint_id
      WHERE v.organization_id=? AND v.project_id=? AND v.endpoint_id=? AND v.id=? AND d.status='ACTIVE'`;
    const [rows]=await batchRead(db,[db.prepare(querySql).bind(organizationId,projectId,endpointId,testDesignVersionId)]);
    const row=rows[0]; if(!row)throw readinessError('TEST_READINESS_VERSION_NOT_FOUND','Versão do Test Design não encontrada neste endpoint.',404);
    if(!row.metadata_json)throw metadataInvalid();
    const raw=JSON.parse(row.metadata_json); if(!Array.isArray(raw)||raw.length>1000||raw.some(s=>!isReadinessId(s.scenarioId))||new Set(raw.map(s=>s.scenarioId)).size!==raw.length)throw metadataInvalid();
    // Detail pages are small bounded artifacts (max 20 in current version contract), not a project-wide fetch.
    const {baselineGapOf,matchesReadiness}=await import('../domain/testReadinessContracts.js');
    const normalized=raw.map(s=>({...s,readiness:READINESS_STATES.includes(s.readiness)?s.readiness:'UNKNOWN',generationClass:GENERATION_CLASSES.includes(s.generationClass)?s.generationClass:'UNKNOWN'}));
    const method=safeMethod(String(row.method||'').toUpperCase()), path=safeReadinessPath(row.path);
    const itemsAll=normalized.filter(s=>matchesReadiness(s,filters) && (!filters.apiServiceKey||filters.apiServiceKey===row.api_service_key) && (!filters.method||filters.method===method) && (!filters.q||String(row.path||'').toLowerCase().includes(filters.q.toLowerCase())||String(row.title||'').toLowerCase().includes(filters.q.toLowerCase()))).sort((a,b)=>a.scenarioId<b.scenarioId?-1:1);
    const revision='rrev_'+await readinessHash(JSON.stringify([READINESS_PROJECTION_VERSION,organizationId,projectId,endpointId,testDesignVersionId,row.latest_version_id]));
    if(decoded&&decoded.revision!==revision)throw readinessError('TEST_READINESS_CURSOR_STALE','A versão atual mudou. Atualize os cenários.',409);
    const visible=itemsAll.filter(s=>!decoded||s.scenarioId>decoded.last);
    const items=visible.slice(0,limit).map(s=>{
      const blockers=safeReasonCodes(s.blockers,READINESS_BLOCKERS),requestReasons=safeReasonCodes(s.requestReasons,COVERAGE_REASONS),responseReasons=safeReasonCodes(s.responseReasons,COVERAGE_REASONS);
      const diagnosticsOmitted=(Array.isArray(s.blockers)?s.blockers.length:0)>blockers.length||(Array.isArray(s.requestReasons)?s.requestReasons.length:0)>requestReasons.length||(Array.isArray(s.responseReasons)?s.responseReasons.length:0)>responseReasons.length;
      const baseline=s.generationClass==='OBSERVED_BASELINE'?Object.fromEntries(['baselineId','environmentId','sourceEventId','sourceEvidenceId','observationSessionId','observedAt','expiresAt','schemaVersionId','schemaHash','comparisonMode','requestCoverage','responseCoverage','selfCheck'].map(k=>[k,s[k]??null])):null;
      return {scenarioId:s.scenarioId,title:safeReadinessText(s.title),generationClass:s.generationClass,readiness:s.readiness,baselineGap:baselineGapOf(s),baseline,
        blockers,requestReasons,responseReasons,diagnosticsOmitted,detailAvailable:blockers.length+requestReasons.length+responseReasons.length>0,
        sourceExpired:!!s.expiresAt&&Date.parse(s.expiresAt)<=Date.parse(now),navigationAction:'OPEN_TEST_DESIGN'};
    });
    const hasMore=visible.length>limit;
    return {contractVersion:READINESS_DETAIL_CONTRACT,organizationId,projectId,endpointId,testDesignId:row.test_design_id,testDesignVersionId,testDesignVersion:row.version,
      isLatest:row.latest_version_id===testDesignVersionId,latestTestDesignVersionId:row.latest_version_id,readinessRevision:revision,computedAt:now,filters,method,path,
      matchingScenarioCount:itemsAll.length,page:{limit,hasMore,nextCursor:hasMore?await encodeReadinessCursor({...context,version:1,revision,last:items.at(-1).scenarioId}):null},items};
  }
  return {list,scenarios};
}

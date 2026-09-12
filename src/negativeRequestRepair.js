/** FIX-2.4: reviewed request repair, with provenance in the existing Evolution.
 * Repair proves that a construction changed, not that the application rejected it.
 * No source result, runtime value, secret or expected assertion is fabricated.
 */
import { NEGATIVE_REPAIR_CHANGE, negativeCanonical, detectNegativeIntent, suggestedNegativeStrategy, validateNegativeStrategy, negativePathDescriptors, negativePreparationGate } from './negativeRequestStrategy.js';
export const NEGATIVE_REPAIR_PROOF='qagent.negative-request-repair-proof.v1';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const reject=code=>{throw Object.assign(new Error('O reparo negativo exige evidência compatível, estratégia delimitada e aprovação.'),{code,status:409});};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(negativeCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>negativeCanonical(a)===negativeCanonical(b);
const ID=/^[A-Za-z0-9_-]{1,200}$/;
const SCOPE=['organizationId','projectId','endpointId','testDesignId','testDesignVersionId','scenarioId','resultSetId','scenarioResultId','runId','environmentId'];
function declarations(source,strategy){
 const out=[];
 for(const d of negativePathDescriptors(source.spec.target.path)){
  if(strategy.operation==='OMIT_PATH_SEGMENT'&&strategy.selector===d.selector)continue;
  if(Object.hasOwn(source.spec.request?.pathParams||{},d.selector))continue;
  if((source.spec.testData?.bindings||[]).some(b=>b.target==='PATH_PARAM'&&b.selector===d.selector))continue;
  if(!['id','uuid','objectId','ulid'].includes(d.selector))reject('NEGATIVE_REQUEST_DEPENDENCY_UNSUPPORTED');
  out.push({target:'PATH_PARAM',selector:d.selector,source:'OBSERVED',valueType:'STRING',bindingKey:`PATH_PARAM:${d.selector}@${d.segmentIndex}:0`,provenance:{origin:'OBSERVED'}});
 }
 return out;
}
export function validateNegativeRepairProof(p){
 const keys=['contractVersion',...SCOPE,'sourceScenarioHash','assertionsHash','strategy','addedBindings','sourceStatusCode','sourceCompletedAt','basis'];
 if(!obj(p)||Object.keys(p).length!==keys.length||Object.keys(p).some(k=>!keys.includes(k))||p.contractVersion!==NEGATIVE_REPAIR_PROOF||p.basis!=='EXECUTED_WITHOUT_NEGATIVE_CONDITION')reject('NEGATIVE_REQUEST_REPAIR_PROOF_INVALID');
 for(const k of SCOPE)if(typeof p[k]!=='string'||!ID.test(p[k]))reject('NEGATIVE_REQUEST_REPAIR_SCOPE_INVALID');
 if(!/^[a-f0-9]{64}$/.test(p.sourceScenarioHash)||!/^[a-f0-9]{64}$/.test(p.assertionsHash)||!Number.isInteger(p.sourceStatusCode)||p.sourceStatusCode<200||p.sourceStatusCode>=300||typeof p.sourceCompletedAt!=='string'||!Number.isFinite(Date.parse(p.sourceCompletedAt)))reject('NEGATIVE_REQUEST_REPAIR_PROOF_INVALID');
 validateNegativeStrategy(p.strategy);
 if(!Array.isArray(p.addedBindings)||p.addedBindings.length>1)reject('NEGATIVE_REQUEST_REPAIR_PROOF_INVALID');
 return structuredClone(p);
}
export async function buildNegativeRepairProof({resultSet:rs,scenario,sourceVersion}){
 const source=sourceVersion?.specification?.scenarios?.find(s=>s.scenarioId===scenario?.scenarioId);
 if(!source||source.spec?.negativeStrategy||source.learning||source.baseline||source.generationClass==='OBSERVED_BASELINE'||source.category!=='NEGATIVE')reject('NEGATIVE_REQUEST_REPAIR_SOURCE_UNSUPPORTED');
 const strategy=suggestedNegativeStrategy(source),http=scenario.http,req=scenario.evidence?.request;
 if(sourceVersion.id!==rs?.testDesignVersionId||sourceVersion.testDesignId!==rs.testDesignId||sourceVersion.endpointId!==rs.endpointId||source.spec.target.catalogEndpointId!==rs.endpointId)reject('NEGATIVE_REQUEST_REPAIR_SCOPE_INVALID');
 for(const k of ['organizationId','projectId'])if(sourceVersion[k]!==rs[k])reject('NEGATIVE_REQUEST_REPAIR_SCOPE_INVALID');
 if(scenario.evidence?.executionPurpose!=='LEARNING'||!http||http.outcome!=='RESPONSE'||http.errorCode||http.redirectCount!==0||!Number.isInteger(http.statusCode)||http.statusCode<200||http.statusCode>=300)reject('NEGATIVE_REQUEST_REPAIR_EVIDENCE_REQUIRED');
 if(!req||req.method!==source.spec.target.method||http.method!==req.method||!Array.isArray(req.query)||!Array.isArray(req.pathParams)||!Array.isArray(req.headers)||req.negativeRequest)reject('NEGATIVE_REQUEST_REPAIR_EVIDENCE_REQUIRED');
 const template=source.spec.target.path,parts=template.split('/'),actual=http.path?.split('/')||[];
 if(req.path!==template||(http.path!==template&&(parts.length!==actual.length||parts.some((x,i)=>/^\{[^}]+\}$/.test(x)?!actual[i]||actual[i].includes('{'):x!==actual[i]))))reject('NEGATIVE_REQUEST_REPAIR_REQUEST_MISMATCH');
 for(const d of negativePathDescriptors(template)){const p=req.pathParams.filter(p=>p.name===d.selector);if(p.length!==1||p[0].redacted===true||p[0].value==null||String(p[0].value)===''||/REDACTED|TRUNCATED|[{}]/.test(String(p[0].value)))reject('NEGATIVE_REQUEST_REPAIR_EVIDENCE_REQUIRED');}
 if(source.spec.auth.requirement==='REQUIRED'&&!req.headers.some(h=>h.source==='AUTH_RUNTIME'&&h.redacted===true))reject('NEGATIVE_REQUEST_REPAIR_AUTH_EVIDENCE_REQUIRED');
 if(req.bodyBytes!==0||Object.keys(source.spec.request?.body||{}).length)reject('NEGATIVE_REQUEST_REPAIR_BODY_UNSUPPORTED');
 const expected=source.spec.assertions||[],assertions=scenario.assertions||[];
 if(!expected.length||expected.length!==assertions.length||new Set(assertions.map(a=>a.assertionIndex)).size!==expected.length)reject('NEGATIVE_REQUEST_REPAIR_ASSERTIONS_INCOMPLETE');
 for(const a of assertions){const e=expected[a.assertionIndex];if(!Number.isInteger(a.assertionIndex)||!e||a.type!==e.type)reject('NEGATIVE_REQUEST_REPAIR_ASSERTIONS_INCOMPLETE');
  if(e.type==='STATUS'&&(!same(a.expectedStatusCodes,e.expectedStatusCodes)||a.actualStatusCode!==http.statusCode||a.outcome!=='FAILED'))reject('NEGATIVE_REQUEST_REPAIR_ASSERTIONS_INCOMPLETE');}
 if(strategy.operation==='QUERY_VALUE_PROBE'){
  const selected=req.query.filter(q=>q.name===strategy.selector);
  if(selected.length!==1||selected[0].redacted!==false||!['DESIGN','FIXED','OBSERVED','GENERATED'].includes(selected[0].source)||!Array.isArray(selected[0].values)||selected[0].values.length!==1||typeof selected[0].values[0]!=='string'||selected[0].values[0]===strategy.probeValue||/REDACTED|TRUNCATED|qagent_probe_/.test(selected[0].values[0]))reject('NEGATIVE_REQUEST_PROBE_BASIS_UNAVAILABLE');
 }
 const p={contractVersion:NEGATIVE_REPAIR_PROOF};
 for(const k of SCOPE)p[k]=k==='scenarioId'?source.scenarioId:k==='scenarioResultId'?scenario.scenarioResultId:rs[k];
 return validateNegativeRepairProof({...p,sourceScenarioHash:await hash(source),assertionsHash:await hash(expected),strategy,addedBindings:declarations(source,strategy),sourceStatusCode:http.statusCode,sourceCompletedAt:rs.completedAt||rs.createdAt,basis:'EXECUTED_WITHOUT_NEGATIVE_CONDITION'});
}
export async function applyNegativeRepairToScenario(source,raw,scope){
 const p=validateNegativeRepairProof(raw);
 for(const k of ['organizationId','projectId','endpointId','testDesignId'])if(scope[k]!==p[k])reject('NEGATIVE_REQUEST_REPAIR_SCOPE_INVALID');
 if(scope.id!==p.testDesignVersionId||source.scenarioId!==p.scenarioId||await hash(source)!==p.sourceScenarioHash||await hash(source.spec.assertions)!==p.assertionsHash||source.spec.target.catalogEndpointId!==p.endpointId)reject('NEGATIVE_REQUEST_REPAIR_SOURCE_MISMATCH');
 if(source.spec?.negativeStrategy||source.learning)reject('NEGATIVE_REQUEST_REPAIR_SOURCE_UNSUPPORTED');
 const strategy=suggestedNegativeStrategy(source);
 if(!same(strategy,p.strategy)||!same(declarations(source,strategy),p.addedBindings))reject('NEGATIVE_REQUEST_REPAIR_PROOF_MISMATCH');
 const out=structuredClone(source);out.spec.negativeStrategy=strategy;
 out.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[...(out.spec.testData?.bindings||[]).filter(b=>!(b.target===strategy.target&&b.selector===strategy.selector)),...p.addedBindings]};
 if(strategy.operation==='QUERY_VALUE_PROBE')out.spec.request.query={...(out.spec.request.query||{}),[strategy.selector]:strategy.probeValue};
 out.automation={...out.automation,readiness:'REVIEW_REQUIRED',blockers:['LEARNING_EXPECTATION_NOT_OBSERVED'],evolutionState:'LEARNING'};
 delete out.automation.diagnostics;
 const gate=negativePreparationGate(out);if(!gate.allowed)reject(gate.reason);
 if(await hash(out.spec.assertions)!==p.assertionsHash)reject('NEGATIVE_REQUEST_REPAIR_ASSERTIONS_CHANGED');
 return out;
}
export async function negativeRepairCandidate(input){
 try{const proof=await buildNegativeRepairProof(input);return {candidates:[{changeType:NEGATIVE_REPAIR_CHANGE,assertionResultId:null,assertionIndex:0,current:{strategy:null},observed:{conditionEstablished:false,actualStatusCode:proof.sourceStatusCode},proposed:{learningMode:'NEGATIVE_REQUEST_REPAIR',requiresHumanApproval:true,assertionsUnchanged:true,readiness:'REVIEW_REQUIRED',strategy:proof.strategy,repairProof:proof},risk:'MEDIUM',confidence:'MEDIUM'}],reason:'NEGATIVE_REQUEST_REPAIR_AVAILABLE'};}
 catch(e){return {candidates:[],reason:e.code||'NEGATIVE_REQUEST_REPAIR_EVIDENCE_REQUIRED'};}
}

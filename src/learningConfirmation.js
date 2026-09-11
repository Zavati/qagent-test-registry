import { COVERAGE_ASSERTION_TYPES, validateCoverageEvaluation, assertionCoverageGaps, jsonTypeMatches } from './coverageAssertions.js';
/** FIX-2.2. Confirm existing assertions; never synthesize a passing assertion.
 * Called with authoritative Results/Registry data. No request values leave this module.
 * The proof is an internal service projection, not a payload accepted by the Console.
 */
import { assessExploratoryLearning } from './learningScenarioEligibility.js';
export const CONFIRMATION_TYPE = 'SCENARIO_READINESS_CONFIRMATION';
export const CONFIRMATION_CONTRACT = 'qagent.learning-confirmation-proof.v1';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const ID=/^[A-Za-z0-9_-]{1,180}$/;
const authName=n=>/^(authorization|proxy-authorization|cookie|x-api-key|api-key|dolapikey|x-auth-token)$/i.test(n||'');
export function confirmationJson(x){if(Array.isArray(x))return '['+x.map(confirmationJson).join(',')+']';if(plain(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+confirmationJson(x[k])).join(',')+'}';return JSON.stringify(x);}
export async function confirmationHash(x){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(confirmationJson(x))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function reject(reason){const e=new Error('Execution evidence cannot confirm this scenario.');e.code=reason;e.status=409;throw e;}
export function confirmationPathBindings(source){
 const out=[],seen=new Set();const bindings=source.spec?.testData?.bindings||[];
 for(const [segmentIndex,segment] of String(source.spec?.target?.path||'').split('/').filter(Boolean).entries()){
  const m=/^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(segment);if(!m)continue;const selector=m[1];
  // Evidence v1 does not distinguish repeated placeholders. Do not infer their identity.
  if(seen.has(selector))reject('LEARNING_CONFIRMATION_REPEATED_PATH_UNSUPPORTED');seen.add(selector);
  if(own(source.spec.request?.pathParams,selector)||bindings.some(b=>b.target==='PATH_PARAM'&&b.selector===selector))continue;
  if(!['id','uuid','objectId','ulid'].includes(selector))reject('LEARNING_CONFIRMATION_PATH_UNSUPPORTED');
  out.push({target:'PATH_PARAM',selector,source:'OBSERVED',valueType:'STRING',bindingKey:`PATH_PARAM:${selector}@${segmentIndex}:0`,provenance:{origin:'OBSERVED'}});
 }
 return out;
}
function sourceEligible(source){
 if(!source||source.baseline||source.generationClass==='OBSERVED_BASELINE')reject('LEARNING_CONFIRMATION_BASELINE_PROTECTED');
 if(source.learning)reject('LEARNING_CONFIRMATION_ALREADY_RECORDED');
 if(!['REVIEW_REQUIRED','NEEDS_DATA'].includes(source.automation?.readiness))reject('LEARNING_CONFIRMATION_REVIEW_NOT_REQUIRED');
 const a=assessExploratoryLearning(source);if(!a.allowed)reject(a.reason);
 if(!['UNAUTHENTICATED','REQUIRED','NONE'].includes(source.spec?.auth?.requirement))reject('LEARNING_CONFIRMATION_AUTH_INTENT_UNSUPPORTED');
 return a;
}
function templateMatches(template,actual){
 if(template===actual)return true;
 const a=String(template).split('/'),b=String(actual).split('/');
 return a.length===b.length&&a.every((s,i)=>/^\{[A-Za-z_][A-Za-z0-9_.-]*\}$/.test(s)?!!b[i]&&!/[{}?]/.test(b[i]):s===b[i]);
}
// Internal evidence validator reused by confirmation and explicit coverage extension.
// Only the extension wrapper may omit STATUS; it adds it in a reviewed new version.
export async function buildLearningExecutionProof({resultSet:rs,scenario,sourceVersion}, {requireStatus=true}={}){
 const source=sourceVersion?.specification?.scenarios?.find(s=>s.scenarioId===scenario?.scenarioId);
 const admission=sourceEligible(source);
 const versionId=sourceVersion.id||sourceVersion.testDesignVersionId;
 if(!rs||versionId!==rs.testDesignVersionId||sourceVersion.testDesignId!==rs.testDesignId||sourceVersion.organizationId!==rs.organizationId||sourceVersion.projectId!==rs.projectId||sourceVersion.endpointId!==rs.endpointId||source.spec.target.catalogEndpointId!==rs.endpointId)reject('LEARNING_CONFIRMATION_SCOPE_MISMATCH');
 const evidence=scenario.evidence,request=evidence?.request,http=scenario.http;
 if(evidence?.executionPurpose!=='LEARNING')reject('LEARNING_CONFIRMATION_PURPOSE_REQUIRED');
 if(scenario.outcome!=='PASSED'||http?.outcome!=='RESPONSE')reject('LEARNING_CONFIRMATION_RESULT_NOT_PASSED');
 if(http.method!==source.spec.target.method||!templateMatches(source.spec.target.path,http.path)||!request||request.method!==http.method||!templateMatches(source.spec.target.path,request.path))reject('LEARNING_CONFIRMATION_REQUEST_MISMATCH');
 if(!Number.isInteger(http.statusCode)||http.statusCode<200||http.statusCode>=500||http.redirectCount!==0||http.errorCode)reject('LEARNING_CONFIRMATION_HTTP_UNUSABLE');
 const expected=source.spec.assertions||[],actual=scenario.assertions||[];
 if(!expected.length||expected.length!==actual.length||expected.length>100)reject('LEARNING_CONFIRMATION_ASSERTIONS_INCOMPLETE');
 const seen=new Set();
 for(const a of actual){
  const x=expected[a.assertionIndex];
  if(!Number.isInteger(a.assertionIndex)||seen.has(a.assertionIndex)||!x||x.type!==a.type||a.outcome!=='PASSED'||a.errorCode)reject('LEARNING_CONFIRMATION_ASSERTIONS_INCOMPLETE');seen.add(a.assertionIndex);
  if(x.type==='STATUS'&&(a.actualStatusCode!==http.statusCode||!x.expectedStatusCodes?.includes(http.statusCode)||confirmationJson(a.expectedStatusCodes)!==confirmationJson(x.expectedStatusCodes)))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  if(x.type==='SCHEMA'&&(a.schemaRef!==x.schemaRef||a.diagnostics?.schemaTruncated===true))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  if(['JSON_PATH_EXISTS','JSON_PATH_EQUALS'].includes(x.type)&&a.path!==x.path)reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  if(x.type==='HEADER_EXISTS'&&String(a.headerName).toLowerCase()!==String(x.name).toLowerCase())reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  if(x.type==='CONTENT_TYPE'&&confirmationJson(a.expectedContentTypes)!==confirmationJson(x.expected))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  if(COVERAGE_ASSERTION_TYPES.has(x.type)){
   let c;try{c=validateCoverageEvaluation(a.coverage,x.type);}catch{reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');}
   if(confirmationJson(c.assertion)!==confirmationJson(x))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
   if(x.type==='JSON_ARRAY_LENGTH_LTE_REQUEST'&&(c.actualType!=='array'||c.actualLength==null||c.requestBound==null||c.actualLength>c.requestBound))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
   if(x.type==='JSON_PATH_TYPE'&&!(c.actualType===x.expectedType||(x.expectedType==='number'&&c.actualType==='integer')))reject('LEARNING_CONFIRMATION_ASSERTION_MISMATCH');
  }
  if(!COVERAGE_ASSERTION_TYPES.has(x.type)&&!['STATUS','SCHEMA','JSON_PATH_EXISTS','JSON_PATH_EQUALS','HEADER_EXISTS','CONTENT_TYPE'].includes(x.type))reject('LEARNING_CONFIRMATION_ASSERTION_UNSUPPORTED');
 }
 if(requireStatus&&!expected.some(a=>a.type==='STATUS'))reject('LEARNING_CONFIRMATION_STATUS_ASSERTION_REQUIRED');
 // For body assertions, do not promote from a suppressed/truncated evaluation representation.
 if(expected.some(a=>(COVERAGE_ASSERTION_TYPES.has(a.type)||['SCHEMA','JSON_PATH_EXISTS','JSON_PATH_EQUALS'].includes(a.type)))&&(http.truncated||evidence.response?.suppressionReason))reject('LEARNING_CONFIRMATION_BODY_EVIDENCE_INCOMPLETE');
 if(!Array.isArray(request.headers)||!Array.isArray(request.query)||!Array.isArray(request.pathParams))reject('LEARNING_CONFIRMATION_REQUEST_EVIDENCE_MISSING');
 const required=source.spec.auth.requirement;
 const authHeaders=request.headers.filter(h=>authName(h.name)||h.source==='AUTH_RUNTIME');
 if(required==='UNAUTHENTICATED'&&(authHeaders.length||(http.headerNames||[]).some(authName)||request.query.some(q=>authName(q.name)||q.source==='AUTH_RUNTIME')))reject('LEARNING_CONFIRMATION_AUTH_INTENT_MISMATCH');
 if(required==='REQUIRED'&&!authHeaders.some(h=>h.source==='AUTH_RUNTIME'))reject('LEARNING_CONFIRMATION_AUTH_EVIDENCE_MISSING');
 // Assert literals in the source request were actually sent, rather than allowing
 // a valid positive input to confirm a negative whose request was silently changed.
 for(const [name,value] of Object.entries(source.spec.request?.query||{})){
   const q=request.query.find(x=>x.name===name);const values=(Array.isArray(value)?value:[value]);
   if(values.some(v=>v!==null&&typeof v==='object')||!q||q.redacted||confirmationJson(q.values)!==confirmationJson(values.map(String)))reject('LEARNING_CONFIRMATION_REQUEST_MISMATCH');
 }
 for(const [name,value] of Object.entries(source.spec.request?.headers||{})){
   const h=request.headers.find(x=>String(x.name).toLowerCase()===name.toLowerCase());
   if(!h||h.redacted||String(value)!==h.value)reject('LEARNING_CONFIRMATION_REQUEST_MISMATCH');
 }
 if(source.spec.request?.body&&Object.keys(source.spec.request.body).length)reject('LEARNING_CONFIRMATION_BODY_REQUEST_UNSUPPORTED');
 const additions=confirmationPathBindings(source);
 const allBindings=[...(source.spec.testData?.bindings||[]),...additions];
 // Persist policies, not the FIXED values frozen in the runtime. Check every required path.
 for(const segment of source.spec.target.path.split('/')){
  const match=/^\{([^}]+)\}$/.exec(segment);if(!match)continue;
  const p=request.pathParams.find(v=>v.name===match[1]);
  if(!p||p.redacted||!['string','number'].includes(typeof p.value)||String(p.value)===''||(typeof p.value==='number'&&!Number.isFinite(p.value))||/\[REDACTED\]|\[TRUNCATED\]|\{[^}]*\}/.test(String(p.value)))reject('LEARNING_CONFIRMATION_PATH_EVIDENCE_MISSING');
  if(own(source.spec.request?.pathParams,match[1])&&String(source.spec.request.pathParams[match[1]])!==String(p.value))reject('LEARNING_CONFIRMATION_REQUEST_MISMATCH');
 }
 for(const b of allBindings){
  const x=evidence.expected?.testDataBindings?.find(t=>t.target===b.target&&t.selector===b.selector);
  if(!x||x.source!==(b.source==='OBSERVED'?'FIXED':b.source)||x.valueType!==b.valueType)reject('LEARNING_CONFIRMATION_BINDING_EVIDENCE_MISMATCH');
 }
 if(typeof rs.completedAt!=='string'||!Number.isFinite(Date.parse(rs.completedAt)))reject('LEARNING_CONFIRMATION_COMPLETION_MISSING');
 return validateConfirmationProof({contractVersion:CONFIRMATION_CONTRACT,organizationId:rs.organizationId,projectId:rs.projectId,endpointId:rs.endpointId,testDesignId:rs.testDesignId,testDesignVersionId:versionId,scenarioId:source.scenarioId,environmentId:rs.environmentId,resultSetId:rs.resultSetId,scenarioResultId:scenario.scenarioResultId,runId:rs.runId,completedAt:rs.completedAt,executionPurpose:'LEARNING',sourceScenarioHash:await confirmationHash(source),assertionsHash:await confirmationHash(expected),assertionCount:expected.length,actualStatusCode:http.statusCode,authRequirement:required,resolvedBlockers:admission.deferredBlockers,addedBindings:additions});
}
export async function buildConfirmationProof(input){
 const source=input.sourceVersion?.specification?.scenarios?.find(s=>s.scenarioId===input.scenario?.scenarioId);
 if(assertionCoverageGaps(source).length)reject('LEARNING_ASSERTION_COVERAGE_REQUIRES_EXTENSION');
 return buildLearningExecutionProof(input);
}
const fields=['contractVersion','organizationId','projectId','endpointId','testDesignId','testDesignVersionId','scenarioId','environmentId','resultSetId','scenarioResultId','runId','completedAt','executionPurpose','sourceScenarioHash','assertionsHash','assertionCount','actualStatusCode','authRequirement','resolvedBlockers','addedBindings'];
export function validateConfirmationProof(p){
 if(!plain(p)||Object.keys(p).length!==fields.length||Object.keys(p).some(k=>!fields.includes(k))||p.contractVersion!==CONFIRMATION_CONTRACT||p.executionPurpose!=='LEARNING')reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 for(const k of fields.slice(1,11))if(typeof p[k]!=='string'||!ID.test(p[k]))reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 if(!Number.isFinite(Date.parse(p.completedAt))||typeof p.completedAt!=='string'||p.completedAt.length>35||!Number.isInteger(p.assertionCount)||p.assertionCount<1||p.assertionCount>100||!Number.isInteger(p.actualStatusCode)||p.actualStatusCode<200||p.actualStatusCode>=500)reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 if(!['NONE','UNAUTHENTICATED','REQUIRED'].includes(p.authRequirement)||![p.sourceScenarioHash,p.assertionsHash].every(h=>/^[a-f0-9]{64}$/.test(h)))reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 if(!Array.isArray(p.resolvedBlockers)||p.resolvedBlockers.length>20||p.resolvedBlockers.some(x=>!/^LEARNING_[A-Z_]{1,100}$/.test(x)))reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 if(!Array.isArray(p.addedBindings)||p.addedBindings.length>12)reject('LEARNING_CONFIRMATION_PROOF_INVALID');
 for(const b of p.addedBindings){if(!plain(b)||Object.keys(b).sort().join(',')!=='bindingKey,provenance,selector,source,target,valueType'||b.target!=='PATH_PARAM'||b.source!=='OBSERVED'||b.valueType!=='STRING'||!['id','uuid','objectId','ulid'].includes(b.selector)||!/^PATH_PARAM:[A-Za-z]+@\d+:0$/.test(b.bindingKey)||confirmationJson(b.provenance)!=='{"origin":"OBSERVED"}')reject('LEARNING_CONFIRMATION_PROOF_INVALID');}
 return structuredClone(p);
}
export async function applyConfirmationToScenario(source,proof,scope){
 const p=validateConfirmationProof(proof),a=sourceEligible(source);
 if(assertionCoverageGaps(source).length||!source.spec?.assertions?.some(a=>a.type==='STATUS'))reject('LEARNING_ASSERTION_COVERAGE_REQUIRES_EXTENSION');
 for(const k of ['organizationId','projectId','endpointId','testDesignId'])if(scope[k]!==p[k])reject('LEARNING_CONFIRMATION_SCOPE_MISMATCH');
 if(scope.id!==p.testDesignVersionId||source.scenarioId!==p.scenarioId||await confirmationHash(source)!==p.sourceScenarioHash||await confirmationHash(source.spec.assertions)!==p.assertionsHash)reject('LEARNING_CONFIRMATION_SOURCE_MISMATCH');
 if(confirmationJson(a.deferredBlockers)!==confirmationJson(p.resolvedBlockers)||confirmationJson(confirmationPathBindings(source))!==confirmationJson(p.addedBindings)||source.spec.auth.requirement!==p.authRequirement||source.spec.assertions.length!==p.assertionCount||!source.spec.assertions.filter(a=>a.type==='STATUS').every(a=>a.expectedStatusCodes.includes(p.actualStatusCode)))reject('LEARNING_CONFIRMATION_PROOF_MISMATCH');
 const out=structuredClone(source);
 if(p.addedBindings.length)out.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[...(out.spec.testData?.bindings||[]),...p.addedBindings]};
 out.automation={...out.automation,readiness:'READY',blockers:[],evolutionState:'LEARNING'};
 delete out.automation.diagnostics;
 return out;
}
export async function confirmationCandidate(input){
 try{const p=await buildConfirmationProof(input);return {candidates:[{assertionResultId:null,assertionIndex:0,changeType:CONFIRMATION_TYPE,current:{readiness:input.sourceVersion.specification.scenarios.find(s=>s.scenarioId===p.scenarioId).automation.readiness},observed:{assertionCount:p.assertionCount,actualStatusCode:p.actualStatusCode,completedAt:p.completedAt},proposed:{readiness:'READY',learningMode:'CONFIRMATION',requiresHumanApproval:true,assertionsUnchanged:true,confirmationProof:p},risk:'LOW',confidence:'HIGH'}],reason:'LEARNING_HYPOTHESIS_CONFIRMED'};}catch(e){return {candidates:[],reason:e.code||'LEARNING_CONFIRMATION_EVIDENCE_INVALID'};}
}

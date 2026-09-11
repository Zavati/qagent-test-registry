/** FIX-2.3: bounded additive repair of assertion coverage in existing Evolution.
 * Source assertions, request, authentication and provenance are never replaced.
 * Facts are read from authoritative Results; approval rechecks the same proof.
 */
import { buildLearningExecutionProof, validateConfirmationProof, confirmationHash, confirmationJson, confirmationPathBindings } from './learningConfirmation.js';
import { assessExploratoryLearning } from './learningScenarioEligibility.js';
import { validateCoverageAssertion, assertionCoverageGaps, valueAtSimplePath, jsonValueType, jsonTypeMatches, positiveQueryBound, schemaNodeAtPath } from './coverageAssertions.js';
import { validateStructuralEvidence } from './activeLearningSchema.js';
export const COVERAGE_CHANGE = 'ASSERTION_COVERAGE_EXTENSION';
export const COVERAGE_PROOF = 'qagent.learning-coverage-proof.v1';
const err=code=>{throw Object.assign(new Error('A cobertura proposta precisa de evidência compatível e revisão.'),{code,status:409});};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
function exact(x,keys){if(!obj(x)||Object.keys(x).length!==keys.length||Object.keys(x).some(k=>!keys.includes(k)))err('LEARNING_COVERAGE_PROOF_INVALID');}
function bodyEvidence(scenario){
 const r=scenario.evidence?.response;
 if(!r||r.suppressionReason||scenario.http?.truncated===true)err('LEARNING_COVERAGE_EVIDENCE_REQUIRED');
 if(r.previewFormat!=='JSON'||r.typesPreserved!==true||r.previewTruncated!==false||r.redacted!==false||typeof r.bodyPreview!=='string'||r.bodyPreview.length>32768)return null;
 try{return JSON.parse(r.bodyPreview);}catch{return null;}
}
function actualTypeAt(scenario,body,path){
 if(body!==null){const at=valueAtSimplePath(body,path);if(at.exists)return jsonValueType(at.value);}
 try{const e=validateStructuralEvidence(scenario.evidence?.response?.structure);if(e.coverage!=='COMPLETE')return null;const n=schemaNodeAtPath(e.schema,path);if(n&&!Array.isArray(n.type)&&n.type!=='unknown'&&!n['x-qagent-partial'])return n.type;}catch{}
 return null;
}
/** Array location is proposed only for a root list, a declared direct path, or
 * the conventional sole business list at $.data. Nothing is inferred from rels. */
function arrayPath(source,body){
 if(body===null)return null;
 if(Array.isArray(body))return '$';
 const declared=[...new Set((source.spec.assertions||[]).map(a=>a.path).filter(p=>typeof p==='string'&&Array.isArray(valueAtSimplePath(body,p).value)))];
 if(declared.length===1)return declared[0];
 if(declared.length>1)return null;
 const business=Object.keys(body||{}).filter(k=>k!=='rels'&&Array.isArray(body[k]));
 return business.length===1&&business[0]==='data'?'$.data':null;
}
function validateObservation(o){
 if(o?.kind==='JSON_TYPE'){
  exact(o,['kind','path','expectedType','actualType']);
  validateCoverageAssertion({type:'JSON_PATH_TYPE',path:o.path,expectedType:o.expectedType});
  if(o.actualType!==o.expectedType&&!(o.expectedType==='number'&&o.actualType==='integer'))err('LEARNING_COVERAGE_NUMERIC_EVIDENCE_CONFLICT');
 }else if(o?.kind==='PAGINATION_BOUND'){
  exact(o,['kind','path','selector','requestBound','actualLength']);
  validateCoverageAssertion({type:'JSON_ARRAY_LENGTH_LTE_REQUEST',path:o.path,target:'QUERY',selector:o.selector});
  if(positiveQueryBound([o.requestBound])==null||!Number.isSafeInteger(o.actualLength)||o.actualLength<0||o.actualLength>o.requestBound)err('LEARNING_COVERAGE_LIMIT_CONTRADICTION');
 }else err('LEARNING_COVERAGE_PROOF_INVALID');
 return structuredClone(o);
}
function derivedAdditions(source,execution,observations){
 const gaps=assertionCoverageGaps(source),additions=[];
 if(gaps.length!==observations.length)err('LEARNING_COVERAGE_REQUIREMENTS_MISMATCH');
 for(let i=0;i<gaps.length;i++){
  const g=gaps[i],o=validateObservation(observations[i]);
  if(g.kind!==o.kind)err('LEARNING_COVERAGE_REQUIREMENTS_MISMATCH');
  if(g.kind==='JSON_TYPE'){
    if(g.path!==o.path||g.expectedType!==o.expectedType)err('LEARNING_COVERAGE_REQUIREMENTS_MISMATCH');
    additions.push({type:'JSON_PATH_TYPE',path:g.path,expectedType:g.expectedType});
  }else{
    if(!g.selector||g.selector!==o.selector)err('LEARNING_COVERAGE_REQUIREMENTS_MISMATCH');
    const declared=(source.spec.assertions||[]).some(a=>a.path===o.path);
    if(o.path!=='$'&&o.path!=='$.data'&&!declared)err('LEARNING_COVERAGE_ARRAY_PATH_AMBIGUOUS');
    additions.push({type:'JSON_ARRAY_LENGTH_LTE_REQUEST',path:o.path,target:'QUERY',selector:g.selector});
  }
 }
 if(!source.spec.assertions.some(a=>a.type==='STATUS')){
  if(execution.actualStatusCode<200||execution.actualStatusCode>=300)err('LEARNING_COVERAGE_STATUS_CONFLICT');
  additions.push({type:'STATUS',expectedStatusCodes:[execution.actualStatusCode]});
 }
 if(!additions.length||additions.length>6||source.spec.assertions.length+additions.length>30)err('LEARNING_COVERAGE_ADDITION_LIMIT');
 return additions;
}
export async function buildCoverageProof(input){
 const source=input.sourceVersion?.specification?.scenarios?.find(s=>s.scenarioId===input.scenario?.scenarioId);
 const gaps=assertionCoverageGaps(source);
 if(!gaps.length)err('LEARNING_COVERAGE_NOT_REQUIRED');
 const execution=await buildLearningExecutionProof(input,{requireStatus:false});
 if(execution.actualStatusCode<200||execution.actualStatusCode>=300)err('LEARNING_COVERAGE_STATUS_CONFLICT');
 const scenario=input.scenario,body=bodyEvidence(scenario),observations=[];
 for(const g of gaps){
  if(g.kind==='JSON_TYPE'){
    const actualType=actualTypeAt(scenario,body,g.path);if(!actualType)err('LEARNING_COVERAGE_TYPED_FIELD_REQUIRED');
    observations.push(validateObservation({...g,actualType}));
  }else{
    if(!g.selector)err('LEARNING_COVERAGE_QUERY_AMBIGUOUS');
    const q=(scenario.evidence?.request?.query||[]).filter(q=>q.name===g.selector);
    const bound=q.length===1&&q[0].redacted===false&&['DESIGN','FIXED','GENERATED','OBSERVED'].includes(q[0].source)?positiveQueryBound(q[0].values):null;
    if(bound==null)err('LEARNING_COVERAGE_QUERY_EVIDENCE_REQUIRED');
    const path=arrayPath(source,body);if(!path)err('LEARNING_COVERAGE_ARRAY_PATH_AMBIGUOUS');
    observations.push(validateObservation({kind:g.kind,path,selector:g.selector,requestBound:bound,actualLength:valueAtSimplePath(body,path).value.length}));
  }
 }
 const additions=derivedAdditions(source,execution,observations);
 return validateCoverageProof({contractVersion:COVERAGE_PROOF,execution,observations,additions,additionsHash:await confirmationHash(additions)});
}
export function validateCoverageProof(proof){
 exact(proof,['contractVersion','execution','observations','additions','additionsHash']);
 if(proof.contractVersion!==COVERAGE_PROOF||!Array.isArray(proof.observations)||proof.observations.length>5||!Array.isArray(proof.additions)||!proof.additions.length||proof.additions.length>6||!/^[0-9a-f]{64}$/.test(proof.additionsHash))err('LEARNING_COVERAGE_PROOF_INVALID');
 const execution=validateConfirmationProof(proof.execution);
 if(execution.actualStatusCode<200||execution.actualStatusCode>=300)err('LEARNING_COVERAGE_STATUS_CONFLICT');
 const observations=proof.observations.map(validateObservation);
 const additions=proof.additions.map(a=>{
   if(a?.type!=='STATUS')return validateCoverageAssertion(a);
   exact(a,['type','expectedStatusCodes']);if(confirmationJson(a.expectedStatusCodes)!==confirmationJson([execution.actualStatusCode]))err('LEARNING_COVERAGE_STATUS_CONFLICT');return structuredClone(a);
 });
 return {...proof,execution,observations,additions};
}
export async function applyCoverageToScenario(source,proof,scope){
 const p=validateCoverageProof(proof),e=p.execution,a=assessExploratoryLearning(source);
 if(!a.allowed||source.baseline||source.generationClass==='OBSERVED_BASELINE'||source.learning||!['REVIEW_REQUIRED','NEEDS_DATA'].includes(source.automation?.readiness))err(a.reason||'LEARNING_COVERAGE_SOURCE_UNSUPPORTED');
 for(const k of ['organizationId','projectId','endpointId','testDesignId'])if(scope[k]!==e[k])err('LEARNING_COVERAGE_SCOPE_MISMATCH');
 if(scope.id!==e.testDesignVersionId||source.scenarioId!==e.scenarioId||source.spec?.target?.catalogEndpointId!==e.endpointId||await confirmationHash(source)!==e.sourceScenarioHash||await confirmationHash(source.spec.assertions)!==e.assertionsHash)err('LEARNING_COVERAGE_SOURCE_MISMATCH');
 if(confirmationJson(a.deferredBlockers)!==confirmationJson(e.resolvedBlockers)||confirmationJson(confirmationPathBindings(source))!==confirmationJson(e.addedBindings)||source.spec.auth.requirement!==e.authRequirement||source.spec.assertions.length!==e.assertionCount)err('LEARNING_COVERAGE_PROOF_MISMATCH');
 const additions=derivedAdditions(source,e,p.observations);
 if(confirmationJson(additions)!==confirmationJson(p.additions)||await confirmationHash(additions)!==p.additionsHash)err('LEARNING_COVERAGE_PROOF_MISMATCH');
 const out=structuredClone(source);out.spec.assertions.push(...additions);
 if(e.addedBindings.length)out.spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings:[...(out.spec.testData?.bindings||[]),...e.addedBindings]};
 if(assertionCoverageGaps(out).length)err('LEARNING_COVERAGE_STILL_INCOMPLETE');
 out.automation={...out.automation,readiness:'READY',blockers:[],evolutionState:'LEARNING'};
 // Stale diagnostics cannot continue to describe the old DSL as the new state.
 delete out.automation.diagnostics;
 return out;
}
export async function coverageExtensionCandidate(input){
 try{
  const proof=await buildCoverageProof(input),source=input.sourceVersion.specification.scenarios.find(s=>s.scenarioId===input.scenario.scenarioId);
  return {candidates:[{changeType:COVERAGE_CHANGE,assertionResultId:null,assertionIndex:0,current:{readiness:source.automation.readiness,assertionCount:source.spec.assertions.length},observed:{actualStatusCode:proof.execution.actualStatusCode,assertionCount:proof.execution.assertionCount,coverage:proof.observations},proposed:{learningMode:'COVERAGE_EXTENSION',requiresHumanApproval:true,existingAssertionsPreserved:true,assertionsUnchanged:false,readiness:'READY',additions:proof.additions,coverageProof:proof},risk:'MEDIUM',confidence:'HIGH'}],reason:'LEARNING_ASSERTION_EXTENSION_AVAILABLE'};
 }catch(e){return {candidates:[],reason:e.code||'LEARNING_COVERAGE_EVIDENCE_REQUIRED'};}
}

import { NEGATIVE_REPAIR_CHANGE } from '../negativeRequestStrategy.js';
import { validateNegativeRepairProof } from '../negativeRequestRepair.js';
import { COVERAGE_CHANGE, validateCoverageProof } from '../learningCoverage.js';
import { validateConfirmationProof, CONFIRMATION_TYPE } from '../learningConfirmation.js';
import { validateLearningSchema } from '../activeLearningSchema.js';
import { TestRegistryError } from "../domain/errors.js";
import { registryLimits, validateInternalTenantHeaders } from "./testDesignVersion.js";

const ALLOWED_TYPES = new Set([NEGATIVE_REPAIR_CHANGE,COVERAGE_CHANGE, CONFIRMATION_TYPE, "STATUS_EXPECTATION", "CONTENT_TYPE_EXPECTATION", "SCHEMA_EXPECTATION", "SCHEMA_ENRICHMENT", "JSON_PATH_EQUALS_EXPECTATION", "ADD_JSON_PATH_EQUALS_ASSERTION", "TEST_DATA_BINDING", "REQUEST_BODY_FIELD_ADD", "REQUEST_BODY_FIELD_REMOVE"]);

function fail(message, path, code = "TEST_REGISTRY_EVOLUTION_INVALID", status = 400) {
  throw new TestRegistryError(message, { code, status, path });
}
function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object.", path);
  return value;
}
function text(value, path, max = 200) {
  if (typeof value !== "string" || !value.trim()) fail("Expected a non-empty string.", path);
  const v=value.trim(); if(v.length>max) fail(`String exceeds maximum length ${max}.`, path); return v;
}
function known(value, keys, path) { for (const k of Object.keys(value)) if(!keys.has(k)) fail(`Unknown or forbidden field: ${k}.`, `${path}.${k}`, "TEST_REGISTRY_EVOLUTION_FORBIDDEN_FIELD"); }
function positiveInt(value, path) { if(!Number.isInteger(value)||value<0) fail("Expected a non-negative integer.", path); return value; }
function enumValue(value, allowed, path) { const v=text(value,path,80).toUpperCase(); if(!allowed.has(v)) fail("Unsupported value.",path); return v; }
function statusCodes(value,path){ if(!Array.isArray(value)||value.length<1||value.length>12) fail("Expected 1..12 status codes.",path); const out=[...new Set(value)]; out.forEach((v,i)=>{if(!Number.isInteger(v)||v<100||v>599) fail("Invalid HTTP status code.",`${path}[${i}]`)}); return out; }
function contentTypes(value,path){ if(!Array.isArray(value)||value.length<1||value.length>10) fail("Expected 1..10 content types.",path); return [...new Set(value.map((v,i)=>text(v,`${path}[${i}]`,160).toLowerCase()))]; }

function scalarGeneratorConfig(value,valueType,path){
  if(value==null)return {};
  const config=object(value,path);known(config,new Set(["schema"]),path);
  if(config.schema==null)return {};
  const schema=object(config.schema,`${path}.schema`);
  known(schema,new Set(["type","minimum","maximum","minLength","maxLength","enum"]),`${path}.schema`);
  const expectedType={STRING:"string",NUMBER:"number",INTEGER:"integer",BOOLEAN:"boolean"}[valueType];
  const schemaType=schema.type==null?expectedType:String(schema.type).trim().toLowerCase();
  if(schemaType!==expectedType)fail("Generator schema type is incompatible with valueType.",`${path}.schema.type`);
  const out={type:expectedType};
  if(valueType==="NUMBER"||valueType==="INTEGER"){
    if(schema.minimum!=null){if(typeof schema.minimum!=="number"||!Number.isFinite(schema.minimum)||(valueType==="INTEGER"&&!Number.isInteger(schema.minimum)))fail("Invalid generator minimum.",`${path}.schema.minimum`);out.minimum=schema.minimum;}
    if(schema.maximum!=null){if(typeof schema.maximum!=="number"||!Number.isFinite(schema.maximum)||(valueType==="INTEGER"&&!Number.isInteger(schema.maximum)))fail("Invalid generator maximum.",`${path}.schema.maximum`);out.maximum=schema.maximum;}
    if(out.minimum!=null&&out.maximum!=null&&out.minimum>out.maximum)fail("Generator minimum exceeds maximum.",`${path}.schema`);
  }
  if(valueType==="STRING"){
    if(schema.minLength!=null){if(!Number.isInteger(schema.minLength)||schema.minLength<0||schema.minLength>4096)fail("Invalid generator minLength.",`${path}.schema.minLength`);out.minLength=schema.minLength;}
    if(schema.maxLength!=null){if(!Number.isInteger(schema.maxLength)||schema.maxLength<0||schema.maxLength>4096)fail("Invalid generator maxLength.",`${path}.schema.maxLength`);out.maxLength=schema.maxLength;}
    if(out.minLength!=null&&out.maxLength!=null&&out.minLength>out.maxLength)fail("Generator minLength exceeds maxLength.",`${path}.schema`);
  }
  if(schema.enum!=null){
    if(!Array.isArray(schema.enum)||schema.enum.length<1||schema.enum.length>20)fail("Generator enum must contain 1..20 values.",`${path}.schema.enum`);
    const values=[];
    for(let i=0;i<schema.enum.length;i+=1){const v=schema.enum[i];
      const ok=valueType==="STRING"?typeof v==="string"&&v.length<=256:valueType==="BOOLEAN"?typeof v==="boolean":valueType==="INTEGER"?Number.isInteger(v):typeof v==="number"&&Number.isFinite(v);
      if(!ok)fail("Generator enum value is incompatible with valueType.",`${path}.schema.enum[${i}]`);
      if((valueType==="NUMBER"||valueType==="INTEGER")&&((out.minimum!=null&&v<out.minimum)||(out.maximum!=null&&v>out.maximum)))fail("Generator enum value is outside configured bounds.",`${path}.schema.enum[${i}]`);
      values.push(v);
    }
    out.enum=[...new Set(values)];
  }
  return Object.keys(out).length>1?{schema:out}:{};
}

export function validateDerivedVersionInput(input, env={}) {
  const payload=object(input,"payload");
  known(payload,new Set(["organizationId","projectId","sourceTestDesignVersionId","derivation","changes"]),"payload");
  const organizationId=text(payload.organizationId,"payload.organizationId",160);
  const projectId=text(payload.projectId,"payload.projectId",160);
  const sourceTestDesignVersionId=text(payload.sourceTestDesignVersionId,"payload.sourceTestDesignVersionId",180);
  const derivation=object(payload.derivation,"payload.derivation");
  known(derivation,new Set(["type","proposalId","sourceResultSetId","sourceScenarioResultId","approvedByUserId","approvalReason","proposals"]),"payload.derivation");
  if(derivation.type!=="RESULT_EVOLUTION") fail("Unsupported derivation type.","payload.derivation.type");
  const proposalId=text(derivation.proposalId,"payload.derivation.proposalId",180);
  const sourceResultSetId=text(derivation.sourceResultSetId,"payload.derivation.sourceResultSetId",180);
  const sourceScenarioResultId=text(derivation.sourceScenarioResultId,"payload.derivation.sourceScenarioResultId",180);
  const approvedByUserId=derivation.approvedByUserId==null?null:text(derivation.approvedByUserId,"payload.derivation.approvedByUserId",180);
  const approvalReason=derivation.approvalReason==null?null:text(derivation.approvalReason,"payload.derivation.approvalReason",1000);
  let proposals;
  if(derivation.proposals!=null){
    if(!Array.isArray(derivation.proposals)||derivation.proposals.length<1||derivation.proposals.length>10)fail("Invalid grouped proposal lineage.","payload.derivation.proposals");
    const ids=new Set();proposals=derivation.proposals.map((raw,i)=>{const path=`payload.derivation.proposals[${i}]`,m=object(raw,path);known(m,new Set(["proposalId","scenarioId","sourceResultSetId","sourceScenarioResultId"]),path);
      const item=Object.fromEntries(["proposalId","scenarioId","sourceResultSetId","sourceScenarioResultId"].map(k=>[k,text(m[k],`${path}.${k}`,180)]));if(ids.has(item.proposalId))fail("Duplicate proposal lineage.",path);ids.add(item.proposalId);return item;});
  }
  if(!Array.isArray(payload.changes)||payload.changes.length<1||payload.changes.length>30) fail("At least one controlled change is required.","payload.changes");
  const seen=new Set();
  const changes=payload.changes.map((raw,index)=>{
    const path=`payload.changes[${index}]`; const c=object(raw,path);
    known(c,new Set(["type","scenarioId","assertionIndex","bindingIndex","expectedStatusCodes","expectedContentTypes","schemaRef","path","expected","target","selector","currentSource","source","valueType","generatorKind","generatorConfig","learningProof","learningSource","confirmationProof","coverageProof","repairProof"]),path);
    const type=text(c.type,`${path}.type`,80); if(!ALLOWED_TYPES.has(type)) fail("Unsupported evolution change type.",`${path}.type`);
    const scenarioId=text(c.scenarioId,`${path}.scenarioId`,180);
    if(type===CONFIRMATION_TYPE||type===COVERAGE_CHANGE||type===NEGATIVE_REPAIR_CHANGE){
      const isCoverage=type===COVERAGE_CHANGE,isRepair=type===NEGATIVE_REPAIR_CHANGE;
      known(c,new Set(['type','scenarioId','assertionIndex',isRepair?'repairProof':isCoverage?'coverageProof':'confirmationProof','learningSource']),path);
      if(c.assertionIndex!==0||!approvedByUserId||!approvalReason)fail('Hypothesis confirmation requires explicit approval.',path,'LEARNING_CONFIRMATION_APPROVAL_REQUIRED',409);
      let proof,coverageProof;try{if(isRepair){proof=validateNegativeRepairProof(c.repairProof);}else if(isCoverage){coverageProof=validateCoverageProof(c.coverageProof);proof=coverageProof.execution;}else proof=validateConfirmationProof(c.confirmationProof);}catch(e){fail(e.message,path,e.code,409);}
      const source=object(c.learningSource,`${path}.learningSource`);known(source,new Set(['proposalId','resultSetId','scenarioResultId','runId','testDesignVersionId','environmentId']),path);
      const ls=Object.fromEntries(['proposalId','resultSetId','scenarioResultId','runId','testDesignVersionId','environmentId'].map(k=>[k,text(source[k],`${path}.learningSource.${k}`,180)]));
      if(proof.organizationId!==organizationId||proof.projectId!==projectId||proof.scenarioId!==scenarioId||proof.testDesignVersionId!==sourceTestDesignVersionId||['resultSetId','scenarioResultId','runId','testDesignVersionId','environmentId'].some(k=>ls[k]!==proof[k]))fail('Confirmation proof scope mismatch.',path,'LEARNING_CONFIRMATION_SCOPE_MISMATCH',409);
      const members=proposals||[{proposalId,scenarioId,sourceResultSetId,sourceScenarioResultId}];
      if(!members.some(m=>m.proposalId===ls.proposalId&&m.scenarioId===scenarioId&&m.sourceResultSetId===ls.resultSetId&&m.sourceScenarioResultId===ls.scenarioResultId))fail('Confirmation lineage mismatch.',path,'LEARNING_CONFIRMATION_SCOPE_MISMATCH',409);
      if(payload.changes.filter(x=>x.scenarioId===scenarioId).length!==1)fail('Confirmation cannot be combined with another change on the same scenario.',path,'TEST_EVOLUTION_BATCH_CHANGE_CONFLICT',409);
      return {type,scenarioId,assertionIndex:0,...(isRepair?{repairProof:proof}:isCoverage?{coverageProof}:{confirmationProof:proof}),learningSource:ls};
    }
    if(type==="TEST_DATA_BINDING"||type==="REQUEST_BODY_FIELD_ADD"||type==="REQUEST_BODY_FIELD_REMOVE") {
      const bindingIndex=positiveInt(c.bindingIndex,`${path}.bindingIndex`);
      const key=`${scenarioId}:TEST_DATA:${bindingIndex}`; if(seen.has(key)) fail("Duplicate Test Data binding change.",path); seen.add(key);
      const target=enumValue(c.target,type==="TEST_DATA_BINDING"?new Set(["BODY","PATH_PARAM","QUERY"]):new Set(["BODY"]),`${path}.target`);
      const selector=text(c.selector,`${path}.selector`,320);
      if(target==="BODY"){
        if(!/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,3}$/.test(selector)) fail("Only bounded simple BODY selectors are supported for payload evolution.",`${path}.selector`);
        if(/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i.test(selector)) fail("Sensitive BODY selector is forbidden.",`${path}.selector`,`TEST_REGISTRY_EVOLUTION_FORBIDDEN_FIELD`);
      }
      if(type==="REQUEST_BODY_FIELD_REMOVE") {
        const source=enumValue(c.source,new Set(["GENERATED"]),`${path}.source`);
        return {type,scenarioId,bindingIndex,target,selector,source};
      }
      if(type==="REQUEST_BODY_FIELD_ADD") {
        const source=enumValue(c.source,new Set(["GENERATED"]),`${path}.source`);
        const valueType=enumValue(c.valueType,new Set(["STRING","NUMBER","INTEGER","BOOLEAN"]),`${path}.valueType`);
        const generatorKind=enumValue(c.generatorKind,new Set(["TEXT","NUMBER","INTEGER","BOOLEAN"]),`${path}.generatorKind`);
        const compatible=(valueType==="STRING"&&generatorKind==="TEXT")||(valueType==="NUMBER"&&generatorKind==="NUMBER")||(valueType==="INTEGER"&&generatorKind==="INTEGER")||(valueType==="BOOLEAN"&&generatorKind==="BOOLEAN");
        if(!compatible) fail("Test Data generator kind is incompatible with valueType.",`${path}.generatorKind`);
        const generatorConfig=scalarGeneratorConfig(c.generatorConfig,valueType,`${path}.generatorConfig`);
        return {type,scenarioId,bindingIndex,target,selector,source,valueType,generatorKind,generatorConfig};
      }
      const proposedSourceRaw=String(c.source||'').trim().toUpperCase();
      const currentSourceInput=c.currentSource??(proposedSourceRaw==="GENERATED"?"GENERATED":null);
      const currentSource=enumValue(currentSourceInput,new Set(["GENERATED","FIXED","OBSERVED"]),`${path}.currentSource`);
      const source=enumValue(c.source,new Set(["GENERATED","OBSERVED"]),`${path}.source`);
      const valueType=enumValue(c.valueType,new Set(["STRING","NUMBER","INTEGER","BOOLEAN"]),`${path}.valueType`);
      if(source==="OBSERVED") {
        if(c.generatorKind!=null||c.generatorConfig!=null) fail("OBSERVED Test Data evolution cannot carry a generator.",path,"TEST_REGISTRY_EVOLUTION_FORBIDDEN_FIELD");
        return {type,scenarioId,bindingIndex,target,selector,currentSource,source,valueType};
      }
      const generatorKind=enumValue(c.generatorKind,new Set(["TEXT","NUMBER","INTEGER","BOOLEAN"]),`${path}.generatorKind`);
      const compatible=(valueType==="STRING"&&generatorKind==="TEXT")||(valueType==="NUMBER"&&generatorKind==="NUMBER")||(valueType==="INTEGER"&&generatorKind==="INTEGER")||(valueType==="BOOLEAN"&&generatorKind==="BOOLEAN");
      if(!compatible) fail("Test Data generator kind is incompatible with valueType.",`${path}.generatorKind`);
      const generatorConfig=scalarGeneratorConfig(c.generatorConfig,valueType,`${path}.generatorConfig`);
      return {type,scenarioId,bindingIndex,target,selector,currentSource,source,valueType,generatorKind,generatorConfig};
    }
    const assertionIndex=positiveInt(c.assertionIndex,`${path}.assertionIndex`);
    const key=`${scenarioId}:${assertionIndex}`; if(seen.has(key)) fail("Duplicate assertion change.",path); seen.add(key);
    if(type==="STATUS_EXPECTATION") return {type,scenarioId,assertionIndex,expectedStatusCodes:statusCodes(c.expectedStatusCodes,`${path}.expectedStatusCodes`)};
    if(type==="CONTENT_TYPE_EXPECTATION") return {type,scenarioId,assertionIndex,expectedContentTypes:contentTypes(c.expectedContentTypes,`${path}.expectedContentTypes`)};
    if(type==="SCHEMA_EXPECTATION") return {type,scenarioId,assertionIndex,schemaRef:text(c.schemaRef,`${path}.schemaRef`,240)};
    if(type==="SCHEMA_ENRICHMENT"){
      const schemaRef=text(c.schemaRef,`${path}.schemaRef`,240),proof=object(c.learningProof,`${path}.learningProof`),source=object(c.learningSource,`${path}.learningSource`);
      known(proof,new Set(["organizationId","projectId","endpointId","environmentId","statusCode","sourceResultSetId","sourceScenarioResultId","currentSchema","currentSchemaHash","currentSchemaVersionId","schema","schemaHash"]),`${path}.learningProof`);
      known(source,new Set(["proposalId","resultSetId","scenarioResultId","runId","testDesignVersionId","environmentId"]),`${path}.learningSource`);
      const learningSource=Object.fromEntries(["proposalId","resultSetId","scenarioResultId","runId","testDesignVersionId","environmentId"].map(k=>[k,text(source[k],`${path}.learningSource.${k}`,180)]));
      const learningProof=Object.fromEntries(["organizationId","projectId","endpointId","environmentId","sourceResultSetId","sourceScenarioResultId","currentSchemaHash","currentSchemaVersionId","schemaHash"].map(k=>[k,text(proof[k],`${path}.learningProof.${k}`,240)]));
      if(!Number.isInteger(proof.statusCode)||proof.statusCode<200||proof.statusCode>=300)fail("Learning requires compatible successful response.",path);
      learningProof.statusCode=proof.statusCode;
      try{learningProof.currentSchema=validateLearningSchema(proof.currentSchema);learningProof.schema=validateLearningSchema(proof.schema,{allowPartial:false});}catch(e){fail("Invalid bounded structural learning proof.",path,e.code||"LEARNING_SCHEMA_INVALID");}
      if(learningProof.organizationId!==organizationId||learningProof.projectId!==projectId||learningSource.testDesignVersionId!==sourceTestDesignVersionId||learningProof.environmentId!==learningSource.environmentId||learningProof.sourceResultSetId!==learningSource.resultSetId||learningProof.sourceScenarioResultId!==learningSource.scenarioResultId)fail("Learning proof scope mismatch.",path,"LEARNING_PROOF_SCOPE_MISMATCH",409);
      const members=proposals||[{proposalId,scenarioId,sourceResultSetId,sourceScenarioResultId}];
      if(!members.some(m=>m.proposalId===learningSource.proposalId&&m.scenarioId===scenarioId&&m.sourceResultSetId===learningSource.resultSetId&&m.sourceScenarioResultId===learningSource.scenarioResultId))fail("Learning proof lineage mismatch.",path,"LEARNING_PROOF_SCOPE_MISMATCH",409);
      return {type,scenarioId,assertionIndex,schemaRef,learningProof,learningSource};
    }
    const jsonPath=text(c.path,`${path}.path`,500);
    if(!/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)?$/.test(jsonPath)) fail("Only simple non-sensitive JSON paths are supported for learning.",`${path}.path`);
    if(/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i.test(jsonPath)) fail("Sensitive JSON path is forbidden.",`${path}.path`,`TEST_REGISTRY_EVOLUTION_FORBIDDEN_FIELD`);
    if(c.expected!==null&&!['string','number','boolean'].includes(typeof c.expected)) fail("Learned JSON expectation must be scalar.",`${path}.expected`);
    if(typeof c.expected==='string'&&c.expected.length>240) fail("Learned JSON expectation is too long.",`${path}.expected`);
    return {type,scenarioId,assertionIndex,path:jsonPath,expected:c.expected};
  });
  const serialized=JSON.stringify(payload); const bytes=new TextEncoder().encode(serialized).byteLength;
  if(bytes>registryLimits(env).maxRequestBytes) fail("Request body exceeds persistence limit.","payload","TEST_REGISTRY_REQUEST_TOO_LARGE",413);
  return {organizationId,projectId,sourceTestDesignVersionId,derivation:{type:"RESULT_EVOLUTION",proposalId,sourceResultSetId,sourceScenarioResultId,approvedByUserId,approvalReason,...(proposals?{proposals}:{})},changes};
}

export { validateInternalTenantHeaders };

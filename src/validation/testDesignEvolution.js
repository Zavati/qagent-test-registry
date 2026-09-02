import { TestRegistryError } from "../domain/errors.js";
import { registryLimits, validateInternalTenantHeaders } from "./testDesignVersion.js";

const ALLOWED_TYPES = new Set(["STATUS_EXPECTATION", "CONTENT_TYPE_EXPECTATION"]);

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
function statusCodes(value,path){ if(!Array.isArray(value)||value.length<1||value.length>12) fail("Expected 1..12 status codes.",path); const out=[...new Set(value)]; out.forEach((v,i)=>{if(!Number.isInteger(v)||v<100||v>599) fail("Invalid HTTP status code.",`${path}[${i}]`)}); return out; }
function contentTypes(value,path){ if(!Array.isArray(value)||value.length<1||value.length>10) fail("Expected 1..10 content types.",path); return [...new Set(value.map((v,i)=>text(v,`${path}[${i}]`,160).toLowerCase()))]; }

export function validateDerivedVersionInput(input, env={}) {
  const payload=object(input,"payload");
  known(payload,new Set(["organizationId","projectId","sourceTestDesignVersionId","derivation","changes"]),"payload");
  const organizationId=text(payload.organizationId,"payload.organizationId",160);
  const projectId=text(payload.projectId,"payload.projectId",160);
  const sourceTestDesignVersionId=text(payload.sourceTestDesignVersionId,"payload.sourceTestDesignVersionId",180);
  const derivation=object(payload.derivation,"payload.derivation");
  known(derivation,new Set(["type","proposalId","sourceResultSetId","sourceScenarioResultId","approvedByUserId","approvalReason"]),"payload.derivation");
  if(derivation.type!=="RESULT_EVOLUTION") fail("Unsupported derivation type.","payload.derivation.type");
  const proposalId=text(derivation.proposalId,"payload.derivation.proposalId",180);
  const sourceResultSetId=text(derivation.sourceResultSetId,"payload.derivation.sourceResultSetId",180);
  const sourceScenarioResultId=text(derivation.sourceScenarioResultId,"payload.derivation.sourceScenarioResultId",180);
  const approvedByUserId=derivation.approvedByUserId==null?null:text(derivation.approvedByUserId,"payload.derivation.approvedByUserId",180);
  const approvalReason=derivation.approvalReason==null?null:text(derivation.approvalReason,"payload.derivation.approvalReason",1000);
  if(!Array.isArray(payload.changes)||payload.changes.length<1||payload.changes.length>30) fail("At least one controlled change is required.","payload.changes");
  const seen=new Set();
  const changes=payload.changes.map((raw,index)=>{
    const path=`payload.changes[${index}]`; const c=object(raw,path);
    known(c,new Set(["type","scenarioId","assertionIndex","expectedStatusCodes","expectedContentTypes"]),path);
    const type=text(c.type,`${path}.type`,80); if(!ALLOWED_TYPES.has(type)) fail("Unsupported evolution change type.",`${path}.type`);
    const scenarioId=text(c.scenarioId,`${path}.scenarioId`,180); const assertionIndex=positiveInt(c.assertionIndex,`${path}.assertionIndex`);
    const key=`${scenarioId}:${assertionIndex}`; if(seen.has(key)) fail("Duplicate assertion change.",path); seen.add(key);
    if(type==="STATUS_EXPECTATION") return {type,scenarioId,assertionIndex,expectedStatusCodes:statusCodes(c.expectedStatusCodes,`${path}.expectedStatusCodes`)};
    return {type,scenarioId,assertionIndex,expectedContentTypes:contentTypes(c.expectedContentTypes,`${path}.expectedContentTypes`)};
  });
  const serialized=JSON.stringify(payload); const bytes=new TextEncoder().encode(serialized).byteLength;
  if(bytes>registryLimits(env).maxRequestBytes) fail("Request body exceeds persistence limit.","payload","TEST_REGISTRY_REQUEST_TOO_LARGE",413);
  return {organizationId,projectId,sourceTestDesignVersionId,derivation:{type:"RESULT_EVOLUTION",proposalId,sourceResultSetId,sourceScenarioResultId,approvedByUserId,approvalReason},changes};
}

export { validateInternalTenantHeaders };

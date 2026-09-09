import { TestRegistryError } from '../domain/errors.js';
import { registryLimits, validateInternalTenantHeaders } from './testDesignVersion.js';

function fail(message,path,code='TEST_REGISTRY_HUMAN_REPAIR_INVALID',status=400){throw new TestRegistryError(message,{code,status,path});}
function obj(v,path){if(!v||typeof v!=='object'||Array.isArray(v))fail('Expected an object.',path);return v;}
function text(v,path,max=240){if(typeof v!=='string'||!v.trim())fail('Expected a non-empty string.',path);const x=v.trim();if(x.length>max)fail(`String exceeds maximum length ${max}.`,path);return x;}
function known(v,keys,path){for(const k of Object.keys(v))if(!keys.has(k))fail(`Unknown or forbidden field: ${k}.`,`${path}.${k}`,'TEST_REGISTRY_HUMAN_REPAIR_FORBIDDEN_FIELD');}
function enumValue(v,allowed,path){const x=text(v,path,80).toUpperCase();if(!allowed.has(x))fail('Unsupported value.',path);return x;}
function index(v,path){if(!Number.isInteger(v)||v<0)fail('Expected a non-negative integer.',path);return v;}

export function validateHumanRequestRepairInput(input,env={}){
  const payload=obj(input,'payload');
  known(payload,new Set(['organizationId','projectId','sourceTestDesignVersionId','repair','changes']),'payload');
  const organizationId=text(payload.organizationId,'payload.organizationId',160);
  const projectId=text(payload.projectId,'payload.projectId',160);
  const sourceTestDesignVersionId=text(payload.sourceTestDesignVersionId,'payload.sourceTestDesignVersionId',180);
  const r=obj(payload.repair,'payload.repair');
  known(r,new Set(['repairId','sourceResultSetId','sourceScenarioResultId','sourceScenarioId','approvedByUserId','reason']),'payload.repair');
  const repair={
    repairId:text(r.repairId,'payload.repair.repairId',180),
    sourceResultSetId:text(r.sourceResultSetId,'payload.repair.sourceResultSetId',180),
    sourceScenarioResultId:text(r.sourceScenarioResultId,'payload.repair.sourceScenarioResultId',180),
    sourceScenarioId:text(r.sourceScenarioId,'payload.repair.sourceScenarioId',180),
    approvedByUserId:text(r.approvedByUserId,'payload.repair.approvedByUserId',180),
    reason:text(r.reason,'payload.repair.reason',1000),
  };
  if(!Array.isArray(payload.changes)||payload.changes.length<1||payload.changes.length>10)fail('At least one human request repair change is required.','payload.changes');
  const seen=new Set();
  const changes=payload.changes.map((raw,i)=>{
    const path=`payload.changes[${i}]`;const c=obj(raw,path);
    const type=text(c.type,`${path}.type`,80).toUpperCase();
    const scenarioId=text(c.scenarioId,`${path}.scenarioId`,180);
    if(scenarioId!==repair.sourceScenarioId)fail('Human repair scenario does not match source scenario.',`${path}.scenarioId`);
    const valueType=enumValue(c.valueType,new Set(['STRING','NUMBER','INTEGER','BOOLEAN']),`${path}.valueType`);
    let normalized;
    if(type==='SET_FIXED_TEST_DATA'){
      known(c,new Set(['type','scenarioId','bindingIndex','target','selector','currentSource','valueType']),path);
      const bindingIndex=index(c.bindingIndex,`${path}.bindingIndex`);
      const target=enumValue(c.target,new Set(['BODY']),`${path}.target`);
      const selector=text(c.selector,`${path}.selector`,320);
      if(!/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,3}$/.test(selector))fail('Only bounded simple BODY selectors are supported.',`${path}.selector`);
      if(/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i.test(selector))fail('Sensitive BODY selector is forbidden.',`${path}.selector`,'TEST_REGISTRY_HUMAN_REPAIR_FORBIDDEN_FIELD');
      const currentSource=enumValue(c.currentSource,new Set(['FIXED','OBSERVED','GENERATED']),`${path}.currentSource`);
      normalized={type:'SET_FIXED_TEST_DATA',scenarioId,bindingIndex,target,selector,currentSource,valueType};
    }else if(type==='ADD_FIXED_TEST_DATA'){
      known(c,new Set(['type','scenarioId','bindingIndex','target','selector','valueType']),path);
      const bindingIndex=index(c.bindingIndex,`${path}.bindingIndex`);
      const target=enumValue(c.target,new Set(['QUERY']),`${path}.target`);
      const selector=text(c.selector,`${path}.selector`,320);
      if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(selector))fail('Only bounded QUERY selectors are supported for unbound repair.',`${path}.selector`);
      if(/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i.test(selector))fail('Sensitive QUERY selector is forbidden.',`${path}.selector`,'TEST_REGISTRY_HUMAN_REPAIR_FORBIDDEN_FIELD');
      normalized={type:'ADD_FIXED_TEST_DATA',scenarioId,bindingIndex,target,selector,valueType};
    }else fail('Unsupported human repair change type.',`${path}.type`);
    const key=`${scenarioId}:${normalized.target}:${normalized.selector}`;if(seen.has(key))fail('Duplicate human repair selector.',path);seen.add(key);
    return normalized;
  });
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if(bytes>registryLimits(env).maxRequestBytes)fail('Request body exceeds persistence limit.','payload','TEST_REGISTRY_REQUEST_TOO_LARGE',413);
  return {organizationId,projectId,sourceTestDesignVersionId,repair,changes};
}

export { validateInternalTenantHeaders };

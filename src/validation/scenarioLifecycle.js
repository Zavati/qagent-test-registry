import { TestRegistryError } from '../domain/errors.js';
import { registryLimits, validateInternalTenantHeaders } from './testDesignVersion.js';

const ACTIONS=new Set(['CLONE','RENAME','REMOVE']);
function fail(message,path='payload',code='TEST_REGISTRY_SCENARIO_LIFECYCLE_INVALID',status=400){throw new TestRegistryError(message,{code,status,path});}
function obj(v,path){if(!v||typeof v!=='object'||Array.isArray(v))fail('Expected an object.',path);return v;}
function text(v,path,max=500){if(typeof v!=='string'||!v.trim())fail('Expected a non-empty string.',path);const x=v.trim();if(x.length>max)fail(`String exceeds maximum length ${max}.`,path);return x;}
function known(v,keys,path){for(const k of Object.keys(v))if(!keys.has(k))fail(`Unknown or forbidden field: ${k}.`,`${path}.${k}`,'TEST_REGISTRY_SCENARIO_LIFECYCLE_FORBIDDEN_FIELD');}

export function validateScenarioLifecycleInput(input,env={}){
  const payload=obj(input,'payload');
  known(payload,new Set(['contractVersion','organizationId','projectId','endpointId','sourceTestDesignVersionId','operation']),'payload');
  if(payload.contractVersion!=='qagent.scenario-lifecycle-registry.v1')fail('Unsupported contractVersion.','payload.contractVersion');
  const organizationId=text(payload.organizationId,'payload.organizationId',160);
  const projectId=text(payload.projectId,'payload.projectId',160);
  const endpointId=text(payload.endpointId,'payload.endpointId',180);
  const sourceTestDesignVersionId=text(payload.sourceTestDesignVersionId,'payload.sourceTestDesignVersionId',180);
  const raw=obj(payload.operation,'payload.operation');
  known(raw,new Set(['operationId','action','scenarioId','newScenarioId','title','objective','reason','approvedByUserId']),'payload.operation');
  const action=text(raw.action,'payload.operation.action',40).toUpperCase();
  if(!ACTIONS.has(action))fail('Unsupported lifecycle action.','payload.operation.action');
  const operation={operationId:text(raw.operationId,'payload.operation.operationId',180),action,scenarioId:text(raw.scenarioId,'payload.operation.scenarioId',180),approvedByUserId:text(raw.approvedByUserId,'payload.operation.approvedByUserId',180),reason:text(raw.reason||'Scenario lifecycle management.','payload.operation.reason',1000)};
  if(action==='CLONE'){
    operation.newScenarioId=text(raw.newScenarioId,'payload.operation.newScenarioId',180);
    if(operation.newScenarioId===operation.scenarioId)fail('Clone must use a new scenarioId.','payload.operation.newScenarioId');
    if(raw.title!=null)operation.title=text(raw.title,'payload.operation.title',500);
    if(raw.objective!=null)operation.objective=text(raw.objective,'payload.operation.objective',2000);
  }else if(action==='RENAME'){
    operation.title=text(raw.title,'payload.operation.title',500);
    if(raw.objective!=null)fail('RENAME changes title only; clone to change scenario intent.','payload.operation.objective','TEST_REGISTRY_SCENARIO_LIFECYCLE_RENAME_OBJECTIVE_FORBIDDEN',409);
  }else{
    if(raw.newScenarioId!=null||raw.title!=null||raw.objective!=null)fail('REMOVE does not accept clone/rename fields.','payload.operation');
  }
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if(bytes>registryLimits(env).maxRequestBytes)fail('Request body exceeds persistence limit.','payload','TEST_REGISTRY_REQUEST_TOO_LARGE',413);
  return {organizationId,projectId,endpointId,sourceTestDesignVersionId,operation};
}
export { validateInternalTenantHeaders };

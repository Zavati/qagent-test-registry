import { TestRegistryError } from '../domain/errors.js';
import { registryLimits, validateInternalTenantHeaders } from './testDesignVersion.js';

const TARGETS=new Set(['BODY','QUERY','PATH_PARAM']);
const VALUE_TYPES=new Set(['STRING','NUMBER','INTEGER','BOOLEAN','JSON']);
const SHARED_SOURCES=new Set(['FIXED','SECRET','GENERATED']);
const GENERATORS=new Set(['AUTO','TEXT','TEXT_SENTENCE','FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','UUID','BR_CPF','BR_CNPJ','BR_CEP','PHONE','INTEGER','NUMBER','BOOLEAN','DATE','DATE_TIME','CURRENT_DATE','CURRENT_DATE_TIME','STRING_LIST','INTEGER_LIST','NUMBER_LIST','BOOLEAN_LIST','JSON_SCHEMA']);
const STRING_GENERATORS=new Set(['AUTO','TEXT','TEXT_SENTENCE','FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','UUID','BR_CPF','BR_CNPJ','BR_CEP','PHONE','DATE','DATE_TIME','CURRENT_DATE','CURRENT_DATE_TIME']);
const SENSITIVE=/(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const BODY_SELECTOR=/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,7}$/;
const SIMPLE_SELECTOR=/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

function fail(message,path,code='TEST_REGISTRY_SCENARIO_REQUEST_EDIT_INVALID',status=400){throw new TestRegistryError(message,{code,status,path});}
function obj(v,path){if(!v||typeof v!=='object'||Array.isArray(v))fail('Expected an object.',path);return v;}
function text(v,path,max=320){if(typeof v!=='string'||!v.trim())fail('Expected a non-empty string.',path);const x=v.trim();if(x.length>max)fail(`String exceeds maximum length ${max}.`,path);return x;}
function known(v,keys,path){for(const k of Object.keys(v))if(!keys.has(k))fail(`Unknown or forbidden field: ${k}.`,`${path}.${k}`,'TEST_REGISTRY_SCENARIO_REQUEST_EDIT_FORBIDDEN_FIELD');}
function enumValue(v,allowed,path){const x=text(v,path,80).toUpperCase();if(!allowed.has(x))fail('Unsupported value.',path);return x;}
function jsonBytes(v,path,max=16384){let s;try{s=JSON.stringify(v);}catch{fail('Value must be JSON serializable.',path);}if(s===undefined)fail('Value must be JSON serializable.',path);if(new TextEncoder().encode(s).byteLength>max)fail(`Value exceeds ${max} bytes.`,path,'TEST_REGISTRY_SCENARIO_REQUEST_EDIT_TOO_LARGE',413);return structuredClone(v);}
function validateSelector(target,selector,path){if(target==='BODY'){if(!BODY_SELECTOR.test(selector))fail('BODY selector must be a bounded simple JSON path.',path);}else if(!SIMPLE_SELECTOR.test(selector))fail('Selector is invalid.',path);}
function assertGeneratorCompatibility(kind,valueType,path){if(kind==='AUTO')return;if(STRING_GENERATORS.has(kind)&&valueType==='STRING')return;if(kind==='INTEGER'&&valueType==='INTEGER')return;if((kind==='INTEGER'||kind==='NUMBER')&&valueType==='NUMBER')return;if(kind==='BOOLEAN'&&valueType==='BOOLEAN')return;if((kind.endsWith('_LIST')||kind==='JSON_SCHEMA')&&valueType==='JSON')return;fail('Generator is incompatible with valueType.',path);}

function validateFixedValue(value,valueType,path){
  if(valueType==='STRING'){if(typeof value!=='string')fail('STRING value must be a string.',path);return value;}
  if(valueType==='INTEGER'){if(!Number.isInteger(value))fail('INTEGER value must be an integer.',path);return value;}
  if(valueType==='NUMBER'){if(typeof value!=='number'||!Number.isFinite(value))fail('NUMBER value must be finite.',path);return value;}
  if(valueType==='BOOLEAN'){if(typeof value!=='boolean')fail('BOOLEAN value must be boolean.',path);return value;}
  return jsonBytes(value,path);
}

function validateTemporalConfig(config,path){if(config==null)return {};const c=obj(config,path);known(c,new Set(['timezone','offsetDays']),path);const timezone=c.timezone==null?'UTC':text(c.timezone,`${path}.timezone`,120);const offsetDays=c.offsetDays==null?0:Number(c.offsetDays);if(!Number.isInteger(offsetDays)||offsetDays < -3660 || offsetDays > 3660)fail('offsetDays out of range.',`${path}.offsetDays`);try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(new Date(0));}catch{fail('timezone must be a valid IANA time zone.',`${path}.timezone`);}return {timezone,offsetDays};}
function normalizeGenerator(raw,path,valueType){const g=obj(raw,path);known(g,new Set(['kind','config']),path);const kind=enumValue(g.kind,GENERATORS,`${path}.kind`);assertGeneratorCompatibility(kind,valueType,`${path}.kind`);let config={};if(kind==='CURRENT_DATE'||kind==='CURRENT_DATE_TIME')config=validateTemporalConfig(g.config,`${path}.config`);else if(g.config!=null)config=jsonBytes(g.config,`${path}.config`,8192);return {kind,config};}

export function validateScenarioRequestEditInput(input,env={}){
  const payload=obj(input,'payload');
  known(payload,new Set(['contractVersion','organizationId','projectId','endpointId','sourceTestDesignVersionId','edit','changes']),'payload');
  if(payload.contractVersion!=='qagent.scenario-request-edit-registry.v1')fail('Unsupported contractVersion.','payload.contractVersion');
  const organizationId=text(payload.organizationId,'payload.organizationId',160);
  const projectId=text(payload.projectId,'payload.projectId',160);
  const endpointId=text(payload.endpointId,'payload.endpointId',180);
  const sourceTestDesignVersionId=text(payload.sourceTestDesignVersionId,'payload.sourceTestDesignVersionId',180);
  const e=obj(payload.edit,'payload.edit');
  known(e,new Set(['editId','scenarioId','approvedByUserId','reason']),'payload.edit');
  const edit={editId:text(e.editId,'payload.edit.editId',180),scenarioId:text(e.scenarioId,'payload.edit.scenarioId',180),approvedByUserId:text(e.approvedByUserId,'payload.edit.approvedByUserId',180),reason:text(e.reason,'payload.edit.reason',1000)};
  if(!Array.isArray(payload.changes)||payload.changes.length<1||payload.changes.length>20)fail('At least one and at most 20 changes are required.','payload.changes');
  const seen=new Set();
  const changes=payload.changes.map((raw,i)=>{
    const path=`payload.changes[${i}]`,c=obj(raw,path);const type=text(c.type,`${path}.type`,80).toUpperCase();const scenarioId=text(c.scenarioId,`${path}.scenarioId`,180);if(scenarioId!==edit.scenarioId)fail('Change scenario does not match edit scenario.',`${path}.scenarioId`);
    const target=enumValue(c.target,TARGETS,`${path}.target`);const selector=text(c.selector,`${path}.selector`,320);validateSelector(target,selector,`${path}.selector`);const k=`${target}:${selector}`;if(seen.has(k))fail('Duplicate selector in edit.',path);seen.add(k);
    if(type==='OMIT'){
      known(c,new Set(['type','scenarioId','target','selector']),path);if(target==='PATH_PARAM')fail('PATH_PARAM omission must use governed negative request strategy.',`${path}.target`,'TEST_REGISTRY_SCENARIO_REQUEST_PATH_OMIT_FORBIDDEN',409);return {type,scenarioId,target,selector};
    }
    const valueType=enumValue(c.valueType,VALUE_TYPES,`${path}.valueType`);
    if(valueType==='JSON'&&target!=='BODY')fail('JSON scenario-local is supported only for BODY.',`${path}.valueType`,'TEST_REGISTRY_SCENARIO_REQUEST_JSON_TARGET_UNSUPPORTED',409);
    if(type==='SET_FIXED_LOCAL'){
      known(c,new Set(['type','scenarioId','target','selector','valueType','value','bindingKey']),path);if(SENSITIVE.test(selector))fail('Sensitive selector cannot store a scenario-local literal.',`${path}.selector`,'TEST_REGISTRY_SCENARIO_REQUEST_SECRET_REQUIRED',409);const bindingKey=text(c.bindingKey,`${path}.bindingKey`,400);return {type,scenarioId,target,selector,valueType,value:validateFixedValue(c.value,valueType,`${path}.value`),bindingKey};
    }
    if(type==='SET_GENERATED'){
      known(c,new Set(['type','scenarioId','target','selector','valueType','generator','sharedBindingId']),path);if(SENSITIVE.test(selector))fail('Sensitive selector cannot use a generated value.',`${path}.selector`,'TEST_REGISTRY_SCENARIO_REQUEST_SECRET_REQUIRED',409);return {type,scenarioId,target,selector,valueType,generator:normalizeGenerator(c.generator,`${path}.generator`,valueType),...(c.sharedBindingId?{sharedBindingId:text(c.sharedBindingId,`${path}.sharedBindingId`,180)}:{})};
    }
    if(type==='SET_OBSERVED'){
      known(c,new Set(['type','scenarioId','target','selector','valueType','bindingKey']),path);if(SENSITIVE.test(selector))fail('Sensitive selector cannot use OBSERVED.',`${path}.selector`,'TEST_REGISTRY_SCENARIO_REQUEST_SECRET_REQUIRED',409);const bindingKey=text(c.bindingKey,`${path}.bindingKey`,400);return {type,scenarioId,target,selector,valueType,bindingKey};
    }
    if(type==='USE_SHARED'){
      known(c,new Set(['type','scenarioId','target','selector','valueType','sourceType','bindingKey','sharedBindingId','generator']),path);const sourceType=enumValue(c.sourceType,SHARED_SOURCES,`${path}.sourceType`);if(SENSITIVE.test(selector)&&sourceType!=='SECRET')fail('Sensitive selector must use a shared SECRET.',`${path}.sourceType`,'TEST_REGISTRY_SCENARIO_REQUEST_SECRET_REQUIRED',409);if(sourceType==='SECRET'&&valueType!=='STRING')fail('SECRET supports STRING only.',`${path}.valueType`);const bindingKey=text(c.bindingKey,`${path}.bindingKey`,400);const sharedBindingId=text(c.sharedBindingId,`${path}.sharedBindingId`,180);let generator=null;if(sourceType==='GENERATED')generator=normalizeGenerator(c.generator,`${path}.generator`,valueType);else if(c.generator!=null)fail('generator is only valid for shared GENERATED.',`${path}.generator`);return {type,scenarioId,target,selector,valueType,sourceType,bindingKey,sharedBindingId,...(generator?{generator}:{})};
    }
    fail('Unsupported scenario request edit type.',`${path}.type`);
  });
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).byteLength;if(bytes>registryLimits(env).maxRequestBytes)fail('Request body exceeds persistence limit.','payload','TEST_REGISTRY_REQUEST_TOO_LARGE',413);
  return {organizationId,projectId,endpointId,sourceTestDesignVersionId,edit,changes};
}

export { validateInternalTenantHeaders };

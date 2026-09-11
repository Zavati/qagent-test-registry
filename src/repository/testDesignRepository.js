import { COVERAGE_CHANGE, applyCoverageToScenario } from '../learningCoverage.js';
import { confirmationHash } from '../learningConfirmation.js';
import { applyConfirmationToScenario, CONFIRMATION_TYPE } from '../learningConfirmation.js';
import { canonicalLearningJson, structuralIsPartial, assertSchemaRefinement } from '../activeLearningSchema.js';
import { validateObservedBaselineScenario, observedBaselineReady, assertNoProtectedBaselineChanges, canonicalBaselineJson, isApprovedBaselineRevision } from '../baselineContract.js';
import { TestRegistryError } from "../domain/errors.js";
import { buildStableTestDesignId, createTestDesignVersionId } from "../domain/ids.js";
import { buildTestDesignExecutionProjection, projectionInsertStatement } from "../domain/executionEligibility.js";

const ROOT_BY_SCOPE_SQL = `
SELECT id, organization_id, project_id, endpoint_id, status,
       latest_version, latest_version_id, created_at, updated_at
FROM test_designs
WHERE organization_id = ? AND project_id = ? AND endpoint_id = ?
LIMIT 1`;

const VERSION_COLUMNS = `
id, test_design_id, organization_id, project_id, endpoint_id, version,
generation_request_id, context_fingerprint, contract_version, specification_version,
provider, model, prompt_version, repair_prompt_version, guard_version,
scenario_count, ready_count, review_required_count,
specification_json, generation_metadata_json, safe_diagnostics_json, created_at`;

function mapRoot(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    endpointId: row.endpoint_id,
    status: row.status,
    latestVersion: row.latest_version,
    latestVersionId: row.latest_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStoredJson(value, field, versionId) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new TestRegistryError("Persisted Test Design JSON is invalid.", {
      code: "TEST_REGISTRY_CORRUPT_ARTIFACT",
      status: 500,
      retryable: false,
      details: { field, versionId },
      cause,
    });
  }
}

function mapVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    testDesignId: row.test_design_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    endpointId: row.endpoint_id,
    version: row.version,
    generationRequestId: row.generation_request_id,
    contextFingerprint: row.context_fingerprint,
    contractVersion: row.contract_version,
    specificationVersion: row.specification_version,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    repairPromptVersion: row.repair_prompt_version,
    guardVersion: row.guard_version,
    scenarioCount: row.scenario_count,
    readyCount: row.ready_count,
    reviewRequiredCount: row.review_required_count,
    specification: parseStoredJson(row.specification_json, "specification_json", row.id),
    generationMetadata: parseStoredJson(row.generation_metadata_json, "generation_metadata_json", row.id),
    safeDiagnostics: parseStoredJson(row.safe_diagnostics_json, "safe_diagnostics_json", row.id),
    createdAt: row.created_at,
  };
}

function isUniqueConstraintError(error) {
  const message = String(error?.message || error || "");
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(message);
}

function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function deleteBodyPath(body, selector) {
  if (!plain(body) || typeof selector !== "string" || !selector.startsWith("$.")) return;
  const parts = selector.slice(2).split(".");
  let cursor = body;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!plain(cursor?.[parts[i]])) return;
    cursor = cursor[parts[i]];
  }
  delete cursor[parts.at(-1)];
}

function isMissingExecutionProjectionTableError(error) {
  return /no such table:\s*test_design_execution_inventory/i.test(String(error?.message || error || ""));
}

async function first(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

export function createTestDesignRepository(db, {
  now = () => new Date(),
  versionIdFactory = createTestDesignVersionId,
  maxVersionRetries = 3,
} = {}) {
  if (!db?.prepare || !db?.batch) {
    throw new TestRegistryError("TEST_REGISTRY_DB binding is unavailable.", {
      code: "TEST_REGISTRY_DB_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  }

  async function getRootByScope({ organizationId, projectId, endpointId }) {
    return mapRoot(await first(db, ROOT_BY_SCOPE_SQL, [organizationId, projectId, endpointId]));
  }

  async function getVersionByGenerationRequestId(generationRequestId) {
    const row = await first(
      db,
      `SELECT ${VERSION_COLUMNS} FROM test_design_versions WHERE generation_request_id = ? LIMIT 1`,
      [generationRequestId],
    );
    return mapVersion(row);
  }

  async function getLatest({ organizationId, projectId, endpointId }) {
    const root = await getRootByScope({ organizationId, projectId, endpointId });
    if (!root || root.latestVersion < 1 || !root.latestVersionId) {
      return { exists: false, testDesign: root, version: null };
    }

    const row = await first(
      db,
      `SELECT ${VERSION_COLUMNS}
       FROM test_design_versions
       WHERE id = ? AND test_design_id = ?
         AND organization_id = ? AND project_id = ? AND endpoint_id = ?
       LIMIT 1`,
      [root.latestVersionId, root.id, organizationId, projectId, endpointId],
    );

    if (!row) {
      throw new TestRegistryError("Latest Test Design pointer is inconsistent.", {
        code: "TEST_REGISTRY_LATEST_POINTER_INVALID",
        status: 500,
        details: { testDesignId: root.id, latestVersionId: root.latestVersionId },
      });
    }

    return { exists: true, testDesign: root, version: mapVersion(row) };
  }

  async function getExactVersion({ organizationId, projectId, testDesignId, version }) {
    const row = await first(
      db,
      `SELECT ${VERSION_COLUMNS}
       FROM test_design_versions
       WHERE test_design_id = ? AND version = ?
         AND organization_id = ? AND project_id = ?
       LIMIT 1`,
      [testDesignId, version, organizationId, projectId],
    );
    return mapVersion(row);
  }

  async function getVersionById({ organizationId, projectId, testDesignVersionId }) {
    const row = await first(
      db,
      `SELECT ${VERSION_COLUMNS}
       FROM test_design_versions
       WHERE id = ?
         AND organization_id = ? AND project_id = ?
       LIMIT 1`,
      [testDesignVersionId, organizationId, projectId],
    );
    return mapVersion(row);
  }


  async function getVersionByDerivationKey(derivationKey) {
    const row = await first(
      db,
      `SELECT ${VERSION_COLUMNS} FROM test_design_versions WHERE derivation_key = ? LIMIT 1`,
      [derivationKey],
    );
    return mapVersion(row);
  }

  async function appendDerivedVersion(input) {
    const derivationKey = `RESULT_EVOLUTION:${input.derivation.proposalId}`;
    const replay = await getVersionByDerivationKey(derivationKey);
    if (replay) {
      if(replay.organizationId!==input.organizationId||replay.projectId!==input.projectId)throw new TestRegistryError('Derivation key belongs to another scope.',{code:'TEST_REGISTRY_IDEMPOTENCY_SCOPE_MISMATCH',status:409});
      return { created: false, idempotentReplay: true, version: replay };
    }

    const source = await getVersionById({
      organizationId: input.organizationId,
      projectId: input.projectId,
      testDesignVersionId: input.sourceTestDesignVersionId,
    });
    if (!source) {
      throw new TestRegistryError("Source Test Design version not found.", { code: "TEST_DESIGN_VERSION_NOT_FOUND", status: 404 });
    }
    const root = await getRootByScope(source);
    if (!root || root.latestVersionId !== source.id) {
      throw new TestRegistryError("Source Test Design version is stale.", {
        code: "TEST_REGISTRY_EVOLUTION_SOURCE_STALE", status: 409, retryable: false,
        details: { sourceVersionId: source.id, latestVersionId: root?.latestVersionId || null },
      });
    }

    try{assertNoProtectedBaselineChanges(source.specification,input.changes.filter(c=>c.type!=='SCHEMA_ENRICHMENT').map(c=>c.scenarioId));}
    catch(error){throw new TestRegistryError(error.message,{code:error.code,status:409});}
    const specification = structuredClone(source.specification);
    for (const change of input.changes) {
      const scenario = (specification.scenarios || []).find((item) => item?.scenarioId === change.scenarioId);
      if (!scenario) throw new TestRegistryError("Evolution scenario not found in source version.", { code: "TEST_REGISTRY_EVOLUTION_SCENARIO_NOT_FOUND", status: 409 });
      if(change.type===COVERAGE_CHANGE){
        if(!input.derivation.approvedByUserId||!input.derivation.approvalReason||input.changes.filter(c=>c.scenarioId===scenario.scenarioId).length!==1)throw new TestRegistryError('Coverage extension requires isolated reviewed changes.',{code:'LEARNING_COVERAGE_APPROVAL_REQUIRED',status:409});
        const extended=await applyCoverageToScenario(scenario,change.coverageProof,source),p=change.coverageProof.execution,e=change.learningSource;
        extended.learning={contractVersion:'qagent.scenario-learning.v1',kind:'ASSERTION_COVERAGE_EXTENSION',phase:'PENDING_VERIFICATION',proposalId:e.proposalId,sourceResultSetId:p.resultSetId,sourceScenarioResultId:p.scenarioResultId,sourceRunId:p.runId,sourceTestDesignVersionId:source.id,environmentId:p.environmentId,sourceScenarioHash:p.sourceScenarioHash,assertionsHash:await confirmationHash(extended.spec.assertions),sourceAssertionsHash:p.assertionsHash,assertionCount:extended.spec.assertions.length,assertionsUnchanged:false,existingAssertionsPreserved:true,addedAssertions:change.coverageProof.additions,resolvedBlockers:p.resolvedBlockers,approvedByUserId:input.derivation.approvedByUserId,approvedAt:now().toISOString()};
        Object.assign(scenario,extended);continue;
      }
      if(change.type===CONFIRMATION_TYPE){
        if(!input.derivation.approvedByUserId||!input.derivation.approvalReason)throw new TestRegistryError('Explicit approval required.',{code:'LEARNING_CONFIRMATION_APPROVAL_REQUIRED',status:409});
        if(input.changes.filter(c=>c.scenarioId===scenario.scenarioId).length!==1)throw new TestRegistryError('Conflicting scenario changes.',{code:'TEST_EVOLUTION_BATCH_CHANGE_CONFLICT',status:409});
        const confirmed=await applyConfirmationToScenario(scenario,change.confirmationProof,source);
        const p=change.confirmationProof,e=change.learningSource;
        confirmed.learning={contractVersion:'qagent.scenario-learning.v1',kind:'HYPOTHESIS_CONFIRMATION',phase:'PENDING_VERIFICATION',proposalId:e.proposalId,sourceResultSetId:p.resultSetId,sourceScenarioResultId:p.scenarioResultId,sourceRunId:p.runId,sourceTestDesignVersionId:source.id,environmentId:p.environmentId,sourceScenarioHash:p.sourceScenarioHash,assertionsHash:p.assertionsHash,assertionCount:p.assertionCount,assertionsUnchanged:true,resolvedBlockers:p.resolvedBlockers,approvedByUserId:input.derivation.approvedByUserId,approvedAt:now().toISOString()};
        Object.assign(scenario,confirmed);
        continue;
      }
      if(change.type === "SCHEMA_ENRICHMENT") {
        const proof=change.learningProof, evidence=change.learningSource;
        const assertion=scenario.spec?.assertions?.[change.assertionIndex];
        const stop=(code)=>{throw new TestRegistryError('Learning proof cannot enrich this source scenario.',{code,status:409});};
        if(!assertion||assertion.type!=='SCHEMA'||assertion.schemaRef!==proof.currentSchemaVersionId||proof.endpointId!==source.endpointId||proof.organizationId!==source.organizationId||proof.projectId!==source.projectId||evidence.testDesignVersionId!==source.id)stop('LEARNING_SOURCE_MISMATCH');
        if(!['GET','HEAD','OPTIONS'].includes(scenario.spec?.target?.method))stop('LEARNING_MUTATION_NOT_SUPPORTED');
        const statuses=(scenario.spec.assertions||[]).filter(a=>a.type==='STATUS').flatMap(a=>a.expectedStatusCodes||[]);
        if(!statuses.includes(proof.statusCode))stop('LEARNING_KNOWN_RULE_CONFLICT');
        if(!structuralIsPartial(proof.currentSchema))stop('LEARNING_SOURCE_SCHEMA_ALREADY_COMPLETE');
        const hash=async(value)=>'sch_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalLearningJson(value))))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
        if(await hash(proof.currentSchema)!==proof.currentSchemaHash||await hash(proof.schema)!==proof.schemaHash)stop('LEARNING_SCHEMA_HASH_MISMATCH');
        try{assertSchemaRefinement(proof.currentSchema,proof.schema);}catch(e){stop(e.code||'LEARNING_INVARIANT_WEAKENED');}
        const approvedAt=now().toISOString();
        if(scenario.generationClass==='OBSERVED_BASELINE'){
          const b=scenario.baseline;
          try{validateObservedBaselineScenario(scenario,source);}catch(e){stop(e.code);}
          if(!input.derivation.approvedByUserId)stop('LEARNING_BASELINE_HUMAN_APPROVAL_REQUIRED');
          if(b.enrichment||b.responseCoverage.status!=='PARTIAL'||b.requestCoverage.status!=='COMPLETE'||b.selfCheck!=='PARTIAL'||Date.parse(b.expiresAt)<=Date.parse(approvedAt))stop('LEARNING_BASELINE_SOURCE_UNUSABLE');
          if(b.source.environmentId!==evidence.environmentId||b.responseSchemaVersionId!==proof.currentSchemaVersionId||b.responseSchemaHash!==proof.currentSchemaHash||b.source.statusCode!==proof.statusCode)stop('LEARNING_BASELINE_SCOPE_MISMATCH');
          const operational=(scenario.automation?.blockers||[]).filter(b=>!['OBSERVED_BASELINE_RESPONSE_INCOMPLETE','OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE'].includes(b));
          if(operational.length||!scenario.spec?.target?.apiServiceKey||(scenario.spec?.auth?.requirement==='REQUIRED'&&!scenario.spec.auth.authProfileRef))stop('LEARNING_BASELINE_OPERATIONAL_BLOCK');
          b.enrichment={contractVersion:'qagent.baseline-enrichment.v1',proposalId:evidence.proposalId,sourceResultSetId:evidence.resultSetId,sourceScenarioResultId:evidence.scenarioResultId,sourceRunId:evidence.runId,sourceTestDesignVersionId:source.id,environmentId:evidence.environmentId,responseSchemaVersionId:change.schemaRef,responseSchemaHash:proof.schemaHash,approvedByUserId:input.derivation.approvedByUserId,approvedAt,selfCheck:'PASSED'};
          scenario.automation={...scenario.automation,readiness:'READY',blockers:[],evolutionState:'LEARNING'};
        }else{
          // Expectations can be completed without changing request bindings or claims
          // about the initial observation. This marker is not verification evidence.
          scenario.learning={contractVersion:'qagent.scenario-learning.v1',phase:'PENDING_VERIFICATION',proposalId:evidence.proposalId,sourceResultSetId:evidence.resultSetId,sourceScenarioResultId:evidence.scenarioResultId,sourceRunId:evidence.runId,sourceTestDesignVersionId:source.id,environmentId:evidence.environmentId,responseSchemaVersionId:change.schemaRef,responseSchemaHash:proof.schemaHash,approvedByUserId:input.derivation.approvedByUserId||null,approvedAt};
          scenario.automation={...scenario.automation,evolutionState:'LEARNING'};
        }
        assertion.schemaRef=change.schemaRef;
        if(scenario.grounding){const refs=new Set(scenario.grounding.schemaRefs||[]);refs.add(change.schemaRef);scenario.grounding.schemaRefs=[...refs];}
        if(scenario.generationClass==='OBSERVED_BASELINE')try{validateObservedBaselineScenario(scenario,source);}catch(e){stop(e.code);}
        continue;
      }
      if (change.type === "TEST_DATA_BINDING") {
        const bindings = scenario?.spec?.testData?.bindings;
        if (!Array.isArray(bindings)) throw new TestRegistryError("Evolution Test Data bindings are unavailable in source version.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_NOT_FOUND", status: 409 });
        const binding = bindings[change.bindingIndex] || null;
        if (!binding) throw new TestRegistryError("Evolution Test Data binding not found in source version.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_NOT_FOUND", status: 409 });
        if (binding.target !== change.target || binding.selector !== change.selector || binding.source !== change.currentSource) {
          throw new TestRegistryError("Evolution Test Data binding identity/source mismatch.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_MISMATCH", status: 409 });
        }
        binding.valueType = change.valueType;
        binding.provenance = { origin: "RESULT_EVOLUTION" };
        if (change.source === "GENERATED") {
          binding.source = "GENERATED";
          delete binding.bindingKey;
          binding.generator = {
            ...(binding.generator || {}),
            kind: change.generatorKind,
            config: structuredClone(change.generatorConfig || {}),
          };
        } else if (change.source === "OBSERVED") {
          binding.source = "OBSERVED";
          binding.bindingKey = binding.bindingKey || `${change.target}:${change.selector}`;
          delete binding.generator;
        } else {
          throw new TestRegistryError("Evolution Test Data target source is unsupported.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_MISMATCH", status: 409 });
        }
        continue;
      }
      if (change.type === "REQUEST_BODY_FIELD_ADD") {
        if (!scenario.spec) scenario.spec = {};
        if (!scenario.spec.testData) scenario.spec.testData = { contractVersion: "qagent.test-data-bindings.v1", bindings: [] };
        const bindings = scenario.spec.testData.bindings;
        if (!Array.isArray(bindings)) throw new TestRegistryError("Evolution Test Data bindings are unavailable in source version.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_NOT_FOUND", status: 409 });
        if (bindings.some((binding) => binding?.target === "BODY" && binding?.selector === change.selector)) {
          throw new TestRegistryError("Evolution BODY field already has a Test Data binding.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_EXISTS", status: 409 });
        }
        if (change.bindingIndex !== bindings.length) {
          throw new TestRegistryError("Evolution BODY field insertion index is stale.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_INDEX_STALE", status: 409 });
        }
        bindings.push({
          target: "BODY", selector: change.selector, source: "GENERATED", valueType: change.valueType,
          generator: { kind: change.generatorKind, config: structuredClone(change.generatorConfig || {}) },
          provenance: { origin: "RESULT_EVOLUTION" },
        });
        continue;
      }
      if (change.type === "REQUEST_BODY_FIELD_REMOVE") {
        const bindings = scenario?.spec?.testData?.bindings;
        if (!Array.isArray(bindings)) throw new TestRegistryError("Evolution Test Data bindings are unavailable in source version.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_NOT_FOUND", status: 409 });
        const binding = bindings[change.bindingIndex] || null;
        if (!binding || binding.target !== "BODY" || binding.selector !== change.selector || binding.source !== "GENERATED" || change.source !== "GENERATED") {
          throw new TestRegistryError("Evolution BODY field identity/source mismatch.", { code: "TEST_REGISTRY_EVOLUTION_TEST_DATA_MISMATCH", status: 409 });
        }
        bindings.splice(change.bindingIndex, 1);
        deleteBodyPath(scenario?.spec?.request?.body, change.selector);
        continue;
      }
      const assertions = scenario?.spec?.assertions;
      if (!Array.isArray(assertions)) throw new TestRegistryError("Evolution assertions are unavailable in source version.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_NOT_FOUND", status: 409 });
      const assertion = assertions[change.assertionIndex] || null;
      if (change.type !== "ADD_JSON_PATH_EQUALS_ASSERTION" && !assertion) throw new TestRegistryError("Evolution assertion not found in source version.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_NOT_FOUND", status: 409 });
      if (change.type === "STATUS_EXPECTATION") {
        if (assertion.type !== "STATUS") throw new TestRegistryError("Evolution assertion type mismatch.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_TYPE_MISMATCH", status: 409 });
        assertion.expectedStatusCodes = [...change.expectedStatusCodes];
      } else if (change.type === "CONTENT_TYPE_EXPECTATION") {
        if (assertion.type !== "CONTENT_TYPE") throw new TestRegistryError("Evolution assertion type mismatch.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_TYPE_MISMATCH", status: 409 });
        assertion.expected = [...change.expectedContentTypes];
      } else if (change.type === "JSON_PATH_EQUALS_EXPECTATION") {
        if (assertion.type !== "JSON_PATH_EQUALS" || assertion.path !== change.path) throw new TestRegistryError("Evolution assertion type/path mismatch.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_TYPE_MISMATCH", status: 409 });
        assertion.expected = structuredClone(change.expected);
      } else if (change.type === "ADD_JSON_PATH_EQUALS_ASSERTION") {
        if (change.assertionIndex !== assertions.length) throw new TestRegistryError("Learned assertion insertion index is stale.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_INDEX_STALE", status: 409 });
        if (assertions.some((item) => item?.type === "JSON_PATH_EQUALS" && item?.path === change.path)) throw new TestRegistryError("Learned assertion already exists.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_EXISTS", status: 409 });
        assertions.push({ type: "JSON_PATH_EQUALS", path: change.path, expected: structuredClone(change.expected) });
        if (scenario.automation && scenario.automation.evolutionState === "LEARNING") {
          scenario.automation.evolutionState = "STABLE";
        }
      } else if (change.type === "SCHEMA_EXPECTATION") {
        if (assertion.type !== "SCHEMA") throw new TestRegistryError("Evolution assertion type mismatch.", { code: "TEST_REGISTRY_EVOLUTION_ASSERTION_TYPE_MISMATCH", status: 409 });
        const previousSchemaRef = assertion.schemaRef;
        assertion.schemaRef = change.schemaRef;
        if (scenario.grounding && Array.isArray(scenario.grounding.schemaRefs)) {
          const stillReferenced = (assertions || []).some((item) => item?.type === "SCHEMA" && item !== assertion && item?.schemaRef === previousSchemaRef);
          const nextRefs = scenario.grounding.schemaRefs.filter((ref) => ref !== change.schemaRef && (stillReferenced || ref !== previousSchemaRef));
          nextRefs.push(change.schemaRef);
          scenario.grounding.schemaRefs = [...new Set(nextRefs)];
        }
      }
    }

    const counts={scenarioCount:specification.scenarios.length,readyCount:0,reviewRequiredCount:0};
    const byReadiness={};
    for(const scenario of specification.scenarios){const r=scenario.automation?.readiness||'REVIEW_REQUIRED';byReadiness[r]=(byReadiness[r]||0)+1;if(r==='READY')counts.readyCount++;if(r==='REVIEW_REQUIRED')counts.reviewRequiredCount++;}
    specification.summary={...specification.summary,scenarioCount:counts.scenarioCount,readyCount:counts.readyCount,byReadiness};
    const nextVersion = root.latestVersion + 1;
    const versionId = versionIdFactory();
    const createdAt = now().toISOString();
    const origin = {
      type: "RESULT_EVOLUTION", proposalId: input.derivation.proposalId,
      sourceResultSetId: input.derivation.sourceResultSetId, sourceScenarioResultId: input.derivation.sourceScenarioResultId,
      sourceTestDesignVersionId: source.id, approvedByUserId: input.derivation.approvedByUserId || null,
      approvalReason: input.derivation.approvalReason || null,
      ...(input.derivation.proposals?{proposals:input.derivation.proposals}:{}),
    };
    const specificationJson = JSON.stringify(specification);
    const insert = db.prepare(
      `INSERT INTO test_design_versions (
         id, test_design_id, organization_id, project_id, endpoint_id, version, generation_request_id, context_fingerprint,
         contract_version, specification_version, provider, model, prompt_version, repair_prompt_version, guard_version,
         scenario_count, ready_count, review_required_count, specification_json, generation_metadata_json, safe_diagnostics_json,
         derivation_key, version_origin_json, created_at
       ) VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM test_designs WHERE id=? AND latest_version_id=? AND status='ACTIVE') THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      versionId, source.testDesignId, source.id, source.testDesignId, source.organizationId, source.projectId, source.endpointId, nextVersion,
      `evolution_${input.derivation.proposalId}`, source.contextFingerprint, source.contractVersion, source.specificationVersion,
      source.provider, source.model, source.promptVersion, source.repairPromptVersion, source.guardVersion,
      counts.scenarioCount, counts.readyCount, counts.reviewRequiredCount, specificationJson,
      JSON.stringify(source.generationMetadata), JSON.stringify(source.safeDiagnostics), derivationKey, JSON.stringify(origin), createdAt,
    );
    const projection = buildTestDesignExecutionProjection({
      specificationJson, testDesignVersionId: versionId, testDesignId: source.testDesignId, organizationId: source.organizationId,
      projectId: source.projectId, endpointId: source.endpointId, testDesignVersion: nextVersion, createdAt,
    });
    const updateRoot = db.prepare(
      `UPDATE test_designs SET latest_version = ?, latest_version_id = ?, updated_at = ? WHERE id = ? AND latest_version_id = ?`
    ).bind(nextVersion, versionId, createdAt, source.testDesignId, source.id);
    try {
      await db.batch([insert, projectionInsertStatement(db, projection), updateRoot]);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const again = await getVersionByDerivationKey(derivationKey);
        if (again) return { created: false, idempotentReplay: true, version: again };
      }
      const current=await getRootByScope(source);
      if(!current||current.latestVersionId!==source.id||current.status!=='ACTIVE')throw new TestRegistryError('Source Test Design version changed during approval.',{code:'TEST_REGISTRY_EVOLUTION_SOURCE_STALE',status:409});
      throw error;
    }
    const created = await getVersionById({ organizationId: source.organizationId, projectId: source.projectId, testDesignVersionId: versionId });
    if (!created) throw new TestRegistryError("Derived Test Design version could not be verified.", { code: "TEST_REGISTRY_EVOLUTION_VERIFY_FAILED", status: 500, retryable: true });
    return { created: true, idempotentReplay: false, version: created };
  }


  async function appendHumanRequestRepairVersion(input) {
    const derivationKey = `HUMAN_REQUEST_REPAIR:${input.repair.repairId}`;
    const replay = await getVersionByDerivationKey(derivationKey);
    if (replay) return { created: false, idempotentReplay: true, version: replay };

    const source = await getVersionById({
      organizationId: input.organizationId,
      projectId: input.projectId,
      testDesignVersionId: input.sourceTestDesignVersionId,
    });
    if (!source) throw new TestRegistryError('Source Test Design version not found.', { code: 'TEST_DESIGN_VERSION_NOT_FOUND', status: 404 });
    const root = await getRootByScope(source);
    if (!root || root.latestVersionId !== source.id) {
      throw new TestRegistryError('Source Test Design version is stale.', {
        code: 'TEST_REGISTRY_HUMAN_REPAIR_SOURCE_STALE', status: 409, retryable: false,
        details: { sourceVersionId: source.id, latestVersionId: root?.latestVersionId || null },
      });
    }

    try{assertNoProtectedBaselineChanges(source.specification,input.changes.map(c=>c.scenarioId));}
    catch(error){throw new TestRegistryError(error.message,{code:error.code,status:409});}
    const specification = structuredClone(source.specification);
    for (const change of input.changes) {
      const scenario = (specification.scenarios || []).find((item) => item?.scenarioId === change.scenarioId);
      if (!scenario) throw new TestRegistryError('Human repair scenario not found in source version.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_SCENARIO_NOT_FOUND', status: 409 });
      if (!scenario.spec) scenario.spec = {};
      if (!scenario.spec.testData) scenario.spec.testData = { contractVersion: 'qagent.test-data-bindings.v1', bindings: [] };
      if (!Array.isArray(scenario.spec.testData.bindings)) scenario.spec.testData.bindings = [];
      const bindings = scenario.spec.testData.bindings;
      if (change.type === 'SET_FIXED_TEST_DATA') {
        const binding = bindings[change.bindingIndex] || null;
        if (!binding) throw new TestRegistryError('Human repair Test Data binding not found.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_TEST_DATA_NOT_FOUND', status: 409 });
        if (binding.target !== change.target || binding.selector !== change.selector || binding.source !== change.currentSource) {
          throw new TestRegistryError('Human repair Test Data binding identity/source mismatch.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_TEST_DATA_MISMATCH', status: 409 });
        }
        if (binding.source === 'SECRET') throw new TestRegistryError('SECRET Test Data cannot be repaired with a literal.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_SECRET_FORBIDDEN', status: 409 });
        binding.source = 'FIXED';
        binding.valueType = change.valueType;
        binding.bindingKey = binding.bindingKey || `${change.target}:${change.selector}`;
        delete binding.generator;
        binding.provenance = { origin: 'USER_DEFINED' };
        continue;
      }
      if (change.type === 'ADD_FIXED_TEST_DATA') {
        if (change.bindingIndex !== bindings.length) throw new TestRegistryError('Human repair Test Data insertion index is stale.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_BINDING_INDEX_STALE', status: 409 });
        if (bindings.some((binding) => binding?.target === change.target && binding?.selector === change.selector)) {
          throw new TestRegistryError('Human repair Test Data binding already exists.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_BINDING_EXISTS', status: 409 });
        }
        bindings.push({
          target: change.target,
          selector: change.selector,
          source: 'FIXED',
          valueType: change.valueType,
          bindingKey: `${change.target}:${change.selector}`,
          provenance: { origin: 'USER_DEFINED' },
        });
        continue;
      }
      throw new TestRegistryError('Unsupported human request repair operation.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_CHANGE_UNSUPPORTED', status: 400 });
    }

    const nextVersion = root.latestVersion + 1;
    const versionId = versionIdFactory();
    const createdAt = now().toISOString();
    const origin = {
      type: 'HUMAN_REQUEST_REPAIR',
      repairId: input.repair.repairId,
      sourceResultSetId: input.repair.sourceResultSetId,
      sourceScenarioResultId: input.repair.sourceScenarioResultId,
      sourceScenarioId: input.repair.sourceScenarioId,
      sourceTestDesignVersionId: source.id,
      approvedByUserId: input.repair.approvedByUserId,
      reason: input.repair.reason,
      repairedSelectors: input.changes.map((change) => change.selector),
    };
    const specificationJson = JSON.stringify(specification);
    const insert = db.prepare(
      `INSERT INTO test_design_versions (
         id, test_design_id, organization_id, project_id, endpoint_id, version, generation_request_id, context_fingerprint,
         contract_version, specification_version, provider, model, prompt_version, repair_prompt_version, guard_version,
         scenario_count, ready_count, review_required_count, specification_json, generation_metadata_json, safe_diagnostics_json,
         derivation_key, version_origin_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      versionId, source.testDesignId, source.organizationId, source.projectId, source.endpointId, nextVersion,
      `human_repair_${input.repair.repairId}`, source.contextFingerprint, source.contractVersion, source.specificationVersion,
      source.provider, source.model, source.promptVersion, source.repairPromptVersion, source.guardVersion,
      source.scenarioCount, source.readyCount, source.reviewRequiredCount, specificationJson,
      JSON.stringify(source.generationMetadata), JSON.stringify(source.safeDiagnostics), derivationKey, JSON.stringify(origin), createdAt,
    );
    const projection = buildTestDesignExecutionProjection({
      specificationJson, testDesignVersionId: versionId, testDesignId: source.testDesignId,
      organizationId: source.organizationId, projectId: source.projectId, endpointId: source.endpointId,
      testDesignVersion: nextVersion, createdAt,
    });
    const updateRoot = db.prepare(
      `UPDATE test_designs SET latest_version = ?, latest_version_id = ?, updated_at = ? WHERE id = ? AND latest_version_id = ?`
    ).bind(nextVersion, versionId, createdAt, source.testDesignId, source.id);
    try {
      await db.batch([insert, projectionInsertStatement(db, projection), updateRoot]);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const again = await getVersionByDerivationKey(derivationKey);
        if (again) return { created: false, idempotentReplay: true, version: again };
      }
      throw error;
    }
    const created = await getVersionById({ organizationId: source.organizationId, projectId: source.projectId, testDesignVersionId: versionId });
    if (!created) throw new TestRegistryError('Human-repaired Test Design version could not be verified.', { code: 'TEST_REGISTRY_HUMAN_REPAIR_VERIFY_FAILED', status: 500, retryable: true });
    return { created: true, idempotentReplay: false, version: created };
  }

  async function appendVersion(input) {
    const expectedRootId = await buildStableTestDesignId(input);
    const existingReplay = await getVersionByGenerationRequestId(input.generationRequestId);
    if (existingReplay) {
      if (
        existingReplay.organizationId !== input.organizationId
        || existingReplay.projectId !== input.projectId
        || existingReplay.endpointId !== input.endpointId
      ) {
        throw new TestRegistryError("generationRequestId is already bound to another scope.", {
          code: "TEST_REGISTRY_IDEMPOTENCY_SCOPE_MISMATCH",
          status: 409,
        });
      }
      return { created: false, idempotentReplay: true, version: existingReplay };
    }

    const rootCreatedAt = now().toISOString();
    await db.prepare(
      `INSERT INTO test_designs (
         id, organization_id, project_id, endpoint_id, status,
         latest_version, latest_version_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'ACTIVE', 0, NULL, ?, ?)
       ON CONFLICT(organization_id, project_id, endpoint_id) DO NOTHING`,
    ).bind(
      expectedRootId,
      input.organizationId,
      input.projectId,
      input.endpointId,
      rootCreatedAt,
      rootCreatedAt,
    ).run();

    for (let attempt = 0; attempt <= maxVersionRetries; attempt += 1) {
      const root = await getRootByScope(input);
      if (!root) {
        throw new TestRegistryError("Test Design root could not be created.", {
          code: "TEST_REGISTRY_ROOT_CREATE_FAILED",
          status: 500,
          retryable: true,
        });
      }
      if (root.id !== expectedRootId) {
        throw new TestRegistryError("Test Design root identity mismatch.", {
          code: "TEST_REGISTRY_ROOT_IDENTITY_MISMATCH",
          status: 500,
          details: { expectedRootId, actualRootId: root.id },
        });
      }

      if(root.latestVersionId){
        const current=await getVersionById({organizationId:input.organizationId,projectId:input.projectId,testDesignVersionId:root.latestVersionId});
        const incoming=JSON.parse(input.specificationJson);
        for(const next of incoming.scenarios||[]){
          const predecessor=(current?.specification?.scenarios||[]).find(s=>s.scenarioId===next.scenarioId);
          if((next.baseline?.enrichment&&canonicalBaselineJson(next.baseline.enrichment)!==canonicalBaselineJson(predecessor?.baseline?.enrichment))||(next.learning&&canonicalBaselineJson(next.learning)!==canonicalBaselineJson(predecessor?.learning)))throw new TestRegistryError('Learning lineage must be created by reviewed Evolution.',{code:'LEARNING_CONTROLLED_DERIVATION_REQUIRED',status:409});
          if(!next.baseline?.revision)continue;
          const prior=(current?.specification?.scenarios||[]).find(s=>s.scenarioId===next.scenarioId&&s.generationClass==='OBSERVED_BASELINE');
          if(!prior)throw new TestRegistryError('A reviewed baseline must descend from a current protected scenario.',{code:'OBSERVED_BASELINE_REVISION_PARENT_REQUIRED',status:409});
        }
        for(const prior of current?.specification?.scenarios||[]){
          if(prior.generationClass!=='OBSERVED_BASELINE')continue;
          const successor=incoming.scenarios.find(s=>s.scenarioId===prior.scenarioId&&s.generationClass==='OBSERVED_BASELINE');
          if(!successor||((canonicalBaselineJson(successor.baseline)!==canonicalBaselineJson(prior.baseline)||canonicalBaselineJson(successor.spec.assertions)!==canonicalBaselineJson(prior.spec.assertions))&&!isApprovedBaselineRevision(prior,successor,root.latestVersionId))){
            throw new TestRegistryError('Regeneration cannot discard or silently change an observed baseline.',{code:'OBSERVED_BASELINE_PRESERVATION_REQUIRED',status:409});
          }
        }
      }
      if(!root.latestVersionId && JSON.parse(input.specificationJson).scenarios.some(s=>s.baseline?.revision||s.baseline?.enrichment||s.learning)){
        throw new TestRegistryError('A baseline revision requires an existing parent version.',{code:'OBSERVED_BASELINE_REVISION_PARENT_REQUIRED',status:409});
      }
      const nextVersion = root.latestVersion + 1;
      const versionId = versionIdFactory();
      const createdAt = now().toISOString();

      const insert = db.prepare(
        `INSERT INTO test_design_versions (
           id, test_design_id, organization_id, project_id, endpoint_id,
           version, generation_request_id, context_fingerprint,
           contract_version, specification_version,
           provider, model, prompt_version, repair_prompt_version, guard_version,
           scenario_count, ready_count, review_required_count,
           specification_json, generation_metadata_json, safe_diagnostics_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        root.id,
        input.organizationId,
        input.projectId,
        input.endpointId,
        nextVersion,
        input.generationRequestId,
        input.contextFingerprint,
        input.contractVersion,
        input.specificationVersion,
        input.provider,
        input.model,
        input.promptVersion,
        input.repairPromptVersion,
        input.guardVersion,
        input.scenarioCount,
        input.readyCount,
        input.reviewRequiredCount,
        input.specificationJson,
        input.generationMetadataJson,
        input.safeDiagnosticsJson,
        createdAt,
      );

      const executionProjection = buildTestDesignExecutionProjection({
        specificationJson: input.specificationJson,
        testDesignVersionId: versionId,
        testDesignId: root.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        endpointId: input.endpointId,
        testDesignVersion: nextVersion,
        createdAt,
      });
      const insertExecutionProjection = projectionInsertStatement(db, executionProjection);

      const updateRoot = db.prepare(
        `UPDATE test_designs
         SET latest_version = CASE WHEN latest_version < ? THEN ? ELSE latest_version END,
             latest_version_id = CASE WHEN latest_version < ? THEN ? ELSE latest_version_id END,
             updated_at = CASE WHEN latest_version < ? THEN ? ELSE updated_at END
         WHERE id = ?`,
      ).bind(
        nextVersion,
        nextVersion,
        nextVersion,
        versionId,
        nextVersion,
        createdAt,
        root.id,
      );

      try {
        await db.batch([insert, insertExecutionProjection, updateRoot]);
      } catch (error) {
        // Rolling-deploy compatibility: old schema revisions can still accept immutable
        // Test Designs before migration 0003 is applied. The projection is lazily
        // backfilled once the new table exists; this prevents a deploy-order outage.
        if (isMissingExecutionProjectionTableError(error)) {
          await db.batch([insert, updateRoot]);
        } else if (!isUniqueConstraintError(error)) {
          throw error;
        } else {
          const replay = await getVersionByGenerationRequestId(input.generationRequestId);
          if (replay) {
            if (
              replay.organizationId !== input.organizationId
              || replay.projectId !== input.projectId
              || replay.endpointId !== input.endpointId
            ) {
              throw new TestRegistryError("generationRequestId is already bound to another scope.", {
                code: "TEST_REGISTRY_IDEMPOTENCY_SCOPE_MISMATCH",
                status: 409,
              });
            }
            return { created: false, idempotentReplay: true, version: replay };
          }

          if (attempt < maxVersionRetries) continue;
          throw new TestRegistryError("Could not allocate immutable Test Design version after retries.", {
            code: "TEST_REGISTRY_VERSION_CONFLICT",
            status: 409,
            retryable: true,
            details: { attempts: maxVersionRetries + 1 },
          });
        }

      }

      const created = await getExactVersion({
        organizationId: input.organizationId,
        projectId: input.projectId,
        testDesignId: root.id,
        version: nextVersion,
      });
      if (!created || created.id !== versionId) {
        throw new TestRegistryError("Persisted Test Design version could not be verified.", {
          code: "TEST_REGISTRY_VERSION_VERIFY_FAILED",
          status: 500,
          retryable: true,
        });
      }

      return { created: true, idempotentReplay: false, version: created };
    }

    throw new TestRegistryError("Version allocation failed.", {
      code: "TEST_REGISTRY_VERSION_CONFLICT",
      status: 409,
      retryable: true,
    });
  }

  return {
    appendVersion,
    getLatest,
    getExactVersion,
    getVersionById,
    getRootByScope,
    getVersionByGenerationRequestId,
    getVersionByDerivationKey,
    appendDerivedVersion,
    appendHumanRequestRepairVersion,
  };
}

export { isUniqueConstraintError };

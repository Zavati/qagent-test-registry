import { TestRegistryError } from "../domain/errors.js";
import { buildStableTestDesignId, createTestDesignVersionId } from "../domain/ids.js";

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
        await db.batch([insert, updateRoot]);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

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
    getRootByScope,
    getVersionByGenerationRequestId,
  };
}

export { isUniqueConstraintError };

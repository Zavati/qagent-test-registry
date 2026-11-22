import { TestRegistryError } from '../domain/errors.js';
import { canonicalUiJson, uiContentHash, uiSha256, uiByteLength } from '../domain/uiTestDesignCanonical.js';
import { validateUiAppendInput, validateUiCompilation } from '../validation/uiTestDesignVersion.js';

const scopeValues = scope => [scope.organizationId, scope.projectId, scope.environmentId];
const scopeWhere = 'organization_id=? AND project_id=? AND environment_id=?';
function conflict() {
  throw new TestRegistryError('UI generationRequestId is already bound to different content or provenance.', {
    code: 'UI_TEST_DESIGN_IDEMPOTENCY_CONFLICT', status: 409,
  });
}
function storageFailure() {
  throw new TestRegistryError('UI Test Design integrity could not be verified.', { code: 'UI_TEST_DESIGN_STORAGE_INTEGRITY_FAILED', status: 500, retryable: false });
}
function summaryRecord(row) {
  return {
    testDesignId: row.test_design_id, testDesignVersionId: row.id, version: row.version,
    contentHash: row.content_hash, domain: 'UI', source: JSON.parse(row.source_json),
    summary: JSON.parse(row.summary_json), createdAt: row.created_at,
  };
}
function cursorEncode(value) { return btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function cursorDecode(value) {
  try {
    if (typeof value !== 'string' || value.length > 600 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(standard + '='.repeat((4 - standard.length % 4) % 4)));
  } catch {
    throw new TestRegistryError('UI list cursor is invalid.', { code: 'UI_TEST_DESIGN_CURSOR_INVALID', status: 400 });
  }
}

export function createUiTestDesignRepository(db, { now = () => new Date() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TestRegistryError('Test Registry storage is not configured.', { code: 'UI_TEST_REGISTRY_STORAGE_UNAVAILABLE', status: 503, retryable: true });
  const operation = (scope, requestId) => db.prepare(`SELECT * FROM ui_test_design_operations WHERE ${scopeWhere} AND generation_request_id=?`).bind(...scopeValues(scope), requestId).first();
  const exactRow = (scope, versionId) => db.prepare(`SELECT * FROM ui_test_design_versions WHERE ${scopeWhere} AND id=?`).bind(...scopeValues(scope), versionId).first();

  async function verifyRow(row, scope) {
    try {
      if (await uiSha256(row.compilation_json) !== row.compilation_hash) storageFailure();
      const compilation = JSON.parse(row.compilation_json);
      await validateUiCompilation(compilation, scope);
      if (compilation.specificationHash !== row.content_hash || compilation.source.captureId !== row.capture_id
        || compilation.source.bundleVersionId !== row.bundle_version_id
        || canonicalUiJson(compilation.source) !== row.source_json || canonicalUiJson(compilation.summary) !== row.summary_json) storageFailure();
      return { ...summaryRecord(row), compilation, executionPerformed: false };
    } catch (error) {
      if (error instanceof TestRegistryError && error.code === 'UI_TEST_DESIGN_STORAGE_INTEGRITY_FAILED') throw error;
      storageFailure();
    }
  }

  async function getExact(scope, versionId) {
    const row = await exactRow(scope, versionId);
    return row ? verifyRow(row, scope) : null;
  }

  async function appendVersion(rawInput) {
    const input = await validateUiAppendInput(rawInput);
    const { scope, compilation, generationRequestId, contentHash, compilationHash, requestHash } = input;
    const source = compilation.source;
    const testDesignId = 'uitd_' + await uiContentHash({ domain: 'UI', scope, captureId: source.captureId });
    const testDesignVersionId = 'uitdv_' + await uiContentHash({ domain: 'UI', scope, captureId: source.captureId, contentHash });

    async function reconcile(existing) {
      if (existing.content_hash !== contentHash || existing.compilation_hash !== compilationHash || existing.request_hash !== requestHash
        || existing.test_design_version_id !== testDesignVersionId) conflict();
      const stored = await getExact(scope, existing.test_design_version_id);
      if (!stored || stored.testDesignId !== testDesignId) storageFailure();
      return { status: 'reused', testDesignId, testDesignVersionId, version: stored.version, contentHash, domain: 'UI' };
    }

    const previous = await operation(scope, generationRequestId);
    if (previous) return reconcile(previous);
    const existingVersion = await exactRow(scope, testDesignVersionId);
    if (existingVersion && existingVersion.compilation_hash !== compilationHash) conflict();
    const createdAt = now().toISOString();
    let results;
    try {
      // D1 batch is transactional. In particular, a racing operation-key conflict
      // rolls back a candidate version instead of leaving a published orphan.
      results = await db.batch([
        db.prepare(`INSERT INTO ui_test_designs (id,organization_id,project_id,environment_id,capture_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
          .bind(testDesignId, ...scopeValues(scope), source.captureId, createdAt, createdAt),
        db.prepare(`INSERT INTO ui_test_design_versions (id,test_design_id,organization_id,project_id,environment_id,capture_id,bundle_version_id,
          version,content_hash,compilation_hash,compiler_version,source_json,summary_json,compilation_json,created_at)
          SELECT ?,?,?,?,?,?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,?,?
          FROM ui_test_design_versions WHERE test_design_id=? ON CONFLICT(id) DO NOTHING`)
          .bind(testDesignVersionId, testDesignId, ...scopeValues(scope), source.captureId, source.bundleVersionId,
            contentHash, compilationHash, compilation.compilerVersion, canonicalUiJson(source), canonicalUiJson(compilation.summary), input.compilationJson, createdAt, testDesignId),
        db.prepare(`INSERT INTO ui_test_design_operations (organization_id,project_id,environment_id,generation_request_id,
          test_design_version_id,content_hash,compilation_hash,request_hash,created_by,created_by_account_id,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
            SELECT 1 FROM ui_test_design_versions WHERE id=? AND content_hash=? AND compilation_hash=?)`)
          .bind(...scopeValues(scope), generationRequestId, testDesignVersionId, contentHash, compilationHash, requestHash,
            input.createdBy, input.createdByAccountId, createdAt, testDesignVersionId, contentHash, compilationHash),
        db.prepare(`UPDATE ui_test_designs SET
          latest_version=(SELECT version FROM ui_test_design_versions WHERE id=?),latest_version_id=?,updated_at=?
          WHERE id=? AND latest_version < (SELECT version FROM ui_test_design_versions WHERE id=?)`)
          .bind(testDesignVersionId, testDesignVersionId, createdAt, testDesignId, testDesignVersionId),
      ]);
    } catch (error) {
      // Also reconcile a committed batch whose transport acknowledgement was lost.
      const committed = await operation(scope, generationRequestId);
      if (committed) return reconcile(committed);
      throw error;
    }
    if (!results[2]?.meta?.changes) conflict();
    const stored = await getExact(scope, testDesignVersionId);
    if (!stored || stored.testDesignId !== testDesignId || stored.contentHash !== contentHash) storageFailure();
    return { status: results[1]?.meta?.changes ? 'persisted' : 'reused', testDesignId, testDesignVersionId,
      version: stored.version, contentHash, domain: 'UI' };
  }

  async function listVersions(scope, { cursor = '', limit = 20 } = {}) {
    const scopeHash = await uiContentHash(scope);
    let snapshot, before;
    if (cursor) {
      const decoded = cursorDecode(cursor);
      if (!decoded || Object.keys(decoded).sort().join(',') !== 'before,scopeHash,snapshot,v' || decoded.v !== 1 || decoded.scopeHash !== scopeHash
        || !Number.isSafeInteger(decoded.snapshot) || decoded.snapshot < 0
        || !Number.isSafeInteger(decoded.before) || decoded.before < 1 || decoded.before > decoded.snapshot + 1) {
        throw new TestRegistryError('UI list cursor is invalid for this scope.', { code: 'UI_TEST_DESIGN_CURSOR_INVALID', status: 400 });
      }
      ({ snapshot, before } = decoded);
    } else {
      snapshot = (await db.prepare(`SELECT COALESCE(MAX(sequence),0) AS last_sequence FROM ui_test_design_versions WHERE ${scopeWhere}`).bind(...scopeValues(scope)).first()).last_sequence;
      before = snapshot + 1;
    }
    const rows = await db.prepare(`SELECT sequence,id,test_design_id,version,content_hash,source_json,summary_json,created_at
      FROM ui_test_design_versions WHERE ${scopeWhere} AND sequence<=? AND sequence<? ORDER BY sequence DESC LIMIT ?`)
      .bind(...scopeValues(scope), snapshot, before, limit + 1).all();
    const all = rows.results || [], selected = [], items = [];
    let bytes = 0;
    for (const row of all.slice(0, limit)) {
      const item = summaryRecord(row), size = uiByteLength(canonicalUiJson(item));
      if (bytes + size > 512 * 1024) break;
      selected.push(row); items.push(item); bytes += size;
    }
    return { domain: 'UI', scope, items, nextCursor: all.length > selected.length
      ? cursorEncode({ v: 1, scopeHash, snapshot, before: selected.at(-1).sequence }) : null };
  }

  return { appendVersion, getExact, listVersions };
}

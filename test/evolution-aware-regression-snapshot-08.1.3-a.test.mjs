import { applyCurrentMigrations } from './helpers/currentMigrations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { handleRequest } from '../src/index.js';
import { appendPayload, sampleSpecification } from './fixtures.mjs';
import { SQLiteD1 } from './helpers/sqliteD1.mjs';

const migrations = [1,2,3,4,5].map((n) => {
  const names = {
    1: '0001_test_registry_foundation.sql',
    2: '0002_foundation_07_7_10_a_suite_definition.sql',
    3: '0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql',
    4: '0004_foundation_07_7_10_b_suite_execution_items.sql',
    5: '0005_foundation_07_8_a_result_evolution_provenance.sql',
  };
  return fs.readFileSync(new URL(`../migrations/${names[n]}`, import.meta.url), 'utf8');
});

function headers() {
  return {
    'content-type': 'application/json',
    'x-qagent-organization-id': 'org_test',
    'x-qagent-project-id': 'prj_test',
  };
}
function env(db) { return { ENVIRONMENT: 'test', TEST_REGISTRY_DB: db }; }

async function appendInitial(db) {
  const specification = sampleSpecification({ endpointId: 'cep_snapshot', contextFingerprint: 'a'.repeat(64) });
  specification.scenarios[0].spec.target.method = 'GET';
  specification.scenarios[0].automation.readiness = 'READY';
  specification.scenarios[0].automation.blockers = [];
  const payload = appendPayload({
    endpointId: 'cep_snapshot',
    generationRequestId: 'tdg_snapshot_0001',
    contextFingerprint: 'a'.repeat(64),
    specification,
  });
  const response = await handleRequest(new Request('https://registry.internal/v1/test-registry/test-designs/versions', {
    method: 'POST', headers: headers(), body: JSON.stringify(payload),
  }), env(db));
  assert.equal(response.status, 201);
  return (await response.json()).data.testDesign;
}

test('08.1.3-A marks immutable regression snapshot OUTDATED when latest Test Design was derived by Evolution', async () => {
  const db = new SQLiteD1();
  applyCurrentMigrations(db);
  
  try {
    const initial = await appendInitial(db);
    const materializedResponse = await handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize?view=compact', {
      method: 'POST', headers: headers(),
    }), env(db));
    assert.equal(materializedResponse.status, 201);
    const materialized = (await materializedResponse.json()).data;
    const suiteV1 = materialized.version.suiteVersionId;

    const before = (await (await handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/latest?view=compact&snapshot=1', { headers: headers() }), env(db))).json()).data;
    assert.equal(before.snapshot.state, 'CURRENT');
    assert.equal(before.snapshot.evolvedTestDesignCount, 0);

    const derivedPayload = {
      organizationId: 'org_test',
      projectId: 'prj_test',
      sourceTestDesignVersionId: initial.versionId,
      derivation: {
        type: 'RESULT_EVOLUTION',
        proposalId: 'tep_snapshot_1234567890',
        sourceResultSetId: 'rset_snapshot_1',
        sourceScenarioResultId: 'sres_snapshot_1',
        approvedByUserId: null,
        approvalReason: 'QAgent AUTO_SAFE deterministic repair',
      },
      changes: [{ type: 'STATUS_EXPECTATION', scenarioId: 'test_001', assertionIndex: 0, expectedStatusCodes: [200, 204] }],
    };
    const derivedResponse = await handleRequest(new Request('https://registry.internal/internal/v1/test-registry/test-designs/derived-versions', {
      method: 'POST', headers: headers(), body: JSON.stringify(derivedPayload),
    }), env(db));
    assert.equal(derivedResponse.status, 201);
    const derived = (await derivedResponse.json()).data.testDesign;
    assert.equal(derived.version, 2);

    const outdated = (await (await handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/latest?view=compact&snapshot=1', { headers: headers() }), env(db))).json()).data;
    assert.equal(outdated.exists, true);
    assert.equal(outdated.version.suiteVersionId, suiteV1, 'immutable Suite version must not mutate in place');
    assert.equal(outdated.snapshot.state, 'OUTDATED');
    assert.equal(outdated.snapshot.outdatedReason, 'TEST_DESIGN_EVOLVED');
    assert.equal(outdated.snapshot.changedTestDesignCount, 1);
    assert.equal(outdated.snapshot.evolvedTestDesignCount, 1);
    assert.equal(outdated.snapshot.versionChangedTestDesignCount, 0);
    assert.equal(outdated.snapshot.changes.length, 1);
    assert.equal(outdated.snapshot.changes[0].changeType, 'TEST_DESIGN_EVOLVED');
    assert.equal(outdated.snapshot.changes[0].from.testDesignVersionId, initial.versionId);
    assert.equal(outdated.snapshot.changes[0].from.testDesignVersion, 1);
    assert.equal(outdated.snapshot.changes[0].to.testDesignVersionId, derived.versionId);
    assert.equal(outdated.snapshot.changes[0].to.testDesignVersion, 2);
    assert.equal(outdated.snapshot.changes[0].evolution.proposalId, 'tep_snapshot_1234567890');

    const refreshedResponse = await handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/materialize?view=compact', {
      method: 'POST', headers: headers(),
    }), env(db));
    assert.equal(refreshedResponse.status, 201);
    const refreshed = (await refreshedResponse.json()).data;
    assert.equal(refreshed.version.version, 2);
    assert.notEqual(refreshed.version.suiteVersionId, suiteV1);
    assert.equal(refreshed.inventory.selection[0]?.testDesignVersionId, undefined, 'compact materialization intentionally omits selection');

    const after = (await (await handleRequest(new Request('https://registry.internal/v1/test-registry/projects/prj_test/suites/auto-ready/latest?view=compact&snapshot=1', { headers: headers() }), env(db))).json()).data;
    assert.equal(after.snapshot.state, 'CURRENT');
    assert.equal(after.version.suiteVersionId, refreshed.version.suiteVersionId);

    const oldSlice = (await (await handleRequest(new Request(`https://registry.internal/v1/test-registry/projects/prj_test/suite-versions/${suiteV1}/execution-slice?offset=0&limit=10`, { headers: headers() }), env(db))).json()).data;
    assert.equal(oldSlice.items[0].testDesignVersionId, initial.versionId, 'historical Suite snapshot must remain pinned to v1');
  } finally {
    db.close();
  }
});

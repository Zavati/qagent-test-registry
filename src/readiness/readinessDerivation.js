import { buildPendingDerivedReadiness } from './readinessReconciliation.js';
import { ScenarioReadinessError } from './readinessIssues.js';
import { projectLegacyReadiness } from './scenarioReadinessV2.js';
import { validateScenarioReadinessAttachment } from './scenarioReadinessV2.js';
import { validateReadinessAgainstScenario } from './scenarioReadinessFacts.js';
import { TestRegistryError } from '../domain/errors.js';
/** Phase-A bridge for EXISTING v1 writers. Never alter a persisted parent.
 * Invalidate only touched copies after existing proof validation. The read adapter
 * supplies a virtual LEGACY_PROJECTION; evidence promotion is deliberately not added.
 */
export function invalidateDerivedReadiness(specification, scenarioIds) {
  const ids = new Set(scenarioIds);
  for (const scenario of specification.scenarios || []) if (ids.has(scenario.scenarioId)) delete scenario.readinessV2;
}
export function validateReadinessAttachments(specification, { generation = false } = {}) {
  try {
    for (const [index, scenario] of (specification.scenarios || []).entries()) {
      if (scenario.readinessV2 && scenario.readinessV2.evaluationScope !== 'TEST_DESIGN_ONLY') throw new ScenarioReadinessError(`specification.scenarios[${index}].readinessV2.evaluationScope`);
      const options = { path: `specification.scenarios[${index}]`, generation };
      // Rename must not recompute semantics from a changed display title.
      if (generation) validateReadinessAgainstScenario(scenario, options);
      else validateScenarioReadinessAttachment(scenario, options);
    }
  } catch (error) {
    if (error?.name !== 'ScenarioReadinessError') throw error;
    throw new TestRegistryError('Invalid structured scenario readiness.', {
      code: error.code, status: 400, path: error.path,
    });
  }
}

/** C is selected by a persisted, internal approval-plan marker, not the flag at retry time. */
export function reconcileDerivedReadiness(specification, sourceSpecification, changes) {
  const ids = new Set(changes.map(c => c.scenarioId));
  for (const next of specification.scenarios || []) {
    if (!ids.has(next.scenarioId)) continue;
    const source = sourceSpecification.scenarios.find(s => s.scenarioId === next.scenarioId);
    const readiness = buildPendingDerivedReadiness(source, next, {
      coverageExtension: changes.some(c => c.scenarioId === next.scenarioId && c.type === 'ASSERTION_COVERAGE_EXTENSION'),
    });
    if (!readiness) { delete next.readinessV2; continue; } // protected baseline stays on its existing path
    next.readinessV2 = readiness;
    next.automation = { ...next.automation, readiness: projectLegacyReadiness(readiness) };
  }
}

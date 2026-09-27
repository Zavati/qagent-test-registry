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

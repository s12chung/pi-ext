/**
 * The planning phase state machine: explore until the plan is submitted,
 * approval while the approval menu is owed. PlanningMode (mode.ts) stores
 * the current phase and advances it; state.ts resolves the menu.
 */

export abstract class PlanningPhaseState {
  // Both phases advance identically: the submitted plan is owed its menu -
  // a refined plan re-enters approval with the new plan
  public submitPlan(plan: string): PlanningPhaseState {
    return new ApprovePhase(plan)
  }
}

export class ExplorePhase extends PlanningPhaseState {}

// Exists only while the menu is owed: promptPlanApproval rejects it back to
// explore when the menu opens
export class ApprovePhase extends PlanningPhaseState {
  public readonly plan: string

  public constructor(plan: string) {
    super()
    this.plan = plan
  }
}

export function isApprovePhase(phase: PlanningPhaseState): phase is ApprovePhase {
  return phase instanceof ApprovePhase
}

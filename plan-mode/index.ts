/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis. Planning is
 * soft-enforced: the reminder directs the agent to leave the workspace
 * unchanged, and there are no code-level tool locks, so the prompt's ONLY
 * exception - experiments mutating inside a temporary folder - stays
 * possible.
 *
 * Features:
 * - /plan command to toggle
 * - Read-only planning through the plan-mode reminder (soft enforcement)
 * - plan_complete is always available but described for plan-mode use only,
 *   and it refuses to stage outside planning; questionnaire is general-purpose
 * - Plan submitted via plan_complete as free-flow markdown (format-validated)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 * - Cache-stable toggles: the tool set is reconciled once per session and the
 *   mode prompt rides as a request-local reminder (session/reminder.ts), so a
 *   toggle never rewrites the provider request prefix
 *
 * The mode objects (mode.ts) own the UI and the approval menu; reminder.ts
 * places the mode prompt; entry.ts is the persisted session entry - its typed
 * shape and the restore of the live mode objects; decode.ts turns persisted
 * session entries into typed shapes - the only module that sees their unknown
 * payloads. This module is the wiring: commands, events, and session lifecycle.
 */

import type {
  AgentSettledEvent,
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent"
import {
  DefaultMode,
  type Mode,
  completionTool,
  promptPlanApproval,
  startFreshHandoff,
} from "./mode.ts"
import { decodedState } from "./session/decode.ts"
import { PLAN_MODE_ENTRY_TYPE, restoreMode } from "./session/entry.ts"
import { applyReminders } from "./session/reminder.ts"
import { questionnaireTool } from "./tools/questionnaire.ts"
import { debugLog } from "./utils/debug.ts"
import { reconcileToolSet } from "./utils/tool-set.ts"

// The mutable state the registration helpers share: the live mode, the exit
// flag the reminder reads, and the freshest command context
interface PlanModeExtensionState {
  mode: Mode
  justExitedPlan: boolean
  latestCommandContext: ExtensionCommandContext | undefined
}

function enterNextMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PlanModeExtensionState,
): void {
  state.justExitedPlan = state.mode.isPlanning()
  state.mode = state.mode.next()
  state.mode.enter(ctx)
  ctx.ui.notify(state.mode.enterNotice)
  pi.appendEntry(PLAN_MODE_ENTRY_TYPE, state.mode.toState())
}

export default function planModeExtension(pi: ExtensionAPI): void {
  const state: PlanModeExtensionState = {
    mode: new DefaultMode(),
    justExitedPlan: false,
    latestCommandContext: undefined,
  }

  pi.registerTool(questionnaireTool())
  pi.registerTool(
    completionTool((plan: string): void => {
      const mode = state.mode
      if (!mode.isPlanning())
        throw new Error("plan_complete is only available while plan mode is active")
      mode.plan = plan
      pi.appendEntry(PLAN_MODE_ENTRY_TYPE, mode.toState())
    }),
  )
  pi.registerCommand("plan", planCommand(pi, state))

  registerAgentEventHandlers(pi, state)
  registerSessionHandlers(pi, state)
}

// only via. a command, we can store the ctx, so no hotkeys or `--plan flags
function planCommand(
  pi: ExtensionAPI,
  state: PlanModeExtensionState,
): Omit<RegisteredCommand, "name" | "sourceInfo"> {
  return {
    description:
      "Toggle plan mode (read-only exploration); /plan exec starts a fresh implementation session",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) throw new Error("Plan mode does not work without dialog capable UI")

      state.latestCommandContext = ctx

      const plan = state.mode.getPlan()
      if (args.trim() === "exec") {
        if (!plan) {
          ctx.ui.notify("No completed plan to execute. Complete a plan in plan mode first.", "info")
          return
        }
        debugLog("/plan startFreshHandoff")
        await startFreshHandoff(ctx, ctx, plan)
        return
      }
      if (plan) {
        debugLog("/plan promptPlanApproval")
        // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (/plan showCurrent)
        if (await promptPlanApproval(ctx, ctx, plan)) enterNextMode(pi, ctx, state)
        return
      }
      debugLog("/plan enterMode")
      enterNextMode(pi, ctx, state)
    },
  }
}

function registerAgentEventHandlers(pi: ExtensionAPI, state: PlanModeExtensionState): void {
  // Deliberately no tool_call gate: blocking edit/write while planning would
  // contradict the reminder's ONLY exception (experiments may mutate inside a
  // temporary folder), and blocking the helpers outside planning would make
  // the loadout mode-dependent again.
  pi.on("context", (event: ContextEvent): ContextEventResult | undefined => {
    const messages = applyReminders(state.mode, state.justExitedPlan, event.messages)
    return messages && { messages }
  })

  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
  pi.on(
    "agent_settled",
    async (_event: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
      const plan = state.mode.getPlan()
      if (!ctx.hasUI || !plan) return
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return

      debugLog("agent_settled menu", { idle: true, pending: ctx.hasPendingMessages() })
      const exit = await promptPlanApproval(ctx, state.latestCommandContext, plan)
      if (exit) enterNextMode(pi, ctx, state)
    },
  )
}

function registerSessionHandlers(pi: ExtensionAPI, state: PlanModeExtensionState): void {
  // Runs before dispose() invalidates this instance's contexts: drop the
  // captured command context so nothing fires on a stale ctx afterwards
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (session_shutdown)
  pi.on("session_shutdown", (): void => {
    debugLog("session_shutdown")
    state.latestCommandContext = undefined
  })

  // Runs on session replacement too (newSession/fork/switch): saved state is
  // authoritative so the replaced session's mode/plan cannot leak.
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext): void => {
    debugLog("session_start", { reason: event.reason })
    state.latestCommandContext = undefined
    state.justExitedPlan = false
    state.mode = restoreMode(decodedState(ctx.sessionManager.getEntries()))
    state.mode.enter(ctx)

    // opencode hides the plan_exit tool per agent (permission-denied out
    // of the request in build mode), so every plan<->build switch reshapes
    // the tools array - the first block of the provider cache prefix (tools
    // -> system -> messages) - all cache breakpoints miss, and the full
    // transcript is re-read and re-written at input price.
    // Source: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src
    // (agent/agent.ts, session/llm/request.ts, provider/transform.ts)
    pi.setActiveTools(reconcileToolSet(pi.getActiveTools()))
  })
}

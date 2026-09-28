/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command to toggle
 * - Bash kept read-only through the plan-mode prompt (soft enforcement)
 * - Plan-only tools (questionnaire, plan_complete) active only while planning
 * - Plan submitted via plan_complete as free-flow markdown (format-validated)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 *
 * The mode objects (mode.ts) own the tool set, UI, event behavior, and the
 * approval menu; entry.ts is the persisted session entry - its typed shape
 * and the restore of the live mode objects; decode.ts turns persisted
 * session entries into typed shapes - the only module that sees their
 * unknown payloads. This module is the wiring: commands, events, and session
 * lifecycle.
 */

import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
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
import { safeSetSection } from "./session/prompt.ts"
import { questionnaireTool } from "./tools/questionnaire.ts"
import { debugLog } from "./utils/debug.ts"

// The mutable state the registration helpers share: the live mode and the
// freshest command context
interface PlanModeExtensionState {
  mode: Mode
  latestCommandContext: ExtensionCommandContext | undefined
}

function enterNextMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PlanModeExtensionState,
): void {
  state.mode = state.mode.next()
  state.mode.enter(pi, ctx)
  ctx.ui.notify(state.mode.enterNotice)
  pi.appendEntry(PLAN_MODE_ENTRY_TYPE, state.mode.toState())
}

export default function planModeExtension(pi: ExtensionAPI): void {
  const state: PlanModeExtensionState = {
    mode: new DefaultMode(),
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
  // Install the mode's system-prompt section for the upcoming run; pi diffs
  // it in on the first planning run and out on the next default run
  pi.on("before_agent_start", (event: BeforeAgentStartEvent, _ctx: ExtensionContext): void => {
    safeSetSection(state.mode.systemPrompt(), event.systemPromptOptions.sections)
  })

  // Present the approval menu once the agent truly settles - not between a
  // turn end and delivery of still-queued follow-up messages, which would
  // stack a second menu behind the first
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

  // Restore state on session start/resume from session memory (appendEntry).
  // Runs on session replacement too (newSession/fork/switch): saved state is
  // authoritative so the replaced session's mode/plan cannot leak.
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext): void => {
    debugLog("session_start", { reason: event.reason })
    state.latestCommandContext = undefined
    state.mode = restoreMode(decodedState(ctx.sessionManager.getEntries()))
    state.mode.enter(pi, ctx)
  })
}

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
 * and the save/restore of the live mode objects; decode.ts turns persisted
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
import { decodeSession } from "./session/decode.ts"
import { restoreMode, saveMode } from "./session/entry.ts"
import { safeSetSection } from "./session/prompt.ts"
import { questionnaireTool } from "./tools/questionnaire.ts"
import { debugLog } from "./utils/debug.ts"

// The mutable state the registration helpers share: the live mode and the
// freshest command context
interface PlanModeExtensionState {
  mode: Mode
  latestCommandContext: ExtensionCommandContext | undefined
}

export default function planModeExtension(pi: ExtensionAPI): void {
  const state: PlanModeExtensionState = {
    mode: new DefaultMode(),
    latestCommandContext: undefined,
  }

  // Questionnaire visibility is toggled by the required-helpers block in
  // utils.ts (plan-mode only)
  pi.registerTool(questionnaireTool())
  pi.registerTool(completionTool(() => state.mode))
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
      state.latestCommandContext = ctx
      if (args.trim() === "exec") {
        const mode = state.mode
        if (!mode.isPlanning() || mode.plan === undefined) {
          ctx.ui.notify("No completed plan to execute. Complete a plan in plan mode first.", "info")
          return
        }
        const plan = mode.plan
        mode.unstagePlan()
        await startFreshHandoff(pi, ctx, ctx, mode, plan)
        return
      }
      // With a completed plan, bare /plan reopens the approval menu instead of
      // toggling the plan away (the picker's exit choice is the way out)
      // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (/plan showCurrent)
      if (state.mode.isPlanning() && state.mode.plan && ctx.hasUI) {
        debugLog("/plan reopen")
        state.mode = await promptPlanApproval(pi, ctx, ctx, state.mode)
        return
      }
      state.mode = saveMode(pi, ctx, state.mode.next())
    },
  }
}

function registerAgentEventHandlers(pi: ExtensionAPI, state: PlanModeExtensionState): void {
  // Install the mode's system-prompt section for the upcoming run; pi diffs
  // it in on the first planning run and out on the next default run
  pi.on("before_agent_start", (event: BeforeAgentStartEvent, _ctx: ExtensionContext): void => {
    safeSetSection(state.mode.systemPrompt(), event.systemPromptOptions.sections)
  })

  pi.on("agent_end", (): void => state.mode.onAgentEnd(pi))

  // Present the approval menu once the agent truly settles - not between a
  // turn end and delivery of still-queued follow-up messages, which would
  // stack a second menu behind the first
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
  pi.on(
    "agent_settled",
    async (_event: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
      if (!ctx.hasUI || !state.mode.shouldPromptApproval()) return
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return
      debugLog("agent_settled menu", { idle: true, pending: ctx.hasPendingMessages() })
      state.mode = await promptPlanApproval(pi, ctx, state.latestCommandContext, state.mode)
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
    state.mode = restoreMode(decodeSession(ctx.sessionManager.getEntries()))
    state.mode.enter(pi, ctx, { notify: false })
  })
}

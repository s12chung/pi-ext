/**
 * Plan Mode Extension
 *
 * Read-only exploration mode, toggled by /plan: the agent explores and
 * produces a decision-ready plan before any file changes. Enforcement is
 * the mode reminder (no tool locks), which also keeps toggles cache-stable:
 * it rides a system-prompt section installed once when planning begins
 * and never removed (session/prompt.ts), and the tool set never changes,
 * so toggling never breaks the cached request prefix. On approval, the plan hands off
 * to a fresh session, leaving the planning transcript behind. This module
 * is the wiring: commands, events, and session lifecycle.
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
import { PROMPTS, loadPrompts } from "./config.ts"
import {
  DefaultMode,
  type Mode,
  completionTool,
  promptPlanApproval,
  startFreshHandoff,
} from "./mode.ts"
import { decodedMode, endedOnPlanCompletion } from "./session/decode.ts"
import { appendEntry, restoreMode } from "./session/entry.ts"
import { applyModelInfo } from "./session/fresh-implementation.ts"
import {
  safeSetSection,
  sectionInstalled,
  sendEndedNote,
  sendReenteredNote,
} from "./session/prompt.ts"
import { questionnaireTool } from "./tools/questionnaire.ts"
import { debugLog } from "./utils/debug.ts"
import { reconcileToolSet } from "./utils/tool-set.ts"

interface PlanModeExtensionState {
  mode: Mode
  /** pi's per-request sections record, re-captured each before_agent_start; undefined until this session's first request */
  sections: Record<string, string> | undefined
  latestCommandContext: ExtensionCommandContext | undefined
  configWarning: string | undefined
}

function enterNextMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PlanModeExtensionState,
): void {
  const wasPlanning = state.mode.isPlanning()
  state.mode = state.mode.next()
  state.mode.enter(ctx)
  ctx.ui.notify(state.mode.enterNotice)
  appendEntry(pi, state.mode.toEntry())

  const installed = sectionInstalled(state.sections)
  if (wasPlanning && installed) {
    sendEndedNote(pi)
  } else if (installed) {
    sendReenteredNote(pi)
  }
}

export default function planModeExtension(pi: ExtensionAPI): void {
  // The one load: overlays plan-mode.json onto the PROMPTS the tools and
  // the mode section import; /reload re-runs this factory, so edits apply
  const { prompts, warning } = loadPrompts()
  Object.assign(PROMPTS, prompts)

  const state: PlanModeExtensionState = {
    mode: new DefaultMode(),
    sections: undefined,
    latestCommandContext: undefined,
    configWarning: warning,
  }

  pi.registerTool(questionnaireTool())
  pi.registerTool(
    completionTool((plan: string): void => {
      const mode = state.mode
      if (!mode.isPlanning())
        throw new Error("plan_complete is only available while plan mode is active")
      mode.plan = plan
      appendEntry(pi, mode.toEntry())
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
    description: PROMPTS.planCommandDescription,
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
  pi.on(
    "before_agent_start",
    async (event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<void> => {
      state.sections = event.systemPromptOptions.sections
      safeSetSection(state.mode.systemPrompt(), state.sections)
      // applyModelInfo here because this session's pi is not accessible in ctx.newSession
      await applyModelInfo(pi, ctx)
    },
  )

  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
  pi.on(
    "agent_settled",
    async (_event: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
      const plan = state.mode.getPlan()
      if (!ctx.hasUI || !plan) return
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return
      if (!endedOnPlanCompletion(ctx.sessionManager.getBranch())) return

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

  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext): void => {
    debugLog("session_start", { reason: event.reason })
    state.latestCommandContext = undefined

    // The load-time config warning surfaces once, on the first start
    if (state.configWarning) {
      ctx.ui.notify(state.configWarning, "warning")
      state.configWarning = undefined
    }

    state.mode = restoreMode(decodedMode(ctx.sessionManager.getEntries()))
    state.sections = undefined
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

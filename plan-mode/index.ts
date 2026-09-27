/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Plan-only tools (questionnaire, plan_complete) active only while planning
 * - Plan submitted via plan_complete as free-flow markdown (format-validated)
 * - Plan stored in session memory (appendEntry) - no files, no drift
 *
 * The mode objects (mode.ts) own the tool set, UI, and event behavior;
 * state.ts swaps them, resolves the approval menu, and persists them;
 * decode.ts turns persisted session entries into typed state - the only
 * module that sees their unknown payloads. This module is the wiring:
 * commands, events, and session lifecycle.
 */

import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent"
import { DefaultMode, completionTool, isDefaultMode, isPlanningMode } from "./mode.ts"
import { decodeSession } from "./session/decode.ts"
import {
  type ModeSlot,
  presentApproval,
  promptPlanApproval,
  restoreMode,
  setMode,
} from "./session/state.ts"
import { questionnaireTool } from "./tools/questionnaire.ts"
import { debugLog } from "./utils/debug.ts"

// The mutable state the registration helpers share: the live mode with its
// session-replacement counter, the freshest command context, and the
// deferred-refresh flag
interface PlanModeExtensionState {
  modeSlot: ModeSlot
  latestCommandContext: ExtensionCommandContext | undefined
  refreshStateBeforeFirstAgentStart: boolean
}

export default function planModeExtension(pi: ExtensionAPI): void {
  const state: PlanModeExtensionState = {
    modeSlot: { mode: new DefaultMode(), rev: 0 },
    latestCommandContext: undefined,
    refreshStateBeforeFirstAgentStart: false,
  }

  // Questionnaire visibility is toggled by the required-helpers block in
  // utils.ts (plan-mode only)
  pi.registerTool(questionnaireTool())
  pi.registerTool(completionTool(() => state.modeSlot.mode))
  pi.registerCommand("plan", planCommand(pi, state))

  registerAgentEventHandlers(pi, state)
  registerSessionHandlers(pi, state)
}

function planCommand(
  pi: ExtensionAPI,
  state: PlanModeExtensionState,
): Omit<RegisteredCommand, "name" | "sourceInfo"> {
  return {
    // pi grants newSession() (and fork/switch/reload) only to command-handler
    // contexts - it creates them solely when executing an extension command and
    // inside withSession (runner.js createCommandContext has no other callers).
    // Events, tools, and shortcuts can therefore never start a session, which is
    // why /plan is the only plan-mode entry point and the fresh handoff below
    // bounces through it when the captured context is missing.
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => {
      state.latestCommandContext = ctx
      // With a completed plan, bare /plan reopens the approval menu instead of
      // toggling the plan away (the picker's exit choice is the way out)
      // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (/plan showCurrent)
      if (isPlanningMode(state.modeSlot.mode) && state.modeSlot.mode.plan && ctx.hasUI) {
        debugLog("/plan reopen")
        await promptPlanApproval(pi, ctx, ctx, state.modeSlot)
        return
      }
      setMode(pi, ctx, state.modeSlot, state.modeSlot.mode.next())
    },
  }
}

function registerAgentEventHandlers(pi: ExtensionAPI, state: PlanModeExtensionState): void {
  // pi's CustomToolCallEvent types custom-tool inputs as Record<string, unknown>
  // and its broad toolName survives the bash check in the union, so the
  // command is vetted rather than cast
  pi.on("tool_call", (event: ToolCallEvent): ToolCallEventResult | undefined => {
    if (event.toolName !== "bash") return
    const { command } = event.input
    return typeof command === "string" ? state.modeSlot.mode.bashBlockReason(command) : undefined
  })

  pi.on("context", (event: ContextEvent): ContextEventResult => ({
    messages: state.modeSlot.mode.filterContext(event.messages),
  }))

  // Inject plan/execution context before agent starts
  pi.on(
    "before_agent_start",
    (
      _event: BeforeAgentStartEvent,
      ctx: ExtensionContext,
    ): BeforeAgentStartEventResult | undefined => {
      refreshStateForFirstPrompt(state, ctx)
      const message = state.modeSlot.mode.agentStartMessage()
      return message ? { message } : undefined
    },
  )

  pi.on("agent_end", (): void => state.modeSlot.mode.onAgentEnd(pi))

  // Present the approval menu once the agent truly settles - not between a
  // turn end and delivery of still-queued follow-up messages, which would
  // stack a second menu behind the first
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (agent_settled)
  pi.on(
    "agent_settled",
    async (_event: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
      if (!ctx.hasUI || !state.modeSlot.mode.shouldPromptApproval()) return
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return
      debugLog("agent_settled menu", { idle: true, pending: ctx.hasPendingMessages() })
      await presentApproval(pi, ctx, state.latestCommandContext, state.modeSlot)
    },
  )
}

function registerSessionHandlers(pi: ExtensionAPI, state: PlanModeExtensionState): void {
  // Runs before dispose() invalidates this instance's contexts: retire the
  // deferred status refreshes and editor re-checks so nothing fires on a
  // stale ctx afterwards
  // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (session_shutdown)
  pi.on("session_shutdown", (): void => {
    debugLog("session_shutdown")
    state.latestCommandContext = undefined
    state.modeSlot.rev += 1
    state.refreshStateBeforeFirstAgentStart = false
  })

  // Restore state on session start/resume from session memory (appendEntry).
  // Runs on session replacement too (newSession/fork/switch): saved state is
  // authoritative so the replaced session's mode/plan cannot leak.
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext): void => {
    debugLog("session_start", { reason: event.reason })
    state.latestCommandContext = undefined
    state.modeSlot.rev += 1
    // A fresh session receives its handed-off plan entry via newSession's
    // setup callback, after session_start, so the restore below misses it
    // Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateBeforeFirstAgentStart)
    state.refreshStateBeforeFirstAgentStart = event.reason === "new"
    state.modeSlot.mode = restoreMode(decodeSession(ctx.sessionManager.getEntries()))
    state.modeSlot.mode.enter(pi, ctx, { notify: false })
  })
}

// Picks up the handed-off plan that newSession's setup appended after the
// fresh session's session_start had already restored state
// Source: https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/plan-mode.ts (refreshStateForFirstPrompt)
function refreshStateForFirstPrompt(state: PlanModeExtensionState, ctx: ExtensionContext): void {
  if (!state.refreshStateBeforeFirstAgentStart) return
  state.refreshStateBeforeFirstAgentStart = false
  state.modeSlot.mode = restoreMode(decodeSession(ctx.sessionManager.getEntries()))
  const restoredPlan = isPlanningMode(state.modeSlot.mode)
    ? state.modeSlot.mode.plan
    : isDefaultMode(state.modeSlot.mode)
      ? state.modeSlot.mode.activePlan
      : undefined
  debugLog("refreshStateForFirstPrompt", { restoredPlan: restoredPlan !== undefined })
}

/**
 * The persisted plan-mode session entry: its typed shape (ModeEntry), the
 * append of it into the session and the find of it among session entries (the
 * only module naming the custom entry type), and the restore of the live mode
 * objects from it (restoreMode). Restores consume decode.ts's typed view of
 * the persisted entries; the unknown payloads never leave that boundary.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import type { ExtensionAPI, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent"
import { DefaultMode, type Mode, PlanningMode } from "../mode.ts"

export interface ModeEntry {
  mode: "default" | "planning"
  plan?: string
  modelInfo?: ModelInfo
}

export interface ModelInfo {
  model: { provider: string; id: string }
  thinkingLevel?: ThinkingLevel
}

const PLAN_MODE_ENTRY_TYPE = "plan-mode"

// The write path: callers persist a state without naming the custom entry type
export function appendEntry(pi: ExtensionAPI, modeEntry: ModeEntry): void {
  pi.appendEntry(PLAN_MODE_ENTRY_TYPE, modeEntry)
}

// The write path into a session under construction: newSession hands its
// session manager to setup before any extension instance of that session
// exists, so the handoff persists through the manager directly
export function appendEntryTo(sessionManager: SessionManager, modeEntry: ModeEntry): void {
  sessionManager.appendCustomEntry(PLAN_MODE_ENTRY_TYPE, modeEntry)
}

// The read path: the newest plan-mode entry, undefined when none persists
export function getEntry(entries: SessionEntry[]): SessionEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY_TYPE) return entry
  }
  return undefined
}

// Source (adapted: latestPlan/activeImplementation plan strings → mode objects):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/state.ts
export function restoreMode(state: ModeEntry | undefined): Mode {
  if (state?.mode !== "planning") return new DefaultMode()
  const planning = new PlanningMode()
  // The menu is owed again after restore: it re-opens on the next settle
  planning.plan = state.plan
  return planning
}

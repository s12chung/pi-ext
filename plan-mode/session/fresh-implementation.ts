/**
 * Fresh-session execution: start a brand-new session whose kickoff prompt
 * embeds the approved plan - the planning transcript stays behind in the
 * parent session.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { bestEffort, safeErrorDetail } from "../utils/safe.ts"

type NewSessionOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>
// pi exports ExtensionCommandContext but not the replacement callback's context
type ReplacementContext = Parameters<NonNullable<NewSessionOptions["withSession"]>>[0]

// Kickoff text: narumiruna's formatTransferredPlanPrompt body with bacnh85's
// fresh-session prefix; the plan is appended after a blank line
// https://github.com/bacnh85/pi-extensions/blob/main/pi-plan/extensions/index.ts (buildExecutionPrompt)
const HANDOFF_PREFIX = `This is a fresh session created from an approved plan. A previous agent produced the markdown plan below to accomplish the user's task. Implement the plan in this fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\n`

// Shown when the kickoff landed and the fresh session's first turn is running
const KICKOFF_STARTED_NOTICE =
  "Fresh implementation session started. Only the approved plan was transferred."

// Source (adapted: model preflight, retention, and runtime selection dropped):
// https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/src/fresh-implementation.ts (startFreshImplementationSession)
export async function startFreshImplementation(
  ctx: ExtensionCommandContext,
  plan: string,
): Promise<void> {
  await ctx.waitForIdle()

  try {
    // The fresh session starts empty (newSession records parentSession for
    // lineage only - no entries are copied), and the kickoff below carries
    // the plan, so no state entry is appended here: nothing in a default
    // session reads a persisted plan.
    const { cancelled } = await ctx.newSession({
      parentSession: ctx.sessionManager.getSessionFile(),
      withSession: (replacementCtx) => kickoffReplacement(replacementCtx, plan),
    })
    if (cancelled) {
      bestEffort(() =>
        ctx.ui.notify("Fresh implementation cancelled. The plan remains available.", "info"),
      )
    }
  } catch (error: unknown) {
    // ctx may already be stale: the replacement applies before withSession runs
    bestEffort(() =>
      ctx.ui.notify(
        `Unable to start a fresh implementation session: ${safeErrorDetail(error)}. The plan remains available; retry or resume the planning session.`,
        "error",
      ),
    )
  }
}

// The withSession callback, running on the live replacement context. pi
// awaits it before reporting the handoff, so a failed kickoff recovers into
// the editor instead of throwing into the replacement path.
async function kickoffReplacement(ctx: ReplacementContext, plan: string): Promise<void> {
  const handoff = `${HANDOFF_PREFIX}${plan}`
  try {
    await ctx.sendUserMessage(handoff)
  } catch (error: unknown) {
    // The fresh session exists but implementation never started - hand the
    // plan back through the editor rather than losing it
    const detail = safeErrorDetail(error)
    const recoveredInEditor = bestEffort(() => ctx.ui.setEditorText(handoff))
    bestEffort(() =>
      ctx.ui.notify(
        recoveredInEditor
          ? `Fresh session created, but implementation did not start: ${detail}. The implementation request is in the editor; submit it or resume the parent planning session.`
          : `Fresh session created, but implementation did not start: ${detail}. The implementation request could not be restored to the editor; resume the parent planning session.`,
        "error",
      ),
    )
    return
  }
  bestEffort(() => ctx.ui.notify(KICKOFF_STARTED_NOTICE, "info"))
}

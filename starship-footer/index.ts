/**
 * Starship Footer Extension - replaces pi's footer, and only the footer, with
 * zentui's starship status line for one fixed setup (no configuration, no
 * format templates, no compact reflow). This module is the wiring only: it
 * collects pi's live data into a FooterSource on each render and installs the
 * component from render.ts, following pi's custom-footer example -
 * session_start installs, branch changes re-render, everything else is read
 * live.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent"
import { type FooterSource, renderFooter } from "./render.ts"

export default function starshipFooter(pi: ExtensionAPI): void {
  // Installed per session so the captured ctx never goes stale across session
  // replacement (new/fork/switch all fire session_start)
  pi.on("session_start", (_event, ctx) => installFooter(pi, ctx))
}

function collectFooterSource(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
): FooterSource {
  return {
    cwd: ctx.cwd,
    sessionName: ctx.sessionManager.getSessionName(),
    branch: footerData.getGitBranch() ?? undefined,
    model: ctx.model,
    contextUsage: ctx.getContextUsage(),
    entries: ctx.sessionManager.getEntries(),
    thinkingLevel: pi.getThinkingLevel(),
    statuses: footerData.getExtensionStatuses(),
  }
}

function installFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return
  ctx.ui.setFooter((tui, theme, footerData) => {
    // Branch switches are the only change pi does not re-render for; usage,
    // model, context, thinking level, and statuses are read live at each render
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender())
    return {
      dispose: unsubscribe,
      invalidate(): void {},
      render: (width: number): string[] =>
        renderFooter(width, theme, collectFooterSource(pi, ctx, footerData)),
    }
  })
}

/**
 * Starship Footer Extension - replaces pi's footer, and only the footer, with
 * zentui's starship status line for one fixed setup (no configuration, no
 * format templates, no compact reflow). This module is the wiring and the
 * composition: it collects pi's live data and decodes it through
 * utils/decoder.ts into state.ts's FooterSource, assembles the row's sides
 * and separator through the part builders and color.ts, and hands them to
 * ui/render.ts's layout, following pi's custom-footer example - session_start
 * installs, branch changes re-render, everything else is read live.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent"
import { type FooterSource, footerPartBuilders } from "./state.ts"
import { type ThemeLike, footerSeparator } from "./ui/color.ts"
import { type FooterRowParts, joinSegments, renderFooterRow } from "./ui/render.ts"
import {
  decodeContextSnapshot,
  decodeModelInfo,
  decodeSessionCost,
  decodeThinkingLevel,
} from "./utils/decoder.ts"

export default function starshipFooter(pi: ExtensionAPI): void {
  // Installed per session so the captured ctx never goes stale across session
  // replacement (new/fork/switch all fire session_start)
  pi.on("session_start", (_event, ctx) => installFooter(pi, ctx))
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
        renderFooterRow(width, footerParts(theme, collectFooterSource(pi, ctx, footerData))),
    }
  })
}

// pi's live data, decoded into the footer's vetted state: the model and
// thinking level come off the session, the cost sums over the entries, and
// the context snapshot prefers the model's window
function collectFooterSource(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
): FooterSource {
  const model = decodeModelInfo(ctx.model)
  return {
    cwd: ctx.cwd,
    sessionName: ctx.sessionManager.getSessionName(),
    branch: footerData.getGitBranch() ?? undefined,
    model,
    contextUsage: decodeContextSnapshot(ctx.getContextUsage(), model.contextWindow),
    cost: decodeSessionCost(ctx.sessionManager.getEntries()),
    thinkingLevel: decodeThinkingLevel(pi.getThinkingLevel()),
    statuses: footerData.getExtensionStatuses(),
  }
}

// The footer's sides, separator, and statuses, assembled through state.ts's
// per-field part builders in display order: the model and thinking level form
// the editor-style metadata group, and ui/render.ts owns the joining
export function footerParts(theme: ThemeLike, source: FooterSource): FooterRowParts {
  const { cwd, sessionName, branch, model, thinkingLevel, contextUsage, cost, statuses } =
    footerPartBuilders
  return {
    left: [cwd(theme, source), sessionName(theme, source), branch(theme, source)],
    right: [
      joinSegments([model(theme, source), thinkingLevel(theme, source)]),
      contextUsage(theme, source),
      cost(theme, source),
    ],
    separator: footerSeparator(theme),
    statuses: statuses(theme, source),
  }
}

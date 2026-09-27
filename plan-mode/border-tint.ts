import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { EditorComponent } from "@earendil-works/pi-tui"

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>

// Our wrap marks itself, so the modes' enter() can re-run ensureBorderTint
// without stacking another wrap
const PLAN_BORDER_OWNER = Symbol.for("pi-plan-mode.editor-owner")

type MarkedFactory = EditorFactory & { [PLAN_BORDER_OWNER]?: true }

// The only live state: flipped by the modes on enter, read by the installed
// wrap at render time
let planActive = false

export function setPlanBorderActive(active: boolean): void {
  planActive = active
}

// Idempotent: installs (not replaces) the editor wrap, so the modes' enter()
// and session_start can both call it freely
export function ensureBorderTint(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return
  const base = ctx.ui.getEditorComponent()
  // Once our marked factory owns the slot, the check doubles as the idempotency guard
  if (base !== undefined && PLAN_BORDER_OWNER in base) return
  // Wrap (not replace) whatever editor is installed; stock pi falls back to a
  // tinted CustomEditor. ctx.ui.theme is a live getter over the global theme,
  // so the captured closure re-resolves role colors at render time and
  // survives theme switches
  const factory = ((tui, theme, keybindings): EditorComponent =>
    tintPlanBorders(
      base ? base(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings),
      () => planActive,
      (text) => ctx.ui.theme.fg("mdHeading", text),
    )) as MarkedFactory
  factory[PLAN_BORDER_OWNER] = true
  ctx.ui.setEditorComponent(factory)
}

export interface BorderColoredEditor {
  // Optional to match pi's EditorComponent, whose borderColor starts unassigned
  borderColor?: (text: string) => string
}

/**
 * While active, an editor's border color reads as the plan color over heavy
 * rails; while inactive it reads as whatever pi assigned. pi reassigns
 * borderColor outright on thinking level and bash mode changes, so the
 * accessor keeps that assignment in stock and restores it whenever no
 * override applies. The accessor is instance-level, so prototypes stay
 * untouched and wrappers that forward borderColor compose transparently.
 */
export function tintPlanBorders<T extends BorderColoredEditor>(
  editor: T,
  isActive: () => boolean,
  planColor: (text: string) => string,
): T {
  let stock = editor.borderColor
  Object.defineProperty(editor, "borderColor", {
    get: () =>
      isActive() ? (text: string): string => planColor(text.replaceAll("─", "━")) : stock,
    set: (next) => {
      stock = next
    },
  })
  return editor
}

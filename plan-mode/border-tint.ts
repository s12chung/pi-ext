import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { EditorComponent } from "@earendil-works/pi-tui"

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>

// Zen marks its editor factory with a registered symbol for cross-extension ownership checks
const ZENTUI_EDITOR_OWNER = Symbol.for("pi-zentui.editor-owner")
// Our wrap marks itself the same way, so the session_start re-checks and the
// modes' enter() can re-run ensureBorderTint without stacking another wrap
const PLAN_BORDER_OWNER = Symbol.for("pi-plan-mode.editor-owner")

type MarkedFactory = EditorFactory & { [PLAN_BORDER_OWNER]?: true }

// The only live state: flipped by the modes on enter, read by the installed
// wrap at render time
let planActive = false

export function setPlanBorderActive(active: boolean): void {
  planActive = active
}

// Idempotent: installs (not replaces) the editor wrap, so the modes' enter()
// and the session_start re-checks can both call it freely
export function ensureBorderTint(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return
  const base = ctx.ui.getEditorComponent()
  // Once our marked factory owns the slot, zen's mark on it is hidden - the
  // check doubles as the idempotency guard
  if (base !== undefined && PLAN_BORDER_OWNER in base) return
  // Zen's static border resolves the borderMuted role (zen style.ts
  // EDITOR_BORDER_FALLBACK), so under adaptive mode the idle border emulates
  // that instead of pi's thinking-level colors - idle stays zen-gray, planning
  // turns the same lines orange heavy-weight, all live
  const idle =
    base !== undefined && ZENTUI_EDITOR_OWNER in base
      ? (text: string): string => ctx.ui.theme.fg("borderMuted", text)
      : undefined
  // Wrap (not replace) whatever editor is installed - theme UIs like zentui
  // render model/thinking in the border and keep working through the
  // forwarded borderColor; stock pi falls back to a tinted CustomEditor.
  // ctx.ui.theme is a live getter over the global theme, so the captured
  // closures re-resolve role colors at render time and survive theme switches
  const factory = ((tui, theme, keybindings): EditorComponent =>
    tintPlanBorders(
      base ? base(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings),
      () => planActive,
      (text) => ctx.ui.theme.fg("mdHeading", text),
      idle,
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
 * rails; while inactive it reads as the idle color when one was given, otherwise
 * whatever pi or a theme UI assigned. pi reassigns borderColor outright on
 * thinking level and bash mode changes, so the accessor keeps that assignment
 * in stock and restores it whenever no override applies. The accessor is
 * instance-level, so prototypes stay untouched and wrappers that forward
 * borderColor (e.g. zentui's editor around ours, or ours around zentui's)
 * compose transparently.
 */
export function tintPlanBorders<T extends BorderColoredEditor>(
  editor: T,
  isActive: () => boolean,
  planColor: (text: string) => string,
  idleColor?: (text: string) => string,
): T {
  let stock = editor.borderColor
  Object.defineProperty(editor, "borderColor", {
    get: () =>
      isActive()
        ? (text: string): string => planColor(text.replaceAll("─", "━"))
        : (idleColor ?? stock),
    set: (next) => {
      stock = next
    },
  })
  return editor
}

import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

// Zen marks its editor factory with a registered symbol for cross-extension ownership checks
const ZENTUI_EDITOR_OWNER = Symbol.for("pi-zentui.editor-owner");

// Rebound by the extension from the live theme (ctx.ui.theme is a getter over
// the global theme), so role colors survive theme switches.
let colorize: (text: string) => string = (text) => text;
// When set, drives the border while plan mode is OFF - used to keep a theme UI's
// static look under adaptive mode instead of pi's thinking-level colors.
let idleColorize: ((text: string) => string) | undefined;
// The tint state the modes flip on enter; the installed wrap reads it live
let planActive = false;
let installedFactory: EditorFactory | undefined;
let zenEditorDetected = false;

export function setPlanBorderColor(fn: (text: string) => string): void {
	colorize = fn;
}

export function setIdleBorderColor(fn: ((text: string) => string) | undefined): void {
	idleColorize = fn;
}

export function setPlanBorderActive(active: boolean): void {
	planActive = active;
}

// Read at wrap time: once our unmarked factory owns the slot, zen's mark on it is hidden
function isZentuiFactory(factory: EditorFactory | undefined): boolean {
	return (factory as Record<PropertyKey, unknown> | undefined)?.[ZENTUI_EDITOR_OWNER] !== undefined;
}

// Idempotent: applies the plan/idle border colors and installs (not replaces)
// the editor wrap, so the modes' enter() and the session_start re-checks can
// both call it freely
export function ensureBorderTint(ctx: ExtensionContext): void {
	// Live theme getter: the role resolves at render time, so theme switches apply
	setPlanBorderColor((text) => ctx.ui.theme.fg("mdHeading", text));
	// Wrap (not replace) whatever editor is installed - theme UIs like zentui
	// render model/thinking in the border and keep working through the
	// forwarded borderColor; stock pi falls back to a tinted CustomEditor
	if (ctx.hasUI && ctx.ui.getEditorComponent() !== installedFactory) {
		const base = ctx.ui.getEditorComponent();
		zenEditorDetected = isZentuiFactory(base);
		const factory: EditorFactory = (tui, theme, keybindings) =>
			tintPlanBorders(
				base ? base(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings),
				() => planActive,
			);
		installedFactory = factory;
		ctx.ui.setEditorComponent(factory);
	}
	// Zen's static border resolves the borderMuted role (zen style.ts
	// EDITOR_BORDER_FALLBACK), so under adaptive mode the idle border emulates
	// that instead of pi's thinking-level colors - idle stays zen-gray, planning
	// turns the same lines orange heavy-weight, all live
	setIdleBorderColor(zenEditorDetected ? (text) => ctx.ui.theme.fg("borderMuted", text) : undefined);
}

function planBorder(text: string): string {
	return colorize(text.replaceAll("─", "━"));
}

export interface BorderColoredEditor {
	// Optional to match pi's EditorComponent, whose borderColor starts unassigned
	borderColor?: (text: string) => string;
}

/**
 * While active, an editor's border color reads as the plan color over heavy
 * rails; while inactive it reads as the idle color when one was set, otherwise
 * whatever pi or a theme UI assigned. pi reassigns borderColor outright on
 * thinking level and bash mode changes, so the accessor keeps that assignment
 * in stock and restores it whenever no override applies. The accessor is
 * instance-level, so prototypes stay untouched and wrappers that forward
 * borderColor (e.g. zentui's editor around ours, or ours around zentui's)
 * compose transparently.
 */
export function tintPlanBorders<T extends BorderColoredEditor>(editor: T, isActive: () => boolean): T {
	let stock = editor.borderColor;
	Object.defineProperty(editor, "borderColor", {
		get: () => (isActive() ? planBorder : idleColorize ?? stock),
		set: (next) => {
			stock = next;
		},
	});
	return editor;
}

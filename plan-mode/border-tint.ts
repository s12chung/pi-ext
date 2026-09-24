// Rebound by the extension from the live theme (ctx.ui.theme is a getter over
// the global theme), so role colors survive theme switches.
let colorize: (text: string) => string = (text) => text;
// When set, drives the border while plan mode is OFF - used to keep a theme UI's
// static look under adaptive mode instead of pi's thinking-level colors.
let idleColorize: ((text: string) => string) | undefined;

export function setPlanBorderColor(fn: (text: string) => string): void {
	colorize = fn;
}

export function setIdleBorderColor(fn: ((text: string) => string) | undefined): void {
	idleColorize = fn;
}

function planBorder(text: string): string {
	return colorize(text.replaceAll("─", "━"));
}

export interface BorderColoredEditor {
	borderColor: (text: string) => string;
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

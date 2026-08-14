/**
 * Opening things without leaving the desktop.
 *
 * Every link out of the board — edit this task, edit this project, look at the
 * post a task was made from — used to be `target="_blank"`, which inside
 * OpenStation is simply wrong. The user is *in* a desktop; throwing them into a
 * browser tab loses the desk, the dock, every other open window, and the drag
 * bridge that is the whole reason the board is a native window. It is the
 * desktop equivalent of an app answering a click by minimising itself.
 *
 * So a click routes through `windowManager.open()` instead, which the shell
 * already treats as the canonical way to open an admin URL. Two things come
 * free with that:
 *
 *   - **Reuse.** Opening a second task's editor navigates the existing editor
 *     window in place rather than stacking a third window on the desk.
 *   - **Identity.** `deriveWindowId()` produces the same id the dock would, so
 *     a window opened from a card *is* the window the dock item addresses —
 *     clicking Posts in the dock afterwards focuses it rather than opening a
 *     rival copy.
 *
 * With no shell — the plain admin page — a new tab is the correct answer and
 * the anchor's own `href` handles it untouched.
 */

import { getShell } from './api';

/**
 * Opens an admin URL as a window, if there is a desktop to open it on.
 *
 * @param url   Admin URL.
 * @param title Window title, used when a new window is created.
 * @param icon  Dashicons class for the title bar.
 * @return True when the shell handled it and the caller should not navigate.
 */
export function openInShell( url: string, title: string, icon = 'dashicons-admin-post' ): boolean {
	const shell = getShell();

	if ( ! url || ! shell?.windowManager?.open || ! shell.deriveWindowId ) {
		return false;
	}

	try {
		const id = shell.deriveWindowId( url );

		// `baseId` as well as `id`: it is what the shell matches on to decide
		// "this window already exists", and omitting it opens a second window
		// for a URL the user already has on screen.
		void shell.windowManager.open( { id, baseId: id, url, title, icon } );

		return true;
	} catch {
		// A shell that changed the config shape underneath us is not worth
		// taking the click down with. Fall through and let the anchor navigate.
		return false;
	}
}

/**
 * Makes an anchor open a desktop window instead of a tab.
 *
 * The element stays a real `<a href>` on purpose. Screen readers announce it as
 * a link, the status bar previews the target, and — the part an onclick-only
 * button always breaks — ⌘/Ctrl-click, middle-click and "Open in new tab" keep
 * working for the person who genuinely wanted a tab. Only a plain left click is
 * intercepted.
 *
 * @param anchor The link.
 * @param title  Window title for the window it opens.
 * @param icon   Dashicons class.
 */
export function routeLinkIntoShell( anchor: HTMLAnchorElement, title: string, icon?: string ): void {
	anchor.addEventListener( 'click', ( event ) => {
		// Anything but a plain primary click means the user asked for the
		// browser's own behaviour. Honour it.
		if ( event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) {
			return;
		}

		if ( openInShell( anchor.href, title, icon ) ) {
			event.preventDefault();
		}
	} );

	// A card starts a drag on pointerdown; without this a press on the link
	// lifts the card instead of following the link.
	anchor.addEventListener( 'pointerdown', ( event ) => event.stopPropagation() );
}

/**
 * Opens a URL the way the current host should — window, or tab.
 *
 * For callers with no anchor to hang behaviour off, such as a card's
 * keyboard-activation handler.
 *
 * @param url   Admin URL.
 * @param title Window title.
 * @param icon  Dashicons class.
 */
export function openUrl( url: string, title: string, icon?: string ): void {
	if ( ! url ) {
		return;
	}

	if ( openInShell( url, title, icon ) ) {
		return;
	}

	window.open( url, '_blank', 'noopener' );
}

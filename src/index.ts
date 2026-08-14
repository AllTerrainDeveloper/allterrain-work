/**
 * Board bundle entry.
 *
 * One bundle, three hosts, and the whole job of this file is to work out which
 * one it woke up in:
 *
 *   - **A native OpenStation window.** The shell calls the render callback we
 *     hang on `window.openStationNativeWindows['allterrain-work']`, hands it the
 *     window body (already populated with the PHP template's markup), and keeps
 *     whatever we return as the teardown for when the window closes.
 *   - **The standalone admin page.** No shell to call us, so we find the root in
 *     the DOM and mount ourselves once it is ready.
 *   - **A chromeless iframe.** The admin page again, rendered inside a shell
 *     window. Identical to the case above — `admin-page.php` emits the same
 *     markup either way.
 *
 * Registering the callback and self-mounting are not mutually exclusive, and
 * that is on purpose: the guard is "did I already mount into this element",
 * not "which host am I". A host that does both gets one board.
 */

import { mountBoard, type Teardown } from './board';

/** Marks a root as mounted, so a second boot path is a no-op rather than a duplicate. */
const MOUNTED = 'atworkMounted';

type RenderCallback = ( body: HTMLElement ) => Teardown;

/** Mounts into a root unless it already holds a board. */
function mountOnce( root: HTMLElement ): Teardown {
	if ( root.dataset[ MOUNTED ] === '1' ) {
		return () => undefined;
	}

	root.dataset[ MOUNTED ] = '1';

	const teardown = mountBoard( root );

	return () => {
		delete root.dataset[ MOUNTED ];
		teardown();
	};
}

/**
 * Registers the native-window render callback.
 *
 * The shell reads this bag when the window opens. Declaring it unconditionally
 * costs nothing on a page with no shell — nobody ever looks at it.
 */
function registerNativeWindow(): void {
	const w = window as unknown as {
		openStationNativeWindows?: Record< string, RenderCallback >;
	};

	w.openStationNativeWindows = w.openStationNativeWindows ?? {};
	w.openStationNativeWindows[ 'allterrain-work' ] = ( body: HTMLElement ) => {
		// The shell cloned the PHP template in before calling us, so the root
		// is already there with its toolbar and board slots. Falling back to
		// the body itself covers a shell build that skipped the clone.
		const root = body.querySelector< HTMLElement >( '[data-atwork-root]' ) ?? body;

		return mountOnce( root );
	};
}

/** Mounts into any board root already sitting in the page. */
function mountInPage(): void {
	document
		.querySelectorAll< HTMLElement >( '[data-atwork-root][data-host="admin"]' )
		.forEach( ( root ) => mountOnce( root ) );
}

/**
 * Opens the native window when the shell was asked to.
 *
 * `?atwork_open=1` is what `atwork_redirect_board_page_into_the_shell()` sends
 * an old board bookmark to. The board page does not exist inside the shell, so
 * without this the redirect would land the user on a bare desktop and leave
 * them to find the app themselves.
 */
function openWindowIfRequested(): void {
	if ( ! new URLSearchParams( window.location.search ).has( 'atwork_open' ) ) {
		return;
	}

	type Shell = {
		openWindow?: ( id: string, o?: unknown ) => boolean;
		isReady?: () => boolean;
	};

	const open = () => {
		const os = ( window as unknown as { wp?: { os?: Shell } } ).wp?.os;

		os?.openWindow?.( 'allterrain-work', { source: 'bookmark' } );
	};

	// `os-init` rather than the shell's `ready` callback: `ready` fires as soon
	// as the window manager exists, which is before the desktop has opened
	// anything at all, and a window opened then is immediately buried by the
	// session restore that follows.
	//
	// The desktop may still open its own default window after this and land it
	// on top. Deliberately not fought: winning that race means re-grabbing focus
	// on a timer or on every window event, and a plugin that keeps yanking a
	// window forward while the user is trying to click something else is a worse
	// bug than a board that opened one layer down. It is open, and it is on the
	// dock.
	if ( ( window as unknown as { wp?: { os?: Shell } } ).wp?.os?.isReady?.() ) {
		open();

		return;
	}

	document.addEventListener( 'os-init', open, { once: true } );
}

/**
 * Makes the Explorer's "Open the work board" button do something.
 *
 * The PHP descriptor puts the button in the preview pane; the click is wired
 * here, because the shell keeps server-declared *appearance* and client-side
 * *behaviour* on separate sides of the wire. A descriptor without a handler
 * renders a button that does nothing, which is worse than no button.
 *
 * Registered unconditionally: `wp.hooks` exists wherever the shell does, and on
 * a page without one this is a no-op nobody pays for.
 */
function registerExplorerAction(): void {
	const hooks = ( window as unknown as {
		wp?: { hooks?: { addFilter?: ( hook: string, ns: string, cb: unknown ) => void } };
	} ).wp?.hooks;

	if ( ! hooks?.addFilter ) {
		return;
	}

	// `onSelect`, not `onClick` — the renderer reads that key, and an action
	// without it is dropped rather than rendered inert. Costly to discover and
	// cheap to get wrong: the button simply never appears.
	hooks.addFilter(
		'os.my-wordpress.preview-actions',
		'allterrain-work/open-board',
		( actions: Array< Record< string, unknown > > ) =>
			actions.map( ( action ) =>
				action.id === 'allterrain-work/open-board'
					? {
							...action,
							onSelect: () => {
								const os = ( window as unknown as {
									wp?: { os?: { openWindow?: ( id: string, o?: unknown ) => boolean } };
								} ).wp?.os;

								os?.openWindow?.( 'allterrain-work', { source: 'wp-explorer' } );
							},
					  }
					: action
			)
	);
}

registerNativeWindow();
registerExplorerAction();
openWindowIfRequested();

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', mountInPage, { once: true } );
} else {
	mountInPage();
}

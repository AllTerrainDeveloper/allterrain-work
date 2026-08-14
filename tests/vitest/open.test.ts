/**
 * Opening things without leaving the desktop.
 *
 * The bug these pin: every link out of the board used to be
 * `target="_blank"`, which inside OpenStation throws the user into a browser
 * tab and loses them the desk, the dock, every other window, and the drag
 * bridge. A desktop app answering a click by minimising itself.
 *
 * The subtle half is the *other* direction — a fix that swallows every click
 * breaks ⌘-click, middle-click and "Open in new tab" for the person who
 * genuinely wanted a tab. Both halves are tested.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openInShell, openUrl, routeLinkIntoShell } from '../../src/open';

/** Calls captured by the fake `windowManager.open`. */
let opened: Array< Record< string, unknown > >;

/** Installs a shell with a window manager. */
function withShell( overrides: Record< string, unknown > = {} ): void {
	( window as unknown as { wp: unknown } ).wp = {
		os: {
			deriveWindowId: ( url: string ) => 'derived-' + url.replace( /\W+/g, '-' ),
			windowManager: {
				open: ( config: Record< string, unknown > ) => {
					opened.push( config );
				},
			},
			...overrides,
		},
	};
}

/** Removes the shell entirely — the plain admin page. */
function withoutShell(): void {
	delete ( window as unknown as { wp?: unknown } ).wp;
}

function anchor( href: string ): HTMLAnchorElement {
	const a = document.createElement( 'a' );
	a.href = href;
	document.body.appendChild( a );

	return a;
}

/** A click the browser would treat as "just follow the link". */
function plainClick(): MouseEvent {
	return new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } );
}

/**
 * Dispatches a click and reports whether *our* handler intercepted it.
 *
 * Read from a listener on the link itself, registered after
 * `routeLinkIntoShell` so it runs immediately after our handler and sees its
 * decision. The document-level listener then stops jsdom trying to perform the
 * navigation a real browser would — which is the correct outcome, and which
 * jsdom can only report by throwing "Not implemented" across the test output.
 */
function clickAndReportInterception( link: HTMLAnchorElement, event: MouseEvent ): boolean {
	let intercepted = false;

	link.addEventListener( 'click', ( e ) => {
		intercepted = e.defaultPrevented;
	} );

	const swallow = ( e: Event ) => e.preventDefault();
	document.addEventListener( 'click', swallow );

	link.dispatchEvent( event );

	document.removeEventListener( 'click', swallow );

	return intercepted;
}

beforeEach( () => {
	opened = [];
	document.body.replaceChildren();
	( window as unknown as { allTerrainWork: unknown } ).allTerrainWork = {
		restUrl: 'https://example.test/wp-json/allterrain-work/v1',
		nonce: 'x',
	};
} );

afterEach( () => {
	withoutShell();
	vi.restoreAllMocks();
} );

describe( 'openInShell', () => {
	it( 'opens an admin URL as a desktop window', () => {
		withShell();

		expect( openInShell( '/wp-admin/post.php?post=42&action=edit', 'Task', 'dashicons-yes-alt' ) ).toBe( true );
		expect( opened ).toHaveLength( 1 );
		expect( opened[ 0 ].url ).toBe( '/wp-admin/post.php?post=42&action=edit' );
		expect( opened[ 0 ].title ).toBe( 'Task' );
	} );

	it( 'sends the derived id as both id and baseId', () => {
		// `baseId` is what the shell matches on to decide a window already
		// exists. Omitting it opens a second window for a URL already on screen.
		withShell();
		openInShell( '/wp-admin/edit.php', 'Posts' );

		expect( opened[ 0 ].id ).toBe( opened[ 0 ].baseId );
		expect( opened[ 0 ].id ).toBe( 'derived--wp-admin-edit-php' );
	} );

	it( 'declines when there is no shell, so the caller can fall back', () => {
		withoutShell();

		expect( openInShell( '/wp-admin/edit.php', 'Posts' ) ).toBe( false );
	} );

	it( 'declines on an older shell with no window manager', () => {
		( window as unknown as { wp: unknown } ).wp = { os: {} };

		expect( openInShell( '/wp-admin/edit.php', 'Posts' ) ).toBe( false );
	} );

	it( 'declines rather than throwing when the shell throws', () => {
		withShell( {
			windowManager: {
				open: () => {
					throw new TypeError( 'config changed underneath us' );
				},
			},
		} );

		expect( openInShell( '/wp-admin/edit.php', 'Posts' ) ).toBe( false );
	} );

	it( 'declines an empty URL instead of opening a blank window', () => {
		withShell();

		expect( openInShell( '', 'Nothing' ) ).toBe( false );
		expect( opened ).toHaveLength( 0 );
	} );
} );

describe( 'routeLinkIntoShell', () => {
	it( 'intercepts a plain click and opens a window instead', () => {
		withShell();

		const link = anchor( 'https://example.test/wp-admin/post.php?post=7&action=edit' );
		routeLinkIntoShell( link, 'A task' );

		expect( clickAndReportInterception( link, plainClick() ) ).toBe( true );
		expect( opened ).toHaveLength( 1 );
	} );

	it( 'leaves a command-click alone so the user still gets their tab', () => {
		withShell();

		const link = anchor( 'https://example.test/wp-admin/edit.php' );
		routeLinkIntoShell( link, 'Posts' );

		const event = new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0, metaKey: true } );

		expect( clickAndReportInterception( link, event ) ).toBe( false );
		expect( opened ).toHaveLength( 0 );
	} );

	it( 'leaves a middle-click alone', () => {
		withShell();

		const link = anchor( 'https://example.test/wp-admin/edit.php' );
		routeLinkIntoShell( link, 'Posts' );

		const event = new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 1 } );

		expect( clickAndReportInterception( link, event ) ).toBe( false );
		expect( opened ).toHaveLength( 0 );
	} );

	it( 'leaves ctrl and shift clicks alone', () => {
		withShell();

		const link = anchor( 'https://example.test/wp-admin/edit.php' );
		routeLinkIntoShell( link, 'Posts' );

		for ( const modifier of [ 'ctrlKey', 'shiftKey', 'altKey' ] ) {
			const event = new MouseEvent( 'click', {
				bubbles: true,
				cancelable: true,
				button: 0,
				[ modifier ]: true,
			} );

			expect( clickAndReportInterception( link, event ) ).toBe( false );
		}

		expect( opened ).toHaveLength( 0 );
	} );

	it( 'stays a real link with no shell, so the href does the work', () => {
		withoutShell();

		const link = anchor( 'https://example.test/wp-admin/edit.php' );
		routeLinkIntoShell( link, 'Posts' );

		// Not intercepted — a browser would follow the href, which is the correct
		// outcome on a page with no desktop to open a window on.
		expect( clickAndReportInterception( link, plainClick() ) ).toBe( false );
	} );

	it( 'keeps a press on the link from lifting the card underneath it', () => {
		withShell();

		const card = document.createElement( 'div' );
		const lifted = vi.fn();
		card.addEventListener( 'pointerdown', lifted );
		document.body.appendChild( card );

		const link = document.createElement( 'a' );
		link.href = 'https://example.test/wp-admin/edit.php';
		card.appendChild( link );
		routeLinkIntoShell( link, 'Posts' );

		link.dispatchEvent( new MouseEvent( 'pointerdown', { bubbles: true } ) as unknown as PointerEvent );

		expect( lifted ).not.toHaveBeenCalled();
	} );
} );

describe( 'openUrl', () => {
	it( 'prefers a desktop window', () => {
		withShell();

		const tab = vi.spyOn( window, 'open' ).mockReturnValue( null );
		openUrl( '/wp-admin/edit.php', 'Posts' );

		expect( opened ).toHaveLength( 1 );
		expect( tab ).not.toHaveBeenCalled();
	} );

	it( 'falls back to a tab only when there is no desktop', () => {
		withoutShell();

		const tab = vi.spyOn( window, 'open' ).mockReturnValue( null );
		openUrl( '/wp-admin/edit.php', 'Posts' );

		expect( tab ).toHaveBeenCalledWith( '/wp-admin/edit.php', '_blank', 'noopener' );
	} );

	it( 'does nothing at all for an empty URL', () => {
		withoutShell();

		const tab = vi.spyOn( window, 'open' ).mockReturnValue( null );
		openUrl( '', 'Nothing' );

		expect( tab ).not.toHaveBeenCalled();
	} );
} );

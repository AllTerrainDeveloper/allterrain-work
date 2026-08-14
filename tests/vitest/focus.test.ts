/**
 * Handing a project from the Explorer to the board.
 *
 * The two live in separately compiled bundles, so a module-scope variable in
 * one is invisible to the other — same source file or not. And the board is
 * almost never open when the request is made: the request is what opens it.
 *
 * Both halves are pinned here, because a plain broadcast passes the first test
 * and silently fails the second, which is the one that matters in practice.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onProjectFocus, requestProjectFocus, type FocusState } from '../../src/focus';

/** A stand-in for `wp.os.createSharedStore` — one slot per key, shared by all callers. */
function installShell(): void {
	const slots = new Map< string, { state: unknown; subs: Set< ( s: unknown ) => void > } >();

	( window as unknown as { wp: unknown } ).wp = {
		os: {
			createSharedStore: < T >( key: string, init: () => T ) => {
				if ( ! slots.has( key ) ) {
					slots.set( key, { state: init(), subs: new Set() } );
				}

				const slot = slots.get( key )!;

				return {
					state: slot.state as T,
					getState: () => slot.state as T,
					notify: () => slot.subs.forEach( ( cb ) => cb( slot.state ) ),
					subscribe: ( cb: ( s: T ) => void ) => {
						slot.subs.add( cb as ( s: unknown ) => void );

						return () => slot.subs.delete( cb as ( s: unknown ) => void );
					},
				};
			},
		},
	};
}

beforeEach( () => {
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'project focus hand-off', () => {
	it( 'delivers a request to a listener that is already watching', () => {
		installShell();

		const apply = vi.fn();
		onProjectFocus( apply );

		requestProjectFocus( 42 );

		expect( apply ).toHaveBeenCalledWith( 42 );
	} );

	it( 'replays a request made before the board existed', () => {
		// The case a plain broadcast gets wrong, and the normal case here: the
		// button is pressed, *then* the board window opens and subscribes.
		installShell();

		requestProjectFocus( 7 );

		const apply = vi.fn();
		onProjectFocus( apply );

		expect( apply ).toHaveBeenCalledWith( 7 );
	} );

	it( 'does not fire on a fresh page where nobody asked for anything', () => {
		installShell();

		const apply = vi.fn();
		onProjectFocus( apply );

		expect( apply ).not.toHaveBeenCalled();
	} );

	it( 'counts asking twice for the same project as two requests', () => {
		// A user who filtered away and pressed the button again means it. A
		// store keyed only on the project id would look unchanged and do
		// nothing.
		installShell();

		const apply = vi.fn();
		onProjectFocus( apply );

		requestProjectFocus( 5 );
		requestProjectFocus( 5 );

		expect( apply ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'carries a clear as readily as a project', () => {
		installShell();

		const apply = vi.fn();
		onProjectFocus( apply );

		requestProjectFocus( 0 );

		expect( apply ).toHaveBeenCalledWith( 0 );
	} );

	it( 'stops delivering once unsubscribed', () => {
		installShell();

		const apply = vi.fn();
		const off = onProjectFocus( apply );

		off();
		requestProjectFocus( 9 );

		expect( apply ).not.toHaveBeenCalled();
	} );

	it( 'is inert without a shell rather than throwing', () => {
		// The admin-page fallback has no shell and therefore no store. Asking
		// must be a no-op, not an exception that takes the click down.
		const apply = vi.fn();

		expect( () => requestProjectFocus( 3 ) ).not.toThrow();
		expect( () => onProjectFocus( apply )() ).not.toThrow();
		expect( apply ).not.toHaveBeenCalled();
	} );

	it( 'shares one slot across separately compiled callers', () => {
		// The whole reason the primitive exists: two bundles, one state.
		installShell();

		const boardApply = vi.fn();
		const widgetApply = vi.fn();

		onProjectFocus( boardApply );
		onProjectFocus( widgetApply );

		requestProjectFocus( 11 );

		expect( boardApply ).toHaveBeenCalledWith( 11 );
		expect( widgetApply ).toHaveBeenCalledWith( 11 );
	} );
} );

describe( 'FocusState', () => {
	it( 'starts at no project and no requests', () => {
		installShell();

		const seen: FocusState[] = [];
		onProjectFocus( () => seen.push( { projectId: 0, requestedAt: 0 } ) );

		expect( seen ).toHaveLength( 0 );
	} );
} );

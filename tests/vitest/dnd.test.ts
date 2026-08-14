/**
 * The fallback drag manager.
 *
 * These tests are the only thing standing between the standalone admin page and
 * a silently broken board: everyone developing this plugin runs OpenStation, so
 * the shell's manager is the one that gets exercised by hand and the fallback is
 * the one that rots unnoticed.
 *
 * The behaviours pinned here are the ones a naive pointer-drag gets wrong:
 * a press that never moves must be a click and not a drop; a rejecting target
 * must swallow the drop rather than let it fall through; and Escape must end the
 * gesture with the card back where it started.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDragManager } from '../../src/dnd';
import type { DragPayload, DropTarget } from '../../src/types';

/** A pointer event jsdom will accept. */
function pointer( type: string, x: number, y: number, button = 0 ): PointerEvent {
	return new MouseEvent( type, {
		clientX: x,
		clientY: y,
		button,
		bubbles: true,
	} ) as unknown as PointerEvent;
}

/** An element with a hit-testable rectangle. jsdom lays nothing out on its own. */
function boxed( rect: { top: number; left: number; width: number; height: number } ): HTMLElement {
	const el = document.createElement( 'div' );

	el.getBoundingClientRect = () =>
		( {
			top: rect.top,
			left: rect.left,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
			width: rect.width,
			height: rect.height,
			x: rect.left,
			y: rect.top,
			toJSON: () => ( {} ),
		} ) as DOMRect;

	document.body.appendChild( el );

	return el;
}

function payloadFor( source: HTMLElement, type = 'allterrain-work/task' ): DragPayload {
	return { type, source, data: { task: { id: 1 } } };
}

/** Registers a target and hands back the spies for its callbacks. */
function target( element: HTMLElement, accept: boolean ): DropTarget & { drops: number } {
	const t = {
		id: `test-${ Math.random() }`,
		element,
		accept: () => accept,
		onEnter: vi.fn(),
		onLeave: vi.fn(),
		onDrop: vi.fn(),
		drops: 0,
	};

	getDragManager().registerDropTarget( t );

	return t as unknown as DropTarget & { drops: number };
}

beforeEach( () => {
	document.body.replaceChildren();
} );

describe( 'fallback drag manager', () => {
	it( 'treats a press that never moves as a click, not a drop', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );
		const onClickOnly = vi.fn();
		const dest = target( boxed( { top: 200, left: 0, width: 200, height: 200 } ), true );

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
			onClickOnly,
		} );

		document.dispatchEvent( pointer( 'pointerup', 10, 10 ) );

		expect( onClickOnly ).toHaveBeenCalledTimes( 1 );
		expect( dest.onDrop ).not.toHaveBeenCalled();
	} );

	it( 'does not lift until the pointer passes the threshold', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
		} );

		// Two pixels. Below the 4px threshold — this is a shaky click, not a drag.
		document.dispatchEvent( pointer( 'pointermove', 12, 10 ) );

		expect( source.classList.contains( 'atwork-is-dragging' ) ).toBe( false );

		document.dispatchEvent( pointer( 'pointermove', 40, 10 ) );

		expect( source.classList.contains( 'atwork-is-dragging' ) ).toBe( true );

		document.dispatchEvent( pointer( 'pointerup', 40, 10 ) );
	} );

	it( 'drops on an accepting target under the cursor', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );
		const dest = target( boxed( { top: 200, left: 0, width: 200, height: 200 } ), true );

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
		} );

		document.dispatchEvent( pointer( 'pointermove', 60, 250 ) );

		expect( dest.onEnter ).toHaveBeenCalledTimes( 1 );

		document.dispatchEvent( pointer( 'pointerup', 60, 250 ) );

		expect( dest.onDrop ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'lets a rejecting target swallow the drop instead of falling through', () => {
		// The claimant rule. Without it, a drop refused by the small target
		// lands on the big one behind it — which is how a drop aimed at one
		// thing quietly does something else.
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );
		const behind = target( boxed( { top: 200, left: 0, width: 400, height: 400 } ), true );
		const refuses = target( boxed( { top: 250, left: 50, width: 100, height: 100 } ), false );

		const onCancel = vi.fn();

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
			onCancel,
		} );

		document.dispatchEvent( pointer( 'pointermove', 100, 300 ) );
		document.dispatchEvent( pointer( 'pointerup', 100, 300 ) );

		expect( refuses.onDrop ).not.toHaveBeenCalled();
		expect( behind.onDrop ).not.toHaveBeenCalled();
		expect( onCancel ).toHaveBeenCalledWith( 'rejected' );
	} );

	it( 'cancels on Escape and leaves the source unmarked', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );
		const dest = target( boxed( { top: 200, left: 0, width: 200, height: 200 } ), true );
		const onCancel = vi.fn();

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
			onCancel,
		} );

		document.dispatchEvent( pointer( 'pointermove', 60, 250 ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );

		expect( onCancel ).toHaveBeenCalledWith( 'escape' );
		expect( source.classList.contains( 'atwork-is-dragging' ) ).toBe( false );
		expect( document.querySelector( '.atwork-drag-ghost' ) ).toBeNull();

		// A pointerup after the cancel must not resurrect the drop.
		document.dispatchEvent( pointer( 'pointerup', 60, 250 ) );

		expect( dest.onDrop ).not.toHaveBeenCalled();
	} );

	it( 'refuses a second session while one is live', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );
		const manager = getDragManager();

		const first = manager.start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
		} );

		const second = manager.start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 12, 12 ),
		} );

		expect( first ).not.toBeNull();
		expect( second ).toBeNull();

		first?.cancel();
	} );

	it( 'ignores a non-primary button', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );

		// Right-click opens the card's context menu; it must not also start a
		// drag that the matching pointerup then commits.
		const session = getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10, 2 ),
		} );

		expect( session ).toBeNull();
	} );

	it( 'picks the deepest target when two overlap', () => {
		const source = boxed( { top: 0, left: 0, width: 100, height: 40 } );

		const outer = boxed( { top: 200, left: 0, width: 400, height: 400 } );
		const inner = document.createElement( 'div' );
		inner.getBoundingClientRect = () =>
			( {
				top: 250,
				left: 50,
				right: 150,
				bottom: 350,
				width: 100,
				height: 100,
				x: 50,
				y: 250,
				toJSON: () => ( {} ),
			} ) as DOMRect;
		outer.appendChild( inner );

		const outerTarget = target( outer, true );
		const innerTarget = target( inner, true );

		getDragManager().start( {
			payload: payloadFor( source ),
			origin: pointer( 'pointerdown', 10, 10 ),
		} );

		document.dispatchEvent( pointer( 'pointermove', 100, 300 ) );
		document.dispatchEvent( pointer( 'pointerup', 100, 300 ) );

		expect( innerTarget.onDrop ).toHaveBeenCalledTimes( 1 );
		expect( outerTarget.onDrop ).not.toHaveBeenCalled();
	} );
} );

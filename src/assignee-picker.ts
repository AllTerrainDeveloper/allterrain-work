/**
 * Assigning a task to somebody, from the card.
 *
 * Dragging a user tile onto a card works and is a lovely thing the desktop makes
 * possible — but it is not *how you assign a task*. It needs WP Explorer open,
 * it needs the right folder, and nothing on the card suggests any of it. A
 * feature reachable only by a gesture nobody can guess is a feature most people
 * do not have.
 *
 * So the avatar on every card is a button, and pressing it opens this: a
 * searchable list of the people who can actually be assigned work. The drag
 * stays — it is faster once you know it — but it is no longer the only door.
 *
 * Anchored to the card rather than rendered in the toolbar, because the answer
 * to "who is this for" belongs beside the thing being assigned. It closes on
 * Escape, on a click elsewhere, and on picking someone.
 */

import { fetchAssignees } from './api';
import type { Assignee } from './types';

/** The picker currently on screen, if any. Only ever one. */
let open: { panel: HTMLElement; close: () => void } | null = null;

/** Closes whatever picker is open. Safe to call when none is. */
export function closeAssigneePicker(): void {
	open?.close();
}

/**
 * Opens the picker beside an element.
 *
 * @param anchor  The button it hangs off.
 * @param current The currently assigned user id, or 0.
 * @param onPick  Called with the chosen user id — 0 to unassign.
 */
export function openAssigneePicker(
	anchor: HTMLElement,
	current: number,
	onPick: ( userId: number ) => void
): void {
	closeAssigneePicker();

	const panel = document.createElement( 'div' );
	panel.className = 'atwork-assignee';
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-label', 'Assign this task' );

	const search = document.createElement( 'input' );
	search.type = 'search';
	search.className = 'atwork-assignee__search';
	search.placeholder = 'Search people';
	search.setAttribute( 'aria-label', 'Search people' );

	const list = document.createElement( 'div' );
	list.className = 'atwork-assignee__list';
	list.setAttribute( 'role', 'listbox' );

	panel.append( search, list );
	document.body.appendChild( panel );

	position( panel, anchor );

	const close = () => {
		document.removeEventListener( 'pointerdown', onOutside, true );
		document.removeEventListener( 'keydown', onKey, true );
		window.removeEventListener( 'resize', close );
		panel.remove();
		open = null;
		anchor.setAttribute( 'aria-expanded', 'false' );
	};

	const onOutside = ( event: Event ) => {
		const target = event.target as Node;

		if ( ! panel.contains( target ) && ! anchor.contains( target ) ) {
			close();
		}
	};

	const onKey = ( event: KeyboardEvent ) => {
		if ( event.key === 'Escape' ) {
			// Stopped so Escape does not also reach the shell and close the
			// window the user is standing in.
			event.stopPropagation();
			close();
			anchor.focus();
		}
	};

	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
	window.addEventListener( 'resize', close );

	anchor.setAttribute( 'aria-expanded', 'true' );
	open = { panel, close };

	const choose = ( id: number ) => {
		close();
		onPick( id );
	};

	const paint = ( people: Assignee[] ) => {
		list.replaceChildren();

		if ( current ) {
			list.appendChild( option( 'Unassign', '', () => choose( 0 ), false, true ) );
		}

		if ( ! people.length ) {
			const empty = document.createElement( 'p' );
			empty.className = 'atwork-assignee__empty';
			empty.textContent = 'Nobody matches.';
			list.appendChild( empty );

			return;
		}

		for ( const person of people ) {
			list.appendChild(
				option( person.name, person.avatar, () => choose( person.id ), person.id === current )
			);
		}
	};

	const loading = document.createElement( 'p' );
	loading.className = 'atwork-assignee__empty';
	loading.textContent = 'Loading…';
	list.appendChild( loading );

	let token = 0;

	const load = ( term: string ) => {
		const mine = ++token;

		void fetchAssignees( term )
			.then( ( people ) => {
				// A slower earlier request must not overwrite a faster later
				// one — otherwise typing quickly leaves the list showing
				// results for a prefix the user has already moved past.
				if ( mine === token && open?.panel === panel ) {
					paint( people );
				}
			} )
			.catch( () => {
				if ( mine === token && open?.panel === panel ) {
					paint( [] );
				}
			} );
	};

	let debounce: ReturnType< typeof setTimeout >;

	search.addEventListener( 'input', () => {
		clearTimeout( debounce );
		debounce = setTimeout( () => load( search.value.trim() ), 200 );
	} );

	load( '' );
	search.focus();
}

/** One row in the list. */
function option(
	label: string,
	avatar: string,
	onSelect: () => void,
	selected: boolean,
	muted = false
): HTMLElement {
	const row = document.createElement( 'button' );
	row.type = 'button';
	row.className = `atwork-assignee__option${ muted ? ' is-muted' : '' }`;
	row.setAttribute( 'role', 'option' );
	row.setAttribute( 'aria-selected', String( selected ) );

	if ( avatar ) {
		const img = document.createElement( 'img' );
		img.src = avatar;
		img.alt = '';
		img.width = 20;
		img.height = 20;
		img.loading = 'lazy';
		row.appendChild( img );
	}

	const name = document.createElement( 'span' );
	name.textContent = label;
	row.appendChild( name );

	if ( selected ) {
		const tick = document.createElement( 'span' );
		tick.className = 'atwork-assignee__tick';
		tick.textContent = '✓';
		row.appendChild( tick );
	}

	row.addEventListener( 'click', onSelect );

	return row;
}

/**
 * Places the panel under its anchor, nudged back on screen if it would overflow.
 *
 * Fixed positioning against the viewport rather than absolute inside the card:
 * a column scrolls and clips its overflow, and a picker that scrolled away with
 * the card it belongs to — or got cut in half by the column's edge — would be
 * worse than one that floats.
 */
function position( panel: HTMLElement, anchor: HTMLElement ): void {
	const rect = anchor.getBoundingClientRect();
	const width = 220;

	panel.style.width = `${ width }px`;

	const left = Math.min( Math.max( 8, rect.left ), window.innerWidth - width - 8 );
	const below = rect.bottom + 6;
	const height = 260;

	// Flip above the anchor when there is not room below it.
	const top = below + height > window.innerHeight ? Math.max( 8, rect.top - height - 6 ) : below;

	panel.style.left = `${ left }px`;
	panel.style.top = `${ top }px`;
}

/**
 * Talking about a task, from the card.
 *
 * A task thread is ordinary WordPress comments — the task post type declares
 * `comments` support, so this is the same object the admin's Comments screen
 * moderates and OpenStation's own Comments window lists. Nothing private, no
 * second notion of "notes" that only this plugin understands.
 *
 * The panel is anchored to the card rather than opened as a window, because a
 * comment is usually one line written while looking at the card. Making people
 * open a window, read, type and close again turns a remark into an errand.
 */

import { addComment, deleteComment, fetchComments } from './api';
import type { TaskComment } from './types';

/** The thread currently on screen, if any. Only ever one. */
let open: { panel: HTMLElement; close: () => void } | null = null;

/** Closes whatever thread is open. Safe to call when none is. */
export function closeComments(): void {
	open?.close();
}

/**
 * Opens the thread for a task.
 *
 * @param anchor   The button it hangs off.
 * @param taskId   The task.
 * @param onChange Called after a post or delete, with the new comment count.
 */
export function openComments(
	anchor: HTMLElement,
	taskId: number,
	onChange: ( count: number ) => void
): void {
	closeComments();

	const panel = document.createElement( 'div' );
	panel.className = 'atwork-comments';
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-label', 'Comments on this task' );

	const list = document.createElement( 'div' );
	list.className = 'atwork-comments__list';

	const form = document.createElement( 'form' );
	form.className = 'atwork-comments__form';

	const input = document.createElement( 'textarea' );
	input.className = 'atwork-comments__input';
	input.rows = 2;
	input.placeholder = 'Write a comment…';
	input.setAttribute( 'aria-label', 'Write a comment' );

	const send = document.createElement( 'button' );
	send.type = 'submit';
	send.className = 'atwork__button atwork__button--primary';
	send.textContent = 'Comment';

	form.append( input, send );
	panel.append( list, form );
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

	let comments: TaskComment[] = [];

	const paint = () => {
		list.replaceChildren();

		if ( ! comments.length ) {
			const empty = document.createElement( 'p' );
			empty.className = 'atwork-comments__empty';
			empty.textContent = 'No comments yet.';
			list.appendChild( empty );

			return;
		}

		for ( const comment of comments ) {
			list.appendChild( render( comment ) );
		}

		// Newest is at the bottom and is what the reader wants first — a thread
		// that opens at its own beginning makes you scroll to find out what just
		// happened.
		list.scrollTop = list.scrollHeight;
	};

	const render = ( comment: TaskComment ): HTMLElement => {
		const row = document.createElement( 'article' );
		row.className = 'atwork-comments__item';

		const head = document.createElement( 'div' );
		head.className = 'atwork-comments__head';

		if ( comment.avatar ) {
			const img = document.createElement( 'img' );
			img.src = comment.avatar;
			img.alt = '';
			img.width = 18;
			img.height = 18;
			img.loading = 'lazy';
			head.appendChild( img );
		}

		const who = document.createElement( 'strong' );
		who.textContent = comment.author;
		head.appendChild( who );

		const when = document.createElement( 'time' );
		when.dateTime = comment.date;
		when.textContent = relative( comment.date );
		when.title = new Date( comment.date ).toLocaleString();
		head.appendChild( when );

		if ( comment.canDelete ) {
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.className = 'atwork-comments__delete';
			remove.setAttribute( 'aria-label', `Delete ${ comment.author }’s comment` );
			remove.textContent = '×';
			remove.addEventListener( 'click', () => {
				void deleteComment( comment.id )
					.then( () => {
						comments = comments.filter( ( c ) => c.id !== comment.id );
						paint();
						onChange( comments.length );
					} )
					.catch( () => undefined );
			} );
			head.appendChild( remove );
		}

		const body = document.createElement( 'p' );
		body.className = 'atwork-comments__body';
		body.textContent = comment.content;

		row.append( head, body );

		return row;
	};

	const loading = document.createElement( 'p' );
	loading.className = 'atwork-comments__empty';
	loading.textContent = 'Loading…';
	list.appendChild( loading );

	void fetchComments( taskId )
		.then( ( loaded ) => {
			if ( open?.panel !== panel ) {
				return;
			}

			comments = loaded;
			paint();
		} )
		.catch( () => {
			if ( open?.panel === panel ) {
				comments = [];
				paint();
			}
		} );

	const submit = () => {
		const content = input.value.trim();

		if ( ! content ) {
			return;
		}

		input.disabled = true;
		send.disabled = true;

		void addComment( taskId, content )
			.then( ( comment ) => {
				if ( open?.panel !== panel ) {
					return;
				}

				comments.push( comment );
				input.value = '';
				paint();
				onChange( comments.length );
			} )
			.catch( () => undefined )
			.finally( () => {
				if ( open?.panel === panel ) {
					input.disabled = false;
					send.disabled = false;
					input.focus();
				}
			} );
	};

	form.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		submit();
	} );

	// Enter sends, Shift+Enter breaks the line. A comment is usually one line,
	// and reaching for a button after every one is the friction that stops
	// people writing them.
	input.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Enter' && ! event.shiftKey ) {
			event.preventDefault();
			submit();
		}
	} );

	input.focus();
}

/** "2 min ago" — good enough, and no dependency. */
function relative( iso: string ): string {
	const then = new Date( iso ).getTime();

	if ( ! Number.isFinite( then ) ) {
		return '';
	}

	const seconds = Math.round( ( Date.now() - then ) / 1000 );

	if ( seconds < 60 ) {
		return 'just now';
	}

	const minutes = Math.round( seconds / 60 );

	if ( minutes < 60 ) {
		return `${ minutes } min ago`;
	}

	const hours = Math.round( minutes / 60 );

	if ( hours < 24 ) {
		return `${ hours } h ago`;
	}

	return new Date( iso ).toLocaleDateString( undefined, { month: 'short', day: 'numeric' } );
}

/** Places the panel beside its anchor, flipped or nudged to stay on screen. */
function position( panel: HTMLElement, anchor: HTMLElement ): void {
	const rect = anchor.getBoundingClientRect();
	const width = 280;
	const height = 300;

	panel.style.width = `${ width }px`;

	const left = Math.min( Math.max( 8, rect.left - width / 2 ), window.innerWidth - width - 8 );
	const below = rect.bottom + 6;
	const top = below + height > window.innerHeight ? Math.max( 8, rect.top - height - 6 ) : below;

	panel.style.left = `${ left }px`;
	panel.style.top = `${ top }px`;
}

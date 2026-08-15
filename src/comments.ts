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
 *
 * **It is shaped like a chat, on purpose.** The first version was a list of
 * rows over a bare `<textarea>`, and it read as a form — something to be filled
 * in and submitted. A work thread is a conversation, and people write more
 * freely into something that looks like one: your own messages on your side,
 * everyone else's on theirs, the newest at the bottom, a composer that grows as
 * you type. The metaphor is doing real work here, not decoration.
 */

import { addComment, deleteComment, fetchComments } from './api';
import { bubbleIcon, closeIcon, sendIcon, trashIcon } from './icons';
import { ensureComponents, registered } from './os-ui';
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
 * @param title    The task's title, for the panel's own heading.
 * @param onChange Called after a post or delete, with the new comment count.
 */
export function openComments(
	anchor: HTMLElement,
	taskId: number,
	title: string,
	onChange: ( count: number ) => void
): void {
	closeComments();

	const panel = document.createElement( 'div' );
	panel.className = 'atwork-comments';
	panel.setAttribute( 'role', 'dialog' );
	panel.setAttribute( 'aria-label', `Comments on “${ title }”` );

	// -- Header. Gives the panel a subject and a way out that is not Escape,
	// which is the only exit a keyboard-averse user would otherwise have.
	const header = document.createElement( 'header' );
	header.className = 'atwork-comments__header';

	const heading = document.createElement( 'div' );
	heading.className = 'atwork-comments__heading';

	const name = document.createElement( 'strong' );
	name.textContent = title;
	name.title = title;

	const subtitle = document.createElement( 'span' );
	subtitle.className = 'atwork-comments__subtitle';

	heading.append( name, subtitle );

	const dismiss = document.createElement( 'button' );
	dismiss.type = 'button';
	dismiss.className = 'atwork-comments__close';
	dismiss.setAttribute( 'aria-label', 'Close comments' );
	dismiss.title = 'Close';
	dismiss.appendChild( closeIcon() );

	header.append( heading, dismiss );

	const list = document.createElement( 'div' );
	list.className = 'atwork-comments__list';

	// -- Composer. The field and the send button share one bordered bar, and the
	// bar takes the focus ring via :focus-within. That is not only nicer: core's
	// `forms.css` owns `textarea:focus` with a specificity a single class cannot
	// beat, so a bare field inside the admin gets a 2px WordPress-blue ring
	// whatever we ask for. Moving the visible edge to the parent puts it out of
	// core's reach entirely.
	const form = document.createElement( 'form' );
	form.className = 'atwork-comments__form';

	const input = document.createElement( 'textarea' );
	input.className = 'atwork-comments__input';
	input.rows = 1;
	input.placeholder = 'Write a comment…';
	input.setAttribute( 'aria-label', 'Write a comment' );

	const send = document.createElement( 'button' );
	send.type = 'submit';
	send.className = 'atwork-comments__send';
	send.setAttribute( 'aria-label', 'Post comment' );
	send.title = 'Post — or press Enter';
	send.appendChild( sendIcon() );
	// Nothing to send yet. Disabled rather than hidden, so the button does not
	// appear and disappear under the pointer as the field fills and empties.
	send.disabled = true;

	form.append( input, send );
	panel.append( header, list, form );
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
		if ( 'Escape' === event.key ) {
			event.stopPropagation();
			close();
			anchor.focus();
		}
	};

	document.addEventListener( 'pointerdown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
	window.addEventListener( 'resize', close );

	dismiss.addEventListener( 'click', () => {
		close();
		anchor.focus();
	} );

	anchor.setAttribute( 'aria-expanded', 'true' );
	open = { panel, close };

	let comments: TaskComment[] = [];

	/** Keeps the header's count honest after every change. */
	const countUp = () => {
		const total = comments.length;

		subtitle.textContent = total
			? `${ total } ${ 1 === total ? 'comment' : 'comments' }`
			: 'No comments yet';
	};

	const paint = () => {
		list.replaceChildren();
		countUp();

		if ( ! comments.length ) {
			list.appendChild( emptyState() );

			return;
		}

		let previous: TaskComment | null = null;

		for ( const comment of comments ) {
			// Consecutive messages from one person are grouped: the name and
			// avatar are drawn once at the top of the run rather than repeated
			// against every line. Somebody writing three thoughts in a row
			// otherwise fills the panel with their own name.
			const grouped =
				null !== previous &&
				previous.author === comment.author &&
				previous.isMine === comment.isMine &&
				withinTheHour( previous.date, comment.date );

			list.appendChild( render( comment, grouped ) );
			previous = comment;
		}

		// Newest is at the bottom and is what the reader wants first — a thread
		// that opens at its own beginning makes you scroll to find out what just
		// happened.
		list.scrollTop = list.scrollHeight;
	};

	/** The nothing-here-yet view: an invitation rather than a statement. */
	const emptyState = (): HTMLElement => {
		const empty = document.createElement( 'div' );
		empty.className = 'atwork-comments__empty';

		const mark = bubbleIcon( false, 28 );
		mark.classList.add( 'atwork-comments__empty-icon' );

		const line = document.createElement( 'p' );
		line.className = 'atwork-comments__empty-title';
		line.textContent = 'No comments yet';

		const hint = document.createElement( 'p' );
		hint.className = 'atwork-comments__empty-hint';
		hint.textContent = 'Start the conversation about this task.';

		empty.append( mark, line, hint );

		return empty;
	};

	const render = ( comment: TaskComment, grouped: boolean ): HTMLElement => {
		const row = document.createElement( 'article' );
		row.className = 'atwork-comments__item';
		row.classList.toggle( 'is-mine', comment.isMine );
		row.classList.toggle( 'is-grouped', grouped );

		// The gutter holds the avatar, and holds its width even when grouping
		// has removed the picture — otherwise every run after the first would
		// slide left and the column of bubbles would lose its edge.
		const gutter = document.createElement( 'div' );
		gutter.className = 'atwork-comments__gutter';

		if ( ! grouped && comment.avatar ) {
			const img = document.createElement( 'img' );
			img.src = comment.avatar;
			img.alt = '';
			img.width = 24;
			img.height = 24;
			img.loading = 'lazy';
			gutter.appendChild( img );
		}

		const bubble = document.createElement( 'div' );
		bubble.className = 'atwork-comments__bubble';

		if ( ! grouped ) {
			const head = document.createElement( 'div' );
			head.className = 'atwork-comments__head';

			const who = document.createElement( 'strong' );
			// "You" rather than your own name. Reading your own display name
			// back at you is how a form talks, not how a conversation does.
			who.textContent = comment.isMine ? 'You' : comment.author;

			head.append( who, timestamp( comment.date ) );
			bubble.appendChild( head );
		}

		const body = document.createElement( 'p' );
		body.className = 'atwork-comments__body';
		body.textContent = comment.content;
		bubble.appendChild( body );

		if ( comment.canDelete ) {
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.className = 'atwork-comments__delete';
			remove.setAttribute( 'aria-label', `Delete this comment by ${ comment.author }` );
			remove.title = 'Delete';
			remove.appendChild( trashIcon() );
			remove.addEventListener( 'click', () => {
				void deleteComment( comment.id )
					.then( () => {
						comments = comments.filter( ( c ) => c.id !== comment.id );
						paint();
						onChange( comments.length );
					} )
					.catch( () => undefined );
			} );
			bubble.appendChild( remove );
		}

		row.append( gutter, bubble );

		return row;
	};

	const loading = document.createElement( 'p' );
	loading.className = 'atwork-comments__loading';
	loading.textContent = 'Loading…';
	list.appendChild( loading );

	/*
	 * The thread and the timestamp component, fetched together.
	 *
	 * In parallel because neither needs the other, and asked for here rather
	 * than when the board mounts because this is the only screen that renders
	 * one: a user who never opens a thread never pays for the kit. With the tag
	 * already registered the call is a registry lookup and no request, so
	 * reopening a thread costs nothing.
	 *
	 * `ensureComponents()` never rejects, so the settled shape below is decided
	 * entirely by whether the comments arrived.
	 */
	void Promise.all( [ fetchComments( taskId ), ensureComponents( [ 'os-relative-time' ] ) ] )
		.then( ( [ loaded ] ) => {
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

	/**
	 * Grows the field with its content, to a ceiling.
	 *
	 * A one-line box that scrolls hides what you already wrote the moment a
	 * comment runs past it. The ceiling keeps the composer from eating the
	 * conversation it belongs to.
	 */
	const resize = () => {
		input.style.height = 'auto';
		input.style.height = `${ Math.min( input.scrollHeight, 110 ) }px`;
	};

	const submit = () => {
		const content = input.value.trim();

		if ( ! content ) {
			return;
		}

		input.disabled = true;
		send.disabled = true;
		panel.classList.add( 'is-sending' );

		void addComment( taskId, content )
			.then( ( comment ) => {
				if ( open?.panel !== panel ) {
					return;
				}

				comments.push( comment );
				input.value = '';
				resize();
				paint();
				onChange( comments.length );
			} )
			.catch( () => undefined )
			.finally( () => {
				if ( open?.panel === panel ) {
					panel.classList.remove( 'is-sending' );
					input.disabled = false;
					send.disabled = '' === input.value.trim();
					input.focus();
				}
			} );
	};

	form.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		submit();
	} );

	input.addEventListener( 'input', () => {
		resize();
		send.disabled = '' === input.value.trim();
	} );

	// Enter sends, Shift+Enter breaks the line. A comment is usually one line,
	// and reaching for a button after every one is the friction that stops
	// people writing them.
	input.addEventListener( 'keydown', ( event ) => {
		if ( 'Enter' === event.key && ! event.shiftKey ) {
			event.preventDefault();
			submit();
		}
	} );

	input.focus();
}

/**
 * The "2 min ago" beside a name.
 *
 * `<os-relative-time>` when the shell can provide it, because a thread is
 * exactly the case a static timestamp gets wrong: the panel stays open while
 * people talk, and a line that said "just now" when it was painted goes on
 * saying it a quarter of an hour later. The component re-renders itself every
 * 30 seconds while connected, and formats through `Intl.RelativeTimeFormat`, so
 * it also says it in the reader's language rather than in the English below.
 *
 * The dates arrive from `comment_date_gmt`, which is what the component asks
 * for — it reads a value with no timezone designator as UTC, so handing it a
 * site-local time would be wrong by the site's offset.
 *
 * @param iso The moment, ISO 8601, UTC.
 */
function timestamp( iso: string ): HTMLElement {
	if ( registered( 'os-relative-time' ) ) {
		const el = document.createElement( 'os-relative-time' );
		el.setAttribute( 'datetime', iso );
		// A comment thread is a narrow column and the name beside this has the
		// stronger claim on the width.
		el.setAttribute( 'compact', '' );

		return el;
	}

	const when = document.createElement( 'time' );
	when.dateTime = iso;
	when.textContent = relative( iso );
	when.title = new Date( iso ).toLocaleString();

	return when;
}

/** Whether two timestamps are close enough to group under one name. */
function withinTheHour( earlier: string, later: string ): boolean {
	const a = new Date( earlier ).getTime();
	const b = new Date( later ).getTime();

	return Number.isFinite( a ) && Number.isFinite( b ) && Math.abs( b - a ) < 3600000;
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
	const width = 320;
	const height = 380;

	panel.style.width = `${ width }px`;

	const left = Math.min( Math.max( 8, rect.left - width / 2 ), window.innerWidth - width - 8 );
	const below = rect.bottom + 8;
	const top = below + height > window.innerHeight ? Math.max( 8, rect.top - height - 8 ) : below;

	panel.style.left = `${ left }px`;
	panel.style.top = `${ top }px`;
}

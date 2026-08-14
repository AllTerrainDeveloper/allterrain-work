/**
 * Asking the user something without stopping the desktop.
 *
 * `window.prompt`, `window.confirm` and `window.alert` are not merely ugly here
 * — they are **destructive**. A browser modal blocks the whole page, and inside
 * OpenStation the page is the entire desktop: every other window freezes, the
 * drag manager stops receiving pointer events mid-gesture, and any bundle
 * waiting on a timer stalls until somebody finds the dialog and dismisses it.
 * A work board has no business doing that to a photo editor open beside it.
 *
 * So the board asks in its own toolbar instead. Three shapes, all non-blocking,
 * all returning promises so calling code reads the same as the blocking version
 * it replaced:
 *
 *   - `ask()`     — one text field. Replaces `prompt`.
 *   - `confirm()` — a sentence and two buttons. Replaces `confirm`.
 *   - `notice()`  — a line that says what went wrong. Replaces `alert`.
 *
 * The shell's own `wp.os.confirm` and `wp.os.notify` are better still — focus
 * trapped, themed, stacked — and the board prefers them wherever they exist.
 * These are what it falls back to on a plain admin page, and they must be good
 * enough to stand alone there rather than being an apology.
 */

/** How a notice reads. */
export type NoticeTone = 'info' | 'error' | 'success';

/** Removes whatever is currently occupying a host element. */
function clear( host: HTMLElement ): void {
	host.replaceChildren();
	host.hidden = true;
}

/**
 * Asks for one line of text.
 *
 * Resolves with the trimmed value, or `null` when the user backed out — Escape,
 * a click on Cancel, or submitting an empty field. `null` rather than `''` so a
 * caller cannot mistake "they cancelled" for "they typed nothing", which is the
 * bug `prompt` has always invited.
 *
 * @param host        Element to render into. Emptied first, shown while open.
 * @param opts.label  What is being asked for.
 * @param opts.submit Label for the confirming button.
 */
export function ask(
	host: HTMLElement,
	opts: { label: string; placeholder?: string; submit?: string }
): Promise< string | null > {
	return new Promise( ( resolve ) => {
		clear( host );
		host.hidden = false;

		const form = document.createElement( 'form' );
		form.className = 'atwork-inline';

		const label = document.createElement( 'label' );
		label.className = 'atwork-inline__label';
		label.textContent = opts.label;

		const input = document.createElement( 'input' );
		input.type = 'text';
		input.className = 'atwork-inline__input';
		input.placeholder = opts.placeholder ?? '';
		label.appendChild( input );

		const submit = document.createElement( 'button' );
		submit.type = 'submit';
		submit.className = 'atwork__button atwork__button--primary';
		submit.textContent = opts.submit ?? 'Add';

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className = 'atwork__button';
		cancel.textContent = 'Cancel';

		form.append( label, submit, cancel );
		host.appendChild( form );

		let settled = false;

		const finish = ( value: string | null ) => {
			if ( settled ) {
				return;
			}

			settled = true;
			clear( host );
			resolve( value );
		};

		form.addEventListener( 'submit', ( ev ) => {
			ev.preventDefault();

			const value = input.value.trim();

			finish( value === '' ? null : value );
		} );

		cancel.addEventListener( 'click', () => finish( null ) );

		input.addEventListener( 'keydown', ( ev ) => {
			if ( ev.key === 'Escape' ) {
				// Stopped so Escape does not also reach the shell and close the
				// window the user is typing into.
				ev.stopPropagation();
				finish( null );
			}
		} );

		input.focus();
	} );
}

/**
 * Asks a yes-or-no question.
 *
 * The destructive button is never the one focus lands on, and never the one
 * Enter activates from the container — the same rule the shell's own confirm
 * dialog follows. Reaching a delete is always deliberate.
 */
export function confirm(
	host: HTMLElement,
	opts: { message: string; confirm?: string; danger?: boolean }
): Promise< boolean > {
	return new Promise( ( resolve ) => {
		clear( host );
		host.hidden = false;

		const wrap = document.createElement( 'div' );
		wrap.className = 'atwork-inline';
		wrap.setAttribute( 'role', 'alertdialog' );

		const text = document.createElement( 'p' );
		text.className = 'atwork-inline__message';
		text.textContent = opts.message;

		const yes = document.createElement( 'button' );
		yes.type = 'button';
		yes.className = opts.danger
			? 'atwork__button atwork__button--danger'
			: 'atwork__button atwork__button--primary';
		yes.textContent = opts.confirm ?? 'Confirm';

		const no = document.createElement( 'button' );
		no.type = 'button';
		no.className = 'atwork__button';
		no.textContent = 'Cancel';

		wrap.append( text, no, yes );
		host.appendChild( wrap );

		let settled = false;

		const finish = ( value: boolean ) => {
			if ( settled ) {
				return;
			}

			settled = true;
			host.removeEventListener( 'keydown', onKey );
			clear( host );
			resolve( value );
		};

		const onKey = ( ev: KeyboardEvent ) => {
			if ( ev.key === 'Escape' ) {
				ev.stopPropagation();
				finish( false );
			}
		};

		host.addEventListener( 'keydown', onKey );
		yes.addEventListener( 'click', () => finish( true ) );
		no.addEventListener( 'click', () => finish( false ) );

		// Focus the safe control. A confirm that opens on its destructive button
		// turns a reflexive Enter into a deletion.
		no.focus();
	} );
}

/**
 * Says something happened.
 *
 * Auto-clears unless it is an error, because a success message that has to be
 * dismissed is a second thing to do for something that already worked. An error
 * stays until the next one replaces it or the user closes it — it is the only
 * record of what went wrong.
 */
export function notice( host: HTMLElement, message: string, tone: NoticeTone = 'info' ): () => void {
	clear( host );
	host.hidden = false;

	const wrap = document.createElement( 'div' );
	wrap.className = `atwork-inline atwork-inline--${ tone }`;
	// Assertive for errors only: a polite live region is right for "saved" and
	// too easy to miss for "that did not save".
	wrap.setAttribute( 'role', tone === 'error' ? 'alert' : 'status' );

	const text = document.createElement( 'p' );
	text.className = 'atwork-inline__message';
	text.textContent = message;

	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'atwork-inline__close';
	close.setAttribute( 'aria-label', 'Dismiss' );
	close.textContent = '×';

	wrap.append( text, close );
	host.appendChild( wrap );

	let timer: ReturnType< typeof setTimeout > | null = null;

	const dismiss = () => {
		if ( timer ) {
			clearTimeout( timer );
			timer = null;
		}

		if ( host.contains( wrap ) ) {
			clear( host );
		}
	};

	close.addEventListener( 'click', dismiss );

	if ( tone !== 'error' ) {
		timer = setTimeout( dismiss, 4000 );
	}

	return dismiss;
}

/**
 * Using the shell's own controls when the shell is there.
 *
 * A raw `<select>` or `<input>` inside OpenStation is not merely plain — it is
 * *wrong*. The shell is a real `wp-admin` document, so WordPress's `forms.css`
 * is loaded and reaches every bare control with a `(0,1,1)` selector
 * (`input[type="text"], select, textarea { background: #fff; color: #1e1e1e }`).
 * That outranks any single class of ours, so a field we had carefully tokenized
 * still renders as a white core-chrome box on a dark window surface.
 *
 * The `<os-*>` components live in shadow DOM, where `forms.css` cannot follow,
 * and they resolve the palette and the active desktop theme themselves. So the
 * board uses them.
 *
 * **Tags, not imports.** Importing from the `openstation` package would pull
 * the whole component kit into a bundle that also has to load on sites with no
 * shell at all. The shell already registers the overlay kit — select, menu,
 * toast, confirm-dialog — right after first paint, so emitting the tag is
 * enough. Every helper here checks the custom-element registry first and falls
 * back to the native control, because a tag no loaded bundle has registered
 * renders as inert HTML rather than as a control.
 */

/** Whether a custom element is actually defined on this page. */
function registered( tag: string ): boolean {
	return typeof customElements !== 'undefined' && !! customElements.get( tag );
}

export interface Option {
	value: string;
	label: string;
}

/**
 * A select that is `<os-select>` in the shell and a `<select>` outside it.
 *
 * Both report through the same `onChange`, so callers never branch on which one
 * they got.
 */
export function selectControl( opts: {
	label: string;
	value: string;
	options: Option[];
	/** Applied to the native fallback only — never to a component host. */
	className?: string;
	/**
	 * Keep the label for screen readers but off the screen.
	 *
	 * A toolbar is a row of controls read left to right, and stacking a caption
	 * over each one makes them taller than the plain buttons beside them — the
	 * row loses its baseline and the buttons float in the middle of it. The
	 * component reads `label || placeholder` for its accessible name, so
	 * passing the text as the placeholder keeps the control named without
	 * drawing a caption above it.
	 */
	hideLabel?: boolean;
	onChange: ( value: string ) => void;
} ): HTMLElement {
	if ( registered( 'os-select' ) ) {
		const select = document.createElement( 'os-select' );

		select.setAttribute( 'value', opts.value );

		if ( opts.hideLabel ) {
			select.setAttribute( 'placeholder', opts.label );
		} else {
			// The component renders this *and* wires the listbox to it, which
			// is the part a bare `aria-label` on a native select cannot do.
			select.setAttribute( 'label', opts.label );
		}

		// No class of ours on the host: the component owns its whole surface,
		// and our border and radius would layer a second edge over its own.
		for ( const option of opts.options ) {
			const el = document.createElement( 'os-option' );
			el.setAttribute( 'value', option.value );
			el.textContent = option.label;
			select.appendChild( el );
		}

		select.addEventListener( 'os-pick', ( event ) => {
			const value = ( event as CustomEvent< { value?: string } > ).detail?.value;

			if ( typeof value === 'string' ) {
				opts.onChange( value );
			}
		} );

		return select;
	}

	const select = document.createElement( 'select' );
	select.className = opts.className ?? '';
	select.setAttribute( 'aria-label', opts.label );

	for ( const option of opts.options ) {
		const el = document.createElement( 'option' );
		el.value = option.value;
		el.textContent = option.label;
		select.appendChild( el );
	}

	select.value = opts.value;
	select.addEventListener( 'change', () => opts.onChange( select.value ) );

	return select;
}

/**
 * A button that is `<os-button>` in the shell and a `<button>` outside it.
 *
 * For plain actions only. A **toggle** wants a native button: `<os-button>`
 * renders its real button inside shadow DOM and forwards no ARIA to it, so an
 * `aria-pressed` set on the host is announced to nobody — the state would be
 * visible and unreadable at once.
 *
 * @param variant   Passed through to `<os-button>`.
 * @param className Applied to the native fallback only; see below.
 */
export function buttonControl( opts: {
	label: string;
	variant?: 'primary' | 'secondary' | 'danger';
	className?: string;
	onClick: () => void;
} ): HTMLElement {
	if ( registered( 'os-button' ) ) {
		const button = document.createElement( 'os-button' );

		button.textContent = opts.label;

		if ( opts.variant ) {
			button.setAttribute( 'variant', opts.variant );
		}

		// The caller's class is deliberately *not* applied to the host. The
		// component owns its whole surface — border, radius, and an iridescent
		// hairline that lights on hover — and a border of ours on the host
		// layers a second outline over it, with our corner radius against its
		// own. The result is a doubled edge with notched corners.
		button.addEventListener( 'click', opts.onClick );

		return button;
	}

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = opts.className ?? 'atwork__button';
	button.textContent = opts.label;
	button.addEventListener( 'click', opts.onClick );

	return button;
}

/**
 * A single-line text field, as a component where one exists.
 *
 * `<os-text-field>` is *not* part of the overlay kit the shell pre-registers,
 * so on most pages this returns the native input — which is exactly why the
 * check is at runtime rather than assumed either way. When another bundle has
 * imported the kit, the board picks the component up for free.
 */
export function textControl( opts: {
	label: string;
	value?: string;
	placeholder?: string;
	type?: string;
	className?: string;
	/** As `selectControl` — named for screen readers, uncaptioned on screen. */
	hideLabel?: boolean;
	onInput: ( value: string ) => void;
} ): HTMLElement {
	if ( registered( 'os-text-field' ) ) {
		const field = document.createElement( 'os-text-field' );

		field.setAttribute( 'value', opts.value ?? '' );

		if ( opts.hideLabel ) {
			field.setAttribute( 'aria-label', opts.label );
		} else {
			field.setAttribute( 'label', opts.label );
		}

		if ( opts.placeholder ) {
			field.setAttribute( 'placeholder', opts.placeholder );
		}

		field.addEventListener( 'input', ( event ) => {
			const value = ( event.target as { value?: string } ).value;
			opts.onInput( typeof value === 'string' ? value : '' );
		} );

		return field;
	}

	const input = document.createElement( 'input' );
	input.type = opts.type ?? 'text';
	input.className = opts.className ?? '';
	input.setAttribute( 'aria-label', opts.label );
	input.value = opts.value ?? '';

	if ( opts.placeholder ) {
		input.placeholder = opts.placeholder;
	}

	input.addEventListener( 'input', () => opts.onInput( input.value ) );

	return input;
}

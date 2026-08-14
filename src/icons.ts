/**
 * The board's own icons, as inline SVG.
 *
 * Emoji were here first and were the wrong call. A 💬 is a *font* glyph: it
 * arrives at whatever size, weight and colour the platform's emoji font decides,
 * it cannot take `currentColor`, and it is drawn in full colour on macOS and as
 * a flat outline on most Linux desktops. A control whose icon changes shape
 * between the designer's screen and the user's is a control that cannot be
 * designed. It also cannot be *sized*: bumping the font-size of an emoji makes a
 * bigger picture, not a bigger button.
 *
 * These are paths. They scale with `inline-size`, they inherit `currentColor`,
 * and they look the same everywhere.
 *
 * All of them are `aria-hidden`. Every one sits inside a control that already
 * carries a real label, and an icon that announces itself as well makes a screen
 * reader say the same thing twice.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds an icon from a path.
 *
 * @param path   The `d` attribute.
 * @param size   Rendered size in pixels. Also the viewBox, which is always 24.
 * @param filled Whether to fill the path or stroke it.
 */
function icon( path: string, size: number, filled: boolean ): SVGElement {
	const svg = document.createElementNS( SVG_NS, 'svg' );

	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'width', String( size ) );
	svg.setAttribute( 'height', String( size ) );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.setAttribute( 'focusable', 'false' );

	const el = document.createElementNS( SVG_NS, 'path' );
	el.setAttribute( 'd', path );

	if ( filled ) {
		el.setAttribute( 'fill', 'currentColor' );
	} else {
		el.setAttribute( 'fill', 'none' );
		el.setAttribute( 'stroke', 'currentColor' );
		el.setAttribute( 'stroke-width', '1.8' );
		el.setAttribute( 'stroke-linecap', 'round' );
		el.setAttribute( 'stroke-linejoin', 'round' );
	}

	svg.appendChild( el );

	return svg;
}

/** A rounded speech bubble with a tail at the bottom left. */
const BUBBLE =
	'M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l4.5-4H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z';

/**
 * The comment bubble.
 *
 * Outlined when the thread is empty and solid once it has something in it, so
 * the card answers "has anyone said anything here" from across the board without
 * anyone reading the number. That is the same distinction every mail and chat
 * client draws between read and unread, and it is legible at a glance in a way a
 * count alone is not.
 *
 * @param filled Whether the thread has comments.
 * @param size   Rendered size in pixels.
 */
export function bubbleIcon( filled: boolean, size = 15 ): SVGElement {
	return icon( BUBBLE, size, filled );
}

/** A paper plane, for the send button. */
export function sendIcon( size = 15 ): SVGElement {
	return icon( 'M4 12l16-8-6 16-3-6-7-2z', size, true );
}

/** A cross, for closing a panel or removing a line. */
export function closeIcon( size = 14 ): SVGElement {
	return icon( 'M6 6l12 12M18 6L6 18', size, false );
}

/** A wastebasket, for deleting one's own comment. */
export function trashIcon( size = 13 ): SVGElement {
	return icon( 'M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v5M14 11v5', size, false );
}

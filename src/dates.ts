/**
 * Due dates.
 *
 * Its own module because the board and the widget both render due dates and both
 * decide what counts as overdue, and those two answers have to be the same one.
 * A card the board paints red and the widget paints grey is not a styling
 * inconsistency — it is the two views disagreeing about whether the work is
 * late.
 *
 * Everything here is string arithmetic on `YYYY-MM-DD`, deliberately. `new
 * Date( '2026-01-09' )` parses as *UTC* midnight, so for anyone west of
 * Greenwich it is still the 8th locally for most of their working day: a task
 * due today renders as overdue, and yesterday's genuinely overdue task renders
 * as due today. Zero-padded ISO dates sort lexicographically, so `<` is the
 * whole comparison and no timezone enters into it.
 */

/** Today in the viewer's own timezone, in the shape the server sends. */
export function today(): string {
	const now = new Date();
	const pad = ( n: number ) => String( n ).padStart( 2, '0' );

	return `${ now.getFullYear() }-${ pad( now.getMonth() + 1 ) }-${ pad( now.getDate() ) }`;
}

/** Whether a due date has already passed. Undated work is never overdue. */
export function isOverdue( due: string ): boolean {
	return !! due && due < today();
}

/**
 * A due date a person can read at a glance.
 *
 * "Today" is spelled out because it is the one date that changes what you do
 * next. Everything else gets a short month and day; the year is omitted because
 * a board showing work due in a different year has a bigger problem than
 * formatting.
 */
export function formatDue( due: string ): string {
	if ( ! due ) {
		return '';
	}

	if ( due === today() ) {
		return 'Today';
	}

	const [ year, month, day ] = due.split( '-' ).map( Number );

	// Constructed from parts rather than parsed from the string, so the Date is
	// local midnight and `toLocaleDateString` cannot shift it a day.
	return new Date( year, month - 1, day ).toLocaleDateString( undefined, {
		month: 'short',
		day: 'numeric',
	} );
}

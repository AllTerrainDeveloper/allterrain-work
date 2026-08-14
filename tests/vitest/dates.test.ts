/**
 * Due-date arithmetic.
 *
 * The timezone cases are the reason this module exists at all, so they are the
 * cases worth pinning: a due date must mean the same thing to the board and the
 * widget, and neither may drift a day because the viewer happens to be west of
 * Greenwich.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDue, isOverdue, today } from '../../src/dates';

/** Pins the clock to a local wall-clock instant. */
function freeze( year: number, month: number, day: number, hour = 12 ): void {
	vi.useFakeTimers();
	vi.setSystemTime( new Date( year, month - 1, day, hour, 0, 0 ) );
}

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'today', () => {
	it( 'zero-pads so dates compare lexicographically', () => {
		freeze( 2026, 3, 7 );

		expect( today() ).toBe( '2026-03-07' );
	} );

	it( 'reports the local date, not the UTC one', () => {
		// 21:00 local. Anywhere east of UTC this instant is already tomorrow in
		// UTC, and a UTC-derived "today" would put the board a day ahead.
		freeze( 2026, 3, 7, 21 );

		expect( today() ).toBe( '2026-03-07' );
	} );
} );

describe( 'isOverdue', () => {
	it( 'is false for undated work', () => {
		freeze( 2026, 3, 7 );

		expect( isOverdue( '' ) ).toBe( false );
	} );

	it( 'is false on the due date itself', () => {
		freeze( 2026, 3, 7 );

		expect( isOverdue( '2026-03-07' ) ).toBe( false );
	} );

	it( 'is true the day after', () => {
		freeze( 2026, 3, 8 );

		expect( isOverdue( '2026-03-07' ) ).toBe( true );
	} );

	it( 'does not turn today into yesterday early in the morning', () => {
		// 01:00 local, which is the previous day in UTC for anyone west of
		// Greenwich. Parsing the due date through `new Date( '…' )` here is
		// what used to mark today's work overdue before breakfast.
		freeze( 2026, 3, 7, 1 );

		expect( isOverdue( '2026-03-07' ) ).toBe( false );
	} );

	it( 'compares across a year boundary', () => {
		freeze( 2026, 1, 1 );

		expect( isOverdue( '2025-12-31' ) ).toBe( true );
		expect( isOverdue( '2026-01-02' ) ).toBe( false );
	} );
} );

describe( 'formatDue', () => {
	it( 'renders nothing for undated work', () => {
		expect( formatDue( '' ) ).toBe( '' );
	} );

	it( 'spells out today', () => {
		freeze( 2026, 3, 7 );

		expect( formatDue( '2026-03-07' ) ).toBe( 'Today' );
	} );

	it( 'renders another day as month and day, in the local calendar', () => {
		freeze( 2026, 3, 7 );

		// Locale-dependent formatting, so assert the parts rather than an exact
		// string: what matters is that the day did not shift.
		const formatted = formatDue( '2026-03-09' );

		expect( formatted ).not.toBe( 'Today' );
		expect( formatted ).toMatch( /9/ );
	} );
} );

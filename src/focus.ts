/**
 * Handing a project from one bundle to another.
 *
 * "Open the work board" from a project's Explorer preview should open the board
 * *on that project*, not on everything. But the button lives in the Explorer
 * bundle and the filter lives in the board bundle, and the two are separately
 * compiled: a module-scope variable set in one is invisible to the other, same
 * source or not.
 *
 * `wp.os.createSharedStore()` is the framework's answer — one window-level slot
 * keyed by a string, mutate-then-notify, subscribers from any bundle.
 *
 * It also solves the ordering problem, which a plain broadcast would not. The
 * board window usually is not open when the button is pressed, so a message
 * sent at that moment has nobody listening. A store holds the value instead:
 * the board reads it when it mounts, however much later that is, and subscribes
 * for the times it was already open.
 */

/** What the two bundles agree to share. */
export interface FocusState {
	/** The project the board should narrow to, or 0 for all. */
	projectId: number;
	/** Bumped on every request, so asking twice for the same project still counts. */
	requestedAt: number;
}

interface SharedStore< T > {
	state: T;
	getState: () => T;
	notify: () => void;
	subscribe: ( cb: ( state: T ) => void ) => () => void;
}

const KEY = 'allterrain-work/focus';

/** The store, or null on a page with no shell to host it. */
function store(): SharedStore< FocusState > | null {
	const create = ( window as unknown as {
		wp?: { os?: { createSharedStore?: < T >( key: string, init: () => T ) => SharedStore< T > } };
	} ).wp?.os?.createSharedStore;

	if ( ! create ) {
		return null;
	}

	return create< FocusState >( KEY, () => ( { projectId: 0, requestedAt: 0 } ) );
}

/**
 * Asks the board to narrow to a project.
 *
 * Safe to call before the board exists — that is the normal case.
 *
 * @param projectId Project to focus, or 0 to clear.
 */
export function requestProjectFocus( projectId: number ): void {
	const shared = store();

	if ( ! shared ) {
		return;
	}

	shared.state.projectId = projectId;
	// A counter rather than a boolean flag: pressing the button twice for the
	// same project is a real request both times, and a value that did not
	// change would be indistinguishable from no request at all.
	shared.state.requestedAt += 1;
	shared.notify();
}

/**
 * Watches for focus requests, and replays one already waiting.
 *
 * The replay is the point: the button is almost always pressed *before* the
 * board is open, so a board that only subscribed would miss the very request
 * that opened it.
 *
 * @param apply Called with the project id to narrow to.
 * @return Unsubscribe.
 */
export function onProjectFocus( apply: ( projectId: number ) => void ): () => void {
	const shared = store();

	if ( ! shared ) {
		return () => undefined;
	}

	let seen = shared.getState().requestedAt;

	if ( seen > 0 ) {
		apply( shared.getState().projectId );
	}

	return shared.subscribe( ( state ) => {
		if ( state.requestedAt === seen ) {
			return;
		}

		seen = state.requestedAt;
		apply( state.projectId );
	} );
}

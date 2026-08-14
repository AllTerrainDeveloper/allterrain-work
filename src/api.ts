/**
 * Talking to WordPress.
 *
 * One thin client over the plugin's REST namespace, shared by the board and the
 * widget. Two things it does that a bare `fetch()` would not:
 *
 *   1. Routes through `wp.os.fetch()` when the shell is present. That is not
 *      cosmetic -- the shell's fetch pulses the window's title-bar activity dot,
 *      reports onto the activity bus, and refreshes a REST nonce that has gone
 *      stale mid-session. A raw `fetch()` in a desktop that has been open for
 *      six hours starts returning 403s that look like permission bugs.
 *   2. Turns a WordPress `WP_Error` JSON body into a thrown `ApiError` carrying
 *      the server's own message, so the UI can show what actually went wrong
 *      instead of "Request failed".
 */

import type { Assignee, Board, Config, MyWork, Project, ProjectDetail, ShellApi, Status, Task, TaskComment, TaskInput } from './types';

/**
 * The framework's content-change topics this plugin listens on.
 *
 * `os.<type>.changed` where `<type>` is the post-type slug — the same channels
 * OpenStation's own Heartbeat relay publishes on, so a change made anywhere
 * reaches the board without any private wiring.
 *
 * **Both types, not just tasks.** Subscribing only to the task topic is a bug
 * that hides well: everything on the board is a task, so it all looks live —
 * until somebody renames a project in the editor and every chip, dropdown entry
 * and panel heading on the board keeps showing the old name until a reload.
 * Projects change less often, which is exactly why the staleness survives long
 * enough to be believed.
 */
const CHANGE_TOPICS = [ 'os.atwork-task.changed', 'os.atwork-project.changed' ];

/**
 * How this *bundle instance* identifies its own broadcasts.
 *
 * Per-instance, not per-plugin, and the difference is load-bearing. The board
 * and the widget are separate bundles that both publish and both subscribe on
 * this topic. A shared `'allterrain-work'` source would make each of them
 * ignore the other — the widget would stop noticing cards dragged to Done,
 * which is the exact behaviour the broadcast exists to provide. A per-instance
 * id skips only the echo of a write this very module made.
 */
const BROADCAST_SOURCE = `allterrain-work/${ Math.random().toString( 36 ).slice( 2, 10 ) }`;

/** An error the server described. `code` is the `WP_Error` code. */
export class ApiError extends Error {
	public readonly code: string;
	public readonly status: number;

	constructor( message: string, code: string, status: number ) {
		super( message );
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Reads the config PHP printed.
 *
 * Throws rather than returning a default, because every caller needs the REST
 * nonce and a board that silently issued unauthenticated requests would look
 * like an empty board rather than a broken one.
 */
export function getConfig(): Config {
	const config = ( window as unknown as { allTerrainWork?: Config } ).allTerrainWork;

	if ( ! config || ! config.restUrl ) {
		throw new Error(
			'[allterrain-work] window.allTerrainWork is missing. The `allterrain-work-config` script handle was not enqueued on this page.'
		);
	}

	return config;
}

/** The shell, if this page has one. */
export function getShell(): ShellApi | null {
	const wp = ( window as unknown as { wp?: { os?: ShellApi } } ).wp;

	return wp?.os ?? null;
}

/** Whether the desktop shell is mounted and usable right now. */
export function shellIsActive(): boolean {
	const shell = getShell();

	// `isActive()` is the shell's own answer to "am I mounted". Its absence on
	// an older build is not proof of anything, so fall back to "the drag
	// manager exists", which is the capability this plugin actually wants.
	return !! shell && ( shell.isActive ? shell.isActive() : !! shell.dragManager );
}

/**
 * One request.
 *
 * @param path   Path under the plugin's REST namespace, e.g. `/board`.
 * @param init   Fetch options. `method` defaults to GET.
 * @param silent Suppress the shell's activity indicator, for background polls.
 */
async function request< T >( path: string, init: RequestInit = {}, silent = false ): Promise< T > {
	const config = getConfig();
	const shell = getShell();
	const url = config.restUrl.replace( /\/$/, '' ) + path;

	const headers: Record< string, string > = {
		Accept: 'application/json',
		...( ( init.headers as Record< string, string > ) ?? {} ),
	};

	if ( init.body ) {
		headers[ 'Content-Type' ] = 'application/json';
	}

	// The shell injects the nonce itself and keeps it fresh; without the shell
	// nobody else will, so send the one PHP printed.
	if ( ! shell?.fetch ) {
		headers[ 'X-WP-Nonce' ] = config.nonce;
	}

	const options: RequestInit = { credentials: 'same-origin', ...init, headers };

	const response = shell?.fetch
		? await shell.fetch( url, options, { source: 'allterrain-work', silent } )
		: await fetch( url, options );

	if ( ! response.ok ) {
		let message = response.statusText || 'Request failed';
		let code = 'atwork_request_failed';

		try {
			const body = ( await response.json() ) as { message?: string; code?: string };
			message = body.message ?? message;
			code = body.code ?? code;
		} catch {
			// A non-JSON error body -- a PHP fatal, an nginx page, a login
			// redirect. The status line is all there is to report.
		}

		throw new ApiError( message, code, response.status );
	}

	// 204 has no body to parse, and `DELETE` may legitimately answer with one.
	if ( response.status === 204 ) {
		return undefined as T;
	}

	return ( await response.json() ) as T;
}

/** Everything the board needs, in one round trip. */
export function fetchBoard( projectId = 0 ): Promise< Board > {
	const query = projectId > 0 ? `?project=${ projectId }` : '';

	return request< Board >( `/board${ query }` );
}

/** One person's queue. `silent` for the widget's background refresh. */
export function fetchMyWork( projects: number[] = [], limit = 25, silent = false ): Promise< MyWork > {
	const params = new URLSearchParams();

	projects.forEach( ( id ) => params.append( 'projects[]', String( id ) ) );
	params.set( 'limit', String( limit ) );

	return request< MyWork >( `/my-work?${ params.toString() }`, {}, silent );
}

/** Creates a task. */
export function createTask( input: TaskInput ): Promise< Task > {
	return request< Task >( '/tasks', { method: 'POST', body: JSON.stringify( input ) } );
}

/** Changes some of a task's fields. Omitted keys are left alone. */
export function updateTask( id: number, input: TaskInput ): Promise< Task > {
	return request< Task >( `/tasks/${ id }`, { method: 'PATCH', body: JSON.stringify( input ) } );
}

/** Moves a card into a column at an index. One atomic write server-side. */
export function moveTask( id: number, status: number, position: number ): Promise< Task > {
	return request< Task >( `/tasks/${ id }/move`, {
		method: 'POST',
		body: JSON.stringify( { status, position } ),
	} );
}

/**
 * The people a task can be assigned to, optionally filtered by name.
 *
 * Silent: the picker fetches while the user types, and a spinner pulsing in the
 * window title bar on every keystroke reads as the window being in trouble.
 */
export function fetchAssignees( search = '' ): Promise< Assignee[] > {
	const query = search ? `?search=${ encodeURIComponent( search ) }` : '';

	return request< Assignee[] >( `/assignees${ query }`, {}, true );
}

/** The discussion on a task, oldest first. */
export function fetchComments( taskId: number ): Promise< TaskComment[] > {
	return request< TaskComment[] >( `/tasks/${ taskId }/comments`, {}, true );
}

/** Adds a comment to a task. */
export function addComment( taskId: number, content: string ): Promise< TaskComment > {
	return request< TaskComment >( `/tasks/${ taskId }/comments`, {
		method: 'POST',
		body: JSON.stringify( { content } ),
	} );
}

/** Removes a comment. Trashed, not destroyed. */
export function deleteComment( commentId: number ): Promise< { deleted: boolean; id: number } > {
	return request( `/comments/${ commentId }`, { method: 'DELETE' } );
}

/** Attaches posts, pages, media or custom posts to a task. */
export function attachToTask( id: number, ids: number[] ): Promise< Task[ 'links' ] > {
	return request( `/tasks/${ id }/links`, { method: 'POST', body: JSON.stringify( { ids } ) } );
}

/** Removes one attachment. Unlinks it — never deletes the linked post. */
export function detachFromTask( id: number, linked: number ): Promise< Task[ 'links' ] > {
	return request( `/tasks/${ id }/links/${ linked }`, { method: 'DELETE' } );
}

/** Sends a project to the trash. Its tasks are left alone. */
export function trashProject( id: number ): Promise< { deleted: boolean; id: number } > {
	return request( `/projects/${ id }`, { method: 'DELETE' } );
}

/** Sends a task to the trash. */
export function trashTask( id: number ): Promise< { deleted: boolean; id: number } > {
	return request( `/tasks/${ id }`, { method: 'DELETE' } );
}

/** Creates a project. */
export function createProject( title: string ): Promise< Project > {
	return request< Project >( '/projects', { method: 'POST', body: JSON.stringify( { title } ) } );
}

/** One project with its counts, members and per-column breakdown. */
export function fetchProject( id: number ): Promise< ProjectDetail > {
	return request< ProjectDetail >( `/projects/${ id }` );
}

/** Adds a column to the board. */
export function createStatus( name: string ): Promise< Status > {
	return request< Status >( '/statuses', { method: 'POST', body: JSON.stringify( { name } ) } );
}

/**
 * Tells the rest of the desktop that a task changed.
 *
 * The widget listens, and so does any other window subscribed to the type's
 * topic. Without it, someone who drags a card to Done watches their My Work
 * widget keep listing it until the next poll — two views of the same work
 * disagreeing on screen at the same time.
 *
 * This is the instant path. The server records the same change into
 * OpenStation's changelog, which reaches other tabs and other users on the next
 * Heartbeat tick; a listener may therefore hear about one change twice, which is
 * why every handler here re-reads rather than applying a delta.
 */
export function announceChange( action: string, ids: number[] ): void {
	// Only the task topic: this plugin's own writes are task writes. A project
	// rename comes from the editor, and the framework announces that one itself.
	getShell()?.broadcast?.( CHANGE_TOPICS[ 0 ], { source: BROADCAST_SOURCE, action, ids } );
}

/**
 * Subscribes to task changes from anywhere — this window, another window,
 * another user, wp-admin, WP-CLI, an agent calling the ability.
 *
 * The topic is the framework's own `os.<type>.changed` family, not a private
 * one, which is what makes that list complete. OpenStation records every
 * mutation of a `show_ui` post type into a changelog and relays it three ways:
 * instantly through the chromeless footer, instantly from the block editor, and
 * within one Heartbeat tick to every other tab and every other user. Subscribing
 * here is the entire cost of being live.
 *
 * Echoes of this module's own writes are skipped. The board already re-reads
 * after a move, and reloading a second time because it heard itself would double
 * every request and, mid-drag, fight the user for the DOM.
 */
export function onChange( cb: () => void ): () => void {
	const shell = getShell();

	if ( ! shell?.subscribe ) {
		return () => undefined;
	}

	const listener = ( payload: unknown ) => {
		if ( ( payload as { source?: string } )?.source === BROADCAST_SOURCE ) {
			return;
		}

		cb();
	};

	const unsubscribes = CHANGE_TOPICS.map( ( topic ) => shell.subscribe!( topic, listener ) );

	return () => unsubscribes.forEach( ( off ) => off() );
}

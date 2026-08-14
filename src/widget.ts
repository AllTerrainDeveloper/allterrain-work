/**
 * The My Work widget.
 *
 * A card in the desktop's widget column showing what *you* have to do — never
 * the whole board, always the current user's open tasks, soonest first. The
 * server does the filtering (`atwork_get_my_work()` scopes to the viewer and
 * refuses to list anyone else without `list_users`), so this is not a client-
 * side hide of data the browser was sent anyway.
 *
 * Two things make it useful rather than decorative:
 *
 *   1. **A project picker.** Most people are on several projects and care about
 *      one or two on any given day. The picked set persists through
 *      `ctx.storage`, which is namespaced per widget id, so the choice survives
 *      reloads without colliding with any other widget's preferences.
 *   2. **It agrees with the board.** It listens on the same cross-window topic
 *      the board broadcasts on, so dragging a card to Done in the board window
 *      strikes it from the widget immediately rather than up to a minute later.
 *      Two views of the same work disagreeing on screen is the specific failure
 *      that makes a dashboard widget untrustworthy.
 *
 * Polling is the backstop for changes that came from somewhere else entirely —
 * another user, wp-admin, an agent calling the ability — and it stops while the
 * tab is hidden. Nobody sees the repaint and the requests still hit the server.
 */

import type { MyWork, Project, Task } from './types';
import { fetchMyWork, getConfig, onChange } from './api';
import { formatDue, isOverdue } from './dates';
import { routeLinkIntoShell } from './open';

const WIDGET_ID = 'allterrain-work/my-work';

/**
 * How often to re-ask the server when nothing has announced a change.
 *
 * A backstop, not the delivery mechanism. Changes arrive on the content-change
 * bus — instantly from this browser, and within a Heartbeat tick from anyone
 * else — so polling only has to cover the case where the shell is absent
 * entirely and there is no bus at all. Five minutes rather than two because a
 * tighter interval buys nothing and costs every idle desktop a request.
 */
const POLL_MS = 300_000;

/** Storage key for the picked project set. */
const PICKED_KEY = 'projects';

/** The shell's per-widget scratch pad. */
interface WidgetStorage {
	get< T = unknown >( key: string ): T | null;
	set< T = unknown >( key: string, value: T ): void;
	remove( key: string ): void;
	clear(): void;
}

interface WidgetContext {
	id: string;
	pluginUrl: string;
	storage: WidgetStorage;
}

type WidgetTeardown = () => void;

/**
 * Mounts the widget.
 *
 * @param container The card body. Already styled by the shell.
 * @param ctx       Widget context — `storage` is the only part used.
 * @return Teardown reversing every side effect.
 */
async function mount( container: HTMLElement, ctx: WidgetContext ): Promise< WidgetTeardown > {
	// Declared first and checked after every await: the user can remove the
	// widget while a request is in flight, and writing into a detached node is
	// how a removed widget keeps holding a timer alive.
	let destroyed = false;

	let picked: number[] = ctx.storage.get< number[] >( PICKED_KEY ) ?? [];

	const root = document.createElement( 'div' );
	root.className = 'atwork-widget';
	container.appendChild( root );

	const header = document.createElement( 'div' );
	header.className = 'atwork-widget__header';
	root.appendChild( header );

	const counts = document.createElement( 'div' );
	counts.className = 'atwork-widget__counts';
	header.appendChild( counts );

	const filterButton = document.createElement( 'button' );
	filterButton.type = 'button';
	filterButton.className = 'atwork-widget__filter';
	filterButton.setAttribute( 'aria-expanded', 'false' );
	filterButton.setAttribute( 'aria-label', 'Choose projects' );
	filterButton.textContent = 'Projects';
	header.appendChild( filterButton );

	const picker = document.createElement( 'div' );
	picker.className = 'atwork-widget__picker';
	picker.hidden = true;
	root.appendChild( picker );

	const list = document.createElement( 'ul' );
	list.className = 'atwork-widget__list';
	root.appendChild( list );

	const status = document.createElement( 'p' );
	status.className = 'atwork-widget__status';
	status.textContent = 'Loading…';
	root.appendChild( status );

	filterButton.addEventListener( 'click', () => {
		picker.hidden = ! picker.hidden;
		filterButton.setAttribute( 'aria-expanded', String( ! picker.hidden ) );
	} );

	/** Redraws the project checkboxes from the last payload. */
	const renderPicker = ( projects: Project[] ) => {
		picker.replaceChildren();

		if ( ! projects.length ) {
			const none = document.createElement( 'p' );
			none.className = 'atwork-widget__picker-empty';
			none.textContent = 'No projects yet.';
			picker.appendChild( none );

			return;
		}

		const all = document.createElement( 'button' );
		all.type = 'button';
		all.className = 'atwork-widget__picker-all';
		all.textContent = picked.length ? 'Show all projects' : 'Showing all projects';
		all.disabled = ! picked.length;
		all.addEventListener( 'click', () => {
			picked = [];
			ctx.storage.set( PICKED_KEY, picked );
			void refresh();
		} );
		picker.appendChild( all );

		for ( const project of projects ) {
			const label = document.createElement( 'label' );
			label.className = 'atwork-widget__picker-row';

			const box = document.createElement( 'input' );
			box.type = 'checkbox';
			// An empty pick means "all", so every box reads as checked. Showing
			// them all unchecked while the list shows every project would say
			// the filter is off when it is merely empty.
			box.checked = picked.length === 0 || picked.includes( project.id );
			box.addEventListener( 'change', () => {
				const base = picked.length ? picked : projects.map( ( p ) => p.id );
				const next = box.checked
					? Array.from( new Set( [ ...base, project.id ] ) )
					: base.filter( ( id ) => id !== project.id );

				// Every box ticked is the same view as none ticked. Storing it
				// as "all" keeps a project added tomorrow visible instead of
				// silently excluded by a set frozen today.
				picked = next.length === projects.length ? [] : next;
				ctx.storage.set( PICKED_KEY, picked );
				void refresh();
			} );

			const name = document.createElement( 'span' );
			name.textContent = project.title;

			label.appendChild( box );
			label.appendChild( name );
			picker.appendChild( label );
		}
	};

	const renderCounts = ( data: MyWork ) => {
		counts.replaceChildren();

		const pairs: Array< [ string, number, string ] > = [
			[ 'Overdue', data.counts.overdue, 'is-overdue' ],
			[ 'Today', data.counts.today, 'is-today' ],
			[ 'Open', data.counts.total, '' ],
		];

		for ( const [ label, value, modifier ] of pairs ) {
			// A zero overdue count is good news, and printing "0 overdue" turns
			// good news into visual noise. Open always shows, because "0 open"
			// is the whole point of a done day.
			if ( ! value && modifier ) {
				continue;
			}

			const chip = document.createElement( 'span' );
			chip.className = `atwork-widget__count ${ modifier }`.trim();
			chip.textContent = `${ value } ${ label.toLowerCase() }`;
			counts.appendChild( chip );
		}
	};

	const renderList = ( tasks: Task[], projects: Project[] ) => {
		list.replaceChildren();

		if ( ! tasks.length ) {
			status.textContent = picked.length
				? 'Nothing open in the projects you picked.'
				: 'Nothing assigned to you. Enjoy it.';
			status.hidden = false;

			return;
		}

		status.hidden = true;

		for ( const task of tasks ) {
			const item = document.createElement( 'li' );
			item.className = 'atwork-widget__item';

			const link = document.createElement( 'a' );
			link.className = 'atwork-widget__link';
			link.href = task.editUrl || '#';
			link.textContent = task.title;
			// A widget lives on the desk. Sending the user to a browser tab from
			// it is the one thing guaranteed to lose them the desk they were
			// glancing at.
			routeLinkIntoShell( link, task.title, 'dashicons-yes-alt' );
			item.appendChild( link );

			const meta = document.createElement( 'span' );
			meta.className = 'atwork-widget__item-meta';

			const project = projects.find( ( p ) => p.id === task.projectId );

			if ( project ) {
				const chip = document.createElement( 'span' );
				chip.className = 'atwork-widget__item-project';
				chip.textContent = project.title;
				meta.appendChild( chip );
			}

			if ( task.due ) {
				const due = document.createElement( 'span' );
				due.className = 'atwork-widget__item-due';
				due.textContent = formatDue( task.due );

				if ( isOverdue( task.due ) ) {
					due.classList.add( 'is-overdue' );
				}

				meta.appendChild( due );
			}

			if ( meta.childElementCount ) {
				item.appendChild( meta );
			}

			list.appendChild( item );
		}
	};

	const refresh = async ( silent = true ) => {
		if ( destroyed ) {
			return;
		}

		try {
			const data = await fetchMyWork( picked, 12, silent );

			if ( destroyed ) {
				return;
			}

			renderCounts( data );
			renderList( data.tasks, data.projects );
			renderPicker( data.projects );
		} catch ( error ) {
			if ( destroyed ) {
				return;
			}

			status.hidden = false;
			status.textContent =
				error instanceof Error ? error.message : 'Your work could not be loaded.';
		}
	};

	await refresh( false );

	// The board announces its own writes, so a drag to Done updates the widget
	// without waiting for the next poll.
	const unsubscribe = onChange( () => void refresh() );

	let timer: ReturnType< typeof setInterval > | null = null;
	let lastRunMs = Date.now();

	const startPolling = () => {
		if ( timer === null ) {
			timer = setInterval( () => {
				lastRunMs = Date.now();
				void refresh();
			}, POLL_MS );
		}
	};

	const stopPolling = () => {
		if ( timer !== null ) {
			clearInterval( timer );
			timer = null;
		}
	};

	const onVisibility = () => {
		if ( document.hidden ) {
			stopPolling();

			return;
		}

		// Catch up on reveal only if the data has actually gone stale; a quick
		// tab flip should not cost a request.
		if ( Date.now() - lastRunMs >= POLL_MS ) {
			lastRunMs = Date.now();
			void refresh();
		}

		startPolling();
	};

	document.addEventListener( 'visibilitychange', onVisibility );

	if ( ! document.hidden ) {
		startPolling();
	}

	return () => {
		destroyed = true;
		stopPolling();
		unsubscribe();
		document.removeEventListener( 'visibilitychange', onVisibility );
		root.remove();
	};
}

// Fail loudly here rather than at mount: a widget whose config never arrived
// renders an empty card, and an empty card looks like "no work" rather than
// "no data".
try {
	getConfig();
} catch ( error ) {
	// eslint-disable-next-line no-console
	console.error( error );
}

const w = window as unknown as {
	openStationWidgets?: Record< string, typeof mount >;
};

w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;

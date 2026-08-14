/**
 * Making WP Explorer show what a task actually is.
 *
 * Out of the box the Explorer gives a custom post type a folder of tiles that
 * know their title, and a preview pane that renders the post body. For a task
 * that is close to nothing: the title is the least interesting field, and the
 * body is usually empty. Which column is it in? Whose is it? Is it late?
 *
 * Four seams answer that, all documented, none requiring a fork:
 *
 *   - **`preview-extras`** paints the fields into the right pane's `meta` slot.
 *     This is the preview proper — status, assignee, due date, priority,
 *     project, and the post a task was made from.
 *   - **`list-bands`** splits the Tasks grid into one band per column, so
 *     browsing the folder has the same shape as the board.
 *   - **`list-tile`** marks overdue tiles, so a late task is visible before you
 *     click it.
 *   - **`status-bar`** counts what the current view is showing.
 *
 * None of it would work without `listFields` on the PHP side: the window sends
 * an explicit `_fields` list, and anything not named there is stripped off the
 * rows before this file sees them.
 */

import { formatDue, isOverdue } from './dates';
import { requestProjectFocus } from './focus';

/** The config PHP prints for every bundle. */
interface Config {
	adminUrl: string;
	priorities: string[];
	/**
	 * The REST field a task's status arrives under.
	 *
	 * Sent from PHP because it is the taxonomy's `rest_base`, not its slug, and
	 * here the two differ (`atwork-statuses` vs `atwork-status`). Guessing gives
	 * an undefined field and no error — every task looks unfiled.
	 */
	statusField: string;
	/**
	 * Every column, shipped with the page.
	 *
	 * The banding filter is consulted synchronously while the section is set
	 * up. A fetch started there answers long after the question, so the grid
	 * renders unbanded and stays that way until something forces a re-render.
	 * PHP knows the columns at render time; carrying them removes the race
	 * instead of trying to win it.
	 */
	statuses: Array< { id: number; name: string; color: string; order: number } >;
}

/** One row as the Explorer's list request returns it. */
interface Row {
	id: number;
	title?: { rendered?: string };
	meta?: Record< string, unknown >;
	[ key: string ]: unknown;
}

/** The entity descriptor a band filter is asked about. */
interface Entity {
	id: string;
	post_type?: string;
}

/** What `preview-extras` hands a listener. */
interface PreviewExtras {
	slot: 'header' | 'meta' | 'footer';
	container: HTMLElement;
	entityId: string;
	kind: string;
	item: Row;
}

interface Banding {
	bands: Array< { id: string; label: string; order?: number } >;
	assign: ( item: Row ) => string | null;
}

/** Section ids, matching `cpt-<slug>` as the Explorer keys them. */
const TASK_SECTION = 'cpt-atwork-task';
const PROJECT_SECTION = 'cpt-atwork-project';

const META = {
	project: '_atwork_project',
	owner: '_atwork_owner',
	due: '_atwork_due',
	priority: '_atwork_priority',
	source: '_atwork_source',
	lead: '_atwork_lead',
	start: '_atwork_start',
	target: '_atwork_target',
	state: '_atwork_state',
	color: '_atwork_color',
} as const;

const STATE_LABELS: Record< string, string > = {
	planning: 'Planning',
	active: 'Active',
	'on-hold': 'On hold',
	done: 'Done',
};

const hooks = ( window as unknown as {
	wp?: { hooks?: { addFilter?: Function; addAction?: Function } };
} ).wp?.hooks;

const config = ( window as unknown as { allTerrainWork?: Config } ).allTerrainWork;

/** The columns, keyed by term id — straight from the page, never fetched. */
const statuses = new Map< number, { name: string; color: string; order: number } >(
	( config?.statuses ?? [] ).map( ( status ) => [
		status.id,
		{ name: status.name, color: status.color, order: status.order },
	] )
);

/** The status term id on a row, or 0. */
function statusOf( item: Row ): number {
	const terms = item[ config?.statusField ?? 'atwork-statuses' ];

	return Array.isArray( terms ) && terms.length ? Number( terms[ 0 ] ) : 0;
}

function metaString( item: Row, key: string ): string {
	const value = item.meta?.[ key ];

	return value === undefined || value === null ? '' : String( value );
}

function metaNumber( item: Row, key: string ): number {
	const value = Number( item.meta?.[ key ] ?? 0 );

	return Number.isFinite( value ) ? value : 0;
}

/** One `label: value` line in the preview pane. */
function row( label: string, value: Node | string, modifier = '' ): HTMLElement {
	const line = document.createElement( 'div' );
	line.className = `atwork-preview__row ${ modifier }`.trim();

	const key = document.createElement( 'span' );
	key.className = 'atwork-preview__label';
	key.textContent = label;

	const val = document.createElement( 'span' );
	val.className = 'atwork-preview__value';

	if ( typeof value === 'string' ) {
		val.textContent = value;
	} else {
		val.appendChild( value );
	}

	line.append( key, val );

	return line;
}

/** A coloured status pill. */
function statusChip( name: string, color: string ): HTMLElement {
	const chip = document.createElement( 'span' );
	chip.className = 'atwork-preview__chip';
	chip.style.setProperty( '--atwork-chip-color', color );
	chip.textContent = name;

	return chip;
}

/**
 * The fields a preview needs, fetched when the row does not already carry them.
 *
 * The pane's `item` is not the same shape as a list row: the list request asks
 * for the section's `listFields`, and the single-row fetch behind a preview
 * does not, so `meta` and the status term can simply be absent. Rendering
 * whatever happens to be on the object produced an empty block — no fields, no
 * error, no clue which of the two shapes was in play.
 *
 * Cached per id, because the pane re-renders on every selection and a user
 * clicking back and forth between two tasks should not re-ask for each.
 */
const rowCache = new Map< number, Promise< Row > >();

function withFields( item: Row ): Promise< Row > {
	if ( item.meta && item[ config?.statusField ?? '' ] !== undefined ) {
		return Promise.resolve( item );
	}

	const cached = rowCache.get( item.id );

	if ( cached ) {
		return cached;
	}

	const root = ( window as unknown as { wpApiSettings?: { root?: string } } ).wpApiSettings?.root ?? '/wp-json/';
	const field = config?.statusField ?? '';
	const url =
		`${ root.replace( /\/$/, '' ) }/wp/v2/atwork-tasks/${ item.id }` +
		`?_fields=id,meta${ field ? ',' + field : '' }`;

	const promise = fetch( url, { credentials: 'same-origin' } )
		.then( ( response ) => ( response.ok ? response.json() : null ) )
		.then( ( row: Row | null ) => ( row ? { ...item, ...row } : item ) )
		.catch( () => item );

	rowCache.set( item.id, promise );

	return promise;
}

/** Resolves a user id to a display name, once per id. */
const userNames = new Map< number, Promise< string > >();

function userName( id: number ): Promise< string > {
	if ( ! id ) {
		return Promise.resolve( '' );
	}

	const cached = userNames.get( id );

	if ( cached ) {
		return cached;
	}

	const root = ( window as unknown as { wpApiSettings?: { root?: string } } ).wpApiSettings?.root ?? '/wp-json/';
	const promise = fetch( `${ root.replace( /\/$/, '' ) }/wp/v2/users/${ id }?_fields=name`, {
		credentials: 'same-origin',
	} )
		.then( ( response ) => ( response.ok ? response.json() : null ) )
		.then( ( user: { name?: string } | null ) => user?.name ?? '' )
		.catch( () => '' );

	userNames.set( id, promise );

	return promise;
}

/** A link that opens an admin URL as a desktop window. */
function windowLink( label: string, url: string, title: string ): HTMLElement {
	const link = document.createElement( 'a' );
	link.className = 'atwork-preview__link';
	link.href = url;
	link.textContent = label;
	link.addEventListener( 'click', ( event ) => {
		const os = ( window as unknown as {
			wp?: { os?: { deriveWindowId?: ( u: string ) => string; windowManager?: { open?: Function } } };
		} ).wp?.os;

		if ( ! os?.deriveWindowId || ! os.windowManager?.open || event.metaKey || event.ctrlKey ) {
			return;
		}

		event.preventDefault();
		const id = os.deriveWindowId( url );
		( os.windowManager.open as Function )( { id, baseId: id, url, title, icon: 'dashicons-yes-alt' } );
	} );

	return link;
}

if ( hooks?.addFilter && hooks.addAction && config ) {
	// -- The preview pane --------------------------------------------------

	hooks.addAction(
		'os.my-wordpress.preview-extras',
		'allterrain-work/preview',
		( ctx: PreviewExtras ) => {
			// `meta` and not `header`: a block of figures above the title reads
			// as a label on whatever comes next, and the reader cannot tell what
			// it describes until they have scrolled past it.
			if ( ctx.slot !== 'meta' ) {
				return;
			}

			if ( ctx.entityId === TASK_SECTION ) {
				renderTaskPreview( ctx );
			} else if ( ctx.entityId === PROJECT_SECTION ) {
				renderProjectPreview( ctx );
			}
		}
	);

	function renderTaskPreview( ctx: PreviewExtras ): void {
		const block = document.createElement( 'div' );
		block.className = 'atwork-preview';

		// Appended up front and filled in once the fields resolve. Waiting to
		// append would put the block after whatever else the pane paints into
		// this slot, which moves the fields around depending on how fast the
		// network is.
		ctx.container.appendChild( block );

		void withFields( ctx.item ).then( ( item ) => paintTask( block, item ) );
	}

	function paintTask( block: HTMLElement, item: Row ): void {
		const statusId = statusOf( item );
		const chipHost = document.createElement( 'span' );

		const status = statuses.get( statusId );

		if ( status ) {
			chipHost.appendChild( statusChip( status.name, status.color ) );
			block.appendChild( row( 'Status', chipHost ) );
		}

		const ownerId = metaNumber( item, META.owner );

		if ( ownerId ) {
			const nameHost = document.createElement( 'span' );
			nameHost.textContent = '…';
			block.appendChild( row( 'Assignee', nameHost ) );
			void userName( ownerId ).then( ( name ) => {
				nameHost.textContent = name || `#${ ownerId }`;
			} );
		}

		const due = metaString( item, META.due );

		if ( due ) {
			block.appendChild(
				row( 'Due', formatDue( due ), isOverdue( due ) ? 'is-overdue' : '' )
			);
		}

		const priority = metaString( item, META.priority );

		if ( priority && priority !== 'medium' ) {
			// Medium is the default every task carries, so printing it adds a
			// line that never distinguishes one task from another.
			block.appendChild( row( 'Priority', priority.charAt( 0 ).toUpperCase() + priority.slice( 1 ) ) );
		}

		const sourceId = metaNumber( item, META.source );

		if ( sourceId ) {
			block.appendChild(
				row(
					'About',
					windowLink(
						'Open the linked post',
						`${ config!.adminUrl.replace( /\/$/, '' ) }/post.php?post=${ sourceId }&action=edit`,
						'Linked post'
					)
				)
			);
		}

	}

	function renderProjectPreview( ctx: PreviewExtras ): void {
		const block = document.createElement( 'div' );
		block.className = 'atwork-preview';
		ctx.container.appendChild( block );

		if ( ctx.item.meta ) {
			paintProject( block, ctx.item );

			return;
		}

		const root = ( window as unknown as { wpApiSettings?: { root?: string } } ).wpApiSettings?.root ?? '/wp-json/';

		void fetch( `${ root.replace( /\/$/, '' ) }/wp/v2/atwork-projects/${ ctx.item.id }?_fields=id,meta`, {
			credentials: 'same-origin',
		} )
			.then( ( response ) => ( response.ok ? response.json() : null ) )
			.then( ( row: Row | null ) => paintProject( block, row ? { ...ctx.item, ...row } : ctx.item ) )
			.catch( () => undefined );
	}

	function paintProject( block: HTMLElement, item: Row ): void {
		const state = metaString( item, META.state ) || 'active';
		block.appendChild( row( 'State', STATE_LABELS[ state ] ?? state ) );

		const leadId = metaNumber( item, META.lead );

		if ( leadId ) {
			const nameHost = document.createElement( 'span' );
			nameHost.textContent = '…';
			block.appendChild( row( 'Lead', nameHost ) );
			void userName( leadId ).then( ( name ) => {
				nameHost.textContent = name || `#${ leadId }`;
			} );
		}

		const start = metaString( item, META.start );
		const target = metaString( item, META.target );

		if ( start ) {
			block.appendChild( row( 'Starts', formatDue( start ) ) );
		}

		if ( target ) {
			block.appendChild( row( 'Target', formatDue( target ), isOverdue( target ) ? 'is-overdue' : '' ) );
		}

		const colour = metaString( item, META.color );

		if ( colour ) {
			// A swatch beside the hex rather than the hex alone. The value is
			// only meaningful as a colour, and the name of a colour is the one
			// thing a reader cannot get from six hex digits.
			const swatch = document.createElement( 'span' );
			swatch.className = 'atwork-preview__swatch';
			swatch.style.setProperty( '--atwork-chip-color', colour );

			const label = document.createElement( 'span' );
			label.textContent = colour;

			const wrap = document.createElement( 'span' );
			wrap.className = 'atwork-preview__colour';
			wrap.append( swatch, label );

			block.appendChild( row( 'Colour', wrap ) );
		}
	}

	// -- Footer: back to the board ----------------------------------------

	hooks.addAction(
		'os.my-wordpress.preview-extras',
		'allterrain-work/preview-board-link',
		( ctx: PreviewExtras ) => {
			if ( ctx.slot !== 'footer' || ( ctx.entityId !== TASK_SECTION && ctx.entityId !== PROJECT_SECTION ) ) {
				return;
			}

			const os = ( window as unknown as {
				wp?: { os?: { openWindow?: ( id: string, o?: unknown ) => boolean } };
			} ).wp?.os;

			if ( ! os?.openWindow ) {
				return;
			}

			// Which project to narrow the board to: the project itself when a
			// project is selected, and the task's project when a task is.
			const projectId =
				ctx.entityId === PROJECT_SECTION
					? Number( ctx.item.id )
					: metaNumber( ctx.item, META.project );

			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'atwork-preview__board';
			button.textContent = projectId ? 'Open this project on the board' : 'Open the work board';
			button.addEventListener( 'click', () => {
				if ( projectId ) {
					// Before opening, not after: the board reads the pending
					// request as it mounts, so setting it first means the very
					// first paint is already filtered rather than flickering
					// through every project on the way.
					requestProjectFocus( projectId );
				}

				os.openWindow?.( 'allterrain-work', { source: 'wp-explorer' } );
			} );

			ctx.container.appendChild( button );
		}
	);

	// -- Banding the grid by column ---------------------------------------

	hooks.addFilter(
		'os.my-wordpress.list-bands',
		'allterrain-work/by-status',
		( banding: Banding | null, entity: Entity ) => {
			if ( entity.id !== TASK_SECTION ) {
				return banding;
			}

			// No columns means nothing to band by, and a single catch-all band
			// is worse than none — it looks deliberate.
			if ( ! statuses.size ) {
				return banding;
			}

			const bands = [ ...statuses.entries() ]
				.map( ( [ id, status ] ) => ( {
					id: String( id ),
					label: status.name,
					order: status.order,
				} ) )
				.sort( ( a, b ) => a.order - b.order );

			// Catch-all last: the contract sends any unrecognised assignment to
			// the final band, so a task whose column was deleted lands somewhere
			// visible instead of vanishing from the folder.
			bands.push( { id: 'unfiled', label: 'No status', order: 9999 } );

			return {
				bands,
				assign: ( item: Row ) => {
					const id = statusOf( item );

					return id && statuses.has( id ) ? String( id ) : 'unfiled';
				},
			} as Banding;
		}
	);

	// -- Marking late work on the tile ------------------------------------

	hooks.addAction(
		'os.my-wordpress.list-tile',
		'allterrain-work/overdue-marker',
		( ctx: { entityId: string; item: Row; tile: HTMLElement } ) => {
			if ( ctx.entityId !== TASK_SECTION || ! ctx.tile ) {
				return;
			}

			const due = metaString( ctx.item, META.due );

			// Only overdue earns a mark. A dot on every tile carrying a date is
			// a dot on most of the grid, which marks nothing.
			if ( ! due || ! isOverdue( due ) ) {
				return;
			}

			ctx.tile.classList.add( 'atwork-tile--overdue' );
			ctx.tile.title = `Overdue — was due ${ formatDue( due ) }`;
		}
	);
}

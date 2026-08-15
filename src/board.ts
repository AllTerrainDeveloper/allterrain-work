/**
 * The board.
 *
 * Columns are statuses, cards are tasks, and dragging a card between columns is
 * the same operation as `POST /tasks/<id>/move` — which is the same operation as
 * the `allterrain-work/move-task` ability. Three front doors, one behaviour.
 *
 * Rendering is deliberately imperative: build the DOM, keep a `Map` of card id
 * to element, and mutate in place. There is no framework here because the
 * expensive interaction is a drag, and a drag is a stream of pointer events that
 * must move one element at 60fps — a reconciler that rebuilds a column on every
 * frame is the wrong tool for that, and the board is small enough that hand-
 * writing the updates costs less than the tool would.
 *
 * The optimistic-move rule, which is most of the subtlety here: on drop the card
 * moves in the DOM immediately and the request goes out after. If the request
 * fails the card goes back where it was and the error is shown. Waiting for the
 * server before moving makes every drag feel broken on a slow connection; never
 * reverting makes a failed move invisible, which is worse.
 */

import type { Board, ProjectDetail, Status, Task } from './types';
import { TASK_PAYLOAD_TYPE } from './types';
import {
	ApiError,
	announceChange,
	attachToTask,
	createProject,
	createStatus,
	createTask,
	detachFromTask,
	trashProject,
	fetchBoard,
	fetchProject,
	getShell,
	moveTask,
	onChange,
	trashTask,
	updateTask,
} from './api';
import { getDragManager, taskPayload, watchShellDragVisuals } from './dnd';
import { ask, confirm as inlineConfirm, notice } from './inline-ui';
import { onProjectFocus } from './focus';
import { closeAssigneePicker, openAssigneePicker } from './assignee-picker';
import { closeComments, openComments } from './comments';
import { bubbleIcon } from './icons';
import { buttonControl, ensureComponents, selectControl, textControl } from './os-ui';
import { openUrl, routeLinkIntoShell } from './open';
import {
	assigneeIn,
	attachableEntities,
	isDesktopPayload,
	sourcePostId,
	type DroppedEntity,
} from './desktop-drops';
import { formatDue, isOverdue } from './dates';

/** How the user has narrowed the board. Held in memory; not persisted. */
interface Filters {
	projectId: number;
	mineOnly: boolean;
	search: string;
}

/** Cleans up everything a mount installed. */
export type Teardown = () => void;

/**
 * Mounts the board into a container.
 *
 * @param root The element to render into. Cleared first.
 * @return A teardown to call when the window closes or the page unloads.
 */
export function mountBoard( root: HTMLElement ): Teardown {
	const board = new BoardView( root );

	void board.load();

	/*
	 * Ask the shell for the `<os-*>` tags this board draws, and redraw if any of
	 * them arrived.
	 *
	 * Not awaited before mounting, deliberately. A native window's render
	 * callback has to hand back its teardown synchronously, so making the mount
	 * async would change a contract the shell owns -- and it would trade a board
	 * that appears at once for a board that waits on a network request to look
	 * slightly better. So the first paint uses whatever is registered, exactly
	 * as it did before, and the upgrade lands a frame later if there was one.
	 *
	 * `ensureComponents()` answers false when the tags were already there, which
	 * is the common case inside the shell, so this usually costs one registry
	 * lookup and no redraw at all.
	 */
	void board.upgradeControls();

	return () => board.destroy();
}

class BoardView {
	private readonly root: HTMLElement;
	private readonly dnd = getDragManager();

	private data: Board | null = null;
	private filters: Filters = { projectId: 0, mineOnly: false, search: '' };
	private destroyed = false;

	/** Deregister functions for every drop target currently registered. */
	private dropTargets: Array< () => void > = [];
	/** Unsubscribe from the cross-window change bus. */
	private unsubscribe: () => void = () => undefined;
	/** Stop dimming lifted cards. */
	private unwatchDrag: () => void = () => undefined;
	/** Stop listening for "show me this project" requests from elsewhere. */
	private unwatchFocus: () => void = () => undefined;

	private toolbarEl!: HTMLElement;
	private boardEl!: HTMLElement;
	/** Where inline prompts, confirms and notices render. Hidden when empty. */
	private inlineEl!: HTMLElement;
	/** Where the project header renders. Hidden when no project is selected. */
	private panelEl!: HTMLElement;
	/** Detail payload for the project currently filtered to, if any. */
	private projectDetail: ProjectDetail | null = null;

	constructor( root: HTMLElement ) {
		this.root = root;

		this.toolbarEl = root.querySelector< HTMLElement >( '[data-atwork-toolbar]' ) ?? this.append( 'atwork__toolbar' );
		this.boardEl = root.querySelector< HTMLElement >( '[data-atwork-board]' ) ?? this.append( 'atwork__board' );

		// Between the toolbar and the board, so a question appears where the
		// user's attention already is and never covers the columns.
		this.inlineEl = document.createElement( 'div' );
		this.inlineEl.className = 'atwork__inline-host';
		this.inlineEl.hidden = true;
		this.toolbarEl.insertAdjacentElement( 'afterend', this.inlineEl );

		this.panelEl = document.createElement( 'div' );
		this.panelEl.className = 'atwork__project-host';
		this.panelEl.hidden = true;
		this.inlineEl.insertAdjacentElement( 'afterend', this.panelEl );

		// Another window moved a card, or the widget marked one done. Reload
		// rather than patch: the change could be anything, and a board that is
		// merely *usually* right about where work is has lost the point.
		this.unsubscribe = onChange( () => {
			if ( ! this.destroyed && ! this.dnd.isDragging() ) {
				void this.load( true );
			}
		} );

		this.unwatchDrag = watchShellDragVisuals( TASK_PAYLOAD_TYPE );

		// Somewhere else on the desktop asked for a project — the Explorer's
		// "Open this project on the board" button, today. Replays a request
		// made before this window existed, which is the usual case: the button
		// is what opened it.
		this.unwatchFocus = onProjectFocus( ( projectId ) => {
			if ( this.destroyed || this.filters.projectId === projectId ) {
				return;
			}

			this.filters.projectId = projectId;
			this.projectDetail = null;

			if ( this.data ) {
				this.render();
				void this.loadProjectDetail();
			}
		} );
	}

	private append( className: string ): HTMLElement {
		const el = document.createElement( 'div' );
		el.className = className;
		this.root.appendChild( el );

		return el;
	}

	public async load( silent = false ): Promise< void > {
		if ( ! silent ) {
			this.boardEl.replaceChildren( skeleton() );
		}

		try {
			const data = await fetchBoard();

			if ( this.destroyed ) {
				return;
			}

			this.data = data;
			this.render();
			void this.loadProjectDetail();
		} catch ( error ) {
			if ( this.destroyed ) {
				return;
			}

			this.boardEl.replaceChildren(
				errorState(
					error instanceof Error ? error.message : 'The board could not be loaded.',
					() => void this.load()
				)
			);
		}
	}

	/**
	 * Redraws once the shell's component tags are available.
	 *
	 * The controls decide between an `<os-*>` component and a native element at
	 * the moment they are built, and that decision cannot un-make itself: a tag
	 * registered later upgrades elements already in the DOM, but it cannot turn
	 * an `<input>` we already chose into an `<os-text-field>`. Hence a redraw
	 * rather than trusting the registry to catch up.
	 */
	public async upgradeControls(): Promise< void > {
		const upgraded = await ensureComponents();

		// The window can close while the kit is in flight.
		if ( upgraded && ! this.destroyed ) {
			this.render();
		}
	}

	public destroy(): void {
		this.destroyed = true;
		closeAssigneePicker();
		closeComments();
		this.clearDropTargets();
		this.unsubscribe();
		this.unwatchDrag();
		this.unwatchFocus();
		this.root.replaceChildren();
	}

	private clearDropTargets(): void {
		this.dropTargets.forEach( ( off ) => off() );
		this.dropTargets = [];
	}

	// -- Rendering ---------------------------------------------------------

	private render(): void {
		if ( ! this.data ) {
			return;
		}

		this.renderToolbar();
		this.renderProjectPanel();
		this.renderColumns();
	}

	/**
	 * Loads the numbers behind the project the board is filtered to.
	 *
	 * Separate from the board request rather than folded into it, because the
	 * board is what the user is waiting for and this is not. Fetching it
	 * alongside would make every unfiltered board pay for a panel it will not
	 * draw.
	 */
	private async loadProjectDetail(): Promise< void > {
		const id = this.filters.projectId;

		if ( ! id ) {
			this.projectDetail = null;
			this.renderProjectPanel();

			return;
		}

		try {
			const detail = await fetchProject( id );

			// The user can change the filter while this is in flight. Painting
			// a stale project's numbers under a different project's name is
			// worse than painting none.
			if ( this.destroyed || this.filters.projectId !== id ) {
				return;
			}

			this.projectDetail = detail;
			this.renderProjectPanel();
		} catch ( error ) {
			if ( ! this.destroyed && this.filters.projectId === id ) {
				this.reportError( error );
			}
		}
	}

	/**
	 * The project header — what a project is, rather than what it filters.
	 *
	 * Only drawn when the board is narrowed to one project. Across every
	 * project at once there is no single completion figure to report, and a
	 * progress bar summing unrelated work would be a number that looks
	 * meaningful and is not.
	 */
	private renderProjectPanel(): void {
		if ( ! this.filters.projectId ) {
			this.panelEl.hidden = true;
			this.panelEl.replaceChildren();

			return;
		}

		const detail = this.projectDetail;
		const known = this.data?.projects.find( ( p ) => p.id === this.filters.projectId );

		this.panelEl.hidden = false;

		const panel = document.createElement( 'div' );
		panel.className = 'atwork-project';

		const head = document.createElement( 'div' );
		head.className = 'atwork-project__head';

		const title = document.createElement( 'h2' );
		title.className = 'atwork-project__title';
		title.textContent = detail?.title ?? known?.title ?? 'Project';
		head.appendChild( title );

		if ( detail ) {
			const percent = document.createElement( 'span' );
			percent.className = 'atwork-project__percent';
			percent.textContent = `${ detail.percent }%`;
			head.appendChild( percent );
		}

		const edit = document.createElement( 'a' );
		edit.className = 'atwork-project__edit';
		edit.href = detail?.editUrl || known?.editUrl || '#';
		edit.textContent = 'Edit';
		routeLinkIntoShell( edit, detail?.title ?? known?.title ?? 'Project', 'dashicons-portfolio' );
		head.appendChild( edit );

		if ( detail?.canEdit ?? known?.canEdit ) {
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.className = 'atwork-project__delete';
			remove.textContent = 'Delete';
			remove.addEventListener( 'click', () => void this.confirmTrashProject( detail?.title ?? known?.title ?? 'this project' ) );
			head.appendChild( remove );
		}

		panel.appendChild( head );

		if ( ! detail ) {
			const loading = document.createElement( 'p' );
			loading.className = 'atwork-project__loading';
			loading.textContent = 'Loading project…';
			panel.appendChild( loading );
			this.panelEl.replaceChildren( panel );

			return;
		}

		if ( detail.description ) {
			const description = document.createElement( 'p' );
			description.className = 'atwork-project__description';
			description.textContent = detail.description;
			panel.appendChild( description );
		}

		// One bar, segmented by column and coloured by it, rather than a plain
		// completion bar: "60% done" and "60% done, the rest all Stuck" are
		// different projects and a single fill cannot tell them apart.
		if ( detail.total > 0 ) {
			const bar = document.createElement( 'div' );
			bar.className = 'atwork-project__bar';
			bar.setAttribute( 'role', 'img' );
			bar.setAttribute(
				'aria-label',
				`${ detail.done } of ${ detail.total } tasks done` +
					( detail.overdue ? `, ${ detail.overdue } overdue` : '' )
			);

			for ( const band of detail.breakdown ) {
				if ( ! band.count ) {
					continue;
				}

				const segment = document.createElement( 'span' );
				segment.className = 'atwork-project__band';
				segment.style.flexGrow = String( band.count );
				segment.style.background = band.color;
				segment.title = `${ band.name }: ${ band.count }`;
				bar.appendChild( segment );
			}

			panel.appendChild( bar );
		}

		const stats = document.createElement( 'div' );
		stats.className = 'atwork-project__stats';

		const figures: Array< [ string, number, string ] > = [
			[ 'done', detail.done, '' ],
			[ 'open', detail.open, '' ],
			[ 'overdue', detail.overdue, 'is-overdue' ],
		];

		for ( const [ label, value, modifier ] of figures ) {
			if ( ! value && modifier ) {
				continue;
			}

			const chip = document.createElement( 'span' );
			chip.className = `atwork-project__stat ${ modifier }`.trim();
			chip.textContent = `${ value } ${ label }`;
			stats.appendChild( chip );
		}

		if ( detail.members.length ) {
			const members = document.createElement( 'span' );
			members.className = 'atwork-project__members';

			for ( const member of detail.members.slice( 0, 6 ) ) {
				const face = avatar( member.name, member.avatar );
				face.title = member.open
					? `${ member.name } — ${ member.open } open`
					: `${ member.name } — nothing open`;
				members.appendChild( face );
			}

			stats.appendChild( members );
		}

		panel.appendChild( stats );

		if ( ! detail.total ) {
			const empty = document.createElement( 'p' );
			empty.className = 'atwork-project__loading';
			empty.textContent = 'No tasks in this project yet.';
			panel.appendChild( empty );
		}

		this.panelEl.replaceChildren( panel );
	}

	private renderToolbar(): void {
		const data = this.data;

		if ( ! data ) {
			return;
		}

		const bar = document.createElement( 'div' );
		bar.className = 'atwork__toolbar-inner';

		// `<os-select>` in the shell, a native select outside it. Not a
		// preference: core's `forms.css` reaches a bare select with a (0,1,1)
		// selector that outranks our classes, so one rendered here would be a
		// white core-chrome box sitting on a dark window.
		bar.appendChild(
			selectControl( {
				label: 'Project',
				hideLabel: true,
				className: 'atwork__select',
				value: String( this.filters.projectId ),
				options: [ { value: '0', label: `All projects (${ data.projects.length })` } ].concat(
					data.projects.map( ( p ) => ( { value: String( p.id ), label: p.title } ) )
				),
				onChange: ( value ) => {
					this.filters.projectId = Number( value );
					this.projectDetail = null;
					this.renderProjectPanel();
					this.renderColumns();
					void this.loadProjectDetail();
				},
			} )
		);

		// A native button on purpose, unlike the plain actions beside it.
		// `<os-button>` renders its real button inside shadow DOM and forwards
		// no ARIA to it, so `aria-pressed` on the host reaches nobody — a
		// toggle whose state is visible but unreadable. Core's `forms.css`
		// problem that pushed the select to a component does not apply here:
		// that rule targets `input`, `select` and `textarea`, never `button`.
		const mine = document.createElement( 'button' );
		mine.type = 'button';
		mine.className = 'atwork__toggle';
		mine.textContent = 'Assigned to me';
		mine.setAttribute( 'aria-pressed', String( this.filters.mineOnly ) );
		mine.addEventListener( 'click', () => {
			this.filters.mineOnly = ! this.filters.mineOnly;
			mine.setAttribute( 'aria-pressed', String( this.filters.mineOnly ) );
			this.renderColumns();
		} );
		bar.appendChild( mine );

		bar.appendChild(
			textControl( {
				label: 'Search tasks',
				hideLabel: true,
				type: 'search',
				className: 'atwork__search',
				value: this.filters.search,
				placeholder: 'Search tasks',
				onInput: ( value ) => {
					this.filters.search = value.trim().toLowerCase();
					this.renderColumns();
				},
			} )
		);

		const spacer = document.createElement( 'span' );
		spacer.className = 'atwork__spacer';
		bar.appendChild( spacer );

		if ( data.viewer.canCreate ) {
			bar.appendChild(
				buttonControl( { label: 'Add column', onClick: () => void this.addColumn() } )
			);
			bar.appendChild(
				buttonControl( { label: 'New project', onClick: () => void this.promptNewProject() } )
			);
		}

		this.toolbarEl.replaceChildren( bar );
	}

	/** Whether the current filters admit a task. */
	private passesFilters( task: Task ): boolean {
		const data = this.data;

		if ( ! data ) {
			return true;
		}

		if ( this.filters.projectId && task.projectId !== this.filters.projectId ) {
			return false;
		}

		if ( this.filters.mineOnly && task.ownerId !== data.viewer.id ) {
			return false;
		}

		if ( this.filters.search && ! task.title.toLowerCase().includes( this.filters.search ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Turns "third card I can see" into "third card in the column".
	 *
	 * The two are only the same number when nothing is filtered. Narrow the
	 * board to one project and a card dropped below the last visible card is
	 * not going to index 3 of the column -- it is going to the end of a column
	 * that may hold twenty. Sending the visible index straight through is how a
	 * drop lands somewhere the user did not aim, and worse, silently reshuffles
	 * the cards the filter is hiding.
	 *
	 * Anchoring on the card the drop landed above, rather than on any count,
	 * is what makes it exact: whatever is hidden between them stays where it is.
	 *
	 * @param task         The card being moved.
	 * @param statusId     Destination column.
	 * @param visibleIndex Index among the cards the user can currently see.
	 */
	private absolutePosition( task: Task, statusId: number, visibleIndex: number ): number {
		const data = this.data;

		if ( ! data ) {
			return visibleIndex;
		}

		const column = data.tasks
			.filter( ( t ) => t.statusId === statusId && t.id !== task.id )
			.sort( ( a, b ) => a.order - b.order );

		const visible = column.filter( ( t ) => this.passesFilters( t ) );

		// Dropped past the last card the user can see means the end of the
		// whole column, not the end of the visible subset.
		if ( visibleIndex >= visible.length ) {
			return column.length;
		}

		const anchorTask = visible[ visibleIndex ];
		const index = column.findIndex( ( t ) => t.id === anchorTask.id );

		return index < 0 ? column.length : index;
	}

	/** The tasks the current filters admit, grouped by column. */
	private visibleTasks(): Map< number, Task[] > {
		const grouped = new Map< number, Task[] >();
		const data = this.data;

		if ( ! data ) {
			return grouped;
		}

		data.statuses.forEach( ( s ) => grouped.set( s.id, [] ) );

		for ( const task of data.tasks ) {
			if ( ! this.passesFilters( task ) ) {
				continue;
			}

			// A task whose status term was deleted has nowhere to sit. Dropping
			// it silently would hide real work, so it goes in the first column
			// where somebody will see it and re-file it.
			const columnId = grouped.has( task.statusId ) ? task.statusId : data.statuses[ 0 ]?.id ?? 0;
			grouped.get( columnId )?.push( task );
		}

		grouped.forEach( ( list ) => list.sort( ( a, b ) => a.order - b.order ) );

		return grouped;
	}

	private renderColumns(): void {
		const data = this.data;

		if ( ! data ) {
			return;
		}

		// The picker is anchored to a card that is about to be replaced, and a
		// popover left floating over a card that no longer exists would assign
		// the wrong task.
		closeAssigneePicker();
		closeComments();
		this.clearDropTargets();

		if ( ! data.statuses.length ) {
			this.boardEl.replaceChildren(
				emptyState(
					'No columns yet',
					'A board needs at least one status. Add one under Work → Statuses.'
				)
			);

			return;
		}

		const grouped = this.visibleTasks();
		const columns = document.createElement( 'div' );
		columns.className = 'atwork__columns';

		for ( const status of data.statuses ) {
			columns.appendChild( this.renderColumn( status, grouped.get( status.id ) ?? [] ) );
		}

		this.boardEl.replaceChildren( columns );
	}

	private renderColumn( status: Status, tasks: Task[] ): HTMLElement {
		const column = document.createElement( 'section' );
		column.className = 'atwork-column';
		column.dataset.statusId = String( status.id );
		column.style.setProperty( '--atwork-column-color', status.color );
		column.setAttribute( 'aria-label', `${ status.name }, ${ tasks.length } tasks` );

		const header = document.createElement( 'header' );
		header.className = 'atwork-column__header';

		const name = document.createElement( 'h2' );
		name.className = 'atwork-column__name';
		name.textContent = status.name;
		header.appendChild( name );

		const count = document.createElement( 'span' );
		count.className = 'atwork-column__count';
		count.textContent = String( tasks.length );
		header.appendChild( count );

		column.appendChild( header );

		const list = document.createElement( 'div' );
		list.className = 'atwork-column__list';
		list.dataset.statusId = String( status.id );
		column.appendChild( list );

		for ( const task of tasks ) {
			list.appendChild( this.renderCard( task, status, list ) );
		}

		if ( ! tasks.length ) {
			const hint = document.createElement( 'p' );
			hint.className = 'atwork-column__empty';
			hint.textContent = 'Drop a card here';
			list.appendChild( hint );
		}

		if ( this.data?.viewer.canCreate ) {
			const add = document.createElement( 'button' );
			add.type = 'button';
			add.className = 'atwork-column__add';
			add.textContent = '+ Add task';
			add.addEventListener( 'click', () => this.showComposer( column, status.id ) );
			column.appendChild( add );
		}

		this.registerColumnDrop( column, list, status );

		return column;
	}

	private renderCard( task: Task, status: Status, list: HTMLElement ): HTMLElement {
		const card = document.createElement( 'article' );
		card.className = `atwork-card atwork-card--${ task.priority }`;
		card.dataset.taskId = String( task.id );
		card.tabIndex = 0;
		card.setAttribute( 'role', 'button' );
		card.setAttribute( 'aria-label', `${ task.title }. Press Enter to open.` );

		const title = document.createElement( 'h3' );
		title.className = 'atwork-card__title';
		title.textContent = task.title;
		card.appendChild( title );

		const meta = document.createElement( 'div' );
		meta.className = 'atwork-card__meta';

		if ( task.projectId ) {
			const project = this.data?.projects.find( ( p ) => p.id === task.projectId );

			if ( project ) {
				const chip = document.createElement( 'span' );
				chip.className = 'atwork-card__project';
				chip.textContent = project.title;

				// The colour set on the project in the editor. Without one the
				// chip keeps the neutral default rather than being assigned a
				// colour it never chose — on a board of six projects, invented
				// colours are worse than none.
				if ( project.color ) {
					chip.style.setProperty( '--atwork-chip-color', project.color );
					chip.classList.add( 'has-color' );
				}

				meta.appendChild( chip );
			}
		}

		if ( task.due ) {
			const due = document.createElement( 'span' );
			due.className = 'atwork-card__due';
			due.textContent = formatDue( task.due );
			// Overdue is the one card state worth colouring, because it is the
			// only one that means "this needed you yesterday".
			if ( isOverdue( task.due ) ) {
				due.classList.add( 'is-overdue' );
			}
			meta.appendChild( due );
		}

		if ( task.sourceId && task.sourceUrl ) {
			const link = document.createElement( 'a' );
			link.className = 'atwork-card__source';
			link.href = task.sourceUrl;
			link.textContent = '\u21b1 ' + ( task.sourceTitle || 'Source' );
			link.title = `Open “${ task.sourceTitle }”`;
			routeLinkIntoShell( link, task.sourceTitle || 'Source', 'dashicons-admin-post' );
			meta.appendChild( link );
		}

		meta.appendChild( this.commentControl( task ) );

		if ( task.canEdit ) {
			meta.appendChild( this.assignControl( task ) );
		} else if ( task.ownerId ) {
			// No permission to change it, so it stays a picture rather than
			// becoming a button that refuses.
			meta.appendChild( avatar( task.ownerName, task.ownerAvatar ) );
		}

		if ( meta.childElementCount ) {
			card.appendChild( meta );
		}

		if ( task.links.length ) {
			card.appendChild( this.renderLinks( task ) );
		}

		if ( task.canDelete ) {
			// A visible control, not only the right-click menu. Right-click is
			// undiscoverable and unreachable on a touch screen, and "how do I
			// delete this" should not be a question the board leaves unanswered.
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.className = 'atwork-card__remove';
			remove.setAttribute( 'aria-label', `Move “${ task.title }” to the trash` );
			remove.title = 'Move to trash';
			remove.textContent = '×';
			remove.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
			remove.addEventListener( 'click', ( ev ) => {
				ev.stopPropagation();
				void this.confirmTrash( task );
			} );
			card.appendChild( remove );
		}

		this.wireCard( card, task, status, list );

		return card;
	}

	/**
	 * The assign control — the avatar, made pressable.
	 *
	 * Every card carries one, assigned or not, because "who is this for" is a
	 * question you ask of unassigned work most of all. An unassigned card shows
	 * a dashed outline rather than nothing, so the affordance is visible before
	 * anyone hovers it.
	 */
	private assignControl( task: Task ): HTMLElement {
		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'atwork-card__assign';
		button.setAttribute( 'aria-haspopup', 'dialog' );
		button.setAttribute( 'aria-expanded', 'false' );
		button.setAttribute(
			'aria-label',
			task.ownerId ? `Assigned to ${ task.ownerName }. Change.` : 'Assign this task'
		);
		button.title = task.ownerId ? `${ task.ownerName } — click to change` : 'Assign';

		if ( task.ownerId ) {
			button.appendChild( avatar( task.ownerName, task.ownerAvatar ) );
		} else {
			button.classList.add( 'is-empty' );
			button.textContent = '+';
		}

		// The card starts a drag on pointerdown; without this, pressing the
		// button lifts the card instead of opening the picker.
		button.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
		button.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			openAssigneePicker( button, task.ownerId, ( userId ) => void this.setOwner( task, userId ) );
		} );

		return button;
	}

	/**
	 * The comment control — a count you can press.
	 *
	 * Always present, even at zero. A thread you can only find once somebody
	 * else has started it is a thread nobody starts.
	 *
	 * Sized to sit level with the avatar beside it rather than shrunk to fit
	 * around the text: this was a 10px emoji at 45% opacity, which is a target
	 * nobody can hit and an affordance nobody notices. It is now the same height
	 * as the assign control, so the meta row reads as a row of controls.
	 */
	private commentControl( task: Task ): HTMLElement {
		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'atwork-card__comments';
		button.setAttribute( 'aria-haspopup', 'dialog' );
		button.setAttribute( 'aria-expanded', 'false' );

		const count = document.createElement( 'span' );
		count.className = 'atwork-card__comments-count';

		/**
		 * Paints the button for a given number of comments.
		 *
		 * Shared by the first render and by the panel's own callback, so an
		 * emptied thread returns the button to exactly the state a card drawn
		 * from scratch would have rather than to an approximation of it.
		 *
		 * @param total How many comments the task has.
		 */
		const paint = ( total: number ) => {
			button.classList.toggle( 'is-empty', 0 === total );
			button.setAttribute(
				'aria-label',
				total
					? `${ total } ${ 1 === total ? 'comment' : 'comments' }. Open the thread.`
					: 'Comment on this task'
			);
			button.title = total
				? `${ total } ${ 1 === total ? 'comment' : 'comments' }`
				: 'Start the conversation';

			button.querySelector( 'svg' )?.remove();
			button.prepend( bubbleIcon( total > 0 ) );

			count.textContent = total ? String( total ) : '';
			count.hidden = ! total;
		};

		button.appendChild( count );
		paint( task.comments );

		button.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
		button.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			openComments( button, task.id, task.title, ( total ) => {
				// Patch the count in place rather than re-rendering: a redraw
				// mid-conversation would tear down the very panel the user is
				// typing in.
				this.applyTask( { ...task, comments: total } );
				paint( total );
			} );
		} );

		return button;
	}

	/** Writes a new assignee, or clears one. */
	private async setOwner( task: Task, userId: number ): Promise< void > {
		if ( userId === task.ownerId ) {
			return;
		}

		try {
			const updated = await updateTask( task.id, { owner: userId } );

			if ( this.destroyed ) {
				return;
			}

			this.applyTask( updated );
			announceChange( 'updated', [ task.id ] );
			this.renderColumns();
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/**
	 * The things attached to a task, as removable chips.
	 *
	 * Titles rather than a count: "3 attachments" tells you there is something
	 * to go and look at, which is a worse answer than showing what it is.
	 */
	private renderLinks( task: Task ): HTMLElement {
		const wrap = document.createElement( 'div' );
		wrap.className = 'atwork-card__links';

		for ( const link of task.links ) {
			const chip = document.createElement( 'span' );
			chip.className = 'atwork-card__link';
			chip.title = `${ link.typeLabel }: ${ link.title }`;

			if ( link.thumbnail ) {
				const img = document.createElement( 'img' );
				img.src = link.thumbnail;
				img.alt = '';
				img.loading = 'lazy';
				chip.appendChild( img );
			}

			const label = document.createElement( 'a' );
			label.className = 'atwork-card__link-title';
			label.href = link.editUrl || '#';
			label.textContent = link.title;
			routeLinkIntoShell( label, link.title );
			chip.appendChild( label );

			if ( task.canEdit ) {
				const detach = document.createElement( 'button' );
				detach.type = 'button';
				detach.className = 'atwork-card__detach';
				detach.setAttribute( 'aria-label', `Detach “${ link.title }”` );
				detach.title = 'Detach — the item itself is not deleted';
				detach.textContent = '×';
				detach.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
				detach.addEventListener( 'click', ( ev ) => {
					ev.stopPropagation();
					void this.detach( task, link.id );
				} );
				chip.appendChild( detach );
			}

			wrap.appendChild( chip );
		}

		return wrap;
	}

	// -- Interaction -------------------------------------------------------

	/**
	 * Makes a card draggable and openable.
	 *
	 * The click handler is `onClickOnly` on the drag session rather than a
	 * `click` listener on the element, so a press that turns into a drag does
	 * not also open the task when the pointer comes up.
	 */
	private wireCard( card: HTMLElement, task: Task, status: Status, list: HTMLElement ): void {
		// Into a desktop window, not a browser tab. Opening a second task's
		// editor navigates the existing editor window rather than stacking
		// another one on the desk.
		const open = () => openUrl( task.editUrl, task.title, 'dashicons-yes-alt' );

		card.addEventListener( 'keydown', ( ev ) => {
			if ( ev.key === 'Enter' || ev.key === ' ' ) {
				ev.preventDefault();
				open();
			}
		} );

		card.addEventListener( 'pointerdown', ( ev ) => {
			// A card the server would refuse to move should not lift at all.
			// Discovering that at drop time means the user has already done the
			// work of aiming.
			if ( ! task.canEdit ) {
				return;
			}

			this.dnd.start( {
				payload: taskPayload( TASK_PAYLOAD_TYPE, card, task, ev ),
				origin: ev,
				onClickOnly: open,
			} );
		} );

		this.registerCardDrop( card, task, status, list );

		card.addEventListener( 'contextmenu', ( ev ) => {
			if ( ! task.canDelete ) {
				return;
			}

			ev.preventDefault();
			void this.confirmTrash( task );
		} );
	}

	/**
	 * Makes a column accept cards.
	 *
	 * `accept()` returns false for foreign payloads rather than the target
	 * simply not existing, which makes the column a *claimant*: a media tile
	 * dragged over it is refused here instead of falling through to whatever is
	 * behind the board. Falling through is how a drop aimed at a column ends up
	 * doing something else entirely.
	 */
	private registerColumnDrop( column: HTMLElement, list: HTMLElement, status: Status ): void {
		const off = this.dnd.registerDropTarget( {
			id: `allterrain-work/column-${ status.id }`,
			// The whole column, not just its list of cards. The header, the
			// gap under the last card and the "+ Add task" row are all places
			// a person aims at when they mean "this column", and a target that
			// stops at the list turns a confident drop into a rejected one.
			element: column,
			// Tasks and nothing else. A column is a *status*, so the only thing
			// that can be in one is a task — dropping a draft here used to mint
			// a task from it, which is a real action taken on a gesture that
			// did not ask for one. Content goes onto a card, where it attaches.
			accept: ( payload ) => payload.type === TASK_PAYLOAD_TYPE,
			acceptLabel: `Move to ${ status.name }`,
			onEnter: () => column.classList.add( 'is-drop-target' ),
			onLeave: () => column.classList.remove( 'is-drop-target' ),
			onDrop: ( session, ev ) => {
				column.classList.remove( 'is-drop-target' );

				const task = ( session.payload.data as { task?: Task } ).task;

				if ( task ) {
					void this.handleDrop( task, status, list, ev.clientY );
				}
			},
		} );

		this.dropTargets.push( off );
	}

	/**
	 * Makes a card a drop target in its own right.
	 *
	 * It has to accept **task** payloads as well as users, and that is not an
	 * extra feature — it is the only way dropping a card onto a column works
	 * when there are already cards in it. The drag manager picks the deepest
	 * target under the cursor and treats a target whose `accept()` returns
	 * false as a *claimant*: the drop is refused there and never falls through
	 * to the column underneath. So a card that declined task payloads made
	 * every other card in the column a dead patch, and the user had to find the
	 * shrinking gap of empty list below them.
	 *
	 * A task dropped here is handed straight to the column's own handler, with
	 * the pointer's height deciding where among the cards it lands — so
	 * dropping *on* a card is not merely allowed, it is how you place one
	 * precisely.
	 */
	private registerCardDrop( card: HTMLElement, task: Task, status: Status, list: HTMLElement ): void {
		const off = this.dnd.registerDropTarget( {
			id: `allterrain-work/card-${ task.id }`,
			element: card,
			accept: ( payload ) => {
				if ( payload.type === TASK_PAYLOAD_TYPE ) {
					return true;
				}

				if ( ! isDesktopPayload( payload ) || ! task.canEdit ) {
					return false;
				}

				// A user assigns; anything that lives in `wp_posts` attaches.
				return assigneeIn( payload ) !== null || attachableEntities( payload ).length > 0;
			},
			acceptLabel: `Move to ${ status.name }`,
			onEnter: ( session ) =>
				card.classList.add(
					session.payload.type === TASK_PAYLOAD_TYPE ? 'is-drop-near' : 'is-assign-target'
				),
			onLeave: () => card.classList.remove( 'is-assign-target', 'is-drop-near' ),
			onDrop: ( session, ev ) => {
				card.classList.remove( 'is-assign-target', 'is-drop-near' );

				if ( session.payload.type === TASK_PAYLOAD_TYPE ) {
					const dragged = ( session.payload.data as { task?: Task } ).task;

					if ( dragged ) {
						void this.handleDrop( dragged, status, list, ev.clientY );
					}

					return;
				}

				const user = assigneeIn( session.payload );

				if ( user ) {
					void this.assign( task, user );

					return;
				}

				const attachable = attachableEntities( session.payload );

				if ( attachable.length ) {
					void this.attach( task, attachable );
				}
			},
		} );

		this.dropTargets.push( off );
	}

	/**
	 * Attaches dropped content to a task.
	 *
	 * Anything in `wp_posts` — a post, a page, an image, a product. The link is
	 * a reference, so detaching later removes the link and never the thing.
	 */
	private async attach( task: Task, entities: DroppedEntity[] ): Promise< void > {
		const ids = entities.map( sourcePostId ).filter( ( id ) => id > 0 );

		if ( ! ids.length ) {
			return;
		}

		try {
			const links = await attachToTask( task.id, ids );

			if ( this.destroyed ) {
				return;
			}

			this.applyTask( { ...task, links } );
			announceChange( 'updated', [ task.id ] );
			this.renderColumns();

			getShell()?.notify?.( {
				title: 'AllTerrain Work',
				body:
					ids.length === 1
						? `Attached “${ entities[ 0 ].title || 'item' }” to ${ task.title }`
						: `Attached ${ ids.length } items to ${ task.title }`,
			} );
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/** Removes one attachment. Unlinks it; never deletes the linked post. */
	private async detach( task: Task, linkedId: number ): Promise< void > {
		try {
			const links = await detachFromTask( task.id, linkedId );

			if ( this.destroyed ) {
				return;
			}

			this.applyTask( { ...task, links } );
			announceChange( 'updated', [ task.id ] );
			this.renderColumns();
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/** Assigns from a dropped user tile — the same write the picker makes. */
	private async assign( task: Task, user: DroppedEntity ): Promise< void > {
		const owner = Number.parseInt( user.ref, 10 );

		if ( ! Number.isFinite( owner ) || owner <= 0 ) {
			return;
		}

		await this.setOwner( task, owner );

		getShell()?.notify?.( {
			title: 'AllTerrain Work',
			body: `“${ task.title }” is now ${ user.title || 'assigned' }`,
		} );
	}

	/**
	 * Commits a drop: move the DOM now, tell the server, revert if it refuses.
	 */
	private async handleDrop( task: Task, status: Status, list: HTMLElement, clientY: number ): Promise< void > {
		const card = this.boardEl.querySelector< HTMLElement >( `[data-task-id="${ task.id }"]` );

		if ( ! card ) {
			return;
		}

		const previousParent = card.parentElement;
		const previousNext = card.nextElementSibling;
		const visibleIndex = insertionIndex( list, card, clientY );
		const position = this.absolutePosition( task, status.id, visibleIndex );

		list.querySelector( '.atwork-column__empty' )?.remove();
		list.insertBefore( card, list.children[ visibleIndex ] ?? null );
		card.classList.add( 'is-pending' );

		try {
			const updated = await moveTask( task.id, status.id, position );

			if ( this.destroyed ) {
				return;
			}

			card.classList.remove( 'is-pending' );
			this.applyTask( updated );
			announceChange( 'moved', [ task.id ] );

			// A move renumbers every card in the column server-side, so the
			// `order` this client holds for the ones it did not touch is now
			// stale. Re-reading is the only way to stay honest about it -- and
			// the card is already sitting where the user dropped it, so the
			// reconcile costs a request and no visible flicker.
			await this.load( true );
		} catch ( error ) {
			if ( this.destroyed ) {
				return;
			}

			card.classList.remove( 'is-pending' );
			previousParent?.insertBefore( card, previousNext );
			this.reportError( error );
		}
	}

	/** Writes a server response back into the local model. */
	private applyTask( updated: Task ): void {
		if ( ! this.data ) {
			return;
		}

		const index = this.data.tasks.findIndex( ( t ) => t.id === updated.id );

		if ( index === -1 ) {
			this.data.tasks.push( updated );
		} else {
			this.data.tasks[ index ] = updated;
		}
	}

	/**
	 * The inline "add a task" field at the foot of a column.
	 *
	 * Inline rather than a modal because adding tasks is the thing people do
	 * most, and a dialog per task turns a two-minute brain-dump into twenty
	 * dialogs.
	 */
	private showComposer( column: HTMLElement, statusId: number ): void {
		const existing = column.querySelector( '.atwork-composer' );

		if ( existing ) {
			existing.querySelector< HTMLInputElement >( 'input' )?.focus();

			return;
		}

		const form = document.createElement( 'form' );
		form.className = 'atwork-composer';

		const input = document.createElement( 'input' );
		input.type = 'text';
		input.className = 'atwork-composer__input';
		input.placeholder = 'What needs doing?';
		input.setAttribute( 'aria-label', 'New task title' );
		form.appendChild( input );

		const close = () => form.remove();

		form.addEventListener( 'submit', ( ev ) => {
			ev.preventDefault();

			const title = input.value.trim();

			if ( ! title ) {
				close();

				return;
			}

			input.disabled = true;

			void createTask( {
				title,
				status: statusId,
				project: this.filters.projectId || undefined,
				// Filtering to "assigned to me" and then adding a task that is
				// not assigned to you would make it vanish the moment it is
				// created. Match the view the user is looking at.
				owner: this.filters.mineOnly ? this.data?.viewer.id : undefined,
			} )
				.then( ( task ) => {
					if ( this.destroyed ) {
						return;
					}

					this.data?.tasks.unshift( task );
					announceChange( 'created', [ task.id ] );
					close();
					this.renderColumns();
				} )
				.catch( ( error: unknown ) => {
					input.disabled = false;
					this.reportError( error );
				} );
		} );

		input.addEventListener( 'keydown', ( ev ) => {
			if ( ev.key === 'Escape' ) {
				close();
			}
		} );

		input.addEventListener( 'blur', () => {
			if ( ! input.value.trim() ) {
				close();
			}
		} );

		column.appendChild( form );
		input.focus();
	}

	private async promptNewProject(): Promise< void > {
		const title = await ask( this.inlineEl, {
			label: 'New project',
			placeholder: 'What is it called?',
			submit: 'Create project',
		} );

		if ( ! title || this.destroyed ) {
			return;
		}

		try {
			const project = await createProject( title );

			if ( this.destroyed ) {
				return;
			}

			this.data?.projects.push( project );
			// Switch to it. Someone who just named a project wants to be
			// looking at it, not back at every project at once.
			this.filters.projectId = project.id;
			this.projectDetail = null;
			this.render();
			void this.loadProjectDetail();
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/**
	 * Adds a column to the board.
	 *
	 * The board is not a fixed four-column pipeline. A team that works in
	 * "Waiting on client" has to be able to say so here, on the board, rather
	 * than being sent to the taxonomy screen in wp-admin to add a term and come
	 * back — which is the moment a tool stops feeling like a tool.
	 */
	private async addColumn(): Promise< void > {
		const name = await ask( this.inlineEl, {
			label: 'New column',
			placeholder: 'Blocked, In review, Waiting on client…',
			submit: 'Add column',
		} );

		if ( ! name || this.destroyed ) {
			return;
		}

		try {
			const status = await createStatus( name );

			if ( this.destroyed ) {
				return;
			}

			this.data?.statuses.push( status );
			this.renderColumns();
			notice( this.inlineEl, `Added the “${ status.name }” column.`, 'success' );
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/**
	 * Trashes the project the board is filtered to.
	 *
	 * The tasks in it stay. A project is a grouping, and deleting a folder
	 * should not delete the work inside it — which is also why the message says
	 * so rather than leaving the user to guess.
	 */
	private async confirmTrashProject( title: string ): Promise< void > {
		const projectId = this.filters.projectId;

		if ( ! projectId ) {
			return;
		}

		const shell = getShell();
		const message = `Move “${ title }” to the trash? Its tasks are kept.`;

		const confirmed = shell?.confirm
			? await shell.confirm( { title: 'Delete project', message, confirmLabel: 'Move to trash', danger: true } )
			: await inlineConfirm( this.inlineEl, { message, confirm: 'Move to trash', danger: true } );

		if ( ! confirmed || this.destroyed ) {
			return;
		}

		try {
			await trashProject( projectId );

			if ( this.destroyed ) {
				return;
			}

			if ( this.data ) {
				this.data.projects = this.data.projects.filter( ( p ) => p.id !== projectId );
			}

			this.filters.projectId = 0;
			this.projectDetail = null;
			announceChange( 'trashed', [ projectId ] );
			this.render();
			notice( this.inlineEl, `“${ title }” is in the trash. Its tasks were kept.`, 'success' );
		} catch ( error ) {
			this.reportError( error );
		}
	}

	private async confirmTrash( task: Task ): Promise< void > {
		const shell = getShell();
		const message = `Move “${ task.title }” to the trash?`;

		// The shell's dialog when there is one — it traps focus and stacks with
		// everything else on the desktop. The inline fallback otherwise. Never
		// `window.confirm`: it freezes every other window on the desktop, not
		// just this board.
		const confirmed = shell?.confirm
			? await shell.confirm( { title: 'Move to trash', message, confirmLabel: 'Move to trash', danger: true } )
			: await inlineConfirm( this.inlineEl, { message, confirm: 'Move to trash', danger: true } );

		if ( ! confirmed ) {
			return;
		}

		try {
			await trashTask( task.id );

			if ( this.destroyed ) {
				return;
			}

			if ( this.data ) {
				this.data.tasks = this.data.tasks.filter( ( t ) => t.id !== task.id );
			}

			announceChange( 'trashed', [ task.id ] );
			this.renderColumns();
		} catch ( error ) {
			this.reportError( error );
		}
	}

	/**
	 * Surfaces a failure.
	 *
	 * Through the shell's toast when there is one — it stacks, it pauses while
	 * the pointer is over it, and it does not steal focus. `alert()` is the
	 * fallback and is deliberately last: it blocks the page, and blocking the
	 * page inside a desktop shell freezes every other window too.
	 */
	private reportError( error: unknown ): void {
		const message =
			error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';

		const shell = getShell();

		if ( shell?.notify ) {
			shell.notify( { title: 'AllTerrain Work', body: message, type: 'error' } );

			return;
		}

		notice( this.inlineEl, message, 'error' );
	}
}

// -- Small DOM helpers ---------------------------------------------------

/** Where in a column a card dropped at `clientY` belongs. */
function insertionIndex( list: HTMLElement, dragged: HTMLElement, clientY: number ): number {
	const cards = Array.from( list.querySelectorAll< HTMLElement >( '.atwork-card' ) ).filter(
		( el ) => el !== dragged
	);

	for ( let i = 0; i < cards.length; i++ ) {
		const rect = cards[ i ].getBoundingClientRect();

		// Midpoint, not top edge: dropping on the top half of a card means
		// "before this one", the bottom half "after". Comparing against the top
		// edge alone makes the last third of every card a dead zone.
		if ( clientY < rect.top + rect.height / 2 ) {
			return i;
		}
	}

	return cards.length;
}

function avatar( name: string, url: string ): HTMLElement {
	const el = document.createElement( 'span' );
	el.className = 'atwork-card__owner';
	el.title = name;

	if ( url ) {
		const img = document.createElement( 'img' );
		img.src = url;
		img.alt = '';
		img.width = 22;
		img.height = 22;
		img.loading = 'lazy';
		el.appendChild( img );
	} else {
		// Avatars can be off site-wide. Initials keep the card readable rather
		// than leaving a broken image where a person should be.
		el.textContent = initials( name );
		el.classList.add( 'atwork-card__owner--initials' );
	}

	return el;
}

function initials( name: string ): string {
	return name
		.split( /\s+/ )
		.filter( Boolean )
		.slice( 0, 2 )
		.map( ( part ) => part.charAt( 0 ).toUpperCase() )
		.join( '' );
}

function skeleton(): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'atwork__skeleton';
	el.setAttribute( 'aria-busy', 'true' );

	for ( let i = 0; i < 4; i++ ) {
		const column = document.createElement( 'div' );
		column.className = 'atwork__skeleton-column';
		el.appendChild( column );
	}

	return el;
}

function emptyState( title: string, body: string ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'atwork__empty';

	const h = document.createElement( 'p' );
	h.className = 'atwork__empty-title';
	h.textContent = title;
	el.appendChild( h );

	const p = document.createElement( 'p' );
	p.textContent = body;
	el.appendChild( p );

	return el;
}

function errorState( message: string, retry: () => void ): HTMLElement {
	const el = emptyState( 'The board could not be loaded', message );

	const button = document.createElement( 'button' );
	button.type = 'button';
	button.className = 'atwork__button';
	button.textContent = 'Try again';
	button.addEventListener( 'click', retry );
	el.appendChild( button );

	return el;
}

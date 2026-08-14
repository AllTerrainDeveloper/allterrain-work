/**
 * The wire shapes.
 *
 * Each interface is the TypeScript twin of a PHP function in `includes/helpers.php`:
 * `Task` mirrors `atwork_prepare_task()`, `Project` mirrors `atwork_prepare_project()`,
 * and so on. When one changes the other has to, and the phpunit suite asserts the
 * PHP side's keys so the pair cannot drift silently.
 */

/** One remark on a task. Ordinary WordPress comments underneath. */
export interface TaskComment {
	id: number;
	author: string;
	avatar: string;
	content: string;
	/** ISO 8601, UTC. */
	date: string;
	canDelete: boolean;
}

/** Somebody a task can be assigned to. */
export interface Assignee {
	id: number;
	name: string;
	avatar: string;
}

/** A board column. One taxonomy term. */
export interface Status {
	id: number;
	slug: string;
	name: string;
	/** `#rrggbb`. Painted on the column header and the card's leading edge. */
	color: string;
	order: number;
	count: number;
}

/** A project. One post. */
export interface Project {
	id: number;
	title: string;
	excerpt: string;
	status: string;
	/** `planning` | `active` | `on-hold` | `done`. Set in the editor sidebar. */
	state: string;
	/** `#rrggbb`, or empty. Worn by this project's chips on the board. */
	color: string;
	start: string;
	target: string;
	leadId: number;
	leadName: string;
	leadAvatar: string;
	editUrl: string;
	canEdit: boolean;
}

/** A card. One post. */
export interface Task {
	id: number;
	title: string;
	excerpt: string;
	projectId: number;
	statusId: number;
	ownerId: number;
	ownerName: string;
	ownerAvatar: string;
	/** `YYYY-MM-DD`, or empty when undated. */
	due: string;
	priority: string;
	/** Index within its column. */
	order: number;
	/** How many approved comments the thread holds. */
	comments: number;
	/** Things attached to this task — any post, page, media or custom post. */
	links: Array< {
		id: number;
		title: string;
		type: string;
		typeLabel: string;
		editUrl: string;
		thumbnail: string;
	} >;
	/** The post this task is about, or 0. Set by dropping content on the board. */
	sourceId: number;
	sourceTitle: string;
	sourceUrl: string;
	editUrl: string;
	canEdit: boolean;
	canDelete: boolean;
}

/** A project with its numbers — what `GET /projects/<id>` returns. */
export interface ProjectDetail extends Project {
	description: string;
	total: number;
	done: number;
	open: number;
	overdue: number;
	/** Whole percent complete, floored, so 199/200 never reads as 100. */
	percent: number;
	breakdown: Array< { id: number; name: string; color: string; count: number } >;
	members: Array< { id: number; name: string; avatar: string; open: number } >;
	modified: string;
}

/** Everything the board needs to paint, from one request. */
export interface Board {
	statuses: Status[];
	projects: Project[];
	tasks: Task[];
	priorities: string[];
	viewer: {
		id: number;
		name: string;
		avatar: string;
		canCreate: boolean;
	};
}

/** One person's queue, for the widget. */
export interface MyWork {
	tasks: Task[];
	counts: {
		overdue: number;
		today: number;
		upcoming: number;
		done: number;
		total: number;
	};
	projects: Project[];
	statuses: Status[];
	generated: string;
}

/** Fields accepted when creating or changing a task. All optional on update. */
export interface TaskInput {
	title?: string;
	content?: string;
	project?: number;
	status?: number;
	owner?: number;
	due?: string;
	priority?: string;
	/** Link the task to a post — what a content drop on a column sets. */
	source?: number;
}

/** The blob PHP prints as `window.allTerrainWork`. */
export interface Config {
	restUrl: string;
	wpRestUrl: string;
	nonce: string;
	adminUrl: string;
	newTaskUrl: string;
	priorities: string[];
	canCreate: boolean;
	viewerId: number;
	version: string;
}

/**
 * The slice of OpenStation this plugin touches.
 *
 * Declared structurally rather than imported from the `openstation` package,
 * because the shell is *optional* here: importing its types would be harmless,
 * but importing its runtime -- which is what `import { … } from 'openstation'`
 * does, since the component barrel registers every tag as a side effect --
 * would bundle the shell's component kit into a plugin that must also run on
 * sites where the shell is not installed at all.
 *
 * Everything is optional and every call site null-checks. That is the price of
 * degrading instead of throwing.
 */
export interface ShellApi {
	dragManager?: DragManagerApi;
	openWindow?: ( id: string, opts?: { source?: string } ) => boolean;
	notify?: ( opts: { title?: string; body?: string; type?: string } ) => () => void;
	confirm?: ( opts: { title?: string; message?: string; confirmLabel?: string; danger?: boolean } ) => Promise< boolean >;
	fetch?: ( input: string, init?: RequestInit, opts?: { source?: string; silent?: boolean } ) => Promise< Response >;
	broadcast?: < T >( topic: string, payload: T ) => void;
	/** Opens an admin URL as a window. Config object only — a string throws. */
	windowManager?: {
		open?: ( config: {
			id: string;
			baseId?: string;
			url: string;
			title: string;
			icon?: string;
		} ) => unknown;
	};
	/** The same window id the dock would derive for a URL. */
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	subscribe?: ( topic: string, cb: ( payload: unknown ) => void ) => () => void;
	isActive?: () => boolean;
}

/** `wp.os.dragManager`, narrowed to what the board uses. */
export interface DragManagerApi {
	start( opts: DragStartOpts ): DragSession | null;
	registerDropTarget( target: DropTarget ): () => void;
	isDragging(): boolean;
	recentlyEndedDrag( withinMs?: number ): boolean;
}

export interface DragPayload {
	type: string;
	source: HTMLElement;
	data: Record< string, unknown >;
	ghost?: {
		element?: HTMLElement;
		offsetX: number;
		offsetY: number;
		hint?: { hidden?: boolean; accept?: string; reject?: string; neutral?: string };
	};
}

export interface DragSession {
	readonly payload: DragPayload;
	isFinished(): boolean;
	cancel( reason?: string ): void;
}

export interface DragStartOpts {
	payload: DragPayload;
	origin: PointerEvent;
	onClickOnly?: () => void;
	onCancel?: ( reason: string ) => void;
	onCommit?: ( target: DropTarget ) => void;
}

export interface DropTarget {
	id: string;
	element: HTMLElement;
	accept( payload: DragPayload ): boolean;
	onEnter?( session: DragSession ): void;
	onLeave?( session: DragSession ): void;
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void | Promise< void >;
	acceptLabel?: string;
}

/**
 * The drag payload slug this plugin emits.
 *
 * Exported so another plugin can register a drop target that accepts a work
 * card -- drop one on a calendar window to schedule it, on a chat window to
 * share it. That is the whole reason the board uses the shell's drag manager
 * instead of its own pointer handlers.
 */
export const TASK_PAYLOAD_TYPE = 'allterrain-work/task';

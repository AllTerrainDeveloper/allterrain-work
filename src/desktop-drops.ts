/**
 * Accepting the rest of the desktop.
 *
 * This is the thing the board can do that a kanban plugin in a browser tab
 * cannot: **drag a page, a draft or an image off the wallpaper onto a card and
 * it is attached to that task.** Drag five and get five. Drag a teammate's
 * avatar onto a card and it is theirs.
 *
 * Onto a *card*, deliberately, and never onto a column. A column is a status,
 * so the only thing that belongs in one is a task; dropping a draft on a column
 * once minted a task from it, which is a real and irreversible action taken on
 * a gesture that did not ask for one. Columns now refuse content outright, and
 * the refusal is visible — the drag manager's claimant rule means the column
 * says "can't drop here" rather than letting the drop fall through to whatever
 * is behind the board.
 *
 * It works because the board is a native window sharing one pointer pipeline
 * with every other surface in the shell, so a tile lifted in WP Explorer is
 * still mid-gesture when it arrives here. Nothing is serialized, nothing crosses
 * an iframe boundary, and the payload is the same object the source built.
 *
 * Two shapes arrive, both framework-stable:
 *
 *   - `shortcut` — a reference to an entity (`kind` + `ref`), which is what a
 *     WP Explorer tile emits. A multi-selection repeats it in `items`.
 *   - `desktop-file` — an existing wallpaper tile being moved. Its placement
 *     carries the same `type` + `ref` underneath.
 *
 * Both reduce to "a list of `{ kind, ref, title }`", which is all this module
 * works in. Nothing here knows what a placement is beyond how to read one.
 */

import type { DragPayload } from './types';

/** One thing the user dragged, flattened out of whichever shape carried it. */
export interface DroppedEntity {
	/** File-type slug — `post`, `page`, `attachment`, `user`, plugin-defined. */
	kind: string;
	/** The entity's id, as the source spelled it. */
	ref: string;
	/** Human-readable label, when the source bothered to carry one. */
	title: string;
}

/** The payload slugs the board is willing to look inside. */
const ACCEPTED_TYPES = [ 'shortcut', 'desktop-file' ];

/** Shapes the framework uses inside the two payloads, narrowed to what is read. */
interface ShortcutItem {
	kind?: string;
	ref?: string;
	title?: string;
}

interface PlacementFile {
	type?: string;
	ref?: string;
	title?: string;
}

interface Placement {
	file?: PlacementFile;
}

/**
 * Everything a payload is carrying, or an empty list.
 *
 * The multi-item fields (`items`, `placements`) are the whole set when the drag
 * began from a selection; the top-level fields describe the one the user
 * actually grabbed. Reading the set with a fallback to the single is the
 * framework's documented pattern, and it means "handle one" and "handle many"
 * are the same code with a different array length.
 */
export function entitiesIn( payload: DragPayload ): DroppedEntity[] {
	if ( payload.type === 'shortcut' ) {
		const data = payload.data as ShortcutItem & { items?: ShortcutItem[] };
		const items = data.items?.length ? data.items : [ data ];

		return items.map( toEntity ).filter( isUsable );
	}

	if ( payload.type === 'desktop-file' ) {
		const data = payload.data as { placement?: Placement; placements?: Placement[] };
		const list = data.placements?.length ? data.placements : [ data.placement ];

		return list
			.map( ( placement ) =>
				toEntity( {
					kind: placement?.file?.type,
					ref: placement?.file?.ref,
					title: placement?.file?.title,
				} )
			)
			.filter( isUsable );
	}

	return [];
}

function toEntity( item: ShortcutItem ): DroppedEntity {
	return {
		kind: String( item.kind ?? '' ),
		ref: String( item.ref ?? '' ),
		title: String( item.title ?? '' ).trim(),
	};
}

function isUsable( entity: DroppedEntity ): boolean {
	return entity.kind !== '' && entity.ref !== '';
}

/** Whether this payload is one the board might do something with at all. */
export function isDesktopPayload( payload: DragPayload ): boolean {
	return ACCEPTED_TYPES.includes( payload.type );
}

/**
 * The post-backed entities in a payload — everything attachable to a task.
 *
 * Any kind whose `ref` is a post id, which is posts, pages, media and every
 * custom post type the Explorer serves (all of which arrive as `kind: 'post'`
 * or `'page'` or `'attachment'`). A term or a comment has an id too, and it is
 * an id in a different table — attaching one would link to the wrong row.
 */
export function attachableEntities( payload: DragPayload ): DroppedEntity[] {
	if ( ! isDesktopPayload( payload ) ) {
		return [];
	}

	return entitiesIn( payload ).filter( ( entity ) => sourcePostId( entity ) > 0 );
}

/**
 * The single user in a payload, when that is exactly what it holds.
 *
 * One, not several: a card has one assignee, and quietly using the first of
 * four dropped avatars would be a guess dressed as a feature. A multi-user drop
 * is refused, and the ghost says so.
 */
export function assigneeIn( payload: DragPayload ): DroppedEntity | null {
	if ( ! isDesktopPayload( payload ) ) {
		return null;
	}

	const entities = entitiesIn( payload );

	return entities.length === 1 && entities[ 0 ].kind === 'user' ? entities[ 0 ] : null;
}

/**
 * The post id to link a task back to, when the entity is one.
 *
 * `post`, `page` and `attachment` are all posts and their refs are post ids, so
 * the task can carry a real link. A `term` or a `comment` is not, and gets a
 * task with a title and no link rather than a link to the wrong table.
 */
export function sourcePostId( entity: DroppedEntity ): number {
	if ( ! [ 'post', 'page', 'attachment' ].includes( entity.kind ) ) {
		return 0;
	}

	const id = Number.parseInt( entity.ref, 10 );

	return Number.isFinite( id ) && id > 0 ? id : 0;
}

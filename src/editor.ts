/**
 * The fields, in the editor where you actually edit.
 *
 * Registering meta with `show_in_rest` makes it *reachable* from the block
 * editor; it does not make it *editable*. Without a UI the fields exist only to
 * REST clients, so opening a task in Gutenberg showed a title, a body, and no
 * hint that the thing has an owner, a deadline and a column. This adds a
 * document sidebar panel per post type that edits them properly.
 *
 * Written against `window.wp.*` rather than importing `@wordpress/*` packages,
 * for the same reason the rest of this plugin is written against the shell
 * structurally: those packages are already on the page as globals when the
 * block editor is running, and importing them would bundle a second copy of
 * React and the component kit into a plugin that also has to load on pages
 * where none of it exists.
 *
 * `createElement` by hand rather than JSX keeps the build a plain Vite IIFE
 * with no transform to configure, at the cost of some verbosity here. Worth it
 * for one panel; if this file ever grows a second screen, reach for JSX.
 */

/** Minimal shapes for the editor globals this file touches. */
interface WpElement {
	createElement: ( type: unknown, props?: Record< string, unknown > | null, ...children: unknown[] ) => unknown;
	Fragment: unknown;
}

interface WpData {
	useSelect: < T >( mapper: ( select: ( store: string ) => Record< string, ( ...args: unknown[] ) => unknown > ) => T, deps?: unknown[] ) => T;
	useDispatch: ( store: string ) => Record< string, ( ...args: unknown[] ) => unknown >;
}

interface EditorGlobals {
	element?: WpElement;
	data?: WpData;
	plugins?: { registerPlugin: ( name: string, settings: Record< string, unknown > ) => void };
	components?: Record< string, unknown >;
	editor?: { PluginDocumentSettingPanel?: unknown };
	editPost?: { PluginDocumentSettingPanel?: unknown };
	i18n?: { __: ( text: string, domain?: string ) => string };
}

/** A user or post row as the core data store returns it. */
interface EntityRow {
	id: number;
	name?: string;
	title?: { rendered?: string; raw?: string };
}

const wp = ( window as unknown as { wp?: EditorGlobals } ).wp;

/** Everything this file needs, or nothing — the guard for a non-editor page. */
function editorApi() {
	if ( ! wp?.element || ! wp.data || ! wp.plugins || ! wp.components ) {
		return null;
	}

	// `PluginDocumentSettingPanel` moved from `wp-edit-post` to `wp-editor` in
	// WordPress 6.6 and is deprecated in the old home. Reading the new one first
	// and falling back keeps this working across both without a version check.
	const panel = wp.editor?.PluginDocumentSettingPanel ?? wp.editPost?.PluginDocumentSettingPanel;

	if ( ! panel ) {
		return null;
	}

	return {
		el: wp.element.createElement,
		Fragment: wp.element.Fragment,
		useSelect: wp.data.useSelect,
		useDispatch: wp.data.useDispatch,
		registerPlugin: wp.plugins.registerPlugin,
		components: wp.components,
		Panel: panel,
		__: wp.i18n?.__ ?? ( ( text: string ) => text ),
	};
}

const api = editorApi();

/** The config PHP printed, for the labels and enums the panel offers. */
interface EditorConfig {
	postType: string;
	projectType: string;
	taskType: string;
	statusTaxonomy: string;
	priorities: string[];
	priorityLabels: Record< string, string >;
	states: string[];
	stateLabels: Record< string, string >;
	meta: Record< string, string >;
	boardWindow: string;
}

const config = ( window as unknown as { allTerrainWorkEditor?: EditorConfig } ).allTerrainWorkEditor;

if ( api && config ) {
	const { el, useSelect, useDispatch, registerPlugin, components, Panel, __ } = api;
	const { TextControl, SelectControl, ColorPalette, BaseControl, Button } = components as Record<
		string,
		unknown
	>;

	/**
	 * Reads and writes meta on the post being edited.
	 *
	 * Through `editPost` rather than a direct save: it marks the post dirty and
	 * lets the field ride the editor's own Save, so a change here behaves like
	 * every other change in the editor — undoable, autosaved, and never written
	 * behind the user's back while they are still typing.
	 *
	 * The selector returns the store's own object, not a copy. `useSelect`
	 * compares results by identity to decide whether to re-render, so a mapper
	 * that builds anything new — an object literal, a `.map()`, even `?? {}` —
	 * returns a different value every call and re-renders the panel on every
	 * store tick. WordPress warns about exactly this in the console. Mapping
	 * belongs outside the hook.
	 */
	const useMeta = () => {
		const meta = useSelect< Record< string, unknown > | undefined >(
			( select ) =>
				select( 'core/editor' ).getEditedPostAttribute( 'meta' ) as
					| Record< string, unknown >
					| undefined,
			[]
		);
		const { editPost } = useDispatch( 'core/editor' );

		return {
			meta: meta ?? {},
			set: ( key: string, value: unknown ) => editPost( { meta: { [ key ]: value } } ),
		};
	};

	/** Turns entity rows into `<SelectControl>` options, outside any selector. */
	const toOptions = (
		rows: EntityRow[] | undefined,
		emptyLabel: string,
		label: ( row: EntityRow ) => string
	) =>
		[ { label: emptyLabel, value: '0' } ].concat(
			( rows ?? [] ).map( ( row ) => ( { label: label( row ), value: String( row.id ) } ) )
		);

	/** The user records, as the store holds them — a stable reference between ticks. */
	const useUsers = () =>
		useSelect< EntityRow[] | undefined >(
			( select ) => select( 'core' ).getEntityRecords( 'root', 'user', { per_page: 100 } ) as
				| EntityRow[]
				| undefined,
			[]
		);

	/** A labelled date field. Native date input — the platform's picker is better than a rebuilt one. */
	const dateField = ( label: string, value: string, onChange: ( next: string ) => void ) =>
		el( TextControl, {
			label,
			type: 'date',
			value: value || '',
			onChange,
			__nextHasNoMarginBottom: true,
		} );

	/** Opens the board, from the editor, without leaving the desktop. */
	const boardButton = () =>
		el(
			Button,
			{
				variant: 'secondary',
				onClick: () => {
					const os = ( window as unknown as {
						wp?: { os?: { openWindow?: ( id: string, o?: unknown ) => boolean } };
					} ).wp?.os;

					os?.openWindow?.( config.boardWindow, { source: 'editor' } );
				},
			},
			__( 'Open the work board', 'allterrain-work' )
		);

	/** Whether the shell is present to open a board window on at all. */
	const hasShell = () =>
		!! ( window as unknown as { wp?: { os?: { openWindow?: unknown } } } ).wp?.os?.openWindow;

	// -- Task panel --------------------------------------------------------

	const TaskPanel = () => {
		const { meta, set } = useMeta();
		const userRows = useUsers();

		const projectRows = useSelect< EntityRow[] | undefined >(
			( select ) => select( 'core' ).getEntityRecords( 'postType', config.projectType, {
				per_page: 100,
				status: 'any',
			} ) as EntityRow[] | undefined,
			[]
		);

		const users = toOptions( userRows, __( '— Nobody —', 'allterrain-work' ), ( row ) =>
			row.name ?? String( row.id )
		);
		const projects = toOptions( projectRows, __( '— No project —', 'allterrain-work' ), ( row ) =>
			row.title?.raw || row.title?.rendered || String( row.id )
		);

		return el(
			Panel as never,
			{ name: 'allterrain-work-task', title: __( 'Work', 'allterrain-work' ) },
			el( SelectControl, {
				label: __( 'Project', 'allterrain-work' ),
				value: String( meta[ config.meta.project ] ?? 0 ),
				options: projects,
				onChange: ( value: string ) => set( config.meta.project, Number( value ) ),
				__nextHasNoMarginBottom: true,
			} ),
			el( SelectControl, {
				label: __( 'Assignee', 'allterrain-work' ),
				value: String( meta[ config.meta.owner ] ?? 0 ),
				options: users,
				onChange: ( value: string ) => set( config.meta.owner, Number( value ) ),
				__nextHasNoMarginBottom: true,
			} ),
			dateField( __( 'Due date', 'allterrain-work' ), String( meta[ config.meta.due ] ?? '' ), ( value ) =>
				set( config.meta.due, value )
			),
			el( SelectControl, {
				label: __( 'Priority', 'allterrain-work' ),
				value: String( meta[ config.meta.priority ] ?? 'medium' ),
				options: config.priorities.map( ( slug ) => ( {
					label: config.priorityLabels[ slug ] ?? slug,
					value: slug,
				} ) ),
				onChange: ( value: string ) => set( config.meta.priority, value ),
				__nextHasNoMarginBottom: true,
			} ),
			hasShell() ? boardButton() : null
		);
	};

	// -- Project panel -----------------------------------------------------

	const ProjectPanel = () => {
		const { meta, set } = useMeta();
		const users = toOptions( useUsers(), __( '— Nobody —', 'allterrain-work' ), ( row ) =>
			row.name ?? String( row.id )
		);

		return el(
			Panel as never,
			{ name: 'allterrain-work-project', title: __( 'Project', 'allterrain-work' ) },
			el( SelectControl, {
				label: __( 'Lead', 'allterrain-work' ),
				value: String( meta[ config.meta.lead ] ?? 0 ),
				options: users,
				onChange: ( value: string ) => set( config.meta.lead, Number( value ) ),
				__nextHasNoMarginBottom: true,
			} ),
			el( SelectControl, {
				label: __( 'State', 'allterrain-work' ),
				value: String( meta[ config.meta.state ] ?? 'active' ),
				options: config.states.map( ( slug ) => ( {
					label: config.stateLabels[ slug ] ?? slug,
					value: slug,
				} ) ),
				onChange: ( value: string ) => set( config.meta.state, value ),
				__nextHasNoMarginBottom: true,
			} ),
			dateField( __( 'Starts', 'allterrain-work' ), String( meta[ config.meta.start ] ?? '' ), ( value ) =>
				set( config.meta.start, value )
			),
			dateField( __( 'Target', 'allterrain-work' ), String( meta[ config.meta.target ] ?? '' ), ( value ) =>
				set( config.meta.target, value )
			),
			el(
				BaseControl,
				{
					label: __( 'Colour', 'allterrain-work' ),
					id: 'atwork-project-colour',
					help: __( 'Worn by this project’s chips on the board.', 'allterrain-work' ),
					__nextHasNoMarginBottom: true,
				},
				el( ColorPalette, {
					value: String( meta[ config.meta.color ] ?? '' ) || undefined,
					// `clearable` matters: the field is optional, and a palette
					// with no way back to "none" makes the first click permanent.
					clearable: true,
					onChange: ( value?: string ) => set( config.meta.color, value ?? '' ),
				} )
			),
			hasShell() ? boardButton() : null
		);
	};

	const panelFor = config.postType === config.projectType ? ProjectPanel : TaskPanel;

	registerPlugin( 'allterrain-work-fields', { render: panelFor, icon: 'clipboard' } );
}

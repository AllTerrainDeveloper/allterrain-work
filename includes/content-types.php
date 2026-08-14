<?php
/**
 * Projects, tasks and the statuses they sit in.
 *
 * All three are core objects: two post types and a taxonomy. Nothing here needs
 * a custom table, and choosing one would have cost every capability check, REST
 * route, revision, search result and `save_post` integration that this file
 * gets for the price of an argument array.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'atwork_register_content_types', 5 );

/**
 * Registers the post types, the status taxonomy, and the task meta.
 *
 * Priority 5 so anything reacting to these registrations -- the shell's window
 * registration at 20, a theme adding a template -- can rely on them existing.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_content_types() {
	register_post_type(
		ATWORK_PROJECT_TYPE,
		array(
			'labels'              => array(
				'name'          => __( 'Projects', 'allterrain-work' ),
				'singular_name' => __( 'Project', 'allterrain-work' ),
				'add_new_item'  => __( 'Add New Project', 'allterrain-work' ),
				'edit_item'     => __( 'Edit Project', 'allterrain-work' ),
				'search_items'  => __( 'Search Projects', 'allterrain-work' ),
				'not_found'     => __( 'No projects yet.', 'allterrain-work' ),
				'menu_name'     => __( 'Projects', 'allterrain-work' ),
			),
			'public'              => false,
			'show_ui'             => true,
			// Not its own top-level menu: the board is the way in, and a second
			// entry that opens the list table would tell users there are two
			// places to work. `atwork_register_admin_page()` hangs the list
			// tables underneath the board's menu instead.
			'show_in_menu'        => false,
			'show_in_rest'        => true,
			'rest_base'           => 'atwork-projects',
			'menu_icon'           => 'dashicons-portfolio',
			// `excerpt` earns its place: WP Explorer renders a section's tiles
			// from `excerpt.rendered`, and the REST controller omits the field
			// entirely for a type that does not declare support -- so without
			// this the tiles have nothing to show but a title, and no filter can
			// put anything there.
			'supports'            => array( 'title', 'editor', 'excerpt', 'author', 'thumbnail', 'revisions', 'custom-fields' ),
			'has_archive'         => false,
			'exclude_from_search' => true,
			'hierarchical'        => false,
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
		)
	);

	register_post_type(
		ATWORK_TASK_TYPE,
		array(
			'labels'              => array(
				'name'          => __( 'Tasks', 'allterrain-work' ),
				'singular_name' => __( 'Task', 'allterrain-work' ),
				'add_new_item'  => __( 'Add New Task', 'allterrain-work' ),
				'edit_item'     => __( 'Edit Task', 'allterrain-work' ),
				'search_items'  => __( 'Search Tasks', 'allterrain-work' ),
				'not_found'     => __( 'No tasks yet.', 'allterrain-work' ),
				'menu_name'     => __( 'Tasks', 'allterrain-work' ),
			),
			'public'              => false,
			'show_ui'             => true,
			'show_in_menu'        => false,
			'show_in_rest'        => true,
			'rest_base'           => 'atwork-tasks',
			'menu_icon'           => 'dashicons-yes-alt',
			// `page-attributes` is what surfaces `menu_order` in the classic
			// editor. `menu_order` is the card's index inside its column, so
			// without this the ordering the board maintains would be invisible
			// -- and uneditable -- to anyone working from wp-admin instead.
			// `excerpt` is what carries the generated status/owner/due summary
			// onto WP Explorer's tiles -- see `atwork_explorer_task_excerpt()`.
			// The REST controller drops the field for a type without support,
			// so this is load-bearing rather than cosmetic.
			'supports'            => array( 'title', 'editor', 'excerpt', 'author', 'comments', 'revisions', 'page-attributes', 'custom-fields' ),
			'taxonomies'          => array( ATWORK_STATUS_TAX ),
			'has_archive'         => false,
			'exclude_from_search' => true,
			'hierarchical'        => false,
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
		)
	);

	register_taxonomy(
		ATWORK_STATUS_TAX,
		array( ATWORK_TASK_TYPE ),
		array(
			'labels'            => array(
				'name'          => __( 'Statuses', 'allterrain-work' ),
				'singular_name' => __( 'Status', 'allterrain-work' ),
				'add_new_item'  => __( 'Add New Status', 'allterrain-work' ),
				'edit_item'     => __( 'Edit Status', 'allterrain-work' ),
				'menu_name'     => __( 'Statuses', 'allterrain-work' ),
			),
			'public'            => false,
			'show_ui'           => true,
			'show_in_menu'      => false,
			'show_in_rest'      => true,
			'rest_base'         => 'atwork-statuses',
			// A task is in exactly one column. Enforcing that in the UI is not
			// enough -- a REST write or an ability call can set several terms
			// at once, and the board would then draw the same card twice.
			// `atwork_enforce_single_status()` below is the actual guarantee.
			'hierarchical'      => false,
			'show_admin_column' => true,
			'capabilities'      => array(
				'manage_terms' => 'manage_categories',
				'edit_terms'   => 'manage_categories',
				'delete_terms' => 'manage_categories',
				'assign_terms' => 'edit_posts',
			),
		)
	);

	atwork_register_task_meta();
	atwork_register_project_meta();
	atwork_register_status_meta();
}

/**
 * Registers the task meta.
 *
 * All four are `show_in_rest`, so `/wp/v2/atwork-tasks` reads and writes them
 * alongside the title -- which is what lets an integration that has never heard
 * of this plugin's own routes still create a fully-formed task.
 *
 * `auth_callback` is the load-bearing argument: without it, meta registered as
 * `show_in_rest` is writable by anyone who can edit *any* post, not just this
 * one. Each returns `current_user_can( 'edit_post', $post_id )`.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_task_meta() {
	$auth = static function ( $allowed, $meta_key, $post_id ) {
		return current_user_can( 'edit_post', $post_id );
	};

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_PROJECT,
		array(
			'type'              => 'integer',
			'description'       => __( 'ID of the project this task belongs to.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_OWNER,
		array(
			'type'              => 'integer',
			'description'       => __( 'ID of the user this task is assigned to.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_DUE,
		array(
			'type'              => 'string',
			'description'       => __( 'Due date, as YYYY-MM-DD. Empty when the task has no deadline.', 'allterrain-work' ),
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => true,
			'sanitize_callback' => 'atwork_sanitize_date',
			'auth_callback'     => $auth,
		)
	);

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_SOURCE,
		array(
			'type'              => 'integer',
			'description'       => __( 'ID of the post this task was created from, if any.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_LINKS,
		array(
			'type'          => 'array',
			'description'   => __( 'IDs of posts, pages, media or custom posts attached to this task.', 'allterrain-work' ),
			'single'        => true,
			'default'       => array(),
			'show_in_rest'  => array(
				'schema' => array(
					'type'  => 'array',
					'items' => array( 'type' => 'integer' ),
				),
			),
			'auth_callback' => $auth,
		)
	);

	register_post_meta(
		ATWORK_TASK_TYPE,
		ATWORK_META_PRIORITY,
		array(
			'type'              => 'string',
			'description'       => __( 'One of: low, medium, high, critical.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 'medium',
			'show_in_rest'      => true,
			'sanitize_callback' => 'atwork_sanitize_priority',
			'auth_callback'     => $auth,
		)
	);
}

/**
 * Registers the project meta.
 *
 * All `show_in_rest`, which is what puts them in reach of the block editor: the
 * editor reads and writes post meta through the same REST resource it uses for
 * the title, so a field that is not exposed there cannot be edited in Gutenberg
 * at all, no matter what UI is registered for it.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_project_meta() {
	$auth = static function ( $allowed, $meta_key, $post_id ) {
		return current_user_can( 'edit_post', $post_id );
	};

	register_post_meta(
		ATWORK_PROJECT_TYPE,
		ATWORK_META_LEAD,
		array(
			'type'              => 'integer',
			'description'       => __( 'ID of the user running this project.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);

	foreach ( array( ATWORK_META_START, ATWORK_META_TARGET ) as $date_key ) {
		register_post_meta(
			ATWORK_PROJECT_TYPE,
			$date_key,
			array(
				'type'              => 'string',
				'description'       => ATWORK_META_START === $date_key
					? __( 'Start date, as YYYY-MM-DD.', 'allterrain-work' )
					: __( 'Target completion date, as YYYY-MM-DD.', 'allterrain-work' ),
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'sanitize_callback' => 'atwork_sanitize_date',
				'auth_callback'     => $auth,
			)
		);
	}

	register_post_meta(
		ATWORK_PROJECT_TYPE,
		ATWORK_META_STATE,
		array(
			'type'              => 'string',
			'description'       => __( 'One of: planning, active, on-hold, done.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 'active',
			'show_in_rest'      => true,
			'sanitize_callback' => 'atwork_sanitize_project_state',
			'auth_callback'     => $auth,
		)
	);

	register_post_meta(
		ATWORK_PROJECT_TYPE,
		ATWORK_META_COLOR,
		array(
			'type'              => 'string',
			'description'       => __( 'Hex colour worn by this project\'s chips on the board.', 'allterrain-work' ),
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => true,
			// Deliberately not `atwork_sanitize_hex_color()`: that one falls back
			// to grey, which would turn "no colour chosen" into "chose grey" and
			// make the field impossible to clear.
			'sanitize_callback' => 'atwork_sanitize_optional_hex_color',
			'auth_callback'     => $auth,
		)
	);
}

/**
 * Registers the status term meta -- the column's colour and its position.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_status_meta() {
	$auth = static function () {
		return current_user_can( 'manage_categories' );
	};

	register_term_meta(
		ATWORK_STATUS_TAX,
		ATWORK_TERM_COLOR,
		array(
			'type'              => 'string',
			'description'       => __( 'Hex colour of the column header and card stripe.', 'allterrain-work' ),
			'single'            => true,
			'default'           => '#c4c4c4',
			'show_in_rest'      => true,
			'sanitize_callback' => 'atwork_sanitize_hex_color',
			'auth_callback'     => $auth,
		)
	);

	register_term_meta(
		ATWORK_STATUS_TAX,
		ATWORK_TERM_ORDER,
		array(
			'type'              => 'integer',
			'description'       => __( 'Left-to-right position of the column on the board.', 'allterrain-work' ),
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => true,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);
}

/**
 * The statuses a fresh install starts with.
 *
 * Returned from a function rather than declared as a constant so the labels can
 * be translated -- a constant would be evaluated before the text domain loads.
 *
 * @since 0.1.0
 *
 * @return array[] List of `slug`, `name`, `color`, `order`.
 */
function atwork_default_statuses() {
	/**
	 * Filters the statuses seeded on activation.
	 *
	 * Only consulted when the taxonomy is empty. Changing this on an existing
	 * site does nothing -- edit the terms instead, so nobody's column
	 * disappears with their cards inside it.
	 *
	 * @since 0.1.0
	 *
	 * @param array[] $statuses List of `slug`, `name`, `color`, `order`.
	 */
	return apply_filters(
		'atwork_default_statuses',
		array(
			array(
				'slug'  => 'not-started',
				'name'  => __( 'Not started', 'allterrain-work' ),
				'color' => '#c4c4c4',
				'order' => 10,
			),
			array(
				'slug'  => 'working-on-it',
				'name'  => __( 'Working on it', 'allterrain-work' ),
				'color' => '#fdab3d',
				'order' => 20,
			),
			array(
				'slug'  => 'stuck',
				'name'  => __( 'Stuck', 'allterrain-work' ),
				'color' => '#e2445c',
				'order' => 30,
			),
			array(
				'slug'  => 'done',
				'name'  => __( 'Done', 'allterrain-work' ),
				'color' => '#00c875',
				'order' => 40,
			),
		)
	);
}

/**
 * Creates the default columns, once.
 *
 * Guarded on the taxonomy being empty rather than on an "already seeded" option:
 * a user who deletes every status has said something, and re-seeding on the next
 * activation would say it back. An option would also resurrect nothing after a
 * database restore that predates it.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_seed_statuses() {
	$existing = get_terms(
		array(
			'taxonomy'   => ATWORK_STATUS_TAX,
			'hide_empty' => false,
			'fields'     => 'ids',
			'number'     => 1,
		)
	);

	if ( is_wp_error( $existing ) || ! empty( $existing ) ) {
		return;
	}

	foreach ( atwork_default_statuses() as $status ) {
		$term = wp_insert_term(
			$status['name'],
			ATWORK_STATUS_TAX,
			array( 'slug' => $status['slug'] )
		);

		if ( is_wp_error( $term ) ) {
			continue;
		}

		update_term_meta( $term['term_id'], ATWORK_TERM_COLOR, $status['color'] );
		update_term_meta( $term['term_id'], ATWORK_TERM_ORDER, $status['order'] );
	}
}

add_action( 'set_object_terms', 'atwork_enforce_single_status', 10, 6 );

/**
 * Keeps a task in exactly one column.
 *
 * A card drawn in two columns at once is not a cosmetic bug -- dragging one copy
 * moves the task and leaves the other copy behind, and the board now disagrees
 * with itself about where the work is. The board UI can only ever send one term,
 * but core REST, an ability call, a CSV importer and `wp_set_object_terms()` in
 * somebody else's plugin can all send several, so the guarantee belongs here
 * rather than in the client.
 *
 * The last term in the submitted list wins, which matches what `wp_set_object_terms()`
 * callers intend when they pass an array they built by appending.
 *
 * @since 0.1.0
 *
 * @param int    $object_id  Post ID.
 * @param array  $terms      Terms as submitted.
 * @param array  $tt_ids     Term taxonomy IDs now assigned.
 * @param string $taxonomy   Taxonomy slug.
 * @param bool   $append     Whether terms were appended rather than replaced.
 * @param array  $old_tt_ids Term taxonomy IDs previously assigned.
 * @return void
 */
function atwork_enforce_single_status( $object_id, $terms, $tt_ids, $taxonomy, $append, $old_tt_ids ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter -- The last two are part of the `set_object_terms` signature and must be accepted to reach `$taxonomy`.
	if ( ATWORK_STATUS_TAX !== $taxonomy || count( $tt_ids ) < 2 ) {
		return;
	}

	// Re-entrancy: the corrective write fires this hook again, but with a single
	// term taxonomy ID, so the count guard above ends the recursion immediately.
	$keep = get_term_by( 'term_taxonomy_id', (int) end( $tt_ids ), $taxonomy );

	if ( $keep instanceof WP_Term ) {
		wp_set_object_terms( $object_id, array( $keep->term_id ), $taxonomy, false );
	}
}

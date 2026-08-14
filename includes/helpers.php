<?php
/**
 * Reading and writing the board.
 *
 * The functions here are the plugin's real API surface: REST routes, abilities
 * and the standalone admin page are all thin wrappers over them. Written so
 * they can be called from any of those contexts -- they take plain arrays,
 * return plain arrays or `WP_Error`, and check capabilities themselves rather
 * than trusting the caller to have done it.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

/**
 * The priorities a task can carry.
 *
 * @since 0.1.0
 *
 * @return string[] Ordered least to most urgent.
 */
function atwork_priorities() {
	return array( 'low', 'medium', 'high', 'critical' );
}

/**
 * Sanitizes a priority, falling back to the middle of the scale.
 *
 * @since 0.1.0
 *
 * @param mixed $value Raw value.
 * @return string One of `atwork_priorities()`.
 */
function atwork_sanitize_priority( $value ) {
	$value = sanitize_key( (string) $value );

	return in_array( $value, atwork_priorities(), true ) ? $value : 'medium';
}

/**
 * Sanitizes a `YYYY-MM-DD` date, rejecting anything else.
 *
 * `checkdate()` rather than a regex alone, so 2025-02-30 -- which matches the
 * shape perfectly -- does not become a due date no calendar contains.
 *
 * @since 0.1.0
 *
 * @param mixed $value Raw value.
 * @return string The date, or an empty string when it is not a real one.
 */
function atwork_sanitize_date( $value ) {
	$value = trim( (string) $value );

	if ( '' === $value ) {
		return '';
	}

	if ( ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m ) ) {
		return '';
	}

	return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ? $value : '';
}

/**
 * Sanitizes a hex colour down to `#rrggbb`.
 *
 * `sanitize_hex_color()` lives in the customizer and is not loaded on every
 * request, so this does the work rather than gambling on it being there.
 *
 * @since 0.1.0
 *
 * @param mixed $value Raw value.
 * @return string A `#rrggbb` string, or the neutral default.
 */
function atwork_sanitize_hex_color( $value ) {
	$value = trim( (string) $value );

	if ( preg_match( '/^#[0-9a-fA-F]{6}$/', $value ) ) {
		return strtolower( $value );
	}

	// Expand `#abc` rather than discarding it -- it is valid CSS a user may
	// well have typed, and silently replacing it with grey reads as the field
	// having ignored them.
	if ( preg_match( '/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/', $value, $m ) ) {
		return strtolower( '#' . $m[1] . $m[1] . $m[2] . $m[2] . $m[3] . $m[3] );
	}

	return '#c4c4c4';
}

/**
 * The REST field name a task's status arrives under.
 *
 * Not the taxonomy slug. `WP_REST_Posts_Controller` keys a taxonomy field by
 * the taxonomy's `rest_base`, which here is the plural `atwork-statuses` — so
 * asking for `atwork-status` asks for a field that does not exist, and the
 * answer is silence rather than an error. Derived rather than written out so
 * changing `rest_base` cannot leave a stale literal behind.
 *
 * @since 0.1.0
 *
 * @return string REST field name.
 */
function atwork_status_rest_field() {
	$taxonomy = get_taxonomy( ATWORK_STATUS_TAX );

	return ( $taxonomy && ! empty( $taxonomy->rest_base ) ) ? (string) $taxonomy->rest_base : ATWORK_STATUS_TAX;
}

/**
 * The states a project can be in.
 *
 * A manual state, deliberately separate from task progress. A project can be
 * 100% of its current tasks and still be on hold waiting for a contract; the
 * two answer different questions and collapsing them loses one.
 *
 * @since 0.1.0
 *
 * @return string[] State slugs.
 */
function atwork_project_states() {
	return array( 'planning', 'active', 'on-hold', 'done' );
}

/**
 * Sanitizes a project state, defaulting to the one most projects are in.
 *
 * @since 0.1.0
 *
 * @param mixed $value Raw value.
 * @return string One of `atwork_project_states()`.
 */
function atwork_sanitize_project_state( $value ) {
	$value = sanitize_key( (string) $value );

	return in_array( $value, atwork_project_states(), true ) ? $value : 'active';
}

/**
 * Sanitizes a hex colour, allowing "none".
 *
 * `atwork_sanitize_hex_color()` falls back to grey, which is right for a column
 * -- every column has a colour -- and wrong for a project, where the field is
 * optional. Falling back there would turn "no colour chosen" into "chose grey"
 * and leave the user no way to clear it again.
 *
 * @since 0.1.0
 *
 * @param mixed $value Raw value.
 * @return string A `#rrggbb` string, or an empty string.
 */
function atwork_sanitize_optional_hex_color( $value ) {
	$value = trim( (string) $value );

	if ( '' === $value ) {
		return '';
	}

	$colour = atwork_sanitize_hex_color( $value );

	// The fallback grey is indistinguishable from a real choice of grey, so an
	// unparseable value clears the field rather than silently becoming one.
	return '#c4c4c4' === $colour && ! preg_match( '/^#c4c4c4$/i', $value ) ? '' : $colour;
}

/**
 * Every status, in board order.
 *
 * @since 0.1.0
 *
 * @return array[] List of `id`, `slug`, `name`, `color`, `order`.
 */
function atwork_get_statuses() {
	$terms = get_terms(
		array(
			'taxonomy'   => ATWORK_STATUS_TAX,
			'hide_empty' => false,
		)
	);

	if ( is_wp_error( $terms ) ) {
		return array();
	}

	$statuses = array();

	foreach ( $terms as $term ) {
		$statuses[] = array(
			'id'    => (int) $term->term_id,
			'slug'  => $term->slug,
			'name'  => $term->name,
			'color' => atwork_sanitize_hex_color( get_term_meta( $term->term_id, ATWORK_TERM_COLOR, true ) ),
			'order' => (int) get_term_meta( $term->term_id, ATWORK_TERM_ORDER, true ),
			'count' => (int) $term->count,
		);
	}

	// Ties break on name so the column order is stable between requests. Terms
	// seeded together all carry order 0 until somebody sorts them, and an
	// unstable sort there would shuffle the board on every reload.
	usort(
		$statuses,
		static function ( $a, $b ) {
			return $a['order'] === $b['order']
				? strcasecmp( $a['name'], $b['name'] )
				: $a['order'] - $b['order'];
		}
	);

	return $statuses;
}

/**
 * Every project the current user can see.
 *
 * @since 0.1.0
 *
 * @return array[] Project payloads, as `atwork_prepare_project()` shapes them.
 */
function atwork_get_projects() {
	$posts = get_posts(
		array(
			'post_type'        => ATWORK_PROJECT_TYPE,
			'post_status'      => array( 'publish', 'draft', 'private' ),
			// A ceiling, not a page. Projects are the board's filter list and
			// its widget's picker, both of which have to be complete to be
			// correct -- a paginated picker silently omits the project the user
			// is looking for. Sites with 200 projects want a search field, not
			// a second page, and that is a different feature.
			'numberposts'      => 200, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_numberposts
			'orderby'          => array(
				'menu_order' => 'ASC',
				'title'      => 'ASC',
			),
			'suppress_filters' => false,
		)
	);

	$projects = array();

	foreach ( $posts as $post ) {
		if ( ! current_user_can( 'read_post', $post->ID ) ) {
			continue;
		}

		$projects[] = atwork_prepare_project( $post );
	}

	return $projects;
}

/**
 * Shapes a project for the client.
 *
 * @since 0.1.0
 *
 * @param WP_Post $post Project post.
 * @return array Project payload.
 */
function atwork_prepare_project( $post ) {
	$lead_id = (int) get_post_meta( $post->ID, ATWORK_META_LEAD, true );
	$lead    = $lead_id ? get_userdata( $lead_id ) : false;

	return array(
		'id'         => (int) $post->ID,
		'title'      => html_entity_decode( get_the_title( $post ), ENT_QUOTES, get_bloginfo( 'charset' ) ),
		'excerpt'    => wp_strip_all_tags( (string) $post->post_excerpt ),
		'status'     => $post->post_status,
		'state'      => atwork_sanitize_project_state( get_post_meta( $post->ID, ATWORK_META_STATE, true ) ),
		'color'      => atwork_sanitize_optional_hex_color( get_post_meta( $post->ID, ATWORK_META_COLOR, true ) ),
		'start'      => (string) get_post_meta( $post->ID, ATWORK_META_START, true ),
		'target'     => (string) get_post_meta( $post->ID, ATWORK_META_TARGET, true ),
		'leadId'     => $lead_id,
		'leadName'   => $lead ? $lead->display_name : '',
		'leadAvatar' => $lead ? (string) get_avatar_url( $lead_id, array( 'size' => 48 ) ) : '',
		'editUrl'    => get_edit_post_link( $post->ID, 'raw' ),
		'canEdit'    => current_user_can( 'edit_post', $post->ID ),
	);
}

/**
 * Shapes a task for the client.
 *
 * `canEdit` travels with every card so the board can hide affordances the server
 * would refuse -- a drag handle that always throws a 403 is worse than no drag
 * handle, because the user only finds out after they have moved it.
 *
 * @since 0.1.0
 *
 * @param WP_Post $post Task post.
 * @return array Task payload.
 */
function atwork_prepare_task( $post ) {
	$terms     = wp_get_object_terms( $post->ID, ATWORK_STATUS_TAX, array( 'fields' => 'ids' ) );
	$status_id = ( ! is_wp_error( $terms ) && ! empty( $terms ) ) ? (int) $terms[0] : 0;
	$owner_id  = (int) get_post_meta( $post->ID, ATWORK_META_OWNER, true );
	$owner     = $owner_id ? get_userdata( $owner_id ) : false;
	$source_id = (int) get_post_meta( $post->ID, ATWORK_META_SOURCE, true );
	$source    = $source_id ? get_post( $source_id ) : null;

	return array(
		'id'          => (int) $post->ID,
		'title'       => html_entity_decode( get_the_title( $post ), ENT_QUOTES, get_bloginfo( 'charset' ) ),
		'excerpt'     => wp_trim_words( wp_strip_all_tags( (string) $post->post_content ), 24 ),
		'projectId'   => (int) get_post_meta( $post->ID, ATWORK_META_PROJECT, true ),
		'statusId'    => $status_id,
		'ownerId'     => $owner_id,
		'ownerName'   => $owner ? $owner->display_name : '',
		// `get_avatar_url()` returns false when avatars are switched off site
		// wide; the client draws initials in that case rather than a broken img.
		'ownerAvatar' => $owner ? (string) get_avatar_url( $owner_id, array( 'size' => 48 ) ) : '',
		'due'         => (string) get_post_meta( $post->ID, ATWORK_META_DUE, true ),
		'priority'    => atwork_sanitize_priority( get_post_meta( $post->ID, ATWORK_META_PRIORITY, true ) ),
		'order'       => (int) $post->menu_order,
		// The content this task is about, when it was made by dropping that
		// content on the board. Null once the post is gone -- a card outliving
		// its source is a task about something that was deleted, which is worth
		// keeping and not worth linking to.
		'sourceId'    => $source ? $source_id : 0,
		'sourceTitle' => $source ? html_entity_decode( get_the_title( $source ), ENT_QUOTES, get_bloginfo( 'charset' ) ) : '',
		'sourceUrl'   => $source ? (string) get_edit_post_link( $source_id, 'raw' ) : '',
		'links'       => atwork_prepare_links( $post->ID ),
		// Approved only: the count on a card is a promise about what the thread
		// contains, and counting something held for moderation makes the card
		// disagree with the thread it opens.
		'comments'    => (int) get_comments_number( $post->ID ),
		'editUrl'     => get_edit_post_link( $post->ID, 'raw' ),
		'canEdit'     => current_user_can( 'edit_post', $post->ID ),
		'canDelete'   => current_user_can( 'delete_post', $post->ID ),
	);
}

/**
 * Tasks matching a query, already shaped for the client.
 *
 * @since 0.1.0
 *
 * @param array $args {
 *     Optional. Query arguments.
 *
 *     @type int   $project  Restrict to one project. 0 for all.
 *     @type int   $owner    Restrict to one assignee. 0 for all.
 *     @type int[] $projects Restrict to several projects. Ignored when `project` is set.
 *     @type int   $limit    Maximum tasks to return. Default 500.
 * }
 * @return array[] Task payloads.
 */
function atwork_get_tasks( $args = array() ) {
	$args = wp_parse_args(
		$args,
		array(
			'project'  => 0,
			'owner'    => 0,
			'projects' => array(),
			'limit'    => 500,
		)
	);

	$meta_query = array();

	if ( $args['project'] > 0 ) {
		$meta_query[] = array(
			'key'     => ATWORK_META_PROJECT,
			'value'   => (int) $args['project'],
			'compare' => '=',
			'type'    => 'NUMERIC',
		);
	} elseif ( ! empty( $args['projects'] ) ) {
		$meta_query[] = array(
			'key'     => ATWORK_META_PROJECT,
			'value'   => array_map( 'absint', $args['projects'] ),
			'compare' => 'IN',
			'type'    => 'NUMERIC',
		);
	}

	if ( $args['owner'] > 0 ) {
		$meta_query[] = array(
			'key'     => ATWORK_META_OWNER,
			'value'   => (int) $args['owner'],
			'compare' => '=',
			'type'    => 'NUMERIC',
		);
	}

	$query_args = array(
		'post_type'        => ATWORK_TASK_TYPE,
		'post_status'      => array( 'publish', 'draft', 'private' ),
		'numberposts'      => max( 1, min( 1000, (int) $args['limit'] ) ), // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_numberposts -- Caller-supplied, and clamped to 1000 on the line itself.
		'orderby'          => array(
			'menu_order' => 'ASC',
			'date'       => 'DESC',
		),
		'suppress_filters' => false,
	);

	if ( $meta_query ) {
		$query_args['meta_query'] = $meta_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
	}

	$posts = get_posts( $query_args );
	$tasks = array();

	foreach ( $posts as $post ) {
		if ( ! current_user_can( 'read_post', $post->ID ) ) {
			continue;
		}

		$tasks[] = atwork_prepare_task( $post );
	}

	return $tasks;
}

/**
 * The whole board, in one payload.
 *
 * One call rather than three because the board cannot paint until it has all of
 * columns, projects and cards -- three round trips would only buy three chances
 * to render a partial board.
 *
 * @since 0.1.0
 *
 * @param int $project_id Restrict cards to one project. 0 for all.
 * @return array {
 *     @type array[] $statuses Columns, in board order.
 *     @type array[] $projects Projects the user can see.
 *     @type array[] $tasks    Cards.
 *     @type array   $viewer   The current user, for the "assigned to me" filter.
 * }
 */
function atwork_get_board( $project_id = 0 ) {
	$user = wp_get_current_user();

	return array(
		'statuses'   => atwork_get_statuses(),
		'projects'   => atwork_get_projects(),
		'tasks'      => atwork_get_tasks( array( 'project' => (int) $project_id ) ),
		'priorities' => atwork_priorities(),
		'viewer'     => array(
			'id'        => (int) $user->ID,
			'name'      => $user->display_name,
			'avatar'    => (string) get_avatar_url( $user->ID, array( 'size' => 48 ) ),
			'canCreate' => current_user_can( 'edit_posts' ),
		),
	);
}

/**
 * Tells the desktop that a task changed.
 *
 * OpenStation keeps a per-request changelog of content mutations and relays it
 * to every open window -- instantly through the chromeless footer, and within
 * one Heartbeat tick to every *other* tab and every other user. Windows listing
 * the type subscribe to `os.<type>.changed` and refresh themselves.
 *
 * Most of this plugin gets that for free: the framework already publishes on
 * `wp_after_insert_post` for any `show_ui` post type, so creating or editing a
 * task is broadcast without a line of code here.
 *
 * A **move** is the exception, and it is the one that matters most. Dropping a
 * card writes `menu_order` straight through `$wpdb` -- deliberately, to avoid a
 * revision per card -- and sets a term. Neither fires `wp_after_insert_post`, so
 * the single most common action in the app was the one action nobody else's
 * board heard about. Recording it by hand is what closes that.
 *
 * Silently does nothing when the shell is absent; a work tracker on a site with
 * no desktop has no windows to notify.
 *
 * @since 0.1.0
 *
 * @param int    $task_id Task ID.
 * @param string $action  One of created, updated, trashed, untrashed, deleted.
 * @return void
 */
function atwork_record_change( $task_id, $action ) {
	if ( ! function_exists( 'openstation_content_changes_record' ) ) {
		return;
	}

	openstation_content_changes_record( ATWORK_TASK_TYPE, (int) $task_id, (string) $action );
}

/**
 * Creates a task.
 *
 * @since 0.1.0
 *
 * @param array $args {
 *     Task fields. Only `title` is required.
 *
 *     @type string $title    Task title.
 *     @type string $content  Task body. Default empty.
 *     @type int    $project  Project ID. Default 0.
 *     @type int    $status   Status term ID. Defaults to the first column.
 *     @type int    $owner    Assignee user ID. Default 0.
 *     @type string $due      `YYYY-MM-DD`. Default empty.
 *     @type string $priority One of `atwork_priorities()`. Default `medium`.
 * }
 * @return array|WP_Error The created task payload, or an error.
 */
function atwork_create_task( $args ) {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error(
			'atwork_cannot_create',
			__( 'You are not allowed to create tasks.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$title = sanitize_text_field( (string) ( $args['title'] ?? '' ) );

	if ( '' === $title ) {
		return new WP_Error(
			'atwork_missing_title',
			__( 'A task needs a title.', 'allterrain-work' ),
			array( 'status' => 400 )
		);
	}

	$post_id = wp_insert_post(
		array(
			'post_type'      => ATWORK_TASK_TYPE,
			'post_status'    => 'publish',
			'post_title'     => $title,
			'post_content'   => wp_kses_post( (string) ( $args['content'] ?? '' ) ),
			'post_author'    => get_current_user_id(),
			// Explicitly open, not left to `default_comment_status`. That option
			// is about the site's *blog*, and plenty of sites set it to closed —
			// which would silently make every task undiscussable on exactly the
			// sites most careful about their public comments.
			'comment_status' => 'open',
			// New cards land at the top of their column. Appending would bury
			// the thing the user just created under everything already there.
			'menu_order'     => 0,
		),
		true
	);

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	atwork_apply_task_fields( $post_id, $args );

	$status_id = absint( $args['status'] ?? 0 );

	if ( ! $status_id ) {
		$statuses  = atwork_get_statuses();
		$status_id = $statuses ? $statuses[0]['id'] : 0;
	}

	if ( $status_id ) {
		wp_set_object_terms( $post_id, array( $status_id ), ATWORK_STATUS_TAX, false );
	}

	// Index 0 explicitly, not "leave it where it sorts". `menu_order` was set to
	// 0 above, and so is every other card that has never been dragged -- so
	// without an explicit position the tie falls through to the date, two cards
	// created in the same second tie on that too, and the new card lands
	// wherever the database felt like putting it.
	atwork_reindex_column( $status_id, $post_id, 0 );

	/**
	 * Fires after a task is created through this plugin's API.
	 *
	 * `save_post` fires too, and covers writes from every other direction --
	 * this one carries the already-shaped payload so a listener doesn't have to
	 * re-read the post to know what changed.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $post_id Task ID.
	 * @param array $task    Prepared task payload.
	 */
	atwork_record_change( $post_id, 'created' );

	do_action( 'atwork_task_created', $post_id, atwork_prepare_task( get_post( $post_id ) ) );

	return atwork_prepare_task( get_post( $post_id ) );
}

/**
 * Updates a task's fields.
 *
 * Every key is optional; only what is present is written. That is what lets the
 * board send `{ due: '2026-01-09' }` without having to round-trip the whole card
 * and risk clobbering a title somebody else changed in the meantime.
 *
 * @since 0.1.0
 *
 * @param int   $task_id Task ID.
 * @param array $args    Fields to change. Same keys as `atwork_create_task()`.
 * @return array|WP_Error The updated task payload, or an error.
 */
function atwork_update_task( $task_id, $args ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'edit_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_edit',
			__( 'You are not allowed to edit this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$update = array( 'ID' => $task_id );

	if ( array_key_exists( 'title', $args ) ) {
		$title = sanitize_text_field( (string) $args['title'] );

		if ( '' === $title ) {
			return new WP_Error(
				'atwork_missing_title',
				__( 'A task needs a title.', 'allterrain-work' ),
				array( 'status' => 400 )
			);
		}

		$update['post_title'] = $title;
	}

	if ( array_key_exists( 'content', $args ) ) {
		$update['post_content'] = wp_kses_post( (string) $args['content'] );
	}

	if ( count( $update ) > 1 ) {
		$result = wp_update_post( $update, true );

		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}

	atwork_apply_task_fields( $task_id, $args );

	if ( array_key_exists( 'status', $args ) ) {
		$status_id = absint( $args['status'] );

		if ( $status_id && term_exists( $status_id, ATWORK_STATUS_TAX ) ) {
			wp_set_object_terms( $task_id, array( $status_id ), ATWORK_STATUS_TAX, false );
		}
	}

	$task = atwork_prepare_task( get_post( $task_id ) );

	/**
	 * Fires after a task is updated through this plugin's API.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $task_id Task ID.
	 * @param array $task    Prepared task payload.
	 */
	atwork_record_change( $task_id, 'updated' );

	do_action( 'atwork_task_updated', $task_id, $task );

	return $task;
}

/**
 * Writes the meta fields present in an argument array.
 *
 * Split out because create and update both need it and neither should know which
 * meta keys exist. Absent keys are left alone; present ones are sanitized by the
 * `sanitize_callback` registered with the meta, which is why this can hand them
 * over raw.
 *
 * @since 0.1.0
 * @access private
 *
 * @param int   $task_id Task ID.
 * @param array $args    Field values.
 * @return void
 */
function atwork_apply_task_fields( $task_id, $args ) {
	$map = array(
		'project'  => ATWORK_META_PROJECT,
		'owner'    => ATWORK_META_OWNER,
		'due'      => ATWORK_META_DUE,
		'priority' => ATWORK_META_PRIORITY,
		'source'   => ATWORK_META_SOURCE,
	);

	foreach ( $map as $key => $meta_key ) {
		if ( array_key_exists( $key, $args ) ) {
			update_post_meta( $task_id, $meta_key, $args[ $key ] );
		}
	}
}

/**
 * Moves a card: new column, new index, one write.
 *
 * The two halves have to happen together. Setting the status and then reordering
 * as separate requests means a board that reloads in between shows the card in
 * the right column at the wrong height -- and if the second request fails, it
 * stays there.
 *
 * @since 0.1.0
 *
 * @param int $task_id   Task ID.
 * @param int $status_id Destination column's term ID.
 * @param int $position  Zero-based index within the destination column.
 * @return array|WP_Error The moved task payload, or an error.
 */
function atwork_move_task( $task_id, $status_id, $position = 0 ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'edit_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_edit',
			__( 'You are not allowed to move this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$status_id = absint( $status_id );

	if ( ! $status_id || ! term_exists( $status_id, ATWORK_STATUS_TAX ) ) {
		return new WP_Error(
			'atwork_bad_status',
			__( 'That status does not exist.', 'allterrain-work' ),
			array( 'status' => 400 )
		);
	}

	wp_set_object_terms( $task_id, array( $status_id ), ATWORK_STATUS_TAX, false );

	atwork_reindex_column( $status_id, $task_id, max( 0, (int) $position ) );

	$task = atwork_prepare_task( get_post( $task_id ) );

	/**
	 * Fires after a card is dropped into a column.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $task_id   Task ID.
	 * @param int   $status_id Destination status term ID.
	 * @param array $task      Prepared task payload.
	 */
	atwork_record_change( $task_id, 'updated' );

	do_action( 'atwork_task_moved', $task_id, $status_id, $task );

	return $task;
}

/**
 * Renumbers a column so its cards read 0, 1, 2, … with one card at a chosen index.
 *
 * Gaps and ties in `menu_order` are what make a board drift: two cards at 4 sort
 * by date instead, and the order a user set silently becomes the order WordPress
 * prefers. Renumbering the whole column on every move keeps the stored order and
 * the drawn order the same thing.
 *
 * Writes `menu_order` directly rather than through `wp_update_post()`, because
 * that would create a revision per card and fire `save_post` for a change no
 * listener cares about -- reordering a column of thirty would mean thirty
 * revisions of twenty-nine untouched tasks.
 *
 * Scoped to the status and nothing else -- deliberately not to the project. The
 * board draws a column by sorting on `menu_order`, and by default it draws every
 * project at once. Renumbering only one project's slice would hand three cards
 * the indices 0, 1, 2 while the rest of the column still held 0, 1, 2 of its
 * own, and the board would then fall through to its secondary sort to break the
 * ties -- silently rearranging cards nobody touched. `menu_order` is one
 * ordering per column, so the renumber has to cover the whole of it.
 *
 * @since 0.1.0
 * @access private
 *
 * @param int      $status_id Column's term ID.
 * @param int      $task_id   Task being placed.
 * @param int|null $position  Index within the whole column, or null to leave it
 *                            where it sorts.
 * @return void
 */
function atwork_reindex_column( $status_id, $task_id, $position = null ) {
	global $wpdb;

	if ( ! $status_id ) {
		return;
	}

	$query_args = array(
		'post_type'        => ATWORK_TASK_TYPE,
		'post_status'      => array( 'publish', 'draft', 'private' ),
		// The whole column, because renumbering half of it is worse than not
		// renumbering it at all: the unread half keeps its old indices and the
		// two halves collide. A column past a thousand cards has stopped being
		// a column somebody reads.
		'numberposts'      => 1000, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_numberposts
		'fields'           => 'ids',
		'orderby'          => array(
			'menu_order' => 'ASC',
			'date'       => 'DESC',
		),
		'tax_query'        => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			array(
				'taxonomy' => ATWORK_STATUS_TAX,
				'field'    => 'term_id',
				'terms'    => (int) $status_id,
			),
		),
		'suppress_filters' => false,
	);

	$ids = get_posts( $query_args );
	$ids = array_values( array_map( 'intval', $ids ) );

	if ( null !== $position ) {
		$ids      = array_values( array_diff( $ids, array( (int) $task_id ) ) );
		$position = min( (int) $position, count( $ids ) );
		array_splice( $ids, $position, 0, array( (int) $task_id ) );
	}

	foreach ( $ids as $index => $id ) {
		if ( (int) get_post_field( 'menu_order', $id ) === $index ) {
			continue;
		}

		$wpdb->update( $wpdb->posts, array( 'menu_order' => $index ), array( 'ID' => $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		clean_post_cache( $id );
	}
}

/**
 * Trashes a task.
 *
 * Trash rather than delete, so the recycle bin -- WordPress's and OpenStation's
 * both -- can hand it back.
 *
 * @since 0.1.0
 *
 * @param int $task_id Task ID.
 * @return true|WP_Error
 */
function atwork_trash_task( $task_id ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'delete_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_delete',
			__( 'You are not allowed to delete this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	if ( ! wp_trash_post( $task_id ) ) {
		return new WP_Error(
			'atwork_trash_failed',
			__( 'The task could not be moved to the trash.', 'allterrain-work' ),
			array( 'status' => 500 )
		);
	}

	atwork_record_change( $task_id, 'trashed' );

	return true;
}

/**
 * Creates a project.
 *
 * @since 0.1.0
 *
 * @param array $args {
 *     Project fields.
 *
 *     @type string $title   Project title. Required.
 *     @type string $content Description. Default empty.
 * }
 * @return array|WP_Error The created project payload, or an error.
 */
function atwork_create_project( $args ) {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error(
			'atwork_cannot_create',
			__( 'You are not allowed to create projects.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$title = sanitize_text_field( (string) ( $args['title'] ?? '' ) );

	if ( '' === $title ) {
		return new WP_Error(
			'atwork_missing_title',
			__( 'A project needs a title.', 'allterrain-work' ),
			array( 'status' => 400 )
		);
	}

	$post_id = wp_insert_post(
		array(
			'post_type'    => ATWORK_PROJECT_TYPE,
			'post_status'  => 'publish',
			'post_title'   => $title,
			'post_content' => wp_kses_post( (string) ( $args['content'] ?? '' ) ),
			'post_author'  => get_current_user_id(),
		),
		true
	);

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	/**
	 * Fires after a project is created through this plugin's API.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $post_id Project ID.
	 * @param array $project Prepared project payload.
	 */
	do_action( 'atwork_project_created', $post_id, atwork_prepare_project( get_post( $post_id ) ) );

	return atwork_prepare_project( get_post( $post_id ) );
}

/**
 * Everything worth knowing about one project.
 *
 * A project in a dropdown is a filter. A project with a description, a
 * completion figure, a breakdown per column and the faces of the people on it
 * is a thing you can hold a meeting about -- and all of it is already in the
 * database, one query away from the filter that was hiding it.
 *
 * Counts are computed from the tasks the *viewer* can read, so a contributor and
 * an editor can see different totals for the same project. That is correct
 * rather than unfortunate: a progress bar that counts work you are not allowed
 * to see is telling you about work you are not allowed to see.
 *
 * @since 0.1.0
 *
 * @param int $project_id Project post ID.
 * @return array|WP_Error Project payload plus stats, or an error.
 */
function atwork_get_project( $project_id ) {
	$project_id = absint( $project_id );
	$post       = get_post( $project_id );

	if ( ! $post || ATWORK_PROJECT_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_project_not_found',
			__( 'That project does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'read_post', $project_id ) ) {
		return new WP_Error(
			'atwork_cannot_read_project',
			__( 'You are not allowed to view this project.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$tasks    = atwork_get_tasks( array( 'project' => $project_id ) );
	$statuses = atwork_get_statuses();
	$done_ids = atwork_done_status_ids();
	$today    = current_time( 'Y-m-d' );

	$by_status = array();

	foreach ( $statuses as $status ) {
		$by_status[ $status['id'] ] = 0;
	}

	$done    = 0;
	$overdue = 0;
	$members = array();

	foreach ( $tasks as $task ) {
		if ( isset( $by_status[ $task['statusId'] ] ) ) {
			++$by_status[ $task['statusId'] ];
		}

		$is_done = in_array( $task['statusId'], $done_ids, true );

		if ( $is_done ) {
			++$done;
		} elseif ( $task['due'] && $task['due'] < $today ) {
			// Only open work can be late. A task finished after its due date is
			// finished, and colouring it red for ever would make a completed
			// project look like a failing one.
			++$overdue;
		}

		if ( $task['ownerId'] && ! isset( $members[ $task['ownerId'] ] ) ) {
			$members[ $task['ownerId'] ] = array(
				'id'     => $task['ownerId'],
				'name'   => $task['ownerName'],
				'avatar' => $task['ownerAvatar'],
				'open'   => 0,
			);
		}

		if ( $task['ownerId'] && ! $is_done ) {
			++$members[ $task['ownerId'] ]['open'];
		}
	}

	// Busiest first: the useful question a member list answers is "who is
	// carrying this", not "who was created first".
	uasort(
		$members,
		static function ( $a, $b ) {
			return $a['open'] === $b['open'] ? strcasecmp( $a['name'], $b['name'] ) : $b['open'] - $a['open'];
		}
	);

	$total = count( $tasks );

	$breakdown = array();

	foreach ( $statuses as $status ) {
		$breakdown[] = array(
			'id'    => $status['id'],
			'name'  => $status['name'],
			'color' => $status['color'],
			'count' => $by_status[ $status['id'] ],
		);
	}

	return array_merge(
		atwork_prepare_project( $post ),
		array(
			'description' => wp_strip_all_tags( (string) $post->post_content ),
			'total'       => $total,
			'done'        => $done,
			'open'        => $total - $done,
			'overdue'     => $overdue,
			// Integer percent so the client never has to decide how to round a
			// progress bar, and never shows "100%" for 199 of 200.
			'percent'     => $total > 0 ? (int) floor( ( $done / $total ) * 100 ) : 0,
			'breakdown'   => $breakdown,
			'members'     => array_values( $members ),
			'modified'    => get_post_modified_time( 'c', true, $post ),
		)
	);
}

/**
 * The colours a new column is given when nobody picks one.
 *
 * Cycled by position, so the second column a user adds does not look identical
 * to the first. Board colour is what makes a column scannable at a glance, and a
 * wall of identical grey headers is the thing that stops being scannable.
 *
 * @since 0.1.0
 *
 * @return string[] Hex colours.
 */
function atwork_status_palette() {
	/**
	 * Filters the colours offered to new columns.
	 *
	 * @since 0.1.0
	 *
	 * @param string[] $palette Hex colours.
	 */
	return apply_filters(
		'atwork_status_palette',
		array( '#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#ff642e', '#037f4c', '#7f5347' )
	);
}

/**
 * Adds a column to the board.
 *
 * The board is not a fixed four-column pipeline -- a team that works in
 * "Blocked on legal" or "Waiting on client" needs to say so, and needing to
 * leave the board for the taxonomy screen to add a column is the kind of gap
 * that makes a tool feel like a demo.
 *
 * @since 0.1.0
 *
 * @param array $args {
 *     Column fields.
 *
 *     @type string $name  Column name. Required.
 *     @type string $color `#rrggbb`. Defaults to the next palette colour.
 *     @type int    $order Sort position. Defaults to after every existing column.
 * }
 * @return array|WP_Error The created status payload, or an error.
 */
function atwork_create_status( $args ) {
	if ( ! current_user_can( 'manage_categories' ) ) {
		return new WP_Error(
			'atwork_cannot_create_status',
			__( 'You are not allowed to add columns to the board.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$name = sanitize_text_field( (string) ( $args['name'] ?? '' ) );

	if ( '' === $name ) {
		return new WP_Error(
			'atwork_missing_status_name',
			__( 'A column needs a name.', 'allterrain-work' ),
			array( 'status' => 400 )
		);
	}

	$existing = atwork_get_statuses();

	$term = wp_insert_term( $name, ATWORK_STATUS_TAX );

	if ( is_wp_error( $term ) ) {
		// `term_exists` is the one error worth translating, because it is the
		// one a user causes rather than a fault: they already have this column.
		if ( 'term_exists' === $term->get_error_code() ) {
			return new WP_Error(
				'atwork_status_exists',
				__( 'There is already a column with that name.', 'allterrain-work' ),
				array( 'status' => 409 )
			);
		}

		return $term;
	}

	$palette = atwork_status_palette();
	$color   = isset( $args['color'] )
		? atwork_sanitize_hex_color( $args['color'] )
		: $palette[ count( $existing ) % max( 1, count( $palette ) ) ];

	// New columns go on the right by default. Existing orders are spaced by 10
	// on seed, so stepping past the last one leaves room to reorder between
	// them later without renumbering the board.
	$order = isset( $args['order'] )
		? absint( $args['order'] )
		: ( $existing ? (int) $existing[ count( $existing ) - 1 ]['order'] + 10 : 10 );

	update_term_meta( $term['term_id'], ATWORK_TERM_COLOR, $color );
	update_term_meta( $term['term_id'], ATWORK_TERM_ORDER, $order );

	$created = array(
		'id'    => (int) $term['term_id'],
		'slug'  => get_term( $term['term_id'] )->slug,
		'name'  => $name,
		'color' => $color,
		'order' => $order,
		'count' => 0,
	);

	/**
	 * Fires after a column is added to the board.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $term_id Status term ID.
	 * @param array $status  Prepared status payload.
	 */
	do_action( 'atwork_status_created', (int) $term['term_id'], $created );

	return $created;
}

/**
 * The things attached to a task, shaped for the client.
 *
 * Resolved through `get_post()` rather than trusted from the stored ids: an
 * attached post can be deleted afterwards, and a card listing a title for
 * something that no longer exists is worse than a card listing one fewer thing.
 * The dead ids are dropped from the answer and left in the meta — cleaning them
 * up on read would mean a write on every board load.
 *
 * @since 0.1.0
 *
 * @param int $task_id Task ID.
 * @return array[] List of `id`, `title`, `type`, `typeLabel`, `editUrl`, `thumbnail`.
 */
function atwork_prepare_links( $task_id ) {
	$ids   = (array) get_post_meta( $task_id, ATWORK_META_LINKS, true );
	$links = array();

	foreach ( $ids as $id ) {
		$id   = absint( $id );
		$post = $id ? get_post( $id ) : null;

		if ( ! $post || 'trash' === $post->post_status ) {
			continue;
		}

		if ( ! current_user_can( 'read_post', $id ) ) {
			continue;
		}

		$type = get_post_type_object( $post->post_type );

		$links[] = array(
			'id'        => $id,
			'title'     => html_entity_decode( get_the_title( $post ), ENT_QUOTES, get_bloginfo( 'charset' ) ),
			'type'      => $post->post_type,
			'typeLabel' => $type ? (string) $type->labels->singular_name : $post->post_type,
			'editUrl'   => (string) get_edit_post_link( $id, 'raw' ),
			// Only media carries a picture worth showing on a chip; everything
			// else gets its type label, which says more than a generic icon.
			'thumbnail' => 'attachment' === $post->post_type ? (string) wp_get_attachment_image_url( $id, 'thumbnail' ) : '',
		);
	}

	return $links;
}

/**
 * Attaches posts to a task.
 *
 * Anything that lives in `wp_posts` — a post, a page, an image, a product, a
 * custom type nobody has written yet. Dragging one onto a card from anywhere on
 * the desktop lands here.
 *
 * @since 0.1.0
 *
 * @param int   $task_id Task ID.
 * @param int[] $ids     Post IDs to attach.
 * @return array|WP_Error The task's links after attaching, or an error.
 */
function atwork_attach_to_task( $task_id, $ids ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'edit_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_edit',
			__( 'You are not allowed to change this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$existing = array_map( 'absint', (array) get_post_meta( $task_id, ATWORK_META_LINKS, true ) );

	foreach ( (array) $ids as $id ) {
		$id     = absint( $id );
		$target = $id ? get_post( $id ) : null;

		// A task cannot be attached to itself, and nothing can be attached
		// twice. Both are things a user does by accident with a stray drag, and
		// neither deserves an error message.
		if ( ! $target || $id === $task_id || in_array( $id, $existing, true ) ) {
			continue;
		}

		// Attaching something you cannot read would put its title on a card for
		// everyone who can read the card.
		if ( ! current_user_can( 'read_post', $id ) ) {
			continue;
		}

		$existing[] = $id;
	}

	update_post_meta( $task_id, ATWORK_META_LINKS, $existing );
	atwork_record_change( $task_id, 'updated' );

	/**
	 * Fires after things are attached to a task.
	 *
	 * @since 0.1.0
	 *
	 * @param int   $task_id Task ID.
	 * @param int[] $ids     The ids requested.
	 */
	do_action( 'atwork_task_attached', $task_id, (array) $ids );

	return atwork_prepare_links( $task_id );
}

/**
 * Removes one attachment from a task.
 *
 * Removes the *link*, never the linked post. Detaching a page from a task must
 * not delete the page.
 *
 * @since 0.1.0
 *
 * @param int $task_id Task ID.
 * @param int $post_id The attached post to unlink.
 * @return array|WP_Error The task's remaining links, or an error.
 */
function atwork_detach_from_task( $task_id, $post_id ) {
	$task_id = absint( $task_id );
	$task    = get_post( $task_id );

	if ( ! $task || ATWORK_TASK_TYPE !== $task->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'edit_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_edit',
			__( 'You are not allowed to change this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$existing  = array_map( 'absint', (array) get_post_meta( $task_id, ATWORK_META_LINKS, true ) );
	$remaining = array_values( array_diff( $existing, array( absint( $post_id ) ) ) );

	update_post_meta( $task_id, ATWORK_META_LINKS, $remaining );
	atwork_record_change( $task_id, 'updated' );

	return atwork_prepare_links( $task_id );
}

/**
 * Trashes a project.
 *
 * The tasks in it are deliberately left alone. A project is a grouping, and
 * deleting a folder should not delete the work inside it -- the tasks keep
 * their `_atwork_project` id and reappear whole if the project is restored
 * from the trash, which it can be.
 *
 * @since 0.1.0
 *
 * @param int $project_id Project ID.
 * @return true|WP_Error
 */
function atwork_trash_project( $project_id ) {
	$project_id = absint( $project_id );
	$post       = get_post( $project_id );

	if ( ! $post || ATWORK_PROJECT_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_project_not_found',
			__( 'That project does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'delete_post', $project_id ) ) {
		return new WP_Error(
			'atwork_cannot_delete',
			__( 'You are not allowed to delete this project.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	if ( ! wp_trash_post( $project_id ) ) {
		return new WP_Error(
			'atwork_trash_failed',
			__( 'The project could not be moved to the trash.', 'allterrain-work' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Fires after a project is trashed.
	 *
	 * @since 0.1.0
	 *
	 * @param int $project_id Project ID.
	 */
	do_action( 'atwork_project_trashed', $project_id );

	return true;
}

/**
 * The discussion on a task.
 *
 * Ordinary WordPress comments — the task post type declares `comments` support,
 * so a task thread is the same object the admin's Comments screen moderates,
 * the same one OpenStation's Comments window lists, and the same one every
 * notification plugin already understands. Rolling a private "task notes" table
 * would have bought a slightly tidier query and thrown all of that away.
 *
 * @since 0.1.0
 *
 * @param int $task_id Task ID.
 * @return array[]|WP_Error Comments oldest first, or an error.
 */
function atwork_get_task_comments( $task_id ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'read_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_read',
			__( 'You are not allowed to read this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$comments = get_comments(
		array(
			'post_id' => $task_id,
			'status'  => 'approve',
			'order'   => 'ASC',
			'number'  => 200,
		)
	);

	$out = array();

	foreach ( $comments as $comment ) {
		$out[] = atwork_prepare_comment( $comment );
	}

	return $out;
}

/**
 * Shapes one comment for the client.
 *
 * @since 0.1.0
 *
 * @param WP_Comment $comment The comment.
 * @return array Comment payload.
 */
function atwork_prepare_comment( $comment ) {
	return array(
		'id'        => (int) $comment->comment_ID,
		'author'    => $comment->comment_author,
		'avatar'    => (string) get_avatar_url( $comment, array( 'size' => 48 ) ),
		'content'   => wp_strip_all_tags( (string) $comment->comment_content ),
		'date'      => mysql2date( 'c', $comment->comment_date_gmt, false ),
		'canDelete' => current_user_can( 'edit_comment', $comment->comment_ID ),
	);
}

/**
 * Adds a comment to a task.
 *
 * Posted as the current user and approved outright. A task thread is a private
 * work conversation between people who can already edit the board -- holding a
 * colleague's reply for moderation would be theatre, and the delay would make
 * the feature useless for the thing it exists for.
 *
 * @since 0.1.0
 *
 * @param int    $task_id Task ID.
 * @param string $content What to say.
 * @return array|WP_Error The created comment, or an error.
 */
function atwork_add_task_comment( $task_id, $content ) {
	$task_id = absint( $task_id );
	$post    = get_post( $task_id );

	if ( ! $post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return new WP_Error(
			'atwork_task_not_found',
			__( 'That task does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	// Commenting is for people who work on the board, not for anyone who can
	// read the site -- the same line every other write in this plugin draws.
	if ( ! current_user_can( 'edit_posts' ) || ! current_user_can( 'read_post', $task_id ) ) {
		return new WP_Error(
			'atwork_cannot_comment',
			__( 'You are not allowed to comment on this task.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$content = trim( wp_strip_all_tags( (string) $content ) );

	if ( '' === $content ) {
		return new WP_Error(
			'atwork_empty_comment',
			__( 'A comment needs something in it.', 'allterrain-work' ),
			array( 'status' => 400 )
		);
	}

	$user = wp_get_current_user();

	$comment_id = wp_insert_comment(
		array(
			'comment_post_ID'      => $task_id,
			'comment_content'      => $content,
			'comment_approved'     => 1,
			'user_id'              => $user->ID,
			'comment_author'       => $user->display_name,
			'comment_author_email' => $user->user_email,
			'comment_type'         => 'comment',
		)
	);

	if ( ! $comment_id ) {
		return new WP_Error(
			'atwork_comment_failed',
			__( 'The comment could not be saved.', 'allterrain-work' ),
			array( 'status' => 500 )
		);
	}

	atwork_record_change( $task_id, 'updated' );

	/**
	 * Fires after a comment is added to a task.
	 *
	 * @since 0.1.0
	 *
	 * @param int $comment_id The new comment.
	 * @param int $task_id    The task it is on.
	 */
	do_action( 'atwork_task_commented', (int) $comment_id, $task_id );

	return atwork_prepare_comment( get_comment( $comment_id ) );
}

/**
 * Removes a comment from a task.
 *
 * Trashed rather than deleted, so it can be recovered from the Comments screen
 * like any other.
 *
 * @since 0.1.0
 *
 * @param int $comment_id Comment ID.
 * @return true|WP_Error
 */
function atwork_delete_task_comment( $comment_id ) {
	$comment_id = absint( $comment_id );
	$comment    = get_comment( $comment_id );

	if ( ! $comment ) {
		return new WP_Error(
			'atwork_comment_not_found',
			__( 'That comment does not exist.', 'allterrain-work' ),
			array( 'status' => 404 )
		);
	}

	if ( ! current_user_can( 'edit_comment', $comment_id ) ) {
		return new WP_Error(
			'atwork_cannot_delete_comment',
			__( 'You are not allowed to delete this comment.', 'allterrain-work' ),
			array( 'status' => 403 )
		);
	}

	$task_id = (int) $comment->comment_post_ID;

	if ( ! wp_trash_comment( $comment_id ) ) {
		return new WP_Error(
			'atwork_comment_delete_failed',
			__( 'The comment could not be removed.', 'allterrain-work' ),
			array( 'status' => 500 )
		);
	}

	atwork_record_change( $task_id, 'updated' );

	return true;
}

/**
 * The people a task can be assigned to.
 *
 * Users who hold `edit_posts`, because assigning work to someone who cannot
 * open it is a way of losing the work. Not the whole user list: a site with a
 * thousand subscribers has a thousand people who are not on the team, and a
 * picker that lists them is a picker nobody can use.
 *
 * Searchable rather than paginated. A picker is opened to find one known
 * person, so typing three letters of their name beats scrolling.
 *
 * @since 0.1.0
 *
 * @param string $search Optional name fragment.
 * @param int    $limit  Maximum users. Default 50.
 * @return array[] List of `id`, `name`, `avatar`.
 */
function atwork_get_assignees( $search = '', $limit = 50 ) {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return array();
	}

	$args = array(
		'capability' => 'edit_posts',
		'number'     => max( 1, min( 200, (int) $limit ) ),
		'orderby'    => 'display_name',
		'order'      => 'ASC',
		'fields'     => array( 'ID', 'display_name' ),
	);

	$search = trim( (string) $search );

	if ( '' !== $search ) {
		$args['search']         = '*' . $search . '*';
		$args['search_columns'] = array( 'display_name', 'user_login', 'user_nicename', 'user_email' );
	}

	/**
	 * Filters the query behind the assignee picker.
	 *
	 * @since 0.1.0
	 *
	 * @param array  $args   `get_users()` arguments.
	 * @param string $search The search fragment.
	 */
	$args = apply_filters( 'atwork_assignee_query', $args, $search );

	$assignees = array();

	foreach ( get_users( $args ) as $user ) {
		$assignees[] = array(
			'id'     => (int) $user->ID,
			'name'   => $user->display_name,
			'avatar' => (string) get_avatar_url( $user->ID, array( 'size' => 48 ) ),
		);
	}

	return $assignees;
}

/**
 * What one person has on their plate.
 *
 * Backs the desktop widget. Scoped to a user and optionally to a chosen set of
 * projects, sorted by how soon it matters: overdue first, then by due date, then
 * by priority for the undated.
 *
 * @since 0.1.0
 *
 * @param int   $user_id  User whose work to return. 0 for the current user.
 * @param int[] $projects Restrict to these projects. Empty for all.
 * @param int   $limit    Maximum cards. Default 25.
 * @return array {
 *     @type array[] $tasks    Task payloads, most urgent first.
 *     @type array   $counts   `overdue`, `today`, `upcoming`, `done`, `total`.
 *     @type array[] $projects Every project, so the widget can offer the picker.
 * }
 */
function atwork_get_my_work( $user_id = 0, $projects = array(), $limit = 25 ) {
	$user_id = $user_id ? absint( $user_id ) : get_current_user_id();

	$tasks = atwork_get_tasks(
		array(
			'owner'    => $user_id,
			'projects' => array_map( 'absint', (array) $projects ),
			'limit'    => 500,
		)
	);

	$done_ids = atwork_done_status_ids();
	$today    = current_time( 'Y-m-d' );

	$counts = array(
		'overdue'  => 0,
		'today'    => 0,
		'upcoming' => 0,
		'done'     => 0,
		'total'    => 0,
	);

	$open = array();

	foreach ( $tasks as $task ) {
		if ( in_array( $task['statusId'], $done_ids, true ) ) {
			++$counts['done'];
			continue;
		}

		++$counts['total'];

		if ( $task['due'] ) {
			if ( $task['due'] < $today ) {
				++$counts['overdue'];
			} elseif ( $task['due'] === $today ) {
				++$counts['today'];
			} else {
				++$counts['upcoming'];
			}
		}

		$open[] = $task;
	}

	$weights = array_flip( atwork_priorities() );

	usort(
		$open,
		static function ( $a, $b ) use ( $weights ) {
			// Dated work outranks undated: a deadline is a commitment to someone
			// else, a priority is only a note to yourself.
			if ( ( '' !== $a['due'] ) !== ( '' !== $b['due'] ) ) {
				return '' !== $a['due'] ? -1 : 1;
			}

			if ( $a['due'] !== $b['due'] ) {
				return strcmp( $a['due'], $b['due'] );
			}

			$pa = $weights[ $b['priority'] ] ?? 1;
			$pb = $weights[ $a['priority'] ] ?? 1;

			return $pa === $pb ? $a['id'] - $b['id'] : $pa - $pb;
		}
	);

	return array(
		'tasks'     => array_slice( $open, 0, max( 1, min( 100, (int) $limit ) ) ),
		'counts'    => $counts,
		'projects'  => atwork_get_projects(),
		'statuses'  => atwork_get_statuses(),
		'generated' => current_time( 'mysql' ),
	);
}

/**
 * Status term IDs that mean "finished".
 *
 * Slug-matched rather than hardcoded to an ID, because the seeded terms get
 * whatever IDs the database hands out and a site may well have renamed the
 * column. A site that calls its last column something else entirely can say so
 * through the filter instead of having its finished work counted as open.
 *
 * @since 0.1.0
 *
 * @return int[] Term IDs.
 */
function atwork_done_status_ids() {
	/**
	 * Filters the status slugs that count as done.
	 *
	 * @since 0.1.0
	 *
	 * @param string[] $slugs Status slugs.
	 */
	$slugs = apply_filters( 'atwork_done_status_slugs', array( 'done' ) );

	$ids = array();

	foreach ( $slugs as $slug ) {
		$term = get_term_by( 'slug', $slug, ATWORK_STATUS_TAX );

		if ( $term instanceof WP_Term ) {
			$ids[] = (int) $term->term_id;
		}
	}

	return $ids;
}

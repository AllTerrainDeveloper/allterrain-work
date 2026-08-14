<?php
/**
 * REST routes.
 *
 * Deliberately small. Both post types are `show_in_rest`, so `/wp/v2/atwork-tasks`
 * already does create, read, update, delete, pagination, search and meta -- and
 * re-implementing that here would mean a second set of permission checks to keep
 * in sync with core's.
 *
 * What core REST cannot express in one round trip is what lives here:
 *
 *   - `/board` -- columns, projects and cards together, because the board cannot
 *     paint from any two of the three.
 *   - `/tasks/<id>/move` -- a status change and a column reorder as one write.
 *   - `/my-work` -- one person's queue, sorted by urgency, for the widget.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', 'atwork_register_rest_routes' );

/**
 * Registers the board-shaped routes.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_rest_routes() {
	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/board',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atwork_rest_get_board',
			'permission_callback' => 'atwork_rest_can_read',
			'args'                => array(
				'project' => array(
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
					'description'       => __( 'Restrict cards to one project. 0 for all.', 'allterrain-work' ),
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atwork_rest_create_task',
			'permission_callback' => 'atwork_rest_can_write',
			'args'                => atwork_rest_task_args( true ),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'atwork_rest_update_task',
				'permission_callback' => 'atwork_rest_can_write',
				'args'                => atwork_rest_task_args( false ),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'atwork_rest_trash_task',
				'permission_callback' => 'atwork_rest_can_write',
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks/(?P<id>\d+)/move',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atwork_rest_move_task',
			'permission_callback' => 'atwork_rest_can_write',
			'args'                => array(
				'status'   => array(
					'type'              => 'integer',
					'required'          => true,
					'sanitize_callback' => 'absint',
					'description'       => __( 'Destination status term ID.', 'allterrain-work' ),
				),
				'position' => array(
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
					'description'       => __( 'Zero-based index within the destination column.', 'allterrain-work' ),
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/projects',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atwork_rest_create_project',
			'permission_callback' => 'atwork_rest_can_write',
			'args'                => array(
				'title'   => array(
					'type'     => 'string',
					'required' => true,
				),
				'content' => array(
					'type'    => 'string',
					'default' => '',
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/projects/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'atwork_rest_get_project',
				'permission_callback' => 'atwork_rest_can_read',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'atwork_rest_trash_project',
				'permission_callback' => 'atwork_rest_can_write',
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks/(?P<id>\d+)/links',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atwork_rest_attach',
			'permission_callback' => 'atwork_rest_can_write',
			'args'                => array(
				'ids' => array(
					'type'     => 'array',
					'required' => true,
					'items'    => array( 'type' => 'integer' ),
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks/(?P<id>\d+)/links/(?P<linked>\d+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'atwork_rest_detach',
			'permission_callback' => 'atwork_rest_can_write',
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/statuses',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'atwork_rest_create_status',
			'permission_callback' => 'atwork_rest_can_manage_statuses',
			'args'                => array(
				'name'  => array(
					'type'     => 'string',
					'required' => true,
				),
				'color' => array( 'type' => 'string' ),
				'order' => array(
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/tasks/(?P<id>\d+)/comments',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'atwork_rest_get_comments',
				'permission_callback' => 'atwork_rest_can_read',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'atwork_rest_add_comment',
				'permission_callback' => 'atwork_rest_can_write',
				'args'                => array(
					'content' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/comments/(?P<comment>\d+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'atwork_rest_delete_comment',
			'permission_callback' => 'atwork_rest_can_write',
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/assignees',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atwork_rest_get_assignees',
			'permission_callback' => 'atwork_rest_can_read',
			'args'                => array(
				'search' => array(
					'type'              => 'string',
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		)
	);

	register_rest_route(
		ATWORK_REST_NAMESPACE,
		'/my-work',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'atwork_rest_get_my_work',
			'permission_callback' => 'atwork_rest_can_read',
			'args'                => array(
				'projects' => array(
					'type'        => 'array',
					'default'     => array(),
					'items'       => array( 'type' => 'integer' ),
					'description' => __( 'Restrict to these project IDs. Empty for all.', 'allterrain-work' ),
				),
				'limit'    => array(
					'type'              => 'integer',
					'default'           => 25,
					'sanitize_callback' => 'absint',
				),
				'user'     => array(
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
					'description'       => __( 'Whose work to list. 0 for the current user. Listing someone else requires `list_users`.', 'allterrain-work' ),
				),
			),
		)
	);
}

/**
 * The task fields a route accepts.
 *
 * Shared between create and update so the two cannot drift -- the difference is
 * only whether `title` is required.
 *
 * @since 0.1.0
 * @access private
 *
 * @param bool $creating Whether this is the create route.
 * @return array Argument definitions.
 */
function atwork_rest_task_args( $creating ) {
	return array(
		'title'    => array(
			'type'     => 'string',
			'required' => $creating,
		),
		'content'  => array( 'type' => 'string' ),
		'project'  => array(
			'type'              => 'integer',
			'sanitize_callback' => 'absint',
		),
		'status'   => array(
			'type'              => 'integer',
			'sanitize_callback' => 'absint',
		),
		'owner'    => array(
			'type'              => 'integer',
			'sanitize_callback' => 'absint',
		),
		'due'      => array( 'type' => 'string' ),
		'priority' => array(
			'type' => 'string',
			'enum' => atwork_priorities(),
		),
		'source'   => array(
			'type'              => 'integer',
			'sanitize_callback' => 'absint',
			'description'       => __( 'ID of the post this task is about.', 'allterrain-work' ),
		),
	);
}

/**
 * Gate for reading the board.
 *
 * `edit_posts` rather than `read`: a subscriber has `read`, and the board is a
 * staff tool whose cards carry assignees, deadlines and internal notes.
 *
 * @since 0.1.0
 *
 * @return bool|WP_Error
 */
function atwork_rest_can_read() {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error(
			'atwork_forbidden',
			__( 'You are not allowed to view the work board.', 'allterrain-work' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return true;
}

/**
 * Gate for writing.
 *
 * Coarse on purpose. Per-object checks happen inside the helpers, where the
 * object is known -- this only keeps out callers who could not edit anything.
 *
 * @since 0.1.0
 *
 * @return bool|WP_Error
 */
function atwork_rest_can_write() {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error(
			'atwork_forbidden',
			__( 'You are not allowed to change work items.', 'allterrain-work' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return true;
}

/**
 * Gate for changing the board's shape.
 *
 * A column is a taxonomy term shared by everybody looking at the board, so
 * adding one is an editorial-structure decision rather than a personal one --
 * `manage_categories`, the same capability the Statuses screen uses.
 *
 * @since 0.1.0
 *
 * @return bool|WP_Error
 */
function atwork_rest_can_manage_statuses() {
	if ( ! current_user_can( 'manage_categories' ) ) {
		return new WP_Error(
			'atwork_forbidden',
			__( 'You are not allowed to change the board\'s columns.', 'allterrain-work' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return true;
}

/**
 * POST /statuses
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_create_status( $request ) {
	$status = atwork_create_status( atwork_rest_collect( $request, array( 'name', 'color', 'order' ) ) );

	if ( is_wp_error( $status ) ) {
		return $status;
	}

	return new WP_REST_Response( $status, 201 );
}

/**
 * GET /board
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function atwork_rest_get_board( $request ) {
	return rest_ensure_response( atwork_get_board( (int) $request['project'] ) );
}

/**
 * POST /tasks
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_create_task( $request ) {
	$task = atwork_create_task( atwork_rest_collect( $request, array_keys( atwork_rest_task_args( true ) ) ) );

	if ( is_wp_error( $task ) ) {
		return $task;
	}

	return new WP_REST_Response( $task, 201 );
}

/**
 * PATCH /tasks/<id>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_update_task( $request ) {
	$task = atwork_update_task(
		(int) $request['id'],
		atwork_rest_collect( $request, array_keys( atwork_rest_task_args( false ) ) )
	);

	return is_wp_error( $task ) ? $task : rest_ensure_response( $task );
}

/**
 * DELETE /tasks/<id>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_trash_task( $request ) {
	$result = atwork_trash_task( (int) $request['id'] );

	return is_wp_error( $result )
		? $result
		: rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $request['id'],
			)
		);
}

/**
 * POST /tasks/<id>/move
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_move_task( $request ) {
	$task = atwork_move_task( (int) $request['id'], (int) $request['status'], (int) $request['position'] );

	return is_wp_error( $task ) ? $task : rest_ensure_response( $task );
}

/**
 * POST /projects
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_create_project( $request ) {
	$project = atwork_create_project(
		array(
			'title'   => $request['title'],
			'content' => $request['content'],
		)
	);

	if ( is_wp_error( $project ) ) {
		return $project;
	}

	return new WP_REST_Response( $project, 201 );
}

/**
 * GET /projects/<id>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_get_project( $request ) {
	$project = atwork_get_project( (int) $request['id'] );

	return is_wp_error( $project ) ? $project : rest_ensure_response( $project );
}

/**
 * DELETE /projects/<id>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_trash_project( $request ) {
	$result = atwork_trash_project( (int) $request['id'] );

	return is_wp_error( $result )
		? $result
		: rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $request['id'],
			)
		);
}

/**
 * POST /tasks/<id>/links
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_attach( $request ) {
	$links = atwork_attach_to_task( (int) $request['id'], (array) $request['ids'] );

	return is_wp_error( $links ) ? $links : rest_ensure_response( $links );
}

/**
 * DELETE /tasks/<id>/links/<linked>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_detach( $request ) {
	$links = atwork_detach_from_task( (int) $request['id'], (int) $request['linked'] );

	return is_wp_error( $links ) ? $links : rest_ensure_response( $links );
}

/**
 * GET /tasks/<id>/comments
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_get_comments( $request ) {
	$comments = atwork_get_task_comments( (int) $request['id'] );

	return is_wp_error( $comments ) ? $comments : rest_ensure_response( $comments );
}

/**
 * POST /tasks/<id>/comments
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_add_comment( $request ) {
	$comment = atwork_add_task_comment( (int) $request['id'], (string) $request['content'] );

	if ( is_wp_error( $comment ) ) {
		return $comment;
	}

	return new WP_REST_Response( $comment, 201 );
}

/**
 * DELETE /comments/<comment>
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_delete_comment( $request ) {
	$result = atwork_delete_task_comment( (int) $request['comment'] );

	return is_wp_error( $result )
		? $result
		: rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $request['comment'],
			)
		);
}

/**
 * GET /assignees
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function atwork_rest_get_assignees( $request ) {
	return rest_ensure_response( atwork_get_assignees( (string) $request['search'] ) );
}

/**
 * GET /my-work
 *
 * @since 0.1.0
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function atwork_rest_get_my_work( $request ) {
	$user_id = (int) $request['user'];

	// Reading someone else's queue is reading who is behind on what. That is a
	// staffing question, not a board question, so it needs the capability that
	// already gates seeing the user list at all.
	if ( $user_id && get_current_user_id() !== $user_id && ! current_user_can( 'list_users' ) ) {
		return new WP_Error(
			'atwork_forbidden',
			__( 'You are not allowed to view another user\'s work.', 'allterrain-work' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	return rest_ensure_response(
		atwork_get_my_work( $user_id, (array) $request['projects'], (int) $request['limit'] )
	);
}

/**
 * Pulls only the keys the client actually sent.
 *
 * This is why none of the task args declare a `default`: a registered default is
 * merged into `get_params()` whether or not the caller sent the key, so a
 * `'due' => ''` default plus a blind read of every key would write an empty
 * string over a due date the user set last week, every time the board patched a
 * title. No defaults, and forward only what is present.
 *
 * @since 0.1.0
 * @access private
 *
 * @param WP_REST_Request $request Request.
 * @param string[]        $keys    Keys to consider.
 * @return array Only the keys present in the request body or query.
 */
function atwork_rest_collect( $request, $keys ) {
	$params = $request->get_params();
	$out    = array();

	foreach ( $keys as $key ) {
		if ( array_key_exists( $key, $params ) ) {
			$out[ $key ] = $params[ $key ];
		}
	}

	return $out;
}

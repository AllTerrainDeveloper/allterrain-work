<?php
/**
 * WordPress Abilities.
 *
 * The Abilities API is how a WordPress site tells an agent -- an AI assistant, an
 * MCP client, another plugin -- what it can actually *do*, as opposed to what
 * tables it has. Registering here means "create a task in the Redesign project,
 * assign it to Ana, due Friday" is a single typed call with a permission check
 * and a JSON Schema on both ends, instead of a REST route somebody has to
 * reverse-engineer from documentation.
 *
 * Every ability is a thin wrapper over the same helpers the REST routes and the
 * board use. That is the point: one implementation, three front doors, and no
 * chance of the agent path drifting from the human one.
 *
 * Every registration goes through `atwork_register_ability()`, which is guarded
 * on `function_exists( 'wp_register_ability' )`. The API landed in WordPress 6.9
 * and is also shipped by plugins that bundle it, so a site can have it from
 * either direction or from neither -- and a site with neither should lose the
 * agent surface, not fatal.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'wp_abilities_api_categories_init', 'atwork_register_ability_category' );
add_action( 'wp_abilities_api_init', 'atwork_register_abilities' );

/**
 * Registers one ability, if this site has the API to register it with.
 *
 * A one-line wrapper around `wp_register_ability()` that exists to put the
 * `function_exists()` guard *at the call site*.
 *
 * The guard used to be a single early return at the top of the function that
 * registers all fifteen. That is exactly equivalent at runtime and reads
 * better, but WordPress.org's Plugin Check does not follow it: it looks for the
 * call to be lexically inside a conditional, reports every one of the fifteen
 * as "requires WordPress 6.9, but your plugin supports 6.0", and fails the
 * review queue. Raising `Requires at least` to 6.9 would answer the tool by
 * lying to users -- the board works perfectly on 6.0 and simply has no agent
 * surface there, which is the whole reason the API is optional.
 *
 * So the guard moved to where a static analyser can see it. One check per
 * registration is a rounding error next to building the argument arrays, and
 * this way the honest answer and the passing answer are the same answer.
 *
 * @since 0.1.0
 *
 * @param string $name Fully-qualified ability name.
 * @param array  $args Ability arguments.
 * @return void
 */
function atwork_register_ability( $name, $args ) {
	if ( function_exists( 'wp_register_ability' ) ) {
		wp_register_ability( $name, $args );
	}
}

/**
 * Registers the ability category, if this site has the API for it.
 *
 * Separate from `atwork_register_ability()` because the two APIs can in
 * principle arrive apart, and because it is guarded for the same reason -- see
 * that function.
 *
 * @since 0.1.0
 *
 * @param string $name Category name.
 * @param array  $args Category arguments.
 * @return void
 */
function atwork_register_category( $name, $args ) {
	if ( function_exists( 'wp_register_ability_category' ) ) {
		wp_register_ability_category( $name, $args );
	}
}

/**
 * Registers the category the abilities below belong to.
 *
 * Two registries, two hooks, and the order between them is load-bearing:
 * categories are built on `wp_abilities_api_categories_init`, which fires
 * *before* `wp_abilities_api_init`, and an ability naming a category that does
 * not exist yet is refused outright. Registering the category alongside the
 * abilities looks tidier and silently drops every one of them.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_ability_category() {
	atwork_register_category(
		'allterrain-work',
		array(
			'label'       => __( 'Work management', 'allterrain-work' ),
			'description' => __( 'Read and change projects, tasks and their statuses on the AllTerrain Work board.', 'allterrain-work' ),
		)
	);
}

/**
 * Registers every ability.
 *
 * On `wp_abilities_api_init` because registering anywhere else is a
 * `_doing_it_wrong()` -- the registry is not built until that hook fires.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_abilities() {
	$read  = static function () {
		return current_user_can( 'edit_posts' );
	};
	$write = $read;

	atwork_register_ability(
		'allterrain-work/list-projects',
		array(
			'label'               => __( 'List projects', 'allterrain-work' ),
			'description'         => __( 'Returns every project on the work board that the current user can see, with its ID and title.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $read,
			'input_schema'        => array(
				'type'        => 'object',
				'properties'  => array(),
				'description' => __( 'No input.', 'allterrain-work' ),
			),
			'output_schema'       => array(
				'type'        => 'array',
				'description' => __( 'The projects.', 'allterrain-work' ),
				'items'       => atwork_ability_project_schema(),
			),
			'execute_callback'    => static function () {
				return atwork_get_projects();
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/list-statuses',
		array(
			'label'               => __( 'List board statuses', 'allterrain-work' ),
			'description'         => __( 'Returns the board columns in order, with the term ID each task must reference to sit in that column.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $read,
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(),
			),
			'output_schema'       => array(
				'type'  => 'array',
				'items' => array(
					'type'       => 'object',
					'properties' => array(
						'id'    => array( 'type' => 'integer' ),
						'slug'  => array( 'type' => 'string' ),
						'name'  => array( 'type' => 'string' ),
						'color' => array( 'type' => 'string' ),
						'order' => array( 'type' => 'integer' ),
						'count' => array( 'type' => 'integer' ),
					),
				),
			),
			'execute_callback'    => static function () {
				return atwork_get_statuses();
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/list-tasks',
		array(
			'label'               => __( 'List tasks', 'allterrain-work' ),
			'description'         => __( 'Returns tasks, optionally narrowed to one project or one assignee.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $read,
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(
					'project' => array(
						'type'        => 'integer',
						'description' => __( 'Project ID. Omit for every project.', 'allterrain-work' ),
					),
					'owner'   => array(
						'type'        => 'integer',
						'description' => __( 'Assignee user ID. Omit for every assignee.', 'allterrain-work' ),
					),
					'limit'   => array(
						'type'        => 'integer',
						'description' => __( 'Maximum tasks to return. Default 100.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'  => 'array',
				'items' => atwork_ability_task_schema(),
			),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();

				return atwork_get_tasks(
					array(
						'project' => absint( $input['project'] ?? 0 ),
						'owner'   => absint( $input['owner'] ?? 0 ),
						'limit'   => absint( $input['limit'] ?? 100 ),
					)
				);
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/create-project',
		array(
			'label'               => __( 'Create a project', 'allterrain-work' ),
			'description'         => __( 'Creates a project on the work board and returns it.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'title' ),
				'properties' => array(
					'title'   => array(
						'type'        => 'string',
						'minLength'   => 1,
						'description' => __( 'The project name.', 'allterrain-work' ),
					),
					'content' => array(
						'type'        => 'string',
						'description' => __( 'An optional description.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => atwork_ability_project_schema(),
			'execute_callback'    => static function ( $input ) {
				return atwork_create_project( is_array( $input ) ? $input : array() );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/create-status',
		array(
			'label'               => __( 'Add a board column', 'allterrain-work' ),
			'description'         => __( 'Adds a status column to the board, for example "Waiting on client". Requires the capability to manage categories.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => static function () {
				return current_user_can( 'manage_categories' );
			},
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'name' ),
				'properties' => array(
					'name'  => array(
						'type'        => 'string',
						'minLength'   => 1,
						'description' => __( 'What the column is called.', 'allterrain-work' ),
					),
					'color' => array(
						'type'        => 'string',
						'pattern'     => '^#[0-9a-fA-F]{6}$',
						'description' => __( 'Hex colour for the column header. Defaults to the next palette colour.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'id'    => array( 'type' => 'integer' ),
					'slug'  => array( 'type' => 'string' ),
					'name'  => array( 'type' => 'string' ),
					'color' => array( 'type' => 'string' ),
					'order' => array( 'type' => 'integer' ),
				),
			),
			'execute_callback'    => static function ( $input ) {
				return atwork_create_status( is_array( $input ) ? $input : array() );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/create-task',
		array(
			'label'               => __( 'Create a task', 'allterrain-work' ),
			'description'         => __( 'Creates a task, optionally in a project, in a status column, assigned to a user, with a due date and a priority. Call list-projects and list-statuses first to resolve names to IDs.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'title' ),
				'properties' => array(
					'title'    => array(
						'type'        => 'string',
						'minLength'   => 1,
						'description' => __( 'What needs doing.', 'allterrain-work' ),
					),
					'content'  => array(
						'type'        => 'string',
						'description' => __( 'Longer notes.', 'allterrain-work' ),
					),
					'project'  => array(
						'type'        => 'integer',
						'description' => __( 'Project ID from list-projects.', 'allterrain-work' ),
					),
					'status'   => array(
						'type'        => 'integer',
						'description' => __( 'Status term ID from list-statuses. Defaults to the first column.', 'allterrain-work' ),
					),
					'owner'    => array(
						'type'        => 'integer',
						'description' => __( 'User ID to assign it to.', 'allterrain-work' ),
					),
					'due'      => array(
						'type'        => 'string',
						'pattern'     => '^\\d{4}-\\d{2}-\\d{2}$',
						'description' => __( 'Due date as YYYY-MM-DD.', 'allterrain-work' ),
					),
					'priority' => array(
						'type'        => 'string',
						'enum'        => atwork_priorities(),
						'description' => __( 'How urgent it is.', 'allterrain-work' ),
					),
					'source'   => array(
						'type'        => 'integer',
						'description' => __( 'ID of a post this task is about, to link the two.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => atwork_ability_task_schema(),
			'execute_callback'    => static function ( $input ) {
				return atwork_create_task( is_array( $input ) ? $input : array() );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/update-task',
		array(
			'label'               => __( 'Update a task', 'allterrain-work' ),
			'description'         => __( 'Changes any subset of a task\'s fields. Fields you omit are left as they are.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id' ),
				'properties' => array(
					'id'       => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
					'title'    => array( 'type' => 'string' ),
					'content'  => array( 'type' => 'string' ),
					'project'  => array( 'type' => 'integer' ),
					'status'   => array( 'type' => 'integer' ),
					'owner'    => array( 'type' => 'integer' ),
					'due'      => array(
						'type'    => 'string',
						'pattern' => '^(\\d{4}-\\d{2}-\\d{2})?$',
					),
					'priority' => array(
						'type' => 'string',
						'enum' => atwork_priorities(),
					),
				),
			),
			'output_schema'       => atwork_ability_task_schema(),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();
				$id    = absint( $input['id'] ?? 0 );

				unset( $input['id'] );

				return atwork_update_task( $id, $input );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/move-task',
		array(
			'label'               => __( 'Move a task to a status', 'allterrain-work' ),
			'description'         => __( 'Moves a task into a status column and places it at a position within that column. This is the same operation as dragging a card on the board.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id', 'status' ),
				'properties' => array(
					'id'       => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
					'status'   => array(
						'type'        => 'integer',
						'description' => __( 'Destination status term ID from list-statuses.', 'allterrain-work' ),
					),
					'position' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Zero-based index within the column. 0 puts it on top.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => atwork_ability_task_schema(),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();

				return atwork_move_task(
					absint( $input['id'] ?? 0 ),
					absint( $input['status'] ?? 0 ),
					absint( $input['position'] ?? 0 )
				);
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/my-work',
		array(
			'label'               => __( 'What is on my plate', 'allterrain-work' ),
			'description'         => __( 'Returns the current user\'s open tasks, most urgent first: overdue before due-today before upcoming, then by priority. Also returns overdue and due-today counts.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $read,
			'input_schema'        => array(
				'type'       => 'object',
				'properties' => array(
					'projects' => array(
						'type'        => 'array',
						'items'       => array( 'type' => 'integer' ),
						'description' => __( 'Restrict to these project IDs. Omit for every project.', 'allterrain-work' ),
					),
					'limit'    => array(
						'type'        => 'integer',
						'description' => __( 'Maximum tasks. Default 25.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'tasks'  => array(
						'type'  => 'array',
						'items' => atwork_ability_task_schema(),
					),
					'counts' => array(
						'type'       => 'object',
						'properties' => array(
							'overdue'  => array( 'type' => 'integer' ),
							'today'    => array( 'type' => 'integer' ),
							'upcoming' => array( 'type' => 'integer' ),
							'done'     => array( 'type' => 'integer' ),
							'total'    => array( 'type' => 'integer' ),
						),
					),
				),
			),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();
				$work  = atwork_get_my_work(
					0,
					(array) ( $input['projects'] ?? array() ),
					absint( $input['limit'] ?? 25 )
				);

				if ( is_wp_error( $work ) ) {
					return $work;
				}

				// The widget needs the project and status lists to draw its
				// picker; an agent asking "what is on my plate" does not, and
				// sending them spends context on a question nobody asked.
				return array(
					'tasks'  => $work['tasks'],
					'counts' => $work['counts'],
				);
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/attach-to-task',
		array(
			'label'               => __( 'Attach something to a task', 'allterrain-work' ),
			'description'         => __( 'Attaches posts, pages, media or any custom post type to a task, by ID. The link is a reference — detaching later never deletes the attached item.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id', 'ids' ),
				'properties' => array(
					'id'  => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
					'ids' => array(
						'type'        => 'array',
						'items'       => array( 'type' => 'integer' ),
						'description' => __( 'IDs of the posts, pages, media or custom posts to attach.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'  => 'array',
				'items' => atwork_ability_link_schema(),
			),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();

				return atwork_attach_to_task( absint( $input['id'] ?? 0 ), (array) ( $input['ids'] ?? array() ) );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/detach-from-task',
		array(
			'label'               => __( 'Detach something from a task', 'allterrain-work' ),
			'description'         => __( 'Removes an attachment from a task. Removes the link only — the attached post, page or file is not deleted.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id', 'linked' ),
				'properties' => array(
					'id'     => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
					'linked' => array(
						'type'        => 'integer',
						'description' => __( 'ID of the attached item to unlink.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'  => 'array',
				'items' => atwork_ability_link_schema(),
			),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();

				return atwork_detach_from_task( absint( $input['id'] ?? 0 ), absint( $input['linked'] ?? 0 ) );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/trash-project',
		array(
			'label'               => __( 'Move a project to the trash', 'allterrain-work' ),
			'description'         => __( 'Sends a project to the WordPress trash. Its tasks are kept and keep their project id, so restoring the project restores the board intact.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id' ),
				'properties' => array(
					'id' => array(
						'type'        => 'integer',
						'description' => __( 'Project ID.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'deleted' => array( 'type' => 'boolean' ),
					'id'      => array( 'type' => 'integer' ),
				),
			),
			'execute_callback'    => static function ( $input ) {
				$input  = is_array( $input ) ? $input : array();
				$id     = absint( $input['id'] ?? 0 );
				$result = atwork_trash_project( $id );

				return is_wp_error( $result ) ? $result : array(
					'deleted' => true,
					'id'      => $id,
				);
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/comment-on-task',
		array(
			'label'               => __( 'Comment on a task', 'allterrain-work' ),
			'description'         => __( 'Adds a comment to a task’s thread, posted as the current user. The thread is ordinary WordPress comments, so it appears on the board, in the Comments screen and anywhere else comments are read.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id', 'content' ),
				'properties' => array(
					'id'      => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
					'content' => array(
						'type'        => 'string',
						'minLength'   => 1,
						'description' => __( 'What to say.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'id'      => array( 'type' => 'integer' ),
					'author'  => array( 'type' => 'string' ),
					'content' => array( 'type' => 'string' ),
					'date'    => array( 'type' => 'string' ),
				),
			),
			'execute_callback'    => static function ( $input ) {
				$input = is_array( $input ) ? $input : array();

				return atwork_add_task_comment( absint( $input['id'] ?? 0 ), (string) ( $input['content'] ?? '' ) );
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	atwork_register_ability(
		'allterrain-work/trash-task',
		array(
			'label'               => __( 'Move a task to the trash', 'allterrain-work' ),
			'description'         => __( 'Sends a task to the WordPress trash, where it can be restored. Nothing is permanently deleted.', 'allterrain-work' ),
			'category'            => 'allterrain-work',
			'permission_callback' => $write,
			'input_schema'        => array(
				'type'       => 'object',
				'required'   => array( 'id' ),
				'properties' => array(
					'id' => array(
						'type'        => 'integer',
						'description' => __( 'Task ID.', 'allterrain-work' ),
					),
				),
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'deleted' => array( 'type' => 'boolean' ),
					'id'      => array( 'type' => 'integer' ),
				),
			),
			'execute_callback'    => static function ( $input ) {
				$input  = is_array( $input ) ? $input : array();
				$id     = absint( $input['id'] ?? 0 );
				$result = atwork_trash_task( $id );

				return is_wp_error( $result ) ? $result : array(
					'deleted' => true,
					'id'      => $id,
				);
			},
			'meta'                => array( 'show_in_rest' => true ),
		)
	);

	/**
	 * Fires after AllTerrain Work has registered its abilities.
	 *
	 * Still inside `wp_abilities_api_init`, so a listener can register its own
	 * abilities in the `allterrain-work` category, or `wp_unregister_ability()`
	 * one of these to keep it away from agents on a particular site.
	 *
	 * @since 0.1.0
	 */
	do_action( 'atwork_abilities_registered' );
}

/**
 * JSON Schema for a task, as the helpers shape it.
 *
 * One definition, referenced by every ability that returns a task, so the
 * schema and `atwork_prepare_task()` cannot describe different things.
 *
 * @since 0.1.0
 * @access private
 *
 * @return array JSON Schema fragment.
 */
function atwork_ability_task_schema() {
	return array(
		'type'       => 'object',
		'properties' => array(
			'id'          => array(
				'type'        => 'integer',
				'description' => __( 'Task ID.', 'allterrain-work' ),
			),
			'title'       => array( 'type' => 'string' ),
			'excerpt'     => array( 'type' => 'string' ),
			'projectId'   => array( 'type' => 'integer' ),
			'statusId'    => array( 'type' => 'integer' ),
			'ownerId'     => array( 'type' => 'integer' ),
			'ownerName'   => array( 'type' => 'string' ),
			'due'         => array(
				'type'        => 'string',
				'description' => __( 'YYYY-MM-DD, or empty when undated.', 'allterrain-work' ),
			),
			'priority'    => array(
				'type' => 'string',
				'enum' => atwork_priorities(),
			),
			'order'       => array(
				'type'        => 'integer',
				'description' => __( 'Position within its column.', 'allterrain-work' ),
			),
			'sourceId'    => array(
				'type'        => 'integer',
				'description' => __( 'The post this task is about, or 0.', 'allterrain-work' ),
			),
			'sourceTitle' => array( 'type' => 'string' ),
			'editUrl'     => array( 'type' => 'string' ),
		),
	);
}

/**
 * JSON Schema for one thing attached to a task.
 *
 * @since 0.1.0
 * @access private
 *
 * @return array JSON Schema fragment.
 */
function atwork_ability_link_schema() {
	return array(
		'type'       => 'object',
		'properties' => array(
			'id'        => array( 'type' => 'integer' ),
			'title'     => array( 'type' => 'string' ),
			'type'      => array( 'type' => 'string' ),
			'typeLabel' => array( 'type' => 'string' ),
			'editUrl'   => array( 'type' => 'string' ),
		),
	);
}

/**
 * JSON Schema for a project.
 *
 * @since 0.1.0
 * @access private
 *
 * @return array JSON Schema fragment.
 */
function atwork_ability_project_schema() {
	return array(
		'type'       => 'object',
		'properties' => array(
			'id'      => array( 'type' => 'integer' ),
			'title'   => array( 'type' => 'string' ),
			'excerpt' => array( 'type' => 'string' ),
			'status'  => array( 'type' => 'string' ),
			'editUrl' => array( 'type' => 'string' ),
		),
	);
}

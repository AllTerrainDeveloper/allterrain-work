<?php
/**
 * The block editor's sidebar panel.
 *
 * Registering meta with `show_in_rest` makes it reachable from Gutenberg; it
 * does not make it editable. Without a panel, opening a task showed a title, a
 * body, and no sign that the thing has an owner, a deadline, a priority and a
 * project — every one of which the board edits happily and the editor could
 * not touch. Two screens disagreeing about what a task *has* is worse than
 * either being incomplete.
 *
 * The panel is enqueued only on the two post types that have fields, so the
 * bundle never loads on an ordinary post.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'enqueue_block_editor_assets', 'atwork_enqueue_editor_panel' );

/**
 * Loads the sidebar panel on this plugin's post types.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_enqueue_editor_panel() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

	if ( ! $screen || ! in_array( $screen->post_type, array( ATWORK_PROJECT_TYPE, ATWORK_TASK_TYPE ), true ) ) {
		return;
	}

	wp_enqueue_script( 'allterrain-work-editor' );
	wp_add_inline_script(
		'allterrain-work-editor',
		'window.allTerrainWorkEditor = ' . wp_json_encode( atwork_editor_config( $screen->post_type ) ) . ';',
		'before'
	);
}

/**
 * What the panel needs to render its controls.
 *
 * The meta *keys* travel with it rather than being hardcoded in the bundle,
 * because they are private (`_`-prefixed) implementation detail that the board,
 * the REST routes and the abilities all reach through named constants. A
 * literal `'_atwork_due'` in TypeScript is the one copy nobody would think to
 * update when the constant changes.
 *
 * @since 0.1.0
 *
 * @param string $post_type The type being edited.
 * @return array Configuration blob.
 */
function atwork_editor_config( $post_type ) {
	$config = array(
		'postType'       => (string) $post_type,
		'projectType'    => ATWORK_PROJECT_TYPE,
		'taskType'       => ATWORK_TASK_TYPE,
		'statusTaxonomy' => ATWORK_STATUS_TAX,
		'boardWindow'    => 'allterrain-work',
		'priorities'     => atwork_priorities(),
		'priorityLabels' => array(
			'low'      => __( 'Low', 'allterrain-work' ),
			'medium'   => __( 'Medium', 'allterrain-work' ),
			'high'     => __( 'High', 'allterrain-work' ),
			'critical' => __( 'Critical', 'allterrain-work' ),
		),
		'states'         => atwork_project_states(),
		'stateLabels'    => array(
			'planning' => __( 'Planning', 'allterrain-work' ),
			'active'   => __( 'Active', 'allterrain-work' ),
			'on-hold'  => __( 'On hold', 'allterrain-work' ),
			'done'     => __( 'Done', 'allterrain-work' ),
		),
		'meta'           => array(
			'project'  => ATWORK_META_PROJECT,
			'owner'    => ATWORK_META_OWNER,
			'due'      => ATWORK_META_DUE,
			'priority' => ATWORK_META_PRIORITY,
			'source'   => ATWORK_META_SOURCE,
			'lead'     => ATWORK_META_LEAD,
			'start'    => ATWORK_META_START,
			'target'   => ATWORK_META_TARGET,
			'state'    => ATWORK_META_STATE,
			'color'    => ATWORK_META_COLOR,
		),
	);

	/**
	 * Filters the block-editor panel configuration.
	 *
	 * @since 0.1.0
	 *
	 * @param array  $config    Configuration blob.
	 * @param string $post_type The type being edited.
	 */
	return apply_filters( 'atwork_editor_config', $config, $post_type );
}

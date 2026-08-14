<?php
/**
 * WP Explorer.
 *
 * OpenStation's site window browses every `show_ui` post type automatically, so
 * Projects and Tasks appear there without a line of code. What arrives by
 * default, though, is two loose folders of tiles reading only a title -- and a
 * task's title is the least interesting thing about it. Which column is it in?
 * Whose is it? Is it late?
 *
 * This file answers those three questions in the places the Explorer already
 * looks, rather than inventing a surface:
 *
 *   - **The folder.** Both types collapse into one *AllTerrain Work* folder,
 *     with the board's icon, sorted ahead of the generic plugin folders.
 *   - **The tiles.** A task's excerpt becomes its status, owner and due date, so
 *     the grid reads like a board even where there is no board.
 *   - **The icons.** Per type, so a project and a task are distinguishable at a
 *     glance in a folder that holds both.
 *
 * There was no need to patch OpenStation for any of it. `menu_icon` is already
 * reused as the section icon, and `openstation_my_wordpress_post_type_entity`
 * can override it per type -- so the icon hook people reach for a fork over
 * turns out to be two hooks that already ship.
 *
 * Every filter here is additive and gated: with no shell installed none of them
 * ever fire, and the excerpt filter is scoped to this plugin's own post type.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

/**
 * The folder id both post types share in the Explorer root.
 *
 * @since 0.1.0
 */
const ATWORK_EXPLORER_GROUP = 'plugin:allterrain-work';

add_filter( 'openstation_my_wordpress_post_type_group', 'atwork_explorer_group', 10, 2 );

/**
 * Puts Projects and Tasks in one folder.
 *
 * The Explorer files a type under whichever plugin called
 * `register_post_type()`, which already lands both of ours together -- but it
 * derives the label and icon from the plugin header, so the folder gets a
 * generic post icon. Declaring the group explicitly is what buys the board's
 * own icon and a sort weight ahead of the other plugin folders.
 *
 * @since 0.1.0
 *
 * @param array|null $group     Resolved group, or null for a loose section.
 * @param string     $post_type Post type slug.
 * @return array|null Group descriptor.
 */
function atwork_explorer_group( $group, $post_type ) {
	if ( ! in_array( $post_type, array( ATWORK_PROJECT_TYPE, ATWORK_TASK_TYPE ), true ) ) {
		return $group;
	}

	return array(
		'id'    => ATWORK_EXPLORER_GROUP,
		'label' => __( 'AllTerrain Work', 'allterrain-work' ),
		'icon'  => 'dashicons-clipboard',
		// Below the built-in Posts / Pages / Media, above the generic plugin
		// folders at 20. Work is something people open often; a folder they
		// have to scroll to is a folder they stop using.
		'order' => 15,
	);
}

add_filter( 'openstation_my_wordpress_post_type_entity', 'atwork_explorer_entity', 10, 2 );

/**
 * Tunes each section inside that folder.
 *
 * @since 0.1.0
 *
 * @param array        $entity    Section descriptor.
 * @param WP_Post_Type $post_type The type it was built from.
 * @return array Filtered descriptor.
 */
function atwork_explorer_entity( $entity, $post_type ) {
	if ( ATWORK_TASK_TYPE === $post_type->name ) {
		$entity['icon'] = 'dashicons-yes-alt';

		// A task has no featured image and never will -- it does not support
		// thumbnails. Leaving them on makes the list request ask for embedded
		// media on every page for an answer that is always empty, and every
		// tile falls back to the icon anyway. Off is both cheaper and the same
		// picture.
		$entity['thumbnails'] = false;

		// Load-bearing, and the reason the grid can be banded by status at all.
		// The window sends an explicit `_fields` list, so anything not named
		// here is stripped off the list rows before the bundle ever sees it --
		// the meta and the status term included. Without this the banding
		// filter is handed rows that know their title and nothing else, and
		// every task falls into the catch-all band.
		$entity['listFields'] = array( 'meta', atwork_status_rest_field() );
	}

	if ( ATWORK_PROJECT_TYPE === $post_type->name ) {
		$entity['icon']       = 'dashicons-portfolio';
		$entity['listFields'] = array( 'meta' );
	}

	return $entity;
}

add_filter( 'get_the_excerpt', 'atwork_explorer_task_excerpt', 10, 2 );

/**
 * Makes a task tile say something a board would say.
 *
 * The Explorer's post-shaped tiles render title plus excerpt, and a task has no
 * excerpt -- so a folder of them is a wall of titles with no way to tell the
 * finished from the late. This fills that space with the three facts a board
 * puts on a card: the column, the owner, and the deadline.
 *
 * On `get_the_excerpt` rather than a bespoke REST field because that is the one
 * place both surfaces read: the Explorer's tiles get it through
 * `excerpt.rendered` on the core REST collection, and so does every other
 * consumer of a task excerpt, including the list table and any theme. A REST
 * field would have improved exactly one screen.
 *
 * A task that already carries a hand-written excerpt keeps it. Someone who took
 * the trouble to summarise their own task has said something more useful than
 * this ever will.
 *
 * @since 0.1.0
 *
 * @param string  $excerpt The excerpt so far.
 * @param WP_Post $post    The post it belongs to.
 * @return string Filtered excerpt.
 */
function atwork_explorer_task_excerpt( $excerpt, $post = null ) {
	if ( ! $post instanceof WP_Post || ATWORK_TASK_TYPE !== $post->post_type ) {
		return $excerpt;
	}

	if ( '' !== trim( (string) $post->post_excerpt ) ) {
		return $excerpt;
	}

	$parts = array();

	$terms = wp_get_object_terms( $post->ID, ATWORK_STATUS_TAX );

	if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
		$parts[] = $terms[0]->name;
	}

	$owner_id = (int) get_post_meta( $post->ID, ATWORK_META_OWNER, true );
	$owner    = $owner_id ? get_userdata( $owner_id ) : false;

	if ( $owner ) {
		$parts[] = $owner->display_name;
	}

	$due = (string) get_post_meta( $post->ID, ATWORK_META_DUE, true );

	if ( $due ) {
		$timestamp = strtotime( $due . ' 00:00:00' );

		$parts[] = $due < current_time( 'Y-m-d' )
			/* translators: %s: formatted due date. */
			? sprintf( __( 'Overdue %s', 'allterrain-work' ), date_i18n( get_option( 'date_format' ), $timestamp ) )
			/* translators: %s: formatted due date. */
			: sprintf( __( 'Due %s', 'allterrain-work' ), date_i18n( get_option( 'date_format' ), $timestamp ) );
	}

	if ( ! $parts ) {
		// Nothing to say is better said by the post's own excerpt logic than by
		// a separator with no words around it.
		return $excerpt;
	}

	/**
	 * Filters the generated summary line on a task.
	 *
	 * @since 0.1.0
	 *
	 * @param string[] $parts   The facts, in render order.
	 * @param WP_Post  $post    The task.
	 */
	$parts = apply_filters( 'atwork_task_summary_parts', $parts, $post );

	return implode( ' · ', $parts );
}

/**
 * The Explorer's section id for a post type.
 *
 * The auto-generated sections are keyed `cpt-<slug>`, not by the slug alone.
 * Getting this wrong does not error -- the action is simply filtered out of
 * every section and never appears, which is exactly the kind of silence a
 * constant is worth having to prevent.
 *
 * @since 0.1.0
 *
 * @param string $post_type Post type slug.
 * @return string Section id.
 */
function atwork_explorer_section_id( $post_type ) {
	return 'cpt-' . $post_type;
}

add_action( 'openstation_mode_init', 'atwork_enqueue_explorer_bundle' );
add_action( 'desktop_mode_mode_init', 'atwork_enqueue_explorer_bundle' );

/**
 * Loads the Explorer decorations onto the shell page.
 *
 * Eagerly, and on the shell rather than on the Explorer window: the hooks it
 * registers are *filters the Explorer consults while painting*, so a bundle
 * that arrives after the user opens the window arrives after the decision it
 * was meant to influence. Registering at shell boot is the only ordering that
 * is reliable, and the bundle is small enough that the cost is a rounding
 * error against being occasionally, unreproducibly absent.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_enqueue_explorer_bundle() {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return;
	}

	wp_enqueue_script( 'allterrain-work-explorer' );
	wp_enqueue_script( 'allterrain-work-config' );
	wp_enqueue_style( 'allterrain-work' );
}

add_filter( 'openstation_my_wordpress_preview_actions', 'atwork_explorer_preview_action' );

/**
 * Offers "Open the work board" from a task or project's preview pane.
 *
 * Someone who found a task by browsing the Explorer is one click from the place
 * it actually lives. The descriptor is only half of it: the button appears from
 * here, and the click is wired on the JS side against
 * `os.my-wordpress.preview-actions`, which is what `script` loads.
 *
 * @since 0.1.0
 *
 * @param array $actions Registered preview actions.
 * @return array Filtered actions.
 */
function atwork_explorer_preview_action( $actions ) {
	$actions[] = array(
		'id'         => 'allterrain-work/open-board',
		'label'      => __( 'Open the work board', 'allterrain-work' ),
		'icon'       => 'dashicons-clipboard',
		'capability' => 'edit_posts',
		'sections'   => array(
			atwork_explorer_section_id( ATWORK_TASK_TYPE ),
			atwork_explorer_section_id( ATWORK_PROJECT_TYPE ),
		),
		'script'     => 'allterrain-work-board',
	);

	return $actions;
}

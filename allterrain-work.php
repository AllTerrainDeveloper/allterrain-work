<?php
/**
 * Plugin Name:       AllTerrain Work
 * Plugin URI:        https://github.com/AllTerrainDeveloper/allterrain-work
 * Description:       Projects and tasks on a drag-and-drop board, as an OpenStation desktop app. Everything is a WordPress post, so the REST API, capabilities, revisions, search and the Abilities API all work on it out of the box.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Daniel Lopez
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       allterrain-work
 *
 * No `Domain Path` header: it names the folder translations are loaded from, and
 * this plugin ships none. Pointing it at a `/languages` directory that does not
 * exist is a promise the package does not keep, and WordPress.org's Plugin Check
 * rejects it as one. Translations from the plugin directory land in
 * `WP_LANG_DIR` and need no header at all; add one only if `.mo` files ever ship
 * inside the plugin itself.
 *
 * AllTerrain Work is a work tracker in the Monday.com shape -- projects, tasks, a
 * status column you drag cards between -- built as an OpenStation application.
 *
 * Two decisions shape the whole plugin:
 *
 * **Everything is a post.** A project is a post, a task is a post, a status is a
 * term. Nothing lives in a bespoke table. That is not nostalgia: it means the
 * REST API, `current_user_can()`, revisions, autosave, search, the trash, the
 * Abilities API and every plugin that hooks `save_post` already work on this
 * data without a line of integration code. A custom schema would have bought a
 * marginally tidier query and cost all of it.
 *
 * **OpenStation is optional, not required.** With the shell installed and
 * switched on, the board is a native window -- rendered into the shell's own
 * DOM, which is what gives it OpenStation's components, its drag manager and
 * its window chrome. With the shell absent or switched off, the same board
 * renders on a plain admin page under its own menu. There is deliberately no
 * `Requires Plugins:` header: every OpenStation call in this plugin sits
 * behind a `function_exists()` gate, so a site without the shell loses the
 * desktop affordances and keeps the work tracker.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

define( 'ATWORK_VERSION', '0.1.0' );
define( 'ATWORK_FILE', __FILE__ );
define( 'ATWORK_DIR', plugin_dir_path( __FILE__ ) );
define( 'ATWORK_URL', plugin_dir_url( __FILE__ ) );

/**
 * REST namespace for the board-shaped endpoints.
 *
 * The post types are `show_in_rest`, so `/wp/v2/atwork-task` handles ordinary
 * CRUD. This namespace exists for the two things core REST cannot express in
 * one round trip: assembling a whole board, and moving a card (a status change
 * and a reorder of its column, which must be one atomic write or a dropped
 * card can land in the right column at the wrong index).
 */
define( 'ATWORK_REST_NAMESPACE', 'allterrain-work/v1' );

/**
 * The post types.
 *
 * Named `atwork-` rather than `allterrain-work-` because WordPress caps a post
 * type key at 20 characters (`register_post_type()` rejects anything longer).
 * `allterrain-work-` is 16 of those on its own, which leaves four for the
 * element and would have made `allterrain-work-project` -- 23 characters --
 * fail registration outright. The taxonomy cap is 32, so the same prefix is
 * kept there for consistency rather than out of necessity.
 */
define( 'ATWORK_PROJECT_TYPE', 'atwork-project' );
define( 'ATWORK_TASK_TYPE', 'atwork-task' );

/** Taxonomy holding the board's columns. */
define( 'ATWORK_STATUS_TAX', 'atwork-status' );

/**
 * Post meta keys on a task.
 *
 * Registered with `register_post_meta( … 'show_in_rest' => true )`, so they are
 * readable and writable through core REST as well as through this plugin's own
 * routes.
 */
define( 'ATWORK_META_PROJECT', '_atwork_project' );
define( 'ATWORK_META_OWNER', '_atwork_owner' );
define( 'ATWORK_META_DUE', '_atwork_due' );
define( 'ATWORK_META_PRIORITY', '_atwork_priority' );

/**
 * The post a task was made from, when it was made by dropping one on the board.
 *
 * Drag a draft off the desktop into "Working on it" and the task that appears
 * remembers which draft it is about, so the card can offer a way back to it.
 */
define( 'ATWORK_META_SOURCE', '_atwork_source' );

/**
 * Things attached to a task.
 *
 * A list of post IDs — which covers posts, pages, media and every custom post
 * type in one field, because all of them are posts. Dragging any of them onto a
 * card from anywhere on the desktop attaches it here.
 *
 * Not `post_parent` on the attached object: that field already means something
 * for media (which gallery it belongs to) and for hierarchical types (its
 * parent page), and borrowing it would move a page under a task.
 */
define( 'ATWORK_META_LINKS', '_atwork_links' );

/**
 * Post meta on a project.
 *
 * A project used to be a title and nothing else, which made it a filter rather
 * than a thing you could plan. These are the fields a project actually has:
 * who is running it, when it runs between, what state it is in, and the colour
 * its tasks wear on the board.
 */
define( 'ATWORK_META_LEAD', '_atwork_lead' );
define( 'ATWORK_META_START', '_atwork_start' );
define( 'ATWORK_META_TARGET', '_atwork_target' );
define( 'ATWORK_META_STATE', '_atwork_state' );
define( 'ATWORK_META_COLOR', '_atwork_color' );

/** Term meta on a status: the column's colour swatch and its left-to-right order. */
define( 'ATWORK_TERM_COLOR', 'atwork_color' );
define( 'ATWORK_TERM_ORDER', 'atwork_order' );

require_once ATWORK_DIR . 'includes/shell-api.php';
require_once ATWORK_DIR . 'includes/content-types.php';
require_once ATWORK_DIR . 'includes/helpers.php';
require_once ATWORK_DIR . 'includes/rest.php';
require_once ATWORK_DIR . 'includes/abilities.php';
require_once ATWORK_DIR . 'includes/assets.php';
require_once ATWORK_DIR . 'includes/admin-page.php';
require_once ATWORK_DIR . 'includes/editor.php';
require_once ATWORK_DIR . 'includes/explorer.php';
require_once ATWORK_DIR . 'includes/openstation.php';

register_activation_hook( __FILE__, 'atwork_activate' );

/**
 * Prepares a site to hold work.
 *
 * Registers the content types before seeding, because `wp_insert_term()` on an
 * unregistered taxonomy fails silently and would leave a board with no columns
 * to drop cards into -- the first-run experience most likely to read as "the
 * plugin is broken" rather than "the plugin is empty".
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_activate() {
	atwork_register_content_types();
	atwork_seed_statuses();
	flush_rewrite_rules();
}

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );

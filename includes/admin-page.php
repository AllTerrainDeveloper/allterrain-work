<?php
/**
 * The admin menu, and the board's no-shell fallback page.
 *
 * **Inside OpenStation the board is never an iframe.** It is a native window,
 * rendered into the shell's own DOM, and that is not a preference -- it is the
 * only way it can reach `wp.os.dragManager`, the shell's components and its
 * palette tokens. A card in an iframe can be dragged inside its own document
 * and nowhere else; a card in a native window can be dragged onto anything on
 * the desktop that registers a drop target.
 *
 * So when the shell is on for a user, this file deliberately does *not* put the
 * board page in the admin menu. A menu entry is a URL, and the shell opens URLs
 * in iframe windows -- the entry would quietly offer a second, worse copy of
 * the board sitting right next to the good one. The board is reached from its
 * dock tile, its desktop icon, or the command palette instead, and the menu
 * carries only the record screens, which are genuine wp-admin pages and belong
 * in iframes.
 *
 * With the shell off or absent, there is no native window to open and the same
 * bundle mounts on a plain admin page here. One board implementation, two
 * hosts -- a second, simpler "fallback board" would be the copy that rots.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_menu', 'atwork_register_admin_page' );

/**
 * Whether the board should render as a wp-admin page at all.
 *
 * False inside the shell, where the native window is the board and an admin
 * page would only add an iframe copy of it.
 *
 * @since 0.1.0
 *
 * @return bool True when the board needs its own admin page.
 */
function atwork_needs_admin_page() {
	/**
	 * Filters whether to register the board's wp-admin page.
	 *
	 * Returning true inside the shell brings the iframe route back -- useful if
	 * a site has customised the page in ways the native window does not carry.
	 *
	 * @since 0.1.0
	 *
	 * @param bool $needed True when the shell is not rendering the board natively.
	 */
	return (bool) apply_filters( 'atwork_needs_admin_page', ! atwork_shell_is_active() );
}

/**
 * Adds the Work menu.
 *
 * The post types register with `show_in_menu => false` and are added here, so
 * wp-admin grows one menu rather than three.
 *
 * What the top-level entry points at depends on where the board lives. Without
 * the shell it is the board itself, because the board is the app. Inside the
 * shell the board is already a window on the desktop, so the menu points at the
 * Tasks list instead -- the records view, which is a real admin screen and is
 * exactly the kind of thing an iframe window is for.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_admin_page() {
	$standalone = atwork_needs_admin_page();
	$tasks      = 'edit.php?post_type=' . ATWORK_TASK_TYPE;
	$parent     = $standalone ? 'allterrain-work' : $tasks;

	add_menu_page(
		__( 'Work', 'allterrain-work' ),
		__( 'Work', 'allterrain-work' ),
		'edit_posts',
		$parent,
		$standalone ? 'atwork_render_admin_page' : '',
		'dashicons-clipboard',
		26
	);

	if ( $standalone ) {
		add_submenu_page(
			$parent,
			__( 'Board', 'allterrain-work' ),
			__( 'Board', 'allterrain-work' ),
			'edit_posts',
			'allterrain-work',
			'atwork_render_admin_page'
		);
	}

	add_submenu_page(
		$parent,
		__( 'Projects', 'allterrain-work' ),
		__( 'Projects', 'allterrain-work' ),
		'edit_posts',
		'edit.php?post_type=' . ATWORK_PROJECT_TYPE
	);

	add_submenu_page(
		$parent,
		__( 'Tasks', 'allterrain-work' ),
		__( 'Tasks', 'allterrain-work' ),
		'edit_posts',
		$tasks
	);

	add_submenu_page(
		$parent,
		__( 'Statuses', 'allterrain-work' ),
		__( 'Statuses', 'allterrain-work' ),
		'manage_categories',
		'edit-tags.php?taxonomy=' . ATWORK_STATUS_TAX . '&post_type=' . ATWORK_TASK_TYPE
	);
}

add_action( 'admin_page_access_denied', 'atwork_redirect_board_page_into_the_shell' );

/**
 * Sends an old board bookmark to the desktop, and opens the window there.
 *
 * Inside the shell the board page is not registered at all, and the two obvious
 * ways to keep its URL alive are both worse than this one. Registering it under
 * a `null` parent -- core's own idiom for a page that answers on its URL but
 * appears in no menu -- leaves `$title` unset for the request, and wp-admin's
 * header then hands `null` to `strip_tags()` and prints a PHP deprecation
 * notice into the top of the window. Registering it normally puts it back in
 * the menu, which is where the shell builds the dock from, and the iframe copy
 * of the board returns.
 *
 * So: no page, and a redirect to the desktop carrying a flag the board bundle
 * reads. The user lands on their desktop with the native window already
 * opening, which is where the bookmark was trying to take them anyway.
 *
 * On `admin_page_access_denied` rather than `admin_init`, which is a full
 * request too late: `wp-admin/menu.php` resolves the requested screen and dies
 * on an unregistered one *before* `admin_init` fires, so a redirect hung there
 * never runs and the user gets the 403 this exists to avoid. This hook fires at
 * exactly that decision point.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_redirect_board_page_into_the_shell() {
	if ( atwork_needs_admin_page() || wp_doing_ajax() ) {
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Reading which admin screen was requested; no state changes here.
	$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';

	if ( 'allterrain-work' !== $page ) {
		return;
	}

	wp_safe_redirect( admin_url( 'index.php?atwork_open=1' ) );
	exit;
}

add_action( 'admin_enqueue_scripts', 'atwork_enqueue_admin_page' );

/**
 * Loads the board bundle on its own admin page.
 *
 * @since 0.1.0
 *
 * @param string $hook_suffix Current admin page.
 * @return void
 */
function atwork_enqueue_admin_page( $hook_suffix ) {
	if ( 'toplevel_page_allterrain-work' !== $hook_suffix ) {
		return;
	}

	wp_enqueue_script( 'allterrain-work-config' );
	wp_enqueue_script( 'allterrain-work-board' );
	wp_enqueue_style( 'allterrain-work' );
}

/**
 * Renders the page shell the bundle mounts into.
 *
 * Markup identical to the native window's template, down to the data
 * attributes, so `src/board.ts` finds the same handles in both hosts. The
 * `data-host` value is the only difference, and it is what the bundle reads to
 * decide whether the shell's drag manager and components are available.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_render_admin_page() {
	if ( ! current_user_can( 'edit_posts' ) ) {
		wp_die( esc_html__( 'You are not allowed to view the work board.', 'allterrain-work' ) );
	}

	$chromeless = atwork_shell_is_chromeless();
	?>
	<div class="wrap atwork-wrap<?php echo $chromeless ? ' atwork-wrap--chromeless' : ''; ?>">
		<?php if ( ! $chromeless ) : ?>
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Work', 'allterrain-work' ); ?></h1>
			<hr class="wp-header-end">
		<?php endif; ?>

		<div class="atwork" data-atwork-root data-host="admin">
			<div class="atwork__toolbar" data-atwork-toolbar>
				<span class="atwork__loading"><?php esc_html_e( 'Loading your board…', 'allterrain-work' ); ?></span>
			</div>
			<div class="atwork__board" data-atwork-board></div>
		</div>

		<noscript>
			<p>
				<?php
				printf(
					/* translators: %s: URL of the tasks list table. */
					wp_kses_post( __( 'The board needs JavaScript. You can still work with <a href="%s">the tasks list</a>.', 'allterrain-work' ) ),
					esc_url( admin_url( 'edit.php?post_type=' . ATWORK_TASK_TYPE ) )
				);
				?>
			</p>
		</noscript>
	</div>
	<?php
}

<?php
/**
 * OpenStation integration.
 *
 * OpenStation is a dependency, not an enhancement: `Requires Plugins:
 * desktop-mode` in the plugin header, which WordPress enforces from 6.5 by
 * refusing to activate this plugin without it. The board is a native window on
 * the desktop and its drag and drop is the shell's pointer pipeline; there is
 * no version of this plugin that does those things alone.
 *
 * Everything here nonetheless sits behind a `function_exists()` gate resolved
 * through `shell-api.php`, because "declared" and "present right now" are
 * different questions. The dependency can be deleted from disk after
 * activation, the header is inert below 6.5, and the shell can rename an API
 * between releases. A missing function then costs the desktop surfaces and an
 * admin notice, rather than a fatal on every request -- which is the difference
 * between a site an administrator can log in and fix, and one they cannot.
 *
 * With the shell present this becomes a desktop app: a native window on the
 * board, a wallpaper icon, a widget in the side column, and an entry in the
 * command palette.
 *
 * The board is a **native** window rather than an iframe, and that is the whole
 * reason the drag-and-drop feels the way it does. Rendering into the shell's own
 * DOM is what gives it `wp.os.dragManager` -- one pointer-event pipeline shared
 * with the wallpaper's file tiles and every other window -- so a card can be
 * dragged out of a column and, later, onto anything else on the desktop that
 * registers a drop target. None of that is reachable from inside an iframe.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'plugins_loaded', 'atwork_maybe_init_openstation', 20 );
add_action( 'admin_notices', 'atwork_missing_shell_notice' );

/**
 * Says so, on a site running without the shell.
 *
 * OpenStation is a dependency, declared in the plugin header as
 * `Requires Plugins: desktop-mode`. WordPress enforces that from 6.5: the
 * Plugins screen lists the requirement, and the activation toggle stays
 * disabled until it is met. This notice is for the versions below that, where
 * the header is read and ignored, and for the case the header cannot cover at
 * all -- a dependency that was active at activation time and has since been
 * deleted.
 *
 * It does not deactivate anything and does not stop the content types
 * registering. A site in this state still has its projects and tasks in the
 * database, and taking the admin screens away to make a point would make
 * recoverable data look lost.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_missing_shell_notice() {
	if ( atwork_shell_has( 'register_window' ) || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	// One screen, not every screen. This is a standing condition rather than
	// the result of anything the reader just did, and a banner on all of
	// wp-admin for a standing condition is one people learn to scroll past.
	$screen = get_current_screen();

	if ( ! $screen || ! in_array( $screen->id, array( 'plugins', 'plugins-network', 'dashboard' ), true ) ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p><strong>%1$s</strong> %2$s</p></div>',
		esc_html__( 'AllTerrain Work needs OpenStation.', 'allterrain-work' ),
		esc_html__(
			'The board is a desktop app: it opens as a window on the OpenStation desktop, and its drag and drop runs on the shell’s pointer pipeline. Without OpenStation active, your projects and tasks are safe but there is nowhere to open them.',
			'allterrain-work'
		)
	);
}

/**
 * Wires up the shell integrations, if there is a shell to wire into.
 *
 * On `plugins_loaded` rather than at file scope: plugins load alphabetically, so
 * `allterrain-work` runs before `desktop-mode` and none of the shell's functions
 * exist yet when this file is first read. Checking then would fail on every
 * site, every time.
 *
 * The gate is on the registration function rather than on a version constant, so
 * a shell release that renames itself or drops the API degrades to "no desktop
 * integration" instead of a fatal error on every request.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_maybe_init_openstation() {
	if ( ! atwork_shell_has( 'register_window' ) ) {
		return;
	}

	add_action( 'init', 'atwork_register_shell_surfaces', 20 );

	// Registered against both spellings of the hook. Which one fires depends on
	// the shell's version, and a listener for a hook that never fires costs
	// nothing -- far less than deciding at boot which shell is present, since
	// the answer can change between `plugins_loaded` and the hook firing.
	foreach ( atwork_shell_hooks( 'mode_init' ) as $hook ) {
		add_action( $hook, 'atwork_enqueue_in_shell' );
	}

	add_action( 'admin_enqueue_scripts', 'atwork_enqueue_shell_styles', 20 );
}

/**
 * Registers the window, the wallpaper icon, the widget and the command.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_shell_surfaces() {
	$registered = atwork_shell_call(
		'register_window',
		'allterrain-work',
		array(
			'title'        => __( 'AllTerrain Work', 'allterrain-work' ),
			'icon'         => 'dashicons-clipboard',
			'template'     => 'atwork_render_window_template',
			'script'       => 'allterrain-work-board',
			'style'        => 'allterrain-work',
			'width'        => 1180,
			'height'       => 760,
			'min_width'    => 640,
			'min_height'   => 420,
			'placement'    => 'dock',
			'capabilities' => array( 'edit_posts' ),
		)
	);

	// A `WP_Error` here means the shell rejected the registration -- a missing
	// title, an unmet capability. Everything downstream references this window
	// by id, so there is nothing useful to register once it has failed.
	if ( is_wp_error( $registered ) ) {
		return;
	}

	if ( atwork_shell_has( 'register_icon' ) ) {
		atwork_shell_call(
			'register_icon',
			'allterrain-work',
			array(
				'title'        => __( 'AllTerrain Work', 'allterrain-work' ),
				'icon'         => 'dashicons-clipboard',
				'window'       => 'allterrain-work',
				'position'     => 20,
				'capabilities' => array( 'edit_posts' ),
			)
		);
	}

	if ( atwork_shell_has( 'register_widget' ) ) {
		atwork_shell_call(
			'register_widget',
			'allterrain-work/my-work',
			array(
				'label'          => __( 'My Work', 'allterrain-work' ),
				'description'    => __( 'Your open tasks, soonest first, from the projects you pick.', 'allterrain-work' ),
				'icon'           => 'dashicons-clipboard',
				'script'         => 'allterrain-work-widget',
				'movable'        => true,
				'resizable'      => true,
				'min_width'      => 260,
				'min_height'     => 200,
				'default_width'  => 320,
				'default_height' => 360,
				'capabilities'   => array( 'edit_posts' ),
			)
		);
	}

	if ( atwork_shell_has( 'register_command' ) ) {
		atwork_shell_call(
			'register_command',
			array(
				'slug'        => 'allterrain-work',
				'label'       => __( 'Work: open the board', 'allterrain-work' ),
				'description' => __( 'Projects and tasks on a drag-and-drop board.', 'allterrain-work' ),
				'icon'        => 'dashicons-clipboard',
				'script'      => 'allterrain-work-board',
			)
		);
	}
}

/**
 * Emits the window's body markup.
 *
 * The shell clones this into the window before calling the JavaScript render
 * callback, so the callback enhances existing markup rather than building from
 * nothing -- which means the window paints a toolbar and a loading state
 * immediately instead of flashing empty while the bundle boots.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_render_window_template() {
	?>
	<div class="atwork" data-atwork-root data-host="window">
		<div class="atwork__toolbar" data-atwork-toolbar>
			<os-spinner preset="inline"></os-spinner>
			<span class="atwork__loading"><?php esc_html_e( 'Loading your board…', 'allterrain-work' ); ?></span>
		</div>
		<div class="atwork__board" data-atwork-board></div>
	</div>
	<?php
}

/**
 * Loads the board bundle into the shell.
 *
 * `openstation_mode_init` fires while the shell is rendering, which is the
 * documented place for a plugin to enqueue shell-level code. Naming the handle
 * on the window registration is not enough on its own: the shell enqueues the
 * handle but never runs this plugin's `wp_add_inline_script()`, so the bundle
 * would boot with no `window.allTerrainWork` to read.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_enqueue_in_shell() {
	if ( ! current_user_can( 'edit_posts' ) ) {
		return;
	}

	wp_enqueue_script( 'allterrain-work-config' );
	wp_enqueue_style( 'allterrain-work' );
}

/**
 * Puts the stylesheet on shell pages before anything renders.
 *
 * Separate from the enqueue above because the *widget* also needs this CSS, and
 * the widget's bundle loads lazily -- possibly after first paint. Registering
 * the style on the widget would not help: the shell injects a stylesheet link
 * for a window's `style` handle, but a widget card that mounts before its CSS
 * arrives renders as unstyled text for a frame. Eager on every shell page is a
 * few hundred bytes and no flash.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_enqueue_shell_styles() {
	if ( ! atwork_shell_is_active() || atwork_shell_is_chromeless() ) {
		return;
	}

	if ( ! current_user_can( 'edit_posts' ) ) {
		return;
	}

	wp_enqueue_style( 'allterrain-work' );
	wp_enqueue_script( 'allterrain-work-config' );
}

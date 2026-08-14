<?php
/**
 * Script and style handles.
 *
 * Two bundles, because they load on different schedules. The board bundle is a
 * native window's `script` -- the shell loads it eagerly at boot or lazily on
 * mid-session activation. The widget bundle is loaded by the shell only when the
 * widget is actually on someone's desktop or the picker is open, so it must be
 * *registered* and never enqueued: `wp_enqueue_script()` here would put it on
 * every admin page for every user, including the ones who never added it.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', 'atwork_register_assets', 5 );

/**
 * Registers every handle.
 *
 * On `init` at 5 so the registrations in `openstation.php` -- which name these
 * handles -- can rely on them existing when they run at 20.
 *
 * @since 0.1.0
 *
 * @return void
 */
function atwork_register_assets() {
	$suffix = atwork_asset_suffix();

	// Registered first, and named as a dependency by every bundle that reads
	// it. A `false` src is WordPress's supported way to ship inline-only JS: a
	// real handle, with nothing to fetch.
	//
	// Being a *dependency* rather than merely enqueued alongside is what makes
	// it reliable. Enqueue order is not execution order once other plugins and
	// the shell are enqueueing too, and a bundle that runs before its config
	// reads `undefined` and silently does nothing — which is exactly how the
	// Explorer decorations came to register their hooks and then decline to
	// decorate anything.
	//
	// It also has to be attached here rather than lazily, because the widget
	// bundle is loaded by the shell long after `wp_print_scripts()` has run.
	wp_register_script( 'allterrain-work-config', false, array(), ATWORK_VERSION, true );
	atwork_print_config( 'allterrain-work-config' );

	wp_register_style(
		'allterrain-work',
		ATWORK_URL . 'assets/css/allterrain-work.css',
		array(),
		atwork_asset_version( 'assets/css/allterrain-work.css' )
	);

	wp_register_script(
		'allterrain-work-board',
		ATWORK_URL . "assets/js/board{$suffix}.js",
		array( 'allterrain-work-config' ),
		atwork_asset_version( "assets/js/board{$suffix}.js" ),
		true
	);

	wp_register_script(
		'allterrain-work-widget',
		ATWORK_URL . "assets/js/widget{$suffix}.js",
		array( 'allterrain-work-config' ),
		atwork_asset_version( "assets/js/widget{$suffix}.js" ),
		true
	);

	wp_register_script(
		'allterrain-work-explorer',
		ATWORK_URL . "assets/js/explorer{$suffix}.js",
		array( 'wp-hooks', 'allterrain-work-config' ),
		atwork_asset_version( "assets/js/explorer{$suffix}.js" ),
		true
	);

	wp_register_script(
		'allterrain-work-editor',
		ATWORK_URL . "assets/js/editor{$suffix}.js",
		// The panel is written against the editor globals rather than importing
		// the packages, so these are real load-order dependencies: without them
		// `wp.plugins` and `wp.editor` may not exist when the bundle runs.
		array( 'wp-element', 'wp-data', 'wp-plugins', 'wp-components', 'wp-i18n', 'wp-editor' ),
		atwork_asset_version( "assets/js/editor{$suffix}.js" ),
		true
	);
}

/**
 * The cache-busting version for one asset.
 *
 * `ATWORK_VERSION` alone is right for a release and actively wrong during
 * development: the plugin version does not change between rebuilds, so the URL
 * does not change either, and the browser keeps serving the bundle it cached
 * before the last `npm run build`. The symptom is the worst kind -- code that
 * is provably correct on disk and provably absent in the page, which sends you
 * looking for the bug anywhere except the cache.
 *
 * So under `WP_DEBUG` or `SCRIPT_DEBUG` the file's modification time is the
 * version. In production the plugin version is, because that is the value that
 * changes exactly when the bytes do and costs no `stat()` per asset per request.
 *
 * @since 0.1.0
 *
 * @param string $relative_path Path under the plugin directory.
 * @return string Version string.
 */
function atwork_asset_version( $relative_path ) {
	$developing = ( defined( 'WP_DEBUG' ) && WP_DEBUG ) || ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG );

	if ( ! $developing ) {
		return ATWORK_VERSION;
	}

	$file = ATWORK_DIR . ltrim( $relative_path, '/' );

	// A missing file is a build that has not run. Falling back to the plugin
	// version keeps the handle registered so the failure shows up as a 404 for
	// the asset rather than a handle nothing can depend on.
	if ( ! file_exists( $file ) ) {
		return ATWORK_VERSION;
	}

	return (string) filemtime( $file );
}

/**
 * `.min` unless the site asked for readable sources.
 *
 * @since 0.1.0
 *
 * @return string Either `.min` or an empty string.
 */
function atwork_asset_suffix() {
	return ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
}

/**
 * The configuration both bundles need.
 *
 * REST root and nonce, plus what the board would otherwise have to make a
 * request to learn. Reaches the page as `window.allTerrainWork` in every host --
 * the shell, a chromeless iframe, the standalone admin page -- so the bundle
 * never has to know which one it woke up in.
 *
 * @since 0.1.0
 *
 * @return array Configuration blob.
 */
function atwork_script_config() {
	$config = array(
		'restUrl'     => esc_url_raw( rest_url( ATWORK_REST_NAMESPACE ) ),
		'wpRestUrl'   => esc_url_raw( rest_url( 'wp/v2' ) ),
		'nonce'       => wp_create_nonce( 'wp_rest' ),
		'adminUrl'    => esc_url_raw( admin_url() ),
		'newTaskUrl'  => esc_url_raw( admin_url( 'post-new.php?post_type=' . ATWORK_TASK_TYPE ) ),
		'priorities'  => atwork_priorities(),
		// The bundle must not guess this: it is the taxonomy's `rest_base`,
		// not its slug, and the two differ here.
		'statusField' => atwork_status_rest_field(),
		// The columns themselves, not just their field name. WP Explorer asks
		// its banding filter for the band list *synchronously*, while it sets
		// the section up — so a bundle that has to fetch the statuses first has
		// already missed the question by the time it can answer, and the grid
		// renders unbanded. PHP knows them at render time for free; shipping
		// them removes the race rather than timing it.
		'statuses'    => atwork_get_statuses(),
		'canCreate'   => current_user_can( 'edit_posts' ),
		'viewerId'    => get_current_user_id(),
		'version'     => ATWORK_VERSION,
	);

	/**
	 * Filters the configuration handed to the board and widget bundles.
	 *
	 * @since 0.1.0
	 *
	 * @param array $config Configuration blob.
	 */
	return apply_filters( 'atwork_script_config', $config );
}

/**
 * Prints the configuration as a global, for hosts that cannot use the shell's
 * `config` argument.
 *
 * @since 0.1.0
 *
 * @param string $handle Script handle to attach it to.
 * @return void
 */
function atwork_print_config( $handle ) {
	wp_add_inline_script(
		$handle,
		'window.allTerrainWork = ' . wp_json_encode( atwork_script_config() ) . ';',
		'before'
	);
}

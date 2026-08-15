<?php
/**
 * What the plugin asks OpenStation for.
 *
 * The shell is stubbed in `bootstrap.php` and records its arguments, so these
 * assertions are about the *contract* — the ids other things reference, the
 * capability gates, the handles the shell will try to enqueue — without a shell
 * being installed.
 *
 * The ids matter beyond this plugin: the desktop icon points at the window by
 * id, and the widget's id is the localStorage key its users' project picks live
 * under. Renaming either silently resets everybody, so both are pinned.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_OpenStationRegistration extends WP_UnitTestCase {

	/**
	 * Everything the stubs recorded.
	 *
	 * @var array
	 */
	protected $registrations;

	public function set_up() {
		parent::set_up();

		// Registration happens on `init`, which the suite has already run by
		// the time a test method executes.
		$this->registrations = $GLOBALS['atwork_shell_registrations'];
	}

	/**
	 * @covers ::atwork_register_shell_surfaces
	 */
	public function test_the_board_registers_as_a_native_window() {
		$this->assertArrayHasKey( 'allterrain-work', $this->registrations['window'] );

		$window = $this->registrations['window']['allterrain-work'];

		$this->assertSame( 'allterrain-work-board', $window['script'] );
		$this->assertSame( 'allterrain-work', $window['style'] );
		$this->assertSame( array( 'edit_posts' ), $window['capabilities'] );
		$this->assertIsCallable( $window['template'] );
	}

	/**
	 * A window narrower than its own columns is a window you cannot use. Three
	 * 260px columns plus gutters is the floor.
	 *
	 * @covers ::atwork_register_shell_surfaces
	 */
	public function test_the_window_cannot_be_resized_below_a_usable_board() {
		$window = $this->registrations['window']['allterrain-work'];

		$this->assertGreaterThanOrEqual( 600, $window['min_width'] );
		$this->assertGreaterThanOrEqual( $window['min_width'], $window['width'] );
		$this->assertGreaterThanOrEqual( $window['min_height'], $window['height'] );
	}

	/**
	 * @covers ::atwork_register_shell_surfaces
	 */
	public function test_the_desktop_icon_points_at_the_window() {
		$this->assertArrayHasKey( 'allterrain-work', $this->registrations['icon'] );

		$icon = $this->registrations['icon']['allterrain-work'];

		$this->assertSame( 'allterrain-work', $icon['window'] );
		$this->assertArrayHasKey( 'allterrain-work', $this->registrations['window'] );
	}

	/**
	 * @covers ::atwork_register_shell_surfaces
	 */
	public function test_the_widget_registers_with_a_stable_id() {
		// The localStorage key for every user's project picks is derived from
		// this id. Renaming it resets everybody's filter silently.
		$this->assertArrayHasKey( 'allterrain-work/my-work', $this->registrations['widget'] );

		$widget = $this->registrations['widget']['allterrain-work/my-work'];

		$this->assertSame( 'allterrain-work-widget', $widget['script'] );
		$this->assertSame( array( 'edit_posts' ), $widget['capabilities'] );
		$this->assertTrue( $widget['movable'] );
		$this->assertTrue( $widget['resizable'] );
	}

	/**
	 * Every handle the shell is told to enqueue has to exist, or the shell
	 * enqueues nothing and the window opens to an empty body.
	 *
	 * @covers ::atwork_register_assets
	 */
	public function test_every_named_handle_is_actually_registered() {
		// The shell resolves handles at render time, which is a front-end
		// context in this suite; register them explicitly first.
		atwork_register_assets();

		$scripts = wp_scripts();
		$styles  = wp_styles();

		$this->assertTrue( $scripts->query( 'allterrain-work-board', 'registered' ) !== false );
		$this->assertTrue( $scripts->query( 'allterrain-work-widget', 'registered' ) !== false );
		$this->assertTrue( $scripts->query( 'allterrain-work-config', 'registered' ) !== false );
		$this->assertTrue( $styles->query( 'allterrain-work', 'registered' ) !== false );
	}

	/**
	 * Every bundle that reads the config must *depend* on it.
	 *
	 * Merely enqueueing the two together is not enough: enqueue order is not
	 * execution order once the shell and other plugins are enqueueing too, and a
	 * bundle that runs before its config reads `undefined` and silently does
	 * nothing. That is exactly how the Explorer decorations came to register
	 * their hooks and then decline to decorate anything — no error, no clue.
	 *
	 * @covers ::atwork_register_assets
	 */
	public function test_every_bundle_depends_on_the_config_it_reads() {
		atwork_register_assets();

		$scripts = wp_scripts();

		foreach ( array( 'allterrain-work-board', 'allterrain-work-widget', 'allterrain-work-explorer' ) as $handle ) {
			$script = $scripts->query( $handle, 'registered' );

			$this->assertNotFalse( $script, "{$handle} is not registered." );
			$this->assertContains(
				'allterrain-work-config',
				$script->deps,
				"{$handle} reads window.allTerrainWork but does not depend on it."
			);
		}
	}

	/**
	 * The Explorer's banding needs the columns on the page, not a fetch away.
	 *
	 * WP Explorer asks its banding filter for the band list *synchronously*
	 * while it sets a section up, so a bundle that has to fetch the statuses
	 * first has missed the question by the time it can answer.
	 *
	 * @covers ::atwork_script_config
	 */
	public function test_the_config_carries_the_columns_the_grid_bands_by() {
		atwork_seed_statuses();

		$config = atwork_script_config();

		$this->assertNotEmpty( $config['statuses'] );
		$this->assertSame( atwork_get_statuses(), $config['statuses'] );
		$this->assertArrayHasKey( 'name', $config['statuses'][0] );
		$this->assertArrayHasKey( 'color', $config['statuses'][0] );
	}

	/**
	 * Assets must cache-bust on every rebuild while developing.
	 *
	 * `ATWORK_VERSION` does not change between builds, so a fixed version means
	 * the browser keeps serving the bundle it cached before the last build. The
	 * symptom is the worst kind to debug: code provably correct on disk and
	 * provably absent from the page.
	 *
	 * @covers ::atwork_asset_version
	 */
	public function test_assets_cache_bust_on_rebuild_while_developing() {
		$version = atwork_asset_version( 'assets/css/allterrain-work.css' );

		if ( ( defined( 'WP_DEBUG' ) && WP_DEBUG ) || ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ) {
			$this->assertNotSame(
				ATWORK_VERSION,
				$version,
				'While developing the version must follow the file, not the plugin.'
			);
			$this->assertSame(
				(string) filemtime( ATWORK_DIR . 'assets/css/allterrain-work.css' ),
				$version
			);
		} else {
			$this->assertSame( ATWORK_VERSION, $version );
		}
	}

	/**
	 * A build that never ran must still leave a registered handle, so the
	 * failure surfaces as a 404 for the asset rather than a handle nothing can
	 * depend on.
	 *
	 * @covers ::atwork_asset_version
	 */
	public function test_a_missing_asset_still_yields_a_version() {
		$this->assertSame( ATWORK_VERSION, atwork_asset_version( 'assets/js/never-built.js' ) );
	}

	/**
	 * The config carries a REST nonce and the namespace root, which is the
	 * minimum a bundle needs to make an authenticated request.
	 *
	 * @covers ::atwork_script_config
	 */
	public function test_the_script_config_carries_what_a_bundle_needs() {
		$config = atwork_script_config();

		$this->assertStringContainsString( ATWORK_REST_NAMESPACE, $config['restUrl'] );
		$this->assertNotEmpty( $config['nonce'] );
		$this->assertSame( atwork_priorities(), $config['priorities'] );
	}

	/**
	 * The window template is what the shell clones into the body before the
	 * bundle boots, so it has to carry the hooks `src/index.ts` looks for.
	 * A template that lost `data-atwork-root` mounts the board nowhere.
	 *
	 * @covers ::atwork_render_window_template
	 */
	public function test_the_window_template_carries_the_mount_points() {
		ob_start();
		atwork_render_window_template();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'data-atwork-root', $html );
		$this->assertStringContainsString( 'data-atwork-toolbar', $html );
		$this->assertStringContainsString( 'data-atwork-board', $html );
	}

	/**
	 * The shell is a per-user preference, so "installed" and "switched on" are
	 * two questions and the plugin has to ask both.
	 *
	 * @covers ::atwork_shell_is_active
	 * @covers ::atwork_shell_function
	 */
	public function test_shell_detection_resolves_either_spelling() {
		// The stubs define the `openstation_` spelling; the older
		// `desktop_mode_` one is what a site mid-upgrade has.
		$this->assertSame( 'openstation_register_window', atwork_shell_function( 'register_window' ) );
		$this->assertTrue( atwork_shell_has( 'is_enabled' ) );
		$this->assertTrue( atwork_shell_is_active() );

		// A capability no shell provides must resolve to nothing rather than
		// to a name that would fatal when called.
		$this->assertSame( '', atwork_shell_function( 'a_function_no_shell_has' ) );
		$this->assertFalse( atwork_shell_has( 'a_function_no_shell_has' ) );
		$this->assertNull( atwork_shell_call( 'a_function_no_shell_has' ) );
	}

	/**
	 * The dependency is declared where WordPress reads it.
	 *
	 * The slug is the whole risk here. `Requires Plugins` matches on the
	 * dependency's directory slug, and OpenStation ships from `desktop-mode` --
	 * naming it `openstation` would point at a plugin that does not exist, and
	 * an unmet dependency blocks activation outright. So this pins the exact
	 * string rather than merely asserting the header is present.
	 *
	 * @covers ::atwork_missing_shell_notice
	 */
	public function test_openstation_is_declared_as_a_dependency() {
		$plugin = get_plugin_data( ATWORK_FILE, false, false );

		$this->assertArrayHasKey( 'RequiresPlugins', $plugin );
		$this->assertSame( 'desktop-mode', $plugin['RequiresPlugins'] );
	}

	/**
	 * With a shell present there is nothing to warn about, and a standing
	 * banner nobody needs is a banner people learn to scroll past.
	 *
	 * @covers ::atwork_missing_shell_notice
	 */
	public function test_no_dependency_notice_while_the_shell_is_there() {
		set_current_screen( 'plugins' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		ob_start();
		atwork_missing_shell_notice();

		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * Nobody who cannot act on it should be shown it.
	 *
	 * @covers ::atwork_missing_shell_notice
	 */
	public function test_the_dependency_notice_is_for_people_who_can_fix_it() {
		set_current_screen( 'plugins' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		ob_start();
		atwork_missing_shell_notice();

		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * Hides the shell, the only way a `function_exists()` check can be hidden.
	 *
	 * @return callable The filter, so it can be removed again.
	 */
	private function without_a_shell() {
		$off = static function () {
			return '';
		};

		add_filter( 'atwork_shell_function', $off, 10, 1 );

		return $off;
	}

	/**
	 * The behaviour the whole dependency declaration exists for.
	 *
	 * @covers ::atwork_missing_shell_notice
	 */
	public function test_the_notice_names_the_dependency_when_the_shell_is_gone() {
		set_current_screen( 'plugins' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$off = $this->without_a_shell();

		ob_start();
		atwork_missing_shell_notice();
		$html = ob_get_clean();

		remove_filter( 'atwork_shell_function', $off, 10 );

		$this->assertStringContainsString( 'OpenStation', $html );
		$this->assertStringContainsString( 'notice-warning', $html );

		// It must say the work is still there. A warning that reads as data
		// loss is worse than no warning.
		$this->assertStringContainsString( 'safe', $html );
	}

	/**
	 * A standing condition, not news, so it belongs on the screens where
	 * somebody is already dealing with plugins -- not on every admin page.
	 *
	 * @covers ::atwork_missing_shell_notice
	 */
	public function test_the_notice_stays_off_unrelated_screens() {
		set_current_screen( 'edit-post' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$off = $this->without_a_shell();

		ob_start();
		atwork_missing_shell_notice();
		$html = ob_get_clean();

		remove_filter( 'atwork_shell_function', $off, 10 );

		$this->assertSame( '', $html );
	}

	/**
	 * The filter is load-bearing for every other no-shell path too, so pin that
	 * it actually reaches the resolver rather than only the notice.
	 *
	 * @covers ::atwork_shell_function
	 */
	public function test_the_shell_resolver_is_filterable() {
		$off = $this->without_a_shell();

		$this->assertSame( '', atwork_shell_function( 'register_window' ) );
		$this->assertFalse( atwork_shell_has( 'register_window' ) );
		$this->assertNull( atwork_shell_call( 'register_window', 'x' ) );

		remove_filter( 'atwork_shell_function', $off, 10 );

		// And back, so the filter is doing the hiding rather than something
		// else having gone missing.
		$this->assertSame( 'openstation_register_window', atwork_shell_function( 'register_window' ) );
	}
}

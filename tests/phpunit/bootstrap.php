<?php
/**
 * PHPUnit bootstrap.
 *
 * Locates a WordPress test library, then loads AllTerrain Work as a must-use
 * plugin so its hooks are registered before the suite's own `init` runs.
 *
 * The shell's registration functions are stubbed here rather than installed.
 * That is deliberate on both counts: these tests are about *this* plugin's PHP,
 * and the plugin checks for a *capability* -- do the functions I am about to
 * call exist -- rather than for a plugin slug, so satisfying the check honestly
 * means defining them. The stubs record what they were handed, which is what
 * lets `openStationRegistration.php` assert the arguments the shell would
 * receive without a shell being present.
 *
 * Point WP_TESTS_DIR (or WP_PHPUNIT__DIR) at a WordPress develop checkout's
 * tests/phpunit directory before running.
 *
 * @package AllTerrain_Work
 */

$atwork_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $atwork_tests_dir ) {
	$atwork_tests_dir = getenv( 'WP_PHPUNIT__DIR' );
}

if ( ! $atwork_tests_dir ) {
	// Conventional locations: wp-env's tests container, then the classic
	// install script's.
	foreach ( array( '/wordpress-phpunit', '/tmp/wordpress-tests-lib' ) as $atwork_candidate ) {
		if ( file_exists( $atwork_candidate . '/includes/functions.php' ) ) {
			$atwork_tests_dir = $atwork_candidate;
			break;
		}
	}
}

if ( ! $atwork_tests_dir || ! file_exists( $atwork_tests_dir . '/includes/functions.php' ) ) {
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- WordPress is not loaded yet, so WP_Filesystem does not exist; this is a CLI diagnostic on STDERR.
	fwrite(
		STDERR,
		"Could not find the WordPress test library.\n" .
		"Set WP_TESTS_DIR to a WordPress develop checkout's tests/phpunit directory, e.g.\n\n" .
		"  WP_TESTS_DIR=../wordpress-develop/tests/phpunit npm run test:php\n\n"
	);
	exit( 1 );
}

require_once $atwork_tests_dir . '/includes/functions.php';

/**
 * Everything the stubs were asked to register, by surface.
 *
 * A global rather than a static because the stubs are plain functions
 * impersonating another plugin's API and cannot carry state any other way.
 *
 * @var array<string, array<int, array>>
 */
$GLOBALS['atwork_shell_registrations'] = array(
	'window'  => array(),
	'icon'    => array(),
	'widget'  => array(),
	'command' => array(),
);

/**
 * Every content change the plugin asked the shell to relay.
 *
 * @var array<int, array{type: string, id: int, action: string}>
 */
$GLOBALS['atwork_content_changes'] = array();

/*
 * Stand-ins for the parts of OpenStation this plugin talks to.
 *
 * Declared at file scope so they exist before the plugin loads, and deliberately
 * unprefixed: they impersonate another plugin's public API, and prefixing them
 * would defeat the entire point.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
 */

if ( ! function_exists( 'openstation_register_window' ) ) {
	/**
	 * Records a native window registration.
	 *
	 * @param string $id   Window id.
	 * @param array  $args Window arguments.
	 * @return bool Always true.
	 */
	function openstation_register_window( $id, $args = array() ) {
		$GLOBALS['atwork_shell_registrations']['window'][ $id ] = $args;

		return true;
	}
}

if ( ! function_exists( 'openstation_register_icon' ) ) {
	/**
	 * Records a desktop icon registration.
	 *
	 * @param string $id   Icon id.
	 * @param array  $args Icon arguments.
	 * @return bool Always true.
	 */
	function openstation_register_icon( $id, $args = array() ) {
		$GLOBALS['atwork_shell_registrations']['icon'][ $id ] = $args;

		return true;
	}
}

if ( ! function_exists( 'openstation_register_widget' ) ) {
	/**
	 * Records a desktop widget registration.
	 *
	 * @param string $id   Widget id.
	 * @param array  $args Widget arguments.
	 * @return bool Always true.
	 */
	function openstation_register_widget( $id, $args = array() ) {
		$GLOBALS['atwork_shell_registrations']['widget'][ $id ] = $args;

		return true;
	}
}

if ( ! function_exists( 'openstation_register_command' ) ) {
	/**
	 * Records a command-palette registration.
	 *
	 * @param array $args Command arguments.
	 * @return bool Always true.
	 */
	function openstation_register_command( $args = array() ) {
		$GLOBALS['atwork_shell_registrations']['command'][] = $args;

		return true;
	}
}

if ( ! function_exists( 'openstation_content_changes_record' ) ) {
	/**
	 * Records a content change into the realtime changelog.
	 *
	 * Reproduces the two parts of the real function's contract the plugin can
	 * observe: the `openstation_content_changes_should_record` veto filter, and
	 * first-writer-wins dedupe per `type:id` within a request. Both matter to a
	 * caller -- a plugin that records the same id twice expecting two entries is
	 * wrong about the real API, and a stub that accepted it would hide that.
	 *
	 * @param string $type   Content type slug.
	 * @param int    $id     Object id.
	 * @param string $action Verb.
	 * @return bool Whether it was recorded.
	 */
	function openstation_content_changes_record( $type, $id, $action ) {
		if ( '' === (string) $type || (int) $id <= 0 || '' === (string) $action ) {
			return false;
		}

		if ( ! apply_filters( 'openstation_content_changes_should_record', true, $type, (int) $id, $action ) ) {
			return false;
		}

		foreach ( $GLOBALS['atwork_content_changes'] as $entry ) {
			if ( $entry['type'] === $type && $entry['id'] === (int) $id ) {
				return false;
			}
		}

		$GLOBALS['atwork_content_changes'][] = array(
			'type'   => (string) $type,
			'id'     => (int) $id,
			'action' => (string) $action,
		);

		return true;
	}
}

if ( ! function_exists( 'openstation_is_enabled' ) ) {
	/**
	 * Whether the current user has the desktop switched on.
	 *
	 * True in tests, so the entry points that only appear inside the shell are
	 * exercised rather than skipped.
	 *
	 * @return bool Always true.
	 */
	function openstation_is_enabled() {
		return true;
	}
}

// phpcs:enable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound

/**
 * Loads the plugin under test.
 *
 * @return void
 */
function atwork_manually_load_plugin() {
	require dirname( __DIR__, 2 ) . '/allterrain-work.php';
}

tests_add_filter( 'muplugins_loaded', 'atwork_manually_load_plugin' );

require $atwork_tests_dir . '/includes/bootstrap.php';

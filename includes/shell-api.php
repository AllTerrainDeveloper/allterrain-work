<?php
/**
 * Naming the shell.
 *
 * The desktop shell was called Desktop Mode and is now called OpenStation, and
 * the rename went all the way down: `desktop_mode_register_window()` became
 * `openstation_register_window()`, and every hook and constant with it.
 * AllTerrain Work ships to sites running either version and cannot know which,
 * so it asks for a capability by its bare name and this file resolves the
 * spelling.
 *
 * Deliberately a lookup rather than a version check. A site mid-upgrade, a fork,
 * or a shell that renames itself again all degrade to "no desktop integration"
 * instead of a fatal error on every request -- which is the same promise the
 * rest of this plugin makes to sites with no shell at all.
 *
 * @package AllTerrain_Work
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prefixes to try, current first.
 *
 * @since 0.1.0
 */
const ATWORK_SHELL_PREFIXES = array( 'openstation_', 'desktop_mode_' );

/**
 * Resolves a shell function to whichever name this install has.
 *
 * @since 0.1.0
 *
 * @param string $name Bare function name, e.g. `register_window`.
 * @return string The callable name, or an empty string when no shell provides it.
 */
function atwork_shell_function( $name ) {
	foreach ( ATWORK_SHELL_PREFIXES as $prefix ) {
		if ( function_exists( $prefix . $name ) ) {
			return $prefix . $name;
		}
	}

	return '';
}

/**
 * Whether the shell offers a capability at all.
 *
 * @since 0.1.0
 *
 * @param string $name Bare function name.
 * @return bool True when some spelling of it exists.
 */
function atwork_shell_has( $name ) {
	return '' !== atwork_shell_function( $name );
}

/**
 * Calls a shell function by its bare name.
 *
 * @since 0.1.0
 *
 * @param string $name    Bare function name.
 * @param mixed  ...$args Arguments to pass through.
 * @return mixed The return value, or null when no shell provides it.
 */
function atwork_shell_call( $name, ...$args ) {
	$fn = atwork_shell_function( $name );

	return $fn ? call_user_func_array( $fn, $args ) : null;
}

/**
 * Every spelling of a shell hook.
 *
 * Returned as a list so callers can register against all of them. A listener for
 * a hook that never fires costs nothing, and it is far cheaper than deciding at
 * boot which shell is present -- the answer can change between `plugins_loaded`
 * and the hook actually firing.
 *
 * @since 0.1.0
 *
 * @param string $name Bare hook name, e.g. `mode_init`.
 * @return string[] Hook names.
 */
function atwork_shell_hooks( $name ) {
	$hooks = array();

	foreach ( ATWORK_SHELL_PREFIXES as $prefix ) {
		$hooks[] = $prefix . $name;
	}

	return $hooks;
}

/**
 * Determines whether the shell is installed *and* switched on for this user.
 *
 * Two separate questions, and both matter. `atwork_shell_has()` answers "is the
 * plugin active"; `openstation_is_enabled()` answers "has this particular user
 * opted in", since the shell is a per-user preference rather than a site-wide
 * one. Only when both hold should AllTerrain Work present itself as a desktop
 * app rather than as an admin page.
 *
 * @since 0.1.0
 *
 * @return bool True when the desktop shell is active for the current user.
 */
function atwork_shell_is_active() {
	if ( ! atwork_shell_has( 'register_window' ) || ! atwork_shell_has( 'is_enabled' ) ) {
		return false;
	}

	return (bool) atwork_shell_call( 'is_enabled' );
}

/**
 * Whether the current request is an admin page rendering inside a shell window.
 *
 * Chromeless requests are admin pages loaded inside a window iframe with the
 * admin bar and menu suppressed. The board is a *native* window, so it never
 * takes this path itself -- but the standalone admin page does, when a user
 * reaches it through the shell's own menu, and it drops its page heading there.
 *
 * @since 0.1.0
 *
 * @return bool True when rendering inside a shell window iframe.
 */
function atwork_shell_is_chromeless() {
	if ( ! atwork_shell_has( 'is_chromeless_request' ) ) {
		return false;
	}

	return (bool) atwork_shell_call( 'is_chromeless_request' );
}

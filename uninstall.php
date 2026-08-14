<?php
/**
 * Uninstall.
 *
 * Deleting a plugin should not delete somebody's work. A project and a task are
 * *posts*: they are in the trash, in search, in revisions, in exports, and a
 * site that removes this plugin to try a different work tracker still wants its
 * three hundred tasks afterwards. So the content stays, and this file removes
 * only what has no meaning without the plugin.
 *
 * The post types stop being registered the moment the plugin goes, which makes
 * the posts invisible in wp-admin -- not gone. Reinstalling brings every one of
 * them back exactly where it was, including its column and its position in it.
 *
 * @package AllTerrain_Work
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Options this plugin owns.
 *
 * None yet -- preferences live in user meta and in `localStorage`. The loop
 * stays because the day one is added, the person adding it will look here.
 */
$atwork_options = array();

foreach ( $atwork_options as $atwork_option ) {
	delete_option( $atwork_option );

	if ( is_multisite() ) {
		delete_site_option( $atwork_option );
	}
}

unset( $atwork_options, $atwork_option );

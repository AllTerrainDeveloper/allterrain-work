<?php
/**
 * Registration of the post types, the taxonomy and their meta.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_ContentTypes extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();

		// `WP_UnitTestCase::tear_down()` unregisters every meta key the suite
		// has seen, so the registration this plugin does once on `init` is gone
		// by the second test in the run. Re-registering here is a harness
		// workaround, not a plugin requirement.
		atwork_register_content_types();
	}

	/**
	 * @covers ::atwork_register_content_types
	 */
	public function test_post_types_are_registered() {
		$this->assertTrue( post_type_exists( ATWORK_PROJECT_TYPE ) );
		$this->assertTrue( post_type_exists( ATWORK_TASK_TYPE ) );
	}

	/**
	 * Post type keys are capped at 20 characters by `register_post_type()`.
	 *
	 * The reason the prefix is `atwork-` rather than the `allterrain-work-`
	 * the project was sketched with: `allterrain-work-project` is 23
	 * characters and would fail registration outright, leaving a plugin whose
	 * every screen 404s. Pinned so a future rename cannot reintroduce it.
	 *
	 * @covers ::atwork_register_content_types
	 */
	public function test_post_type_keys_fit_the_core_limit() {
		$this->assertLessThanOrEqual( 20, strlen( ATWORK_PROJECT_TYPE ) );
		$this->assertLessThanOrEqual( 20, strlen( ATWORK_TASK_TYPE ) );
	}

	/**
	 * @covers ::atwork_register_content_types
	 */
	public function test_status_taxonomy_is_registered_for_tasks() {
		$this->assertTrue( taxonomy_exists( ATWORK_STATUS_TAX ) );
		$this->assertContains( ATWORK_STATUS_TAX, get_object_taxonomies( ATWORK_TASK_TYPE ) );
	}

	/**
	 * Core REST has to reach both types, because it is how anything that has
	 * never heard of this plugin's own routes still creates a task.
	 *
	 * @covers ::atwork_register_content_types
	 */
	public function test_types_are_exposed_to_the_rest_api() {
		$this->assertTrue( get_post_type_object( ATWORK_TASK_TYPE )->show_in_rest );
		$this->assertTrue( get_post_type_object( ATWORK_PROJECT_TYPE )->show_in_rest );
		$this->assertTrue( get_taxonomy( ATWORK_STATUS_TAX )->show_in_rest );
	}

	/**
	 * @covers ::atwork_register_task_meta
	 */
	public function test_task_meta_is_registered_and_rest_visible() {
		$registered = get_registered_meta_keys( 'post', ATWORK_TASK_TYPE );

		foreach ( array( ATWORK_META_PROJECT, ATWORK_META_OWNER, ATWORK_META_DUE, ATWORK_META_PRIORITY ) as $key ) {
			$this->assertArrayHasKey( $key, $registered, "{$key} is not registered." );
			$this->assertTrue( $registered[ $key ]['show_in_rest'], "{$key} is not exposed to REST." );
			$this->assertTrue( $registered[ $key ]['single'], "{$key} should be single." );
		}
	}

	/**
	 * A task in two columns is drawn twice, and dragging one copy leaves the
	 * other behind — the board then disagrees with itself about where the work
	 * is. The board can only ever send one term; core REST, an importer and
	 * `wp_set_object_terms()` in someone else's plugin can all send several,
	 * so the guarantee has to live in the hook rather than in the client.
	 *
	 * @covers ::atwork_enforce_single_status
	 */
	public function test_a_task_ends_up_in_exactly_one_status() {
		atwork_seed_statuses();

		$first  = get_term_by( 'slug', 'not-started', ATWORK_STATUS_TAX );
		$second = get_term_by( 'slug', 'done', ATWORK_STATUS_TAX );
		$task   = self::factory()->post->create( array( 'post_type' => ATWORK_TASK_TYPE ) );

		wp_set_object_terms( $task, array( $first->term_id, $second->term_id ), ATWORK_STATUS_TAX, false );

		$terms = wp_get_object_terms( $task, ATWORK_STATUS_TAX, array( 'fields' => 'ids' ) );

		$this->assertCount( 1, $terms );
		// Last one wins, which is what a caller appending to an array means.
		$this->assertSame( (int) $second->term_id, (int) $terms[0] );
	}

	/**
	 * @covers ::atwork_enforce_single_status
	 */
	public function test_a_single_status_is_left_alone() {
		atwork_seed_statuses();

		$status = get_term_by( 'slug', 'working-on-it', ATWORK_STATUS_TAX );
		$task   = self::factory()->post->create( array( 'post_type' => ATWORK_TASK_TYPE ) );

		wp_set_object_terms( $task, array( $status->term_id ), ATWORK_STATUS_TAX, false );

		$terms = wp_get_object_terms( $task, ATWORK_STATUS_TAX, array( 'fields' => 'ids' ) );

		$this->assertSame( array( (int) $status->term_id ), array_map( 'intval', $terms ) );
	}

	/**
	 * @covers ::atwork_seed_statuses
	 */
	public function test_seeding_creates_the_default_columns_with_colours() {
		atwork_seed_statuses();

		$terms = get_terms(
			array(
				'taxonomy'   => ATWORK_STATUS_TAX,
				'hide_empty' => false,
			)
		);

		$this->assertCount( 4, $terms );

		$done = get_term_by( 'slug', 'done', ATWORK_STATUS_TAX );

		$this->assertSame( '#00c875', get_term_meta( $done->term_id, ATWORK_TERM_COLOR, true ) );
		$this->assertSame( '40', get_term_meta( $done->term_id, ATWORK_TERM_ORDER, true ) );
	}

	/**
	 * Seeding twice must not double the columns. A user who deleted a status
	 * has said something, and a second activation should not say it back.
	 *
	 * @covers ::atwork_seed_statuses
	 */
	public function test_seeding_is_idempotent() {
		atwork_seed_statuses();
		atwork_seed_statuses();

		$terms = get_terms(
			array(
				'taxonomy'   => ATWORK_STATUS_TAX,
				'hide_empty' => false,
				'fields'     => 'ids',
			)
		);

		$this->assertCount( 4, $terms );
	}
}

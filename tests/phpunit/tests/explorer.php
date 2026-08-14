<?php
/**
 * WP Explorer integration.
 *
 * The Explorer browses `show_ui` post types on its own, so the risk here is not
 * that the sections fail to appear — it is that they appear uselessly: two loose
 * folders of tiles reading nothing but a title, when a task's title is the least
 * interesting thing about it.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_Explorer extends WP_UnitTestCase {

	/**
	 * An editor, so the tasks are readable.
	 *
	 * @var int
	 */
	protected static $editor;

	/**
	 * @param WP_UnitTest_Factory $factory Factory.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor = $factory->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Ana Ruiz',
			)
		);
	}

	public function set_up() {
		parent::set_up();

		atwork_seed_statuses();
		wp_set_current_user( self::$editor );
	}

	/**
	 * The term id of a seeded status.
	 *
	 * @param string $slug Status slug.
	 * @return int Term ID.
	 */
	private function status( $slug ) {
		return (int) get_term_by( 'slug', $slug, ATWORK_STATUS_TAX )->term_id;
	}

	/**
	 * Both types must land in one folder, or the plugin occupies two root tiles
	 * for one idea.
	 *
	 * @covers ::atwork_explorer_group
	 */
	public function test_both_post_types_share_one_explorer_folder() {
		$projects = atwork_explorer_group( null, ATWORK_PROJECT_TYPE );
		$tasks    = atwork_explorer_group( null, ATWORK_TASK_TYPE );

		$this->assertSame( ATWORK_EXPLORER_GROUP, $projects['id'] );
		$this->assertSame( ATWORK_EXPLORER_GROUP, $tasks['id'] );
		$this->assertSame( $projects, $tasks, 'Every member of a group must carry identical folder values.' );
		$this->assertSame( 'dashicons-clipboard', $projects['icon'] );
	}

	/**
	 * @covers ::atwork_explorer_group
	 */
	public function test_other_plugins_post_types_are_left_alone() {
		$untouched = array( 'id' => 'plugin:somebody-else' );

		$this->assertSame( $untouched, atwork_explorer_group( $untouched, 'some_other_type' ) );
		$this->assertNull( atwork_explorer_group( null, 'post' ) );
	}

	/**
	 * The icon hook people reach for a fork over is two hooks that already
	 * ship: `menu_icon` on the type, and this filter to override per section.
	 *
	 * @covers ::atwork_explorer_entity
	 */
	public function test_each_section_gets_its_own_icon() {
		$tasks = atwork_explorer_entity( array(), get_post_type_object( ATWORK_TASK_TYPE ) );
		$projs = atwork_explorer_entity( array(), get_post_type_object( ATWORK_PROJECT_TYPE ) );

		$this->assertSame( 'dashicons-yes-alt', $tasks['icon'] );
		$this->assertSame( 'dashicons-portfolio', $projs['icon'] );
	}

	/**
	 * A task has no featured image and never will, so asking for embedded media
	 * on every list page buys an always-empty answer.
	 *
	 * @covers ::atwork_explorer_entity
	 */
	public function test_tasks_do_not_request_thumbnails_they_can_never_have() {
		$tasks = atwork_explorer_entity( array(), get_post_type_object( ATWORK_TASK_TYPE ) );

		$this->assertFalse( $tasks['thumbnails'] );
	}

	/**
	 * Without this the grid cannot be banded and tiles cannot be marked.
	 *
	 * The window sends an explicit `_fields` list, so anything a section does
	 * not name in `listFields` is stripped off the list rows before the bundle
	 * sees them — meta and terms included. The banding filter would then be
	 * handed rows that know their title and nothing else, and every task would
	 * fall into the catch-all band. Silent, and total.
	 *
	 * @covers ::atwork_explorer_entity
	 */
	public function test_task_rows_carry_the_fields_the_grid_is_banded_by() {
		$tasks = atwork_explorer_entity( array(), get_post_type_object( ATWORK_TASK_TYPE ) );

		$this->assertContains( 'meta', $tasks['listFields'] );
		$this->assertContains( atwork_status_rest_field(), $tasks['listFields'] );
	}

	/**
	 * The status field is named after the taxonomy's `rest_base`, not its slug.
	 *
	 * The two differ here — `atwork-statuses` against `atwork-status` — and
	 * asking for the wrong one is answered with silence rather than an error:
	 * the field is simply absent, every task reads as unfiled, and the banding
	 * quietly collapses. Pinned against the live REST response so the constant
	 * and the controller cannot disagree.
	 *
	 * @covers ::atwork_status_rest_field
	 */
	public function test_the_status_field_name_matches_what_rest_actually_returns() {
		$status = get_term_by( 'slug', 'stuck', ATWORK_STATUS_TAX );
		$task   = atwork_create_task(
			array(
				'title'  => 'Banded',
				'status' => $status->term_id,
			)
		);

		$request  = new WP_REST_Request( 'GET', '/wp/v2/atwork-tasks/' . $task['id'] );
		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$field = atwork_status_rest_field();

		$this->assertArrayHasKey( $field, $data, "REST returns no `{$field}` field for a task." );
		$this->assertContains( (int) $status->term_id, $data[ $field ] );
		$this->assertNotSame( ATWORK_STATUS_TAX, $field, 'The slug and the rest_base differ; do not conflate them.' );
	}

	/**
	 * The bundle is told the field name rather than guessing it.
	 *
	 * @covers ::atwork_script_config
	 */
	public function test_the_bundle_is_told_the_status_field_name() {
		$this->assertSame( atwork_status_rest_field(), atwork_script_config()['statusField'] );
	}

	/**
	 * @covers ::atwork_explorer_entity
	 */
	public function test_project_rows_carry_their_meta() {
		$projects = atwork_explorer_entity( array(), get_post_type_object( ATWORK_PROJECT_TYPE ) );

		$this->assertContains( 'meta', $projects['listFields'] );
	}

	/**
	 * The decorations register filters the Explorer consults *while painting*,
	 * so a bundle that loads when the window opens loads after the decision it
	 * was meant to influence. Shell boot is the only reliable ordering.
	 *
	 * @covers ::atwork_register_assets
	 * @covers ::atwork_enqueue_explorer_bundle
	 */
	public function test_the_explorer_bundle_is_registered_for_eager_loading() {
		atwork_register_assets();

		$script = wp_scripts()->query( 'allterrain-work-explorer', 'registered' );

		$this->assertNotFalse( $script );
		$this->assertContains( 'wp-hooks', $script->deps );
	}

	/**
	 * @covers ::atwork_explorer_entity
	 */
	public function test_a_foreign_post_type_descriptor_is_returned_untouched() {
		$entity = array( 'icon' => 'dashicons-admin-post' );

		$this->assertSame( $entity, atwork_explorer_entity( $entity, get_post_type_object( 'post' ) ) );
	}

	// -- Previews ----------------------------------------------------------

	/**
	 * The whole point: a tile that says which column, whose it is, and when it
	 * is due, instead of a wall of titles with no way to tell late from done.
	 *
	 * @covers ::atwork_explorer_task_excerpt
	 */
	public function test_a_task_tile_summarises_its_status_owner_and_due_date() {
		$task = atwork_create_task(
			array(
				'title'  => 'Wireframe the homepage',
				'status' => $this->status( 'working-on-it' ),
				'owner'  => self::$editor,
				'due'    => gmdate( 'Y-m-d', strtotime( '+3 days' ) ),
			)
		);

		$excerpt = get_the_excerpt( get_post( $task['id'] ) );

		$this->assertStringContainsString( 'Working on it', $excerpt );
		$this->assertStringContainsString( 'Ana Ruiz', $excerpt );
		$this->assertStringContainsString( 'Due', $excerpt );
	}

	/**
	 * @covers ::atwork_explorer_task_excerpt
	 */
	public function test_an_overdue_task_says_overdue_rather_than_due() {
		$task = atwork_create_task(
			array(
				'title' => 'Late thing',
				'due'   => gmdate( 'Y-m-d', strtotime( '-2 days' ) ),
			)
		);

		$excerpt = get_the_excerpt( get_post( $task['id'] ) );

		$this->assertStringContainsString( 'Overdue', $excerpt );
	}

	/**
	 * Someone who wrote their own excerpt has said something more useful than
	 * a generated summary ever will.
	 *
	 * @covers ::atwork_explorer_task_excerpt
	 */
	public function test_a_hand_written_excerpt_is_never_overwritten() {
		$task = atwork_create_task( array( 'title' => 'Has an excerpt' ) );

		wp_update_post(
			array(
				'ID'           => $task['id'],
				'post_excerpt' => 'The author said this.',
			)
		);

		$this->assertStringContainsString( 'The author said this.', get_the_excerpt( get_post( $task['id'] ) ) );
	}

	/**
	 * The filter runs on every excerpt on the site, so a post must come through
	 * it completely untouched.
	 *
	 * @covers ::atwork_explorer_task_excerpt
	 */
	public function test_the_summary_never_touches_other_post_types() {
		$post = self::factory()->post->create(
			array(
				'post_title'   => 'An ordinary post',
				'post_excerpt' => 'An ordinary excerpt.',
			)
		);

		$this->assertSame( 'An ordinary excerpt.', get_the_excerpt( get_post( $post ) ) );
	}

	/**
	 * A bare task carries no status, owner or date, and a separator with no
	 * words around it is worse than nothing.
	 *
	 * @covers ::atwork_explorer_task_excerpt
	 */
	public function test_a_task_with_nothing_to_report_gets_no_summary() {
		$task = self::factory()->post->create( array( 'post_type' => ATWORK_TASK_TYPE ) );

		$this->assertStringNotContainsString( '·', (string) get_the_excerpt( get_post( $task ) ) );
	}

	/**
	 * The summary has to survive the REST round trip, not just a direct call.
	 *
	 * This is the test that would have caught the real bug: `get_the_excerpt()`
	 * happily runs the filter for any post, so a unit test calling it directly
	 * passes even when the field never reaches a client. The REST controller
	 * omits `excerpt` **entirely** for a post type that does not declare
	 * `excerpt` support, and WP Explorer's tiles read `excerpt.rendered` — so
	 * the tiles were blank while the filter worked perfectly.
	 *
	 * @covers ::atwork_explorer_task_excerpt
	 * @covers ::atwork_register_content_types
	 */
	public function test_the_summary_reaches_the_rest_field_explorer_tiles_read() {
		$this->assertTrue(
			post_type_supports( ATWORK_TASK_TYPE, 'excerpt' ),
			'Without excerpt support the REST controller drops the field and every Explorer tile is blank.'
		);

		$task = atwork_create_task(
			array(
				'title'  => 'Wireframe the homepage',
				'status' => $this->status( 'stuck' ),
				'owner'  => self::$editor,
			)
		);

		$request  = new WP_REST_Request( 'GET', '/wp/v2/atwork-tasks/' . $task['id'] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();

		$this->assertArrayHasKey( 'excerpt', $data );
		$this->assertStringContainsString( 'Stuck', wp_strip_all_tags( $data['excerpt']['rendered'] ) );
		$this->assertStringContainsString( 'Ana Ruiz', wp_strip_all_tags( $data['excerpt']['rendered'] ) );
	}

	/**
	 * @covers ::atwork_explorer_preview_action
	 */
	public function test_the_preview_pane_offers_a_way_back_to_the_board() {
		$actions = atwork_explorer_preview_action( array() );

		$this->assertCount( 1, $actions );
		$this->assertSame( 'allterrain-work/open-board', $actions[0]['id'] );
	}

	/**
	 * The section ids are `cpt-<slug>`, not the slug alone.
	 *
	 * Getting this wrong does not error — the action is filtered out of every
	 * section and simply never appears, which is why it is worth an assertion
	 * rather than a glance.
	 *
	 * @covers ::atwork_explorer_preview_action
	 * @covers ::atwork_explorer_section_id
	 */
	public function test_the_preview_action_targets_the_sections_the_explorer_actually_keys() {
		$actions = atwork_explorer_preview_action( array() );

		$this->assertSame( 'cpt-' . ATWORK_TASK_TYPE, atwork_explorer_section_id( ATWORK_TASK_TYPE ) );
		$this->assertContains( 'cpt-' . ATWORK_TASK_TYPE, $actions[0]['sections'] );
		$this->assertContains( 'cpt-' . ATWORK_PROJECT_TYPE, $actions[0]['sections'] );
		$this->assertNotContains( ATWORK_TASK_TYPE, $actions[0]['sections'] );
	}

	/**
	 * The script the descriptor names has to exist, or the shell enqueues
	 * nothing and the button renders with no handler behind it.
	 *
	 * @covers ::atwork_explorer_preview_action
	 * @covers ::atwork_register_assets
	 */
	public function test_the_preview_action_names_a_registered_script() {
		atwork_register_assets();

		$actions = atwork_explorer_preview_action( array() );

		$this->assertNotFalse( wp_scripts()->query( $actions[0]['script'], 'registered' ) );
	}
}

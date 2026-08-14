<?php
/**
 * The realtime layer, and the content link a desktop drop creates.
 *
 * OpenStation relays content changes to every open window and — one Heartbeat
 * tick later — to every other tab and every other user. The framework already
 * publishes for any `show_ui` post type on `wp_after_insert_post`, so creating
 * and editing a task ride along for free.
 *
 * A **move** does not, and it is the action this app is built around. Dropping a
 * card writes `menu_order` straight through `$wpdb` to avoid a revision per card,
 * and sets a term; neither fires `wp_after_insert_post`. These tests pin the
 * hand-rolled recording that closes that gap, because the failure mode is
 * invisible: everything works perfectly in the window you are looking at.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_Realtime extends WP_UnitTestCase {

	/**
	 * An editor, so capability checks pass.
	 *
	 * @var int
	 */
	protected static $editor;

	/**
	 * @param WP_UnitTest_Factory $factory Factory.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor = $factory->user->create( array( 'role' => 'editor' ) );
	}

	public function set_up() {
		parent::set_up();

		atwork_seed_statuses();
		wp_set_current_user( self::$editor );

		// The stub's log is per-request and this suite is one long request, so
		// each test starts from a clean slate rather than reading a neighbour's
		// entries -- and, more importantly, so the recorder's first-writer-wins
		// dedupe cannot make a later test's record silently a no-op.
		$GLOBALS['atwork_content_changes'] = array();
	}

	/**
	 * Whether a change was recorded for a task.
	 *
	 * @param int    $task_id Task ID.
	 * @param string $action  Verb, or empty for any.
	 * @return bool
	 */
	private function recorded_for( $task_id, $action = '' ) {
		foreach ( $GLOBALS['atwork_content_changes'] as $entry ) {
			if ( ATWORK_TASK_TYPE !== $entry['type'] || (int) $task_id !== $entry['id'] ) {
				continue;
			}

			if ( '' === $action || $action === $entry['action'] ) {
				return true;
			}
		}

		return false;
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
	 * The regression this whole file exists for.
	 *
	 * A drag is the commonest action on the board and the only mutation that
	 * touches neither `wp_insert_post` nor `wp_update_post`, so it is the one
	 * change the framework's built-in publisher cannot see. Without the manual
	 * record, every other window and every other user keeps drawing the card in
	 * the column it left.
	 *
	 * @covers ::atwork_move_task
	 * @covers ::atwork_record_change
	 */
	public function test_moving_a_card_reaches_the_realtime_changelog() {
		$task = atwork_create_task( array( 'title' => 'Move me' ) );

		$GLOBALS['atwork_content_changes'] = array();

		atwork_move_task( $task['id'], $this->status( 'done' ), 0 );

		$this->assertTrue(
			$this->recorded_for( $task['id'], 'updated' ),
			'A move must be recorded, or no other window learns the card left its column.'
		);
	}

	/**
	 * @covers ::atwork_create_task
	 * @covers ::atwork_record_change
	 */
	public function test_creating_a_task_reaches_the_realtime_changelog() {
		$task = atwork_create_task( array( 'title' => 'Fresh' ) );

		$this->assertTrue( $this->recorded_for( $task['id'] ) );
	}

	/**
	 * @covers ::atwork_trash_task
	 * @covers ::atwork_record_change
	 */
	public function test_trashing_a_task_reaches_the_realtime_changelog() {
		$task = atwork_create_task( array( 'title' => 'Goodbye' ) );

		$GLOBALS['atwork_content_changes'] = array();

		atwork_trash_task( $task['id'] );

		$this->assertTrue( $this->recorded_for( $task['id'] ) );
	}

	/**
	 * A site can veto the whole realtime path and the board keeps working.
	 *
	 * `openstation_content_changes_should_record` is the framework's own opt-out
	 * for high-churn types. Honouring it must cost the plugin nothing, because
	 * the alternative -- a write that fails because nobody wanted the
	 * notification -- would be absurd.
	 *
	 * @covers ::atwork_record_change
	 */
	public function test_a_vetoed_changelog_does_not_break_writes() {
		add_filter( 'openstation_content_changes_should_record', '__return_false' );

		$task  = atwork_create_task( array( 'title' => 'Still works' ) );
		$moved = atwork_move_task( $task['id'], $this->status( 'done' ), 0 );

		remove_filter( 'openstation_content_changes_should_record', '__return_false' );

		$this->assertNotWPError( $task );
		$this->assertNotWPError( $moved );
		$this->assertSame( array(), $GLOBALS['atwork_content_changes'] );
	}

	// -- The link a desktop drop creates -----------------------------------

	/**
	 * Dropping a post on a column makes a task that remembers the post.
	 *
	 * @covers ::atwork_create_task
	 * @covers ::atwork_prepare_task
	 */
	public function test_a_task_can_be_linked_to_the_content_it_is_about() {
		$post = self::factory()->post->create( array( 'post_title' => 'Launch plan' ) );

		$task = atwork_create_task(
			array(
				'title'  => 'Launch plan',
				'source' => $post,
			)
		);

		$this->assertNotWPError( $task );
		$this->assertSame( $post, $task['sourceId'] );
		$this->assertSame( 'Launch plan', $task['sourceTitle'] );
		$this->assertNotEmpty( $task['sourceUrl'] );
	}

	/**
	 * A task with no source is the normal case and must not pretend otherwise.
	 *
	 * @covers ::atwork_prepare_task
	 */
	public function test_an_unlinked_task_reports_no_source() {
		$task = atwork_create_task( array( 'title' => 'Just a task' ) );

		$this->assertSame( 0, $task['sourceId'] );
		$this->assertSame( '', $task['sourceTitle'] );
		$this->assertSame( '', $task['sourceUrl'] );
	}

	/**
	 * A card outliving the post it was made from is a task about something that
	 * was deleted -- worth keeping, and not worth rendering a dead link for.
	 *
	 * @covers ::atwork_prepare_task
	 */
	public function test_a_task_whose_source_was_deleted_drops_the_link_not_the_card() {
		$post = self::factory()->post->create( array( 'post_title' => 'Doomed' ) );

		$task = atwork_create_task(
			array(
				'title'  => 'About the doomed post',
				'source' => $post,
			)
		);

		wp_delete_post( $post, true );

		$after = atwork_prepare_task( get_post( $task['id'] ) );

		$this->assertSame( 'About the doomed post', $after['title'] );
		$this->assertSame( 0, $after['sourceId'] );
		$this->assertSame( '', $after['sourceUrl'] );
	}

	/**
	 * The link has to survive the round trip through core REST as well, since
	 * that is how anything that has never heard of this plugin would set it.
	 *
	 * @covers ::atwork_register_task_meta
	 */
	public function test_the_source_meta_is_exposed_to_rest() {
		atwork_register_content_types();

		$registered = get_registered_meta_keys( 'post', ATWORK_TASK_TYPE );

		$this->assertArrayHasKey( ATWORK_META_SOURCE, $registered );
		$this->assertTrue( $registered[ ATWORK_META_SOURCE ]['show_in_rest'] );
	}
}

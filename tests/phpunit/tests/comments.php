<?php
/**
 * Talking about a task.
 *
 * A task thread is ordinary WordPress comments — the post type declares
 * `comments` support, so the same rows the admin's Comments screen moderates
 * and OpenStation's Comments window lists. A private "task notes" table would
 * have bought a tidier query and thrown all of that away.
 *
 * The one that would have shipped broken without a test: `comment_status`.
 * WordPress gives a new post the site's `default_comment_status`, which plenty
 * of sites set to closed — so on exactly the sites most careful about their
 * public comments, every task would have been silently undiscussable.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_Comments extends WP_UnitTestCase {

	/**
	 * An editor, who works the board.
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

		atwork_register_content_types();
		atwork_seed_statuses();
		wp_set_current_user( self::$editor );
	}

	/**
	 * @covers ::atwork_register_content_types
	 */
	public function test_the_task_type_supports_comments_at_all() {
		$this->assertTrue( post_type_supports( ATWORK_TASK_TYPE, 'comments' ) );
	}

	/**
	 * The regression this file exists for.
	 *
	 * A site with `default_comment_status` set to closed — a completely normal
	 * setting — would otherwise create every task with its thread shut, and the
	 * comment box would appear to do nothing.
	 *
	 * @covers ::atwork_create_task
	 */
	public function test_a_new_task_is_open_for_comment_even_when_the_site_is_not() {
		update_option( 'default_comment_status', 'closed' );

		$task = atwork_create_task( array( 'title' => 'Discuss me' ) );

		$this->assertSame( 'open', get_post( $task['id'] )->comment_status );

		delete_option( 'default_comment_status' );
	}

	/**
	 * @covers ::atwork_add_task_comment
	 */
	public function test_a_comment_can_be_added_and_read_back() {
		$task = atwork_create_task( array( 'title' => 'Needs a decision' ) );

		$added = atwork_add_task_comment( $task['id'], 'Blocked on legal.' );

		$this->assertNotWPError( $added );
		$this->assertSame( 'Blocked on legal.', $added['content'] );
		$this->assertSame( 'Ana Ruiz', $added['author'] );

		$thread = atwork_get_task_comments( $task['id'] );

		$this->assertCount( 1, $thread );
		$this->assertSame( 'Blocked on legal.', $thread[0]['content'] );
	}

	/**
	 * Approved outright. A task thread is a private conversation between people
	 * who can already edit the board; holding a colleague's reply for
	 * moderation would be theatre, and the delay would make the feature useless
	 * for the thing it exists for.
	 *
	 * @covers ::atwork_add_task_comment
	 */
	public function test_a_comment_is_visible_immediately() {
		$task  = atwork_create_task( array( 'title' => 'Quick one' ) );
		$added = atwork_add_task_comment( $task['id'], 'Done, shipping now.' );

		$this->assertSame( '1', get_comment( $added['id'] )->comment_approved );
	}

	/**
	 * The count on a card is a promise about what the thread contains.
	 *
	 * @covers ::atwork_prepare_task
	 */
	public function test_the_card_count_matches_the_thread() {
		$task = atwork_create_task( array( 'title' => 'Chatty' ) );

		atwork_add_task_comment( $task['id'], 'One' );
		atwork_add_task_comment( $task['id'], 'Two' );

		$this->assertSame( 2, atwork_prepare_task( get_post( $task['id'] ) )['comments'] );
	}

	/**
	 * @covers ::atwork_add_task_comment
	 */
	public function test_an_empty_comment_is_refused() {
		$task = atwork_create_task( array( 'title' => 'Nothing to say' ) );

		$result = atwork_add_task_comment( $task['id'], "   \n  " );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_empty_comment', $result->get_error_code() );
	}

	/**
	 * @covers ::atwork_add_task_comment
	 */
	public function test_a_subscriber_cannot_comment_on_the_board() {
		$task = atwork_create_task( array( 'title' => 'Staff only' ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = atwork_add_task_comment( $task['id'], 'Let me in' );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_cannot_comment', $result->get_error_code() );
	}

	/**
	 * @covers ::atwork_add_task_comment
	 */
	public function test_commenting_on_something_that_is_not_a_task_is_refused() {
		$post = self::factory()->post->create();

		$result = atwork_add_task_comment( $post, 'Wrong place' );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_task_not_found', $result->get_error_code() );
	}

	/**
	 * Markup in a comment must not survive to be rendered on a card.
	 *
	 * @covers ::atwork_add_task_comment
	 */
	public function test_a_comment_carries_no_markup() {
		$task  = atwork_create_task( array( 'title' => 'Careful' ) );
		$added = atwork_add_task_comment( $task['id'], 'Hello <script>alert(1)</script> there' );

		$this->assertStringNotContainsString( '<script>', $added['content'] );
		$this->assertStringContainsString( 'Hello', $added['content'] );
	}

	/**
	 * Trashed rather than destroyed, so it can be recovered from the Comments
	 * screen like any other.
	 *
	 * @covers ::atwork_delete_task_comment
	 */
	public function test_deleting_a_comment_trashes_it() {
		$task  = atwork_create_task( array( 'title' => 'Oops' ) );
		$added = atwork_add_task_comment( $task['id'], 'Said too soon' );

		$this->assertTrue( atwork_delete_task_comment( $added['id'] ) );
		$this->assertSame( 'trash', get_comment( $added['id'] )->comment_approved );
		$this->assertSame( 0, atwork_prepare_task( get_post( $task['id'] ) )['comments'] );
	}

	/**
	 * @covers ::atwork_delete_task_comment
	 */
	public function test_a_contributor_cannot_delete_someone_elses_comment() {
		$task  = atwork_create_task( array( 'title' => 'Mine' ) );
		$added = atwork_add_task_comment( $task['id'], 'Ana said this' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'contributor' ) ) );

		$result = atwork_delete_task_comment( $added['id'] );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_cannot_delete_comment', $result->get_error_code() );
	}

	/**
	 * A comment changes what every other board draws on that card.
	 *
	 * @covers ::atwork_add_task_comment
	 */
	public function test_commenting_reaches_the_realtime_changelog() {
		if ( ! function_exists( 'openstation_content_changes_record' ) ) {
			$this->markTestSkipped( 'No shell to record into.' );
		}

		$task = atwork_create_task( array( 'title' => 'Broadcast' ) );

		$GLOBALS['atwork_content_changes'] = array();

		atwork_add_task_comment( $task['id'], 'Heard?' );

		$this->assertContains( $task['id'], wp_list_pluck( $GLOBALS['atwork_content_changes'], 'id' ) );
	}
}

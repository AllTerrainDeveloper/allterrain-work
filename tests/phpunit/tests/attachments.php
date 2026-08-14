<?php
/**
 * Attaching things to a task, and removing things generally.
 *
 * A task can hold anything that lives in `wp_posts` — a post, a page, an image,
 * a product, a custom type nobody has written yet — because dragging any of
 * them onto a card from anywhere on the desktop attaches it.
 *
 * The distinction these pin hardest is *link* versus *thing*: detaching a page
 * from a task must never delete the page, and trashing a project must never
 * take its tasks with it.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_Attachments extends WP_UnitTestCase {

	/**
	 * An editor, who owns the fixtures.
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

		atwork_register_content_types();
		atwork_seed_statuses();
		wp_set_current_user( self::$editor );
	}

	// -- Attaching ---------------------------------------------------------

	/**
	 * @covers ::atwork_attach_to_task
	 */
	public function test_anything_that_lives_in_wp_posts_can_be_attached() {
		$task = atwork_create_task( array( 'title' => 'Review the launch' ) );
		$post = self::factory()->post->create( array( 'post_title' => 'Launch plan' ) );
		$page = self::factory()->post->create(
			array(
				'post_title' => 'Pricing',
				'post_type'  => 'page',
			)
		);

		$links = atwork_attach_to_task( $task['id'], array( $post, $page ) );

		$this->assertNotWPError( $links );
		$this->assertCount( 2, $links );
		$this->assertSame( array( 'Launch plan', 'Pricing' ), wp_list_pluck( $links, 'title' ) );
		$this->assertSame( array( 'Post', 'Page' ), wp_list_pluck( $links, 'typeLabel' ) );
	}

	/**
	 * A custom post type is a post like any other — that is the whole point of
	 * storing links as post ids rather than a hand-rolled type union.
	 *
	 * @covers ::atwork_attach_to_task
	 */
	public function test_a_custom_post_type_attaches_like_anything_else() {
		register_post_type(
			'atwork_widget',
			array(
				'public' => true,
				'label'  => 'Widget',
			)
		);

		$task   = atwork_create_task( array( 'title' => 'Ship it' ) );
		$widget = self::factory()->post->create(
			array(
				'post_title' => 'A widget',
				'post_type'  => 'atwork_widget',
			)
		);

		$links = atwork_attach_to_task( $task['id'], array( $widget ) );

		$this->assertCount( 1, $links );
		$this->assertSame( 'atwork_widget', $links[0]['type'] );
	}

	/**
	 * Both are things a stray drag causes, and neither deserves an error.
	 *
	 * @covers ::atwork_attach_to_task
	 */
	public function test_attaching_twice_or_to_itself_is_quietly_ignored() {
		$task = atwork_create_task( array( 'title' => 'Careful' ) );
		$post = self::factory()->post->create();

		atwork_attach_to_task( $task['id'], array( $post ) );
		$links = atwork_attach_to_task( $task['id'], array( $post, $task['id'] ) );

		$this->assertCount( 1, $links );
	}

	/**
	 * Attaching something the user cannot read would put its title on a card
	 * that other people can read.
	 *
	 * @covers ::atwork_attach_to_task
	 */
	public function test_content_the_user_cannot_read_is_not_attached() {
		$other   = self::factory()->user->create( array( 'role' => 'author' ) );
		$private = self::factory()->post->create(
			array(
				'post_status' => 'private',
				'post_author' => $other,
				'post_title'  => 'Someone else’s draft',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'contributor' ) ) );

		$task = self::factory()->post->create( array( 'post_type' => ATWORK_TASK_TYPE ) );

		wp_set_current_user( self::$editor );
		$task = atwork_create_task( array( 'title' => 'Mine' ) );

		wp_set_current_user( $other );
		$links = atwork_attach_to_task( $task['id'], array( $private ) );

		// The author can neither edit this task nor should they smuggle a
		// private post onto it.
		$this->assertWPError( $links );
	}

	/**
	 * @covers ::atwork_attach_to_task
	 */
	public function test_attaching_to_a_task_that_does_not_exist_is_a_404() {
		$links = atwork_attach_to_task( 999999, array( 1 ) );

		$this->assertWPError( $links );
		$this->assertSame( 'atwork_task_not_found', $links->get_error_code() );
	}

	/**
	 * @covers ::atwork_prepare_task
	 * @covers ::atwork_prepare_links
	 */
	public function test_attachments_ride_along_on_the_task_payload() {
		$task = atwork_create_task( array( 'title' => 'With things' ) );
		$post = self::factory()->post->create( array( 'post_title' => 'Attached' ) );

		atwork_attach_to_task( $task['id'], array( $post ) );

		$payload = atwork_prepare_task( get_post( $task['id'] ) );

		$this->assertCount( 1, $payload['links'] );
		$this->assertSame( 'Attached', $payload['links'][0]['title'] );
	}

	/**
	 * A card listing a title for something that no longer exists is worse than
	 * a card listing one fewer thing.
	 *
	 * @covers ::atwork_prepare_links
	 */
	public function test_a_deleted_attachment_drops_off_the_card() {
		$task = atwork_create_task( array( 'title' => 'Outlives things' ) );
		$post = self::factory()->post->create();

		atwork_attach_to_task( $task['id'], array( $post ) );
		wp_delete_post( $post, true );

		$this->assertSame( array(), atwork_prepare_links( $task['id'] ) );
	}

	// -- Detaching ---------------------------------------------------------

	/**
	 * The distinction the whole feature rests on: detaching removes the *link*.
	 * Deleting the page because it was mentioned on a task would be a disaster
	 * dressed as a tidy-up.
	 *
	 * @covers ::atwork_detach_from_task
	 */
	public function test_detaching_removes_the_link_and_never_the_thing() {
		$task = atwork_create_task( array( 'title' => 'Careful now' ) );
		$page = self::factory()->post->create(
			array(
				'post_type'  => 'page',
				'post_title' => 'Still here',
			)
		);

		atwork_attach_to_task( $task['id'], array( $page ) );
		$links = atwork_detach_from_task( $task['id'], $page );

		$this->assertNotWPError( $links );
		$this->assertSame( array(), $links );
		$this->assertSame( 'Still here', get_the_title( $page ), 'Detaching must not delete the page.' );
		$this->assertSame( 'publish', get_post_status( $page ) );
	}

	/**
	 * @covers ::atwork_detach_from_task
	 */
	public function test_detaching_something_that_was_never_attached_is_harmless() {
		$task = atwork_create_task( array( 'title' => 'Nothing attached' ) );

		$this->assertSame( array(), atwork_detach_from_task( $task['id'], 12345 ) );
	}

	// -- Removing a project ------------------------------------------------

	/**
	 * A project is a grouping. Deleting a folder must not delete the work in
	 * it — and because the project is only trashed, restoring it brings the
	 * whole board back intact.
	 *
	 * @covers ::atwork_trash_project
	 */
	public function test_trashing_a_project_keeps_its_tasks() {
		$project = atwork_create_project( array( 'title' => 'Doomed' ) );
		$task    = atwork_create_task(
			array(
				'title'   => 'Survivor',
				'project' => $project['id'],
			)
		);

		$this->assertTrue( atwork_trash_project( $project['id'] ) );
		$this->assertSame( 'trash', get_post_status( $project['id'] ) );
		$this->assertSame( 'publish', get_post_status( $task['id'] ) );
		$this->assertSame( $project['id'], (int) get_post_meta( $task['id'], ATWORK_META_PROJECT, true ) );
	}

	/**
	 * @covers ::atwork_trash_project
	 */
	public function test_a_contributor_cannot_delete_a_project() {
		$project = atwork_create_project( array( 'title' => 'Not yours' ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'contributor' ) ) );

		$result = atwork_trash_project( $project['id'] );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_cannot_delete', $result->get_error_code() );
	}

	/**
	 * @covers ::atwork_trash_project
	 */
	public function test_trashing_something_that_is_not_a_project_is_refused() {
		$task = atwork_create_task( array( 'title' => 'A task, not a project' ) );

		$result = atwork_trash_project( $task['id'] );

		$this->assertWPError( $result );
		$this->assertSame( 'atwork_project_not_found', $result->get_error_code() );
	}

	// -- Realtime ----------------------------------------------------------

	/**
	 * Attaching changes what every other board draws on that card.
	 *
	 * @covers ::atwork_attach_to_task
	 */
	public function test_attaching_reaches_the_realtime_changelog() {
		if ( ! function_exists( 'openstation_content_changes_record' ) ) {
			$this->markTestSkipped( 'No shell to record into.' );
		}

		$task = atwork_create_task( array( 'title' => 'Broadcast me' ) );
		$post = self::factory()->post->create();

		$GLOBALS['atwork_content_changes'] = array();

		atwork_attach_to_task( $task['id'], array( $post ) );

		$ids = wp_list_pluck( $GLOBALS['atwork_content_changes'], 'id' );

		$this->assertContains( $task['id'], $ids );
	}
}

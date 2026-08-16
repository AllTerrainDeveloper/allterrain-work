<?php
/**
 * Reading and writing the board.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_BoardApi extends WP_UnitTestCase {

	/**
	 * An editor, so capability checks pass on the happy path.
	 *
	 * @var int
	 */
	protected static $editor;

	/**
	 * A subscriber, for the paths that must be refused.
	 *
	 * @var int
	 */
	protected static $subscriber;

	/**
	 * Creates the fixture users once for the class.
	 *
	 * @param WP_UnitTest_Factory $factory Factory.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber = $factory->user->create( array( 'role' => 'subscriber' ) );
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

	// -- Sanitizers --------------------------------------------------------

	/**
	 * @covers ::atwork_sanitize_priority
	 */
	public function test_priority_falls_back_to_the_middle_of_the_scale() {
		$this->assertSame( 'critical', atwork_sanitize_priority( 'critical' ) );
		$this->assertSame( 'medium', atwork_sanitize_priority( 'urgent-ish' ) );
		$this->assertSame( 'medium', atwork_sanitize_priority( null ) );
	}

	/**
	 * A date that matches the shape but names no real day is not a date.
	 * 30 February is the case a regex alone waves through.
	 *
	 * @covers ::atwork_sanitize_date
	 */
	public function test_date_rejects_shapes_that_are_not_days() {
		$this->assertSame( '2026-01-09', atwork_sanitize_date( '2026-01-09' ) );
		$this->assertSame( '', atwork_sanitize_date( '2026-02-30' ) );
		$this->assertSame( '', atwork_sanitize_date( '09/01/2026' ) );
		$this->assertSame( '', atwork_sanitize_date( 'tomorrow' ) );
		$this->assertSame( '', atwork_sanitize_date( '' ) );
	}

	/**
	 * @covers ::atwork_sanitize_hex_color
	 */
	public function test_hex_colours_normalise_and_expand() {
		$this->assertSame( '#00c875', atwork_sanitize_hex_color( '#00C875' ) );
		$this->assertSame( '#aabbcc', atwork_sanitize_hex_color( '#abc' ) );
		$this->assertSame( '#c4c4c4', atwork_sanitize_hex_color( 'rebeccapurple' ) );
	}

	// -- Creating ----------------------------------------------------------

	/**
	 * @covers ::atwork_create_task
	 */
	public function test_creating_a_task_stores_every_field() {
		$task = atwork_create_task(
			array(
				'title'    => 'Ship the board',
				'content'  => 'With drag and drop.',
				'status'   => $this->status( 'working-on-it' ),
				'owner'    => self::$editor,
				'due'      => '2026-04-01',
				'priority' => 'high',
			)
		);

		$this->assertNotWPError( $task );
		$this->assertSame( 'Ship the board', $task['title'] );
		$this->assertSame( $this->status( 'working-on-it' ), $task['statusId'] );
		$this->assertSame( self::$editor, $task['ownerId'] );
		$this->assertSame( '2026-04-01', $task['due'] );
		$this->assertSame( 'high', $task['priority'] );
	}

	/**
	 * A card with no column would be invisible on the board — real work that
	 * nobody can see is worse than no card at all.
	 *
	 * @covers ::atwork_create_task
	 */
	public function test_a_task_created_without_a_status_lands_in_the_first_column() {
		$task = atwork_create_task( array( 'title' => 'Unfiled' ) );

		$this->assertNotWPError( $task );
		$this->assertSame( $this->status( 'not-started' ), $task['statusId'] );
	}

	/**
	 * @covers ::atwork_create_task
	 */
	public function test_a_task_needs_a_title() {
		$task = atwork_create_task( array( 'title' => '   ' ) );

		$this->assertWPError( $task );
		$this->assertSame( 'atwork_missing_title', $task->get_error_code() );
	}

	/**
	 * @covers ::atwork_create_task
	 */
	public function test_a_subscriber_cannot_create_tasks() {
		wp_set_current_user( self::$subscriber );

		$task = atwork_create_task( array( 'title' => 'Not mine to make' ) );

		$this->assertWPError( $task );
		$this->assertSame( 'atwork_cannot_create', $task->get_error_code() );
	}

	/**
	 * New cards land on top, because burying the thing somebody just created
	 * under everything already in the column is the opposite of what they
	 * asked for.
	 *
	 * @covers ::atwork_create_task
	 * @covers ::atwork_reindex_column
	 */
	public function test_a_new_task_lands_at_the_top_of_its_column() {
		$status = $this->status( 'not-started' );

		$first  = atwork_create_task( array( 'title' => 'First' ) );
		$second = atwork_create_task( array( 'title' => 'Second' ) );

		$this->assertSame( 0, $second['order'] );
		$this->assertSame( 1, (int) get_post_field( 'menu_order', $first['id'] ) );
		$this->assertSame( $status, $second['statusId'] );
	}

	// -- Updating ----------------------------------------------------------

	/**
	 * The reason update takes a sparse array: the board patches one field at a
	 * time, and a partial write that clobbered the rest would erase a due date
	 * every time somebody renamed a card.
	 *
	 * @covers ::atwork_update_task
	 */
	public function test_updating_leaves_absent_fields_alone() {
		$task = atwork_create_task(
			array(
				'title'    => 'Original',
				'due'      => '2026-04-01',
				'priority' => 'critical',
			)
		);

		$updated = atwork_update_task( $task['id'], array( 'title' => 'Renamed' ) );

		$this->assertNotWPError( $updated );
		$this->assertSame( 'Renamed', $updated['title'] );
		$this->assertSame( '2026-04-01', $updated['due'] );
		$this->assertSame( 'critical', $updated['priority'] );
	}

	/**
	 * @covers ::atwork_update_task
	 */
	public function test_updating_a_missing_task_is_a_404() {
		$updated = atwork_update_task( 999999, array( 'title' => 'Ghost' ) );

		$this->assertWPError( $updated );
		$this->assertSame( 'atwork_task_not_found', $updated->get_error_code() );
	}

	// -- Moving ------------------------------------------------------------

	/**
	 * @covers ::atwork_move_task
	 */
	public function test_moving_a_task_changes_its_column() {
		$task = atwork_create_task( array( 'title' => 'Move me' ) );

		$moved = atwork_move_task( $task['id'], $this->status( 'done' ), 0 );

		$this->assertNotWPError( $moved );
		$this->assertSame( $this->status( 'done' ), $moved['statusId'] );
	}

	/**
	 * The whole point of doing the status change and the reorder in one write:
	 * a card dropped third from top has to *be* third, not merely in the right
	 * column at whatever height the previous order left it.
	 *
	 * @covers ::atwork_move_task
	 * @covers ::atwork_reindex_column
	 */
	public function test_moving_places_the_card_at_the_requested_index() {
		$done = $this->status( 'done' );

		$a = atwork_create_task(
			array(
				'title'  => 'A',
				'status' => $done,
			)
		);
		$b = atwork_create_task(
			array(
				'title'  => 'B',
				'status' => $done,
			)
		);
		$c = atwork_create_task(
			array(
				'title'  => 'C',
				'status' => $done,
			)
		);

		$moved = atwork_move_task( $c['id'], $done, 2 );

		$this->assertNotWPError( $moved );
		$this->assertSame( 2, $moved['order'] );

		// And the column reads 0, 1, 2 with no gaps or ties — a tie would let
		// the secondary sort silently decide the order the user just set.
		$orders = array_map(
			static function ( $id ) {
				return (int) get_post_field( 'menu_order', $id );
			},
			array( $b['id'], $a['id'], $c['id'] )
		);

		sort( $orders );

		$this->assertSame( array( 0, 1, 2 ), $orders );
	}

	/**
	 * A column is one ordering, not one per project.
	 *
	 * The board draws a column by sorting on `menu_order` and shows every
	 * project at once, so renumbering only the moved card's project would leave
	 * two independent runs of 0, 1, 2 inside one column. The board would then
	 * break the ties on its secondary sort and quietly rearrange cards nobody
	 * touched. This is the regression test for exactly that.
	 *
	 * @covers ::atwork_move_task
	 * @covers ::atwork_reindex_column
	 */
	public function test_a_column_is_renumbered_across_every_project() {
		$done  = $this->status( 'done' );
		$alpha = atwork_create_project( array( 'title' => 'Alpha' ) );
		$beta  = atwork_create_project( array( 'title' => 'Beta' ) );

		$ids = array();

		foreach ( array( $alpha, $beta, $alpha, $beta ) as $index => $project ) {
			$task  = atwork_create_task(
				array(
					'title'   => 'Task ' . $index,
					'status'  => $done,
					'project' => $project['id'],
				)
			);
			$ids[] = $task['id'];
		}

		// Move one of them, which renumbers the column it lands in.
		atwork_move_task( $ids[0], $done, 3 );

		$orders = array();

		foreach ( $ids as $id ) {
			$orders[] = (int) get_post_field( 'menu_order', $id );
		}

		sort( $orders );

		// Four cards, four distinct indices, no gaps -- regardless of which
		// project each one belongs to.
		$this->assertSame( array( 0, 1, 2, 3 ), $orders );
	}

	/**
	 * @covers ::atwork_move_task
	 */
	public function test_moving_to_a_status_that_does_not_exist_is_refused() {
		$task = atwork_create_task( array( 'title' => 'Move me' ) );

		$moved = atwork_move_task( $task['id'], 999999, 0 );

		$this->assertWPError( $moved );
		$this->assertSame( 'atwork_bad_status', $moved->get_error_code() );
	}

	/**
	 * @covers ::atwork_move_task
	 */
	public function test_a_subscriber_cannot_move_a_task() {
		$task = atwork_create_task( array( 'title' => 'Not yours' ) );

		wp_set_current_user( self::$subscriber );

		$moved = atwork_move_task( $task['id'], $this->status( 'done' ), 0 );

		$this->assertWPError( $moved );
		$this->assertSame( 'atwork_cannot_edit', $moved->get_error_code() );
	}

	// -- Trashing ----------------------------------------------------------

	/**
	 * Trash, never delete — so both WordPress's recycle bin and OpenStation's
	 * can hand the card back.
	 *
	 * @covers ::atwork_trash_task
	 */
	public function test_trashing_a_task_trashes_rather_than_deletes() {
		$task = atwork_create_task( array( 'title' => 'Goodbye' ) );

		$this->assertTrue( atwork_trash_task( $task['id'] ) );
		$this->assertSame( 'trash', get_post_status( $task['id'] ) );
	}

	// -- The board payload -------------------------------------------------

	/**
	 * @covers ::atwork_get_board
	 */
	public function test_the_board_payload_carries_everything_needed_to_paint() {
		atwork_create_task( array( 'title' => 'Something' ) );

		$board = atwork_get_board();

		$this->assertArrayHasKey( 'statuses', $board );
		$this->assertArrayHasKey( 'projects', $board );
		$this->assertArrayHasKey( 'tasks', $board );
		$this->assertArrayHasKey( 'viewer', $board );
		$this->assertCount( 4, $board['statuses'] );
		$this->assertSame( self::$editor, $board['viewer']['id'] );
		$this->assertTrue( $board['viewer']['canCreate'] );
	}

	/**
	 * Columns sort by their stored order, and ties break on name so the board
	 * does not reshuffle itself between reloads.
	 *
	 * @covers ::atwork_get_statuses
	 */
	public function test_statuses_come_back_in_board_order() {
		$slugs = wp_list_pluck( atwork_get_statuses(), 'slug' );

		$this->assertSame( array( 'not-started', 'working-on-it', 'stuck', 'done' ), $slugs );
	}

	/**
	 * The shape the TypeScript `Task` interface mirrors. A key renamed on one
	 * side and not the other is a card that renders blank, so the contract is
	 * pinned here rather than discovered in a browser.
	 *
	 * @covers ::atwork_prepare_task
	 */
	public function test_the_task_payload_shape_matches_the_client_contract() {
		$task = atwork_create_task( array( 'title' => 'Shape' ) );

		$expected = array(
			'id',
			'title',
			'excerpt',
			'projectId',
			'statusId',
			'ownerId',
			'ownerName',
			'ownerAvatar',
			'due',
			'priority',
			'order',
			'sourceId',
			'sourceTitle',
			'sourceUrl',
			'links',
			'comments',
			'editUrl',
			'canEdit',
			'canDelete',
		);

		$this->assertSame( $expected, array_keys( $task ) );
	}

	// -- My work -----------------------------------------------------------

	/**
	 * @covers ::atwork_get_my_work
	 */
	public function test_my_work_only_returns_the_viewers_own_tasks() {
		$other = self::factory()->user->create( array( 'role' => 'editor' ) );

		atwork_create_task(
			array(
				'title' => 'Mine',
				'owner' => self::$editor,
			)
		);
		atwork_create_task(
			array(
				'title' => 'Theirs',
				'owner' => $other,
			)
		);

		$work = atwork_get_my_work();

		$this->assertCount( 1, $work['tasks'] );
		$this->assertSame( 'Mine', $work['tasks'][0]['title'] );
	}

	/**
	 * Finished work is not "on your plate". Counting it as open is how a
	 * widget tells somebody they have twenty things to do on a day they
	 * finished nineteen of them.
	 *
	 * @covers ::atwork_get_my_work
	 * @covers ::atwork_done_status_ids
	 */
	public function test_my_work_excludes_done_and_counts_it_separately() {
		atwork_create_task(
			array(
				'title' => 'Open',
				'owner' => self::$editor,
			)
		);
		atwork_create_task(
			array(
				'title'  => 'Finished',
				'owner'  => self::$editor,
				'status' => $this->status( 'done' ),
			)
		);

		$work = atwork_get_my_work();

		$this->assertCount( 1, $work['tasks'] );
		$this->assertSame( 1, $work['counts']['done'] );
		$this->assertSame( 1, $work['counts']['total'] );
	}

	/**
	 * Dated work outranks undated: a deadline is a commitment to somebody
	 * else, a priority is a note to yourself.
	 *
	 * @covers ::atwork_get_my_work
	 */
	public function test_my_work_sorts_by_urgency() {
		atwork_create_task(
			array(
				'title'    => 'No date, critical',
				'owner'    => self::$editor,
				'priority' => 'critical',
			)
		);
		atwork_create_task(
			array(
				'title' => 'Next week',
				'owner' => self::$editor,
				'due'   => gmdate( 'Y-m-d', strtotime( '+7 days' ) ),
			)
		);
		atwork_create_task(
			array(
				'title' => 'Overdue',
				'owner' => self::$editor,
				'due'   => gmdate( 'Y-m-d', strtotime( '-2 days' ) ),
			)
		);

		$titles = wp_list_pluck( atwork_get_my_work()['tasks'], 'title' );

		$this->assertSame( array( 'Overdue', 'Next week', 'No date, critical' ), $titles );
		$this->assertSame( 1, atwork_get_my_work()['counts']['overdue'] );
	}

	/**
	 * The widget's project picker is only useful if the server honours it.
	 *
	 * @covers ::atwork_get_my_work
	 */
	public function test_my_work_narrows_to_the_picked_projects() {
		$alpha = atwork_create_project( array( 'title' => 'Alpha' ) );
		$beta  = atwork_create_project( array( 'title' => 'Beta' ) );

		atwork_create_task(
			array(
				'title'   => 'In alpha',
				'owner'   => self::$editor,
				'project' => $alpha['id'],
			)
		);
		atwork_create_task(
			array(
				'title'   => 'In beta',
				'owner'   => self::$editor,
				'project' => $beta['id'],
			)
		);

		$work = atwork_get_my_work( 0, array( $alpha['id'] ) );

		$this->assertCount( 1, $work['tasks'] );
		$this->assertSame( 'In alpha', $work['tasks'][0]['title'] );

		// And the picker itself needs the full project list regardless of the
		// filter, or unticking the last box would leave nothing to tick back.
		$this->assertCount( 2, $work['projects'] );
	}

	/**
	 * Reading a colleague's queue is a staffing question and takes `list_users`.
	 * The check lives in the helper itself, not only in the REST route, so every
	 * front door -- present and future -- enforces it by construction.
	 *
	 * @covers ::atwork_get_my_work
	 */
	public function test_my_work_refuses_another_users_queue_without_list_users() {
		$other = self::factory()->user->create( array( 'role' => 'editor' ) );

		$work = atwork_get_my_work( $other );

		$this->assertWPError( $work );
		$this->assertSame( 'atwork_forbidden', $work->get_error_code() );
	}

	/**
	 * Somebody who can already see the user list can see a user's workload.
	 *
	 * @covers ::atwork_get_my_work
	 */
	public function test_my_work_shows_another_users_queue_to_a_user_manager() {
		$other = self::factory()->user->create( array( 'role' => 'editor' ) );
		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );

		wp_set_current_user( self::$editor );
		atwork_create_task(
			array(
				'title' => 'Theirs',
				'owner' => $other,
			)
		);

		wp_set_current_user( $admin );
		$work = atwork_get_my_work( $other );

		$this->assertCount( 1, $work['tasks'] );
		$this->assertSame( 'Theirs', $work['tasks'][0]['title'] );
	}
}

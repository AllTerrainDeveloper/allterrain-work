<?php
/**
 * Adding columns, and what a project actually is.
 *
 * Two gaps this covers, both of which made the board feel like a demo rather
 * than a tool: a board whose columns were fixed at whatever activation seeded,
 * and a project that existed only as an entry in a filter dropdown.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_ProjectsAndColumns extends WP_UnitTestCase {

	/**
	 * An author — can make work, cannot reshape the board.
	 *
	 * The line is `manage_categories`, which editors and administrators hold and
	 * authors and contributors do not. That is the right line: a column is
	 * shared by everyone looking at the board, so adding one is the same kind of
	 * decision as adding a category, and it is deliberately *not* restricted to
	 * administrators — the senior editorial people are exactly who should be
	 * able to say the team now works in "Waiting on client".
	 *
	 * @var int
	 */
	protected static $author;

	/**
	 * An editor, who may reshape the board.
	 *
	 * @var int
	 */
	protected static $editor;

	/**
	 * An administrator — holds `manage_categories`.
	 *
	 * @var int
	 */
	protected static $admin;

	/**
	 * @param WP_UnitTest_Factory $factory Factory.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( $factory ) {
		self::$author = $factory->user->create( array( 'role' => 'author' ) );
		self::$editor = $factory->user->create( array( 'role' => 'editor' ) );
		self::$admin  = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();

		atwork_seed_statuses();
		wp_set_current_user( self::$admin );
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

	// -- Columns -----------------------------------------------------------

	/**
	 * @covers ::atwork_create_status
	 */
	public function test_a_column_can_be_added_to_the_board() {
		$status = atwork_create_status( array( 'name' => 'Waiting on client' ) );

		$this->assertNotWPError( $status );
		$this->assertSame( 'Waiting on client', $status['name'] );
		$this->assertNotEmpty( $status['color'] );

		$names = wp_list_pluck( atwork_get_statuses(), 'name' );

		$this->assertContains( 'Waiting on client', $names );
	}

	/**
	 * A new column goes on the right, where a pipeline grows.
	 *
	 * @covers ::atwork_create_status
	 */
	public function test_a_new_column_sorts_after_the_existing_ones() {
		atwork_create_status( array( 'name' => 'Shipped' ) );

		$slugs = wp_list_pluck( atwork_get_statuses(), 'name' );

		$this->assertSame( 'Shipped', end( $slugs ) );
	}

	/**
	 * Colours are cycled rather than repeated, because a board's colours are
	 * what make it scannable and a wall of identical headers is not.
	 *
	 * @covers ::atwork_create_status
	 * @covers ::atwork_status_palette
	 */
	public function test_new_columns_do_not_all_get_the_same_colour() {
		$first  = atwork_create_status( array( 'name' => 'One' ) );
		$second = atwork_create_status( array( 'name' => 'Two' ) );

		$this->assertNotSame( $first['color'], $second['color'] );
	}

	/**
	 * @covers ::atwork_create_status
	 */
	public function test_a_column_colour_can_be_chosen() {
		$status = atwork_create_status(
			array(
				'name'  => 'Brand',
				'color' => '#AABBCC',
			)
		);

		$this->assertSame( '#aabbcc', $status['color'] );
	}

	/**
	 * @covers ::atwork_create_status
	 */
	public function test_a_column_needs_a_name() {
		$status = atwork_create_status( array( 'name' => '  ' ) );

		$this->assertWPError( $status );
		$this->assertSame( 'atwork_missing_status_name', $status->get_error_code() );
	}

	/**
	 * A duplicate is something the user did, not a fault, so it earns a message
	 * that says what happened rather than a raw `term_exists`.
	 *
	 * @covers ::atwork_create_status
	 */
	public function test_adding_a_column_that_already_exists_says_so() {
		$status = atwork_create_status( array( 'name' => 'Done' ) );

		$this->assertWPError( $status );
		$this->assertSame( 'atwork_status_exists', $status->get_error_code() );
	}

	/**
	 * An author writes work; they do not decide what the columns are.
	 *
	 * @covers ::atwork_create_status
	 */
	public function test_an_author_cannot_reshape_the_board() {
		wp_set_current_user( self::$author );

		$status = atwork_create_status( array( 'name' => 'Sneaky' ) );

		$this->assertWPError( $status );
		$this->assertSame( 'atwork_cannot_create_status', $status->get_error_code() );
	}

	/**
	 * An editor can, and deliberately so — gating this to administrators would
	 * mean asking one for a new column every time a team changed how it works.
	 *
	 * @covers ::atwork_create_status
	 */
	public function test_an_editor_can_reshape_the_board() {
		wp_set_current_user( self::$editor );

		$status = atwork_create_status( array( 'name' => 'In review' ) );

		$this->assertNotWPError( $status );
	}

	/**
	 * A column added on the board has to be a real term, or none of the rest of
	 * WordPress — the taxonomy screen, REST, queries — knows about it.
	 *
	 * @covers ::atwork_create_status
	 */
	public function test_a_new_column_is_a_real_term_tasks_can_move_into() {
		$status = atwork_create_status( array( 'name' => 'In review' ) );
		$task   = atwork_create_task( array( 'title' => 'Needs a look' ) );

		$moved = atwork_move_task( $task['id'], $status['id'], 0 );

		$this->assertNotWPError( $moved );
		$this->assertSame( $status['id'], $moved['statusId'] );
	}

	// -- Project details ---------------------------------------------------

	/**
	 * @covers ::atwork_get_project
	 */
	public function test_a_project_reports_its_progress() {
		$project = atwork_create_project( array( 'title' => 'Redesign' ) );

		foreach ( array( 'not-started', 'working-on-it', 'done', 'done' ) as $slug ) {
			atwork_create_task(
				array(
					'title'   => 'Task in ' . $slug,
					'project' => $project['id'],
					'status'  => $this->status( $slug ),
				)
			);
		}

		$detail = atwork_get_project( $project['id'] );

		$this->assertNotWPError( $detail );
		$this->assertSame( 4, $detail['total'] );
		$this->assertSame( 2, $detail['done'] );
		$this->assertSame( 2, $detail['open'] );
		$this->assertSame( 50, $detail['percent'] );
	}

	/**
	 * Floored, so a project one task short of finished never claims 100%.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_progress_never_rounds_up_to_finished() {
		$project = atwork_create_project( array( 'title' => 'Almost' ) );

		for ( $i = 0; $i < 3; $i++ ) {
			atwork_create_task(
				array(
					'title'   => 'Done ' . $i,
					'project' => $project['id'],
					'status'  => $this->status( 'done' ),
				)
			);
		}

		atwork_create_task(
			array(
				'title'   => 'The last one',
				'project' => $project['id'],
				'status'  => $this->status( 'working-on-it' ),
			)
		);

		$detail = atwork_get_project( $project['id'] );

		$this->assertSame( 75, $detail['percent'] );
		$this->assertLessThan( 100, $detail['percent'] );
	}

	/**
	 * An empty project is 0%, not a division by zero.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_an_empty_project_reports_zero_rather_than_erroring() {
		$project = atwork_create_project( array( 'title' => 'Brand new' ) );
		$detail  = atwork_get_project( $project['id'] );

		$this->assertNotWPError( $detail );
		$this->assertSame( 0, $detail['total'] );
		$this->assertSame( 0, $detail['percent'] );
	}

	/**
	 * Finished work cannot be late. Counting a task completed after its due
	 * date as overdue for ever would make a delivered project look like a
	 * failing one.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_only_open_work_counts_as_overdue() {
		$project   = atwork_create_project( array( 'title' => 'Deadlines' ) );
		$yesterday = gmdate( 'Y-m-d', strtotime( '-1 day' ) );

		atwork_create_task(
			array(
				'title'   => 'Late and open',
				'project' => $project['id'],
				'due'     => $yesterday,
			)
		);
		atwork_create_task(
			array(
				'title'   => 'Late but finished',
				'project' => $project['id'],
				'status'  => $this->status( 'done' ),
				'due'     => $yesterday,
			)
		);

		$detail = atwork_get_project( $project['id'] );

		$this->assertSame( 1, $detail['overdue'] );
	}

	/**
	 * The breakdown is what makes the progress bar honest: "60% done" and
	 * "60% done, the rest all Stuck" are different projects.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_the_breakdown_covers_every_column_including_empty_ones() {
		$project = atwork_create_project( array( 'title' => 'Bands' ) );

		atwork_create_task(
			array(
				'title'   => 'Stuck one',
				'project' => $project['id'],
				'status'  => $this->status( 'stuck' ),
			)
		);

		$detail = atwork_get_project( $project['id'] );
		$bands  = wp_list_pluck( $detail['breakdown'], 'count', 'name' );

		$this->assertCount( 4, $detail['breakdown'] );
		$this->assertSame( 1, $bands['Stuck'] );
		$this->assertSame( 0, $bands['Done'] );
	}

	/**
	 * Members are ordered by how much they are carrying, because that is the
	 * question a face row answers.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_members_are_listed_busiest_first() {
		$project = atwork_create_project( array( 'title' => 'Team' ) );
		$busy    = self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Busy',
			)
		);
		$quiet   = self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Quiet',
			)
		);

		foreach ( array( $busy, $busy, $quiet ) as $index => $owner ) {
			atwork_create_task(
				array(
					'title'   => 'Task ' . $index,
					'project' => $project['id'],
					'owner'   => $owner,
				)
			);
		}

		$detail = atwork_get_project( $project['id'] );

		$this->assertSame( 'Busy', $detail['members'][0]['name'] );
		$this->assertSame( 2, $detail['members'][0]['open'] );
		$this->assertSame( 'Quiet', $detail['members'][1]['name'] );
	}

	/**
	 * @covers ::atwork_get_project
	 */
	public function test_a_missing_project_is_a_404() {
		$detail = atwork_get_project( 999999 );

		$this->assertWPError( $detail );
		$this->assertSame( 'atwork_project_not_found', $detail->get_error_code() );
	}

	/**
	 * Asking for a task id must not return a project-shaped answer about it.
	 *
	 * @covers ::atwork_get_project
	 */
	public function test_a_task_id_is_not_a_project() {
		$task   = atwork_create_task( array( 'title' => 'Not a project' ) );
		$detail = atwork_get_project( $task['id'] );

		$this->assertWPError( $detail );
		$this->assertSame( 'atwork_project_not_found', $detail->get_error_code() );
	}
}

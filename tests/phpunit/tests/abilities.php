<?php
/**
 * The WordPress Abilities surface.
 *
 * Skipped wholesale when the Abilities API is not present — it ships in
 * WordPress 6.9 and is also bundled by some plugins, so a site can have it from
 * either direction or from neither, and "neither" must be a skip rather than a
 * fatal.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_Abilities extends WP_UnitTestCase {

	/**
	 * An editor, so the permission callbacks pass.
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

		if ( ! function_exists( 'wp_register_ability' ) || ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'The Abilities API is not available on this install.' );
		}

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
	 * @covers ::atwork_register_abilities
	 */
	public function test_every_ability_is_registered() {
		$expected = array(
			'allterrain-work/list-projects',
			'allterrain-work/list-statuses',
			'allterrain-work/list-tasks',
			'allterrain-work/create-project',
			'allterrain-work/create-task',
			'allterrain-work/update-task',
			'allterrain-work/move-task',
			'allterrain-work/my-work',
			'allterrain-work/trash-task',
			'allterrain-work/attach-to-task',
			'allterrain-work/detach-from-task',
			'allterrain-work/trash-project',
			'allterrain-work/comment-on-task',
		);

		foreach ( $expected as $name ) {
			$this->assertNotNull( wp_get_ability( $name ), "{$name} is not registered." );
		}
	}

	/**
	 * An ability with no schema is a tool an agent has to guess at. Both ends
	 * are described so the call either validates or fails before it reaches
	 * the database.
	 *
	 * @covers ::atwork_register_abilities
	 */
	public function test_abilities_describe_both_ends() {
		$ability = wp_get_ability( 'allterrain-work/create-task' );

		$input = $ability->get_input_schema();

		$this->assertSame( 'object', $input['type'] );
		$this->assertContains( 'title', $input['required'] );
		$this->assertArrayHasKey( 'priority', $input['properties'] );
		$this->assertSame( atwork_priorities(), $input['properties']['priority']['enum'] );

		$this->assertNotEmpty( $ability->get_output_schema() );
		$this->assertNotEmpty( $ability->get_description() );
	}

	/**
	 * The abilities are wrappers over the same helpers the board uses, so this
	 * is really asserting they were wired to the right ones — an agent and a
	 * human dragging a card must reach the same code.
	 *
	 * @covers ::atwork_register_abilities
	 */
	public function test_create_task_ability_creates_a_task() {
		$result = wp_get_ability( 'allterrain-work/create-task' )->execute(
			array(
				'title'    => 'Filed by an agent',
				'status'   => $this->status( 'working-on-it' ),
				'priority' => 'high',
			)
		);

		$this->assertNotWPError( $result );
		$this->assertSame( 'Filed by an agent', $result['title'] );
		$this->assertSame( $this->status( 'working-on-it' ), $result['statusId'] );
		$this->assertSame( 'high', $result['priority'] );
		$this->assertSame( ATWORK_TASK_TYPE, get_post_type( $result['id'] ) );
	}

	/**
	 * @covers ::atwork_register_abilities
	 */
	public function test_move_task_ability_is_the_same_operation_as_a_drag() {
		$task = atwork_create_task( array( 'title' => 'Drag me' ) );

		$result = wp_get_ability( 'allterrain-work/move-task' )->execute(
			array(
				'id'       => $task['id'],
				'status'   => $this->status( 'done' ),
				'position' => 0,
			)
		);

		$this->assertNotWPError( $result );
		$this->assertSame( $this->status( 'done' ), $result['statusId'] );
	}

	/**
	 * The agent-facing payload is deliberately narrower than the widget's:
	 * project and status lists answer a question nobody asked and spend
	 * context doing it.
	 *
	 * @covers ::atwork_register_abilities
	 */
	public function test_my_work_ability_returns_only_tasks_and_counts() {
		atwork_create_task(
			array(
				'title' => 'Mine',
				'owner' => self::$editor,
			)
		);

		$result = wp_get_ability( 'allterrain-work/my-work' )->execute( array() );

		$this->assertNotWPError( $result );
		$this->assertSame( array( 'tasks', 'counts' ), array_keys( $result ) );
		$this->assertCount( 1, $result['tasks'] );
	}

	/**
	 * A subscriber must not reach the board through the agent door either.
	 *
	 * @covers ::atwork_register_abilities
	 */
	public function test_abilities_refuse_a_user_without_the_capability() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		// `check_permissions()` answers true, false, or a WP_Error explaining
		// the refusal. Anything but a strict `true` is a refusal, which is what
		// `execute()` itself goes on to enforce.
		$this->assertNotTrue( wp_get_ability( 'allterrain-work/create-task' )->check_permissions( array( 'title' => 'No' ) ) );
		$this->assertNotTrue( wp_get_ability( 'allterrain-work/list-tasks' )->check_permissions( array() ) );

		// And the refusal has to survive an actual call, not just the check.
		$this->assertWPError( wp_get_ability( 'allterrain-work/create-task' )->execute( array( 'title' => 'No' ) ) );
	}
}

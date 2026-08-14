<?php
/**
 * The fields a project has, and the panel that edits them.
 *
 * A project used to be a title and nothing else — a filter rather than a thing
 * you could plan. These pin the meta that changed that, and the two ways it has
 * to be reachable: through REST, because that is the only way the block editor
 * can read or write it, and through the payload the board paints from.
 *
 * @package AllTerrain_Work
 */

/**
 * @group allterrain-work
 */
class Tests_ATWork_ProjectFields extends WP_UnitTestCase {

	/**
	 * An editor, so the meta auth callbacks pass.
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

	// -- Sanitizers --------------------------------------------------------

	/**
	 * @covers ::atwork_sanitize_project_state
	 */
	public function test_state_falls_back_to_the_one_most_projects_are_in() {
		$this->assertSame( 'planning', atwork_sanitize_project_state( 'planning' ) );
		$this->assertSame( 'on-hold', atwork_sanitize_project_state( 'on-hold' ) );
		$this->assertSame( 'active', atwork_sanitize_project_state( 'sort-of-going' ) );
		$this->assertSame( 'active', atwork_sanitize_project_state( null ) );
	}

	/**
	 * A project's colour is optional, so it has to be clearable.
	 *
	 * `atwork_sanitize_hex_color()` falls back to grey, which is right for a
	 * column — every column has a colour — and wrong here: it would turn "no
	 * colour chosen" into "chose grey" and leave no way back to none.
	 *
	 * @covers ::atwork_sanitize_optional_hex_color
	 */
	public function test_an_optional_colour_can_be_cleared_and_never_becomes_grey_by_accident() {
		$this->assertSame( '#579bfc', atwork_sanitize_optional_hex_color( '#579BFC' ) );
		$this->assertSame( '', atwork_sanitize_optional_hex_color( '' ) );
		$this->assertSame( '', atwork_sanitize_optional_hex_color( 'rebeccapurple' ) );

		// Grey chosen deliberately still means grey.
		$this->assertSame( '#c4c4c4', atwork_sanitize_optional_hex_color( '#c4c4c4' ) );
	}

	// -- Registration ------------------------------------------------------

	/**
	 * The block editor reads and writes meta through the post's REST resource.
	 * A field that is not `show_in_rest` cannot be edited in Gutenberg at all,
	 * no matter what panel is registered for it — so this is the assertion that
	 * the sidebar can actually function.
	 *
	 * @covers ::atwork_register_project_meta
	 */
	public function test_every_project_field_is_reachable_from_the_block_editor() {
		$registered = get_registered_meta_keys( 'post', ATWORK_PROJECT_TYPE );

		foreach ( array( ATWORK_META_LEAD, ATWORK_META_START, ATWORK_META_TARGET, ATWORK_META_STATE, ATWORK_META_COLOR ) as $key ) {
			$this->assertArrayHasKey( $key, $registered, "{$key} is not registered." );
			$this->assertTrue( $registered[ $key ]['show_in_rest'], "{$key} is invisible to the editor." );
			$this->assertTrue( $registered[ $key ]['single'], "{$key} should be single." );
		}
	}

	/**
	 * @covers ::atwork_register_project_meta
	 */
	public function test_project_fields_round_trip_through_rest() {
		$project = atwork_create_project( array( 'title' => 'Redesign' ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/atwork-projects/' . $project['id'] );
		$request->set_body_params(
			array(
				'meta' => array(
					ATWORK_META_LEAD   => self::$editor,
					ATWORK_META_TARGET => '2026-12-01',
					ATWORK_META_STATE  => 'planning',
					ATWORK_META_COLOR  => '#579bfc',
				),
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();

		$this->assertSame( self::$editor, $data['meta'][ ATWORK_META_LEAD ] );
		$this->assertSame( '2026-12-01', $data['meta'][ ATWORK_META_TARGET ] );
		$this->assertSame( 'planning', $data['meta'][ ATWORK_META_STATE ] );
		$this->assertSame( '#579bfc', $data['meta'][ ATWORK_META_COLOR ] );
	}

	/**
	 * A nonsense state written through REST must land as a real one rather than
	 * reaching the board and rendering an unknown label.
	 *
	 * @covers ::atwork_sanitize_project_state
	 */
	public function test_rest_cannot_write_a_state_that_does_not_exist() {
		$project = atwork_create_project( array( 'title' => 'Redesign' ) );

		update_post_meta( $project['id'], ATWORK_META_STATE, 'whatever' );

		$this->assertSame( 'active', atwork_prepare_project( get_post( $project['id'] ) )['state'] );
	}

	// -- The payload the board paints from ---------------------------------

	/**
	 * @covers ::atwork_prepare_project
	 */
	public function test_the_project_payload_carries_its_new_fields() {
		$project = atwork_create_project( array( 'title' => 'Redesign' ) );

		update_post_meta( $project['id'], ATWORK_META_LEAD, self::$editor );
		update_post_meta( $project['id'], ATWORK_META_STATE, 'on-hold' );
		update_post_meta( $project['id'], ATWORK_META_START, '2026-01-05' );
		update_post_meta( $project['id'], ATWORK_META_TARGET, '2026-06-30' );
		update_post_meta( $project['id'], ATWORK_META_COLOR, '#a25ddc' );

		$payload = atwork_prepare_project( get_post( $project['id'] ) );

		$this->assertSame( 'on-hold', $payload['state'] );
		$this->assertSame( '2026-01-05', $payload['start'] );
		$this->assertSame( '2026-06-30', $payload['target'] );
		$this->assertSame( '#a25ddc', $payload['color'] );
		$this->assertSame( self::$editor, $payload['leadId'] );
		$this->assertSame( 'Ana Ruiz', $payload['leadName'] );
	}

	/**
	 * A brand-new project has no lead and no colour, and must say so rather
	 * than inventing either.
	 *
	 * @covers ::atwork_prepare_project
	 */
	public function test_a_fresh_project_reports_empty_fields_honestly() {
		$project = atwork_create_project( array( 'title' => 'Brand new' ) );
		$payload = atwork_prepare_project( get_post( $project['id'] ) );

		$this->assertSame( 0, $payload['leadId'] );
		$this->assertSame( '', $payload['leadName'] );
		$this->assertSame( '', $payload['color'] );
		$this->assertSame( '', $payload['target'] );
		$this->assertSame( 'active', $payload['state'] );
	}

	// -- The panel's configuration -----------------------------------------

	/**
	 * The meta keys travel to the bundle rather than being hardcoded in it.
	 *
	 * They are private, `_`-prefixed implementation detail that PHP reaches
	 * through named constants everywhere else; a literal `'_atwork_target'` in
	 * TypeScript is the one copy nobody would think to update.
	 *
	 * @covers ::atwork_editor_config
	 */
	public function test_the_panel_is_told_the_meta_keys_rather_than_guessing_them() {
		$config = atwork_editor_config( ATWORK_PROJECT_TYPE );

		$this->assertSame( ATWORK_META_TARGET, $config['meta']['target'] );
		$this->assertSame( ATWORK_META_LEAD, $config['meta']['lead'] );
		$this->assertSame( ATWORK_META_DUE, $config['meta']['due'] );
		$this->assertSame( ATWORK_PROJECT_TYPE, $config['postType'] );
	}

	/**
	 * Every enum the panel offers needs a label, or a select renders raw slugs.
	 *
	 * @covers ::atwork_editor_config
	 */
	public function test_every_option_the_panel_offers_has_a_label() {
		$config = atwork_editor_config( ATWORK_TASK_TYPE );

		foreach ( $config['priorities'] as $slug ) {
			$this->assertArrayHasKey( $slug, $config['priorityLabels'], "No label for priority {$slug}." );
		}

		foreach ( $config['states'] as $slug ) {
			$this->assertArrayHasKey( $slug, $config['stateLabels'], "No label for state {$slug}." );
		}
	}

	/**
	 * Assigning must be reachable from the board, not only by dragging a user
	 * tile onto a card — a gesture that needs WP Explorer open and that nothing
	 * in the UI suggests.
	 *
	 * @covers ::atwork_get_assignees
	 */
	public function test_the_assignee_picker_offers_people_who_can_do_the_work() {
		$editor     = self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Ana Ruiz',
			)
		);
		$subscriber = self::factory()->user->create(
			array(
				'role'         => 'subscriber',
				'display_name' => 'Sam Reader',
			)
		);

		$names = wp_list_pluck( atwork_get_assignees(), 'name' );

		$this->assertContains( 'Ana Ruiz', $names );

		// A subscriber cannot open a task, and assigning work to someone who
		// cannot open it is a way of losing the work.
		$this->assertNotContains( 'Sam Reader', $names );

		unset( $editor, $subscriber );
	}

	/**
	 * A picker is opened to find one known person, so it searches.
	 *
	 * @covers ::atwork_get_assignees
	 */
	public function test_the_assignee_picker_searches_by_name() {
		self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Zephyr Quill',
			)
		);

		$names = wp_list_pluck( atwork_get_assignees( 'Zephyr' ), 'name' );

		$this->assertContains( 'Zephyr Quill', $names );
		$this->assertNotContains( 'Ana Ruiz', $names );
	}

	/**
	 * @covers ::atwork_get_assignees
	 */
	public function test_a_user_who_cannot_edit_gets_no_assignee_list() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertSame( array(), atwork_get_assignees() );
	}

	/**
	 * Every assignee carries what the picker draws: a name and a face.
	 *
	 * @covers ::atwork_get_assignees
	 */
	public function test_assignees_carry_a_name_and_an_avatar() {
		$one = atwork_get_assignees();

		$this->assertNotEmpty( $one );
		$this->assertArrayHasKey( 'id', $one[0] );
		$this->assertArrayHasKey( 'name', $one[0] );
		$this->assertArrayHasKey( 'avatar', $one[0] );
	}

	/**
	 * The panel script has to be registered, or `wp_enqueue_script()` in the
	 * editor hook silently enqueues nothing.
	 *
	 * @covers ::atwork_register_assets
	 */
	public function test_the_panel_script_is_registered_with_its_editor_dependencies() {
		atwork_register_assets();

		$script = wp_scripts()->query( 'allterrain-work-editor', 'registered' );

		$this->assertNotFalse( $script );

		// Written against the editor globals rather than importing the packages,
		// so these are real load-order dependencies rather than bookkeeping.
		foreach ( array( 'wp-element', 'wp-data', 'wp-plugins', 'wp-components' ) as $dependency ) {
			$this->assertContains( $dependency, $script->deps );
		}
	}
}

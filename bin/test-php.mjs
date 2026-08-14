/**
 * Runs the PHPUnit suite where a WordPress test library actually exists.
 *
 * The suite needs three things this repository does not contain: a WordPress
 * checkout, a `wp-tests-config.php`, and a MySQL server. All three live in the
 * `wordpress-alcazaba` docker-compose project that serves the manual-QA site, so
 * the tests run *there* rather than on the host -- where `DB_HOST` is the
 * compose alias `mysql` and resolves to nothing.
 *
 * The plugin ships without its `tests/` directory (see `bin/ships.mjs`), so this
 * copies the suite into the deployed plugin for the run and takes it out again
 * afterwards. A test directory left behind in a running site is a set of files
 * with no reason to be there and a `bootstrap.php` that defines unprefixed
 * functions impersonating another plugin's API.
 *
 * Override the container with ATWORK_PHP_CONTAINER. Skips with a note rather
 * than failing when Docker or the container is not there, so `npm test` on a
 * machine without the environment is still useful.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );

const CONTAINER = process.env.ATWORK_PHP_CONTAINER || 'wordpress-alcazaba-php-1';
const CHECKOUT = resolve( root, '../wordpress-alcazaba' );
const DEPLOYED = join( CHECKOUT, 'src/wp-content/plugins/allterrain-work' );
const IN_CONTAINER = '/var/www/src/wp-content/plugins/allterrain-work';

/** Whether a container of that name is running. */
function containerIsUp() {
	try {
		const names = execFileSync( 'docker', [ 'ps', '--format', '{{.Names}}' ], {
			encoding: 'utf8',
		} );

		return names.split( '\n' ).includes( CONTAINER );
	} catch {
		return false;
	}
}

function skip( reason ) {
	console.log( `[allterrain-work] Skipping PHPUnit: ${ reason }` );
	process.exit( 0 );
}

if ( ! containerIsUp() ) {
	skip( `container "${ CONTAINER }" is not running. Start the QA environment first.` );
}

if ( ! existsSync( DEPLOYED ) ) {
	skip( `the plugin is not deployed at ${ DEPLOYED }. Run \`npm run build\` first.` );
}

const stagedTests = join( DEPLOYED, 'tests' );

rmSync( stagedTests, { recursive: true, force: true } );
cpSync( join( root, 'tests' ), stagedTests, { recursive: true } );

const result = spawnSync(
	'docker',
	[
		'exec',
		CONTAINER,
		'sh',
		'-c',
		`cd ${ IN_CONTAINER } && WP_TESTS_DIR=/var/www/tests/phpunit ` +
			'/var/www/vendor/bin/phpunit --configuration tests/phpunit/phpunit.xml.dist ' +
			process.argv.slice( 2 ).join( ' ' ),
	],
	{ stdio: 'inherit' }
);

// Always, even on failure: the copy is scaffolding, and leaving it behind after
// a red run is exactly when it is most likely to be forgotten.
rmSync( stagedTests, { recursive: true, force: true } );

process.exit( result.status ?? 1 );

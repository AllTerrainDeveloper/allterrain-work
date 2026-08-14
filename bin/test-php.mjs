/**
 * Runs the PHPUnit suite where a WordPress test library actually exists.
 *
 * The suite needs three things this repository does not contain: a WordPress
 * checkout, a `wp-tests-config.php`, and a MySQL server. Two environments can
 * supply them, and this picks whichever is actually there:
 *
 *   alcazaba  the docker-compose project behind the manual-QA site. Already
 *             running on the machine this plugin is developed on, so the tests
 *             cost nothing to run and use the same WordPress the board is being
 *             looked at in.
 *   wp-env    WordPress's own environment, from `.wp-env.json`. Needs no sibling
 *             checkout, which is what makes it the one CI can use.
 *
 * One command rather than one per environment, deliberately. Two entry points
 * running "the tests" is how a suite ends up green on a laptop and red on a
 * runner for reasons nobody can reproduce -- and how one of them quietly stops
 * being run at all.
 *
 * Force a backend with `ATWORK_PHP_BACKEND=alcazaba|wp-env`. Override the
 * compose container with `ATWORK_PHP_CONTAINER`. Skips with a note rather than
 * failing when neither environment is up, so `npm test` on a fresh machine is
 * still useful.
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
const SLUG = 'allterrain-work';

/** Extra arguments to hand to PHPUnit, e.g. `--filter`. */
const args = process.argv.slice( 2 );

/**
 * Whether a container of that name is running.
 *
 * @param {string} name Container name.
 */
function containerIsUp( name ) {
	try {
		const names = execFileSync( 'docker', [ 'ps', '--format', '{{.Names}}' ], {
			encoding: 'utf8',
		} );

		return names.split( '\n' ).includes( name );
	} catch {
		return false;
	}
}

/**
 * Reports that the suite could not run, without failing the build.
 *
 * @param {string} reason Why.
 */
function skip( reason ) {
	process.stdout.write( `[${ SLUG }] Skipping PHPUnit: ${ reason }\n` );
	process.exit( 0 );
}

/**
 * Runs the suite in the manual-QA compose project.
 *
 * The plugin ships without its `tests/` directory (see `bin/ships.mjs`), so the
 * suite is copied into the deployed plugin for the run and taken out again
 * afterwards. A test directory left behind in a running site is a set of files
 * with no reason to be there and a `bootstrap.php` that defines unprefixed
 * functions impersonating another plugin's API.
 */
function runOnAlcazaba() {
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
				args.join( ' ' ),
		],
		{ stdio: 'inherit' }
	);

	// Always, even on failure: the copy is scaffolding, and leaving it behind
	// after a red run is exactly when it is most likely to be forgotten.
	rmSync( stagedTests, { recursive: true, force: true } );

	return result.status ?? 1;
}

/**
 * Runs the suite in wp-env.
 *
 * `tests-cli` rather than `cli`: wp-env keeps a second WordPress install for
 * tests, and the test library's `wp-tests-config.php` only exists there. The
 * repository is mounted in place, so unlike the compose path there is nothing
 * to copy in or clean up.
 */
function runOnWpEnv() {
	const result = spawnSync(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			`--env-cwd=wp-content/plugins/${ SLUG }`,
			'vendor/bin/phpunit',
			'--configuration',
			'tests/phpunit/phpunit.xml.dist',
			...args,
		],
		{ stdio: 'inherit' }
	);

	return result.status ?? 1;
}

/** Whether wp-env has containers up for this project. */
function wpEnvIsUp() {
	try {
		const names = execFileSync( 'docker', [ 'ps', '--format', '{{.Names}}' ], {
			encoding: 'utf8',
		} );

		return /wp-env.*tests-cli/.test( names ) || /wp-env.*tests-wordpress/.test( names );
	} catch {
		return false;
	}
}

const forced = process.env.ATWORK_PHP_BACKEND;

if ( forced && ! [ 'alcazaba', 'wp-env' ].includes( forced ) ) {
	process.stderr.write(
		`[${ SLUG }] Unknown ATWORK_PHP_BACKEND "${ forced }". Use "alcazaba" or "wp-env".\n`
	);
	process.exit( 1 );
}

if ( 'wp-env' === forced ) {
	process.exit( runOnWpEnv() );
}

if ( 'alcazaba' === forced ) {
	if ( ! containerIsUp( CONTAINER ) ) {
		skip( `container "${ CONTAINER }" is not running.` );
	}

	if ( ! existsSync( DEPLOYED ) ) {
		skip( `the plugin is not deployed at ${ DEPLOYED }. Run \`npm run build\` first.` );
	}

	process.exit( runOnAlcazaba() );
}

// Unforced: prefer the QA environment when it is both running and deployed to,
// because it is already warm and it is the same site the board is being looked
// at in. Otherwise fall back to wp-env, which is the only one CI has.
if ( containerIsUp( CONTAINER ) && existsSync( DEPLOYED ) ) {
	process.exit( runOnAlcazaba() );
}

if ( wpEnvIsUp() ) {
	process.exit( runOnWpEnv() );
}

skip(
	'no PHP environment is running. Start one with `npm run env:start` (wp-env), ' +
		'or bring up the wordpress-alcazaba QA site and run `npm run build`.'
);

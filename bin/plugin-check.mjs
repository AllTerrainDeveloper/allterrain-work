/**
 * Runs WordPress's own Plugin Check against the plugin.
 *
 * Plugin Check is the tool the WordPress.org review queue runs, so it is the
 * closest thing to a pre-submission verdict available locally. It is a plugin
 * rather than a standalone binary, so it has to be installed into a running
 * WordPress: this uses the wp-env instance the test suite can already fall back
 * on.
 *
 * Installed on first use and then left in place. Reinstalling on every run would
 * add a network round trip to a command people should be able to run constantly.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ships } from './ships.mjs';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const slug = 'allterrain-work';

/**
 * Splits the repository root into what ships and what does not.
 *
 * wp-env maps the *repository* into the site rather than the packaged plugin,
 * so without this the check reports the build tooling: `.wp-env.json` as a
 * forbidden hidden file, `phpcs.xml.dist` as an application file, `bin/` as
 * unexpected scripting. None of it is in the zip.
 *
 * The list is derived from `ships()` rather than written out again, because a
 * second hand-maintained copy of "what ships" is a copy that drifts. Asking the
 * packager directly means the check can only ever be blind to things the zip
 * genuinely does not contain -- add a directory to `EXCLUDED` and the check
 * follows on its own.
 *
 * @return {{ directories: string[], files: string[] }} Names Plugin Check should skip.
 */
function excluded() {
	const directories = [];
	const files = [];

	for ( const entry of readdirSync( root, { withFileTypes: true } ) ) {
		if ( ships( entry.name ) ) {
			continue;
		}

		( entry.isDirectory() ? directories : files ).push( entry.name );
	}

	return { directories, files };
}

/**
 * Runs a command in the wp-env CLI container.
 *
 * @param {string[]} args  Arguments after `wp`.
 * @param {boolean}  quiet Whether to capture output instead of printing it.
 * @return {{ status: number, stdout: string, stderr: string }} Result.
 */
function wp( args, quiet = false ) {
	const result = spawnSync( 'npx', [ 'wp-env', 'run', 'cli', 'wp', ...args ], {
		encoding: 'utf8',
		stdio: quiet ? 'pipe' : 'inherit',
	} );

	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

/**
 * Turns Plugin Check's JSON report into a flat list of findings.
 *
 * The output is not a single JSON document: it is a `FILE: <path>` header
 * followed by one JSON array per file, repeated. So the file each finding
 * belongs to comes from the header above it rather than from the finding itself.
 *
 * @param {string} output Raw stdout from `wp plugin check --format=json`.
 * @return {Array<Object>} Findings, each carrying the file it was reported against.
 */
function parseFindings( output ) {
	const findings = [];
	let file = '(unknown file)';

	for ( const line of output.split( '\n' ) ) {
		const trimmed = line.trim();

		if ( trimmed.startsWith( 'FILE:' ) ) {
			file = trimmed.slice( 'FILE:'.length ).trim();
			continue;
		}

		if ( ! trimmed.startsWith( '[' ) ) {
			continue;
		}

		let parsed;

		try {
			parsed = JSON.parse( trimmed );
		} catch {
			process.stderr.write(
				`[${ slug }] Could not parse Plugin Check output. Raw output:\n${ output }\n`
			);
			process.exit( 1 );
		}

		for ( const finding of parsed ) {
			findings.push( { ...finding, file } );
		}
	}

	return findings;
}

process.stdout.write( `[${ slug }] Checking the wp-env instance…\n` );

const running = wp( [ 'core', 'is-installed' ], true );

if ( 0 !== running.status ) {
	process.stderr.write( `[${ slug }] wp-env is not running. Start it with \`npm run env:start\`.\n` );
	process.exit( 1 );
}

const installed = wp( [ 'plugin', 'is-installed', 'plugin-check' ], true );

if ( 0 !== installed.status ) {
	process.stdout.write( `[${ slug }] Installing Plugin Check…\n` );

	const install = wp( [ 'plugin', 'install', 'plugin-check', '--activate' ] );

	if ( 0 !== install.status ) {
		process.stderr.write( `[${ slug }] Could not install Plugin Check.\n` );
		process.exit( 1 );
	}
} else {
	// Installed but possibly deactivated by a previous run or a reset.
	wp( [ 'plugin', 'activate', 'plugin-check' ], true );
}

process.stdout.write( `[${ slug }] Running Plugin Check…\n\n` );

// Severity 5 and above is what fails the WordPress.org review queue; the
// advisory findings below it are worth reading but are not a gate.
//
// Read as JSON and counted rather than trusted to set an exit code, because
// `wp plugin check` EXITS 0 WHILE REPORTING ERRORS -- verified against a
// deliberate stable-tag mismatch, which is on its own enough to have a
// submission rejected and which still exited 0. A release gate wired to that
// exit code would pass every time and catch nothing.
const { directories, files } = excluded();
const report = wp(
	[
		'plugin',
		'check',
		slug,
		`--exclude-directories=${ directories.join( ',' ) }`,
		`--exclude-files=${ files.join( ',' ) }`,
		'--severity=5',
		'--format=json',
	],
	true
);

// An empty report is only good news when the command actually ran. A wp-cli
// failure (plugin not installed, container gone) also produces no findings, and
// must not be mistaken for a clean bill of health.
if ( 0 !== report.status && ! report.stdout.includes( '[' ) ) {
	process.stderr.write(
		`[${ slug }] Plugin Check did not run.\n${ report.stdout }${ report.stderr }`
	);
	process.exit( 1 );
}

const findings = parseFindings( report.stdout );

if ( 0 === findings.length ) {
	process.stdout.write( `[${ slug }] Plugin Check passed — no errors found.\n` );
	process.exit( 0 );
}

process.stderr.write(
	`[${ slug }] Plugin Check found ${ findings.length } error${ 1 === findings.length ? '' : 's' }:\n\n`
);

for ( const finding of findings ) {
	const where = finding.line ? `${ finding.file }:${ finding.line }` : finding.file;

	process.stderr.write( `  ${ where }\n    [${ finding.code }] ${ finding.message }\n\n` );
}

process.stderr.write(
	`[${ slug }] WordPress.org runs this same check. Fix the above before releasing.\n`
);
process.exit( 1 );

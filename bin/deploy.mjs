/**
 * Syncs the built plugin into the local WordPress Docker instance.
 *
 * The manual-QA site at http://localhost:8889 is the `wordpress-alcazaba`
 * docker-compose project. It bind-mounts its own checkout at /var/www, so
 * anything written into `<checkout>/src/wp-content/plugins/allterrain-work` is
 * live in the container immediately -- no restart, no upload screen.
 *
 * Runs as part of `npm run build`, so every change reaches the site without a
 * separate step. When no WordPress checkout is present (CI, a fresh clone, a
 * different machine) it prints a note and exits successfully rather than failing
 * the build -- deploying is a convenience, not a build requirement.
 *
 * Override the destination with ATWORK_DEPLOY_TARGET, or skip entirely with
 * ATWORK_SKIP_DEPLOY=1.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ships } from './ships.mjs';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );

/**
 * Marker proving a directory is an AllTerrain Work install rather than something else.
 *
 * The sync deletes files the source no longer has, so it must never be pointed at
 * a directory it does not own. Refusing unless this file is present is the guard.
 */
const OWNERSHIP_MARKER = 'allterrain-work.php';

/** Resolves the plugin directory to write to, or null when there is nothing to do. */
function resolveTarget() {
	if ( process.env.ATWORK_SKIP_DEPLOY === '1' ) {
		return null;
	}

	if ( process.env.ATWORK_DEPLOY_TARGET ) {
		return resolve( process.env.ATWORK_DEPLOY_TARGET );
	}

	const candidates = [
		resolve( root, '../wordpress-alcazaba/src/wp-content/plugins' ),
		resolve( root, '../wordpress-develop/src/wp-content/plugins' ),
	];

	for ( const plugins of candidates ) {
		if ( existsSync( plugins ) ) {
			return join( plugins, 'allterrain-work' );
		}
	}

	return null;
}

/**
 * Mirrors the source tree into the destination.
 *
 * Copies what changed and removes what the source no longer has, so a renamed or
 * deleted file cannot linger in the running site and mask a bug.
 *
 * @param {string}  from Source directory.
 * @param {string}  to   Destination directory.
 * @param {boolean} top  Whether this is the top level, where the ships() filter applies.
 * @return {{written: number, removed: number}} Counts.
 */
function mirror( from, to, top = false ) {
	let written = 0;
	let removed = 0;

	mkdirSync( to, { recursive: true } );

	const sourceEntries = readdirSync( from, { withFileTypes: true } ).filter(
		( entry ) => ! ( top && ! ships( entry.name ) ) && entry.name !== '.DS_Store'
	);
	const keep = new Set( sourceEntries.map( ( entry ) => entry.name ) );

	for ( const entry of readdirSync( to, { withFileTypes: true } ) ) {
		if ( ! keep.has( entry.name ) ) {
			rmSync( join( to, entry.name ), { recursive: true, force: true } );
			removed++;
		}
	}

	for ( const entry of sourceEntries ) {
		const src = join( from, entry.name );
		const dest = join( to, entry.name );

		if ( entry.isDirectory() ) {
			const nested = mirror( src, dest );
			written += nested.written;
			removed += nested.removed;
			continue;
		}

		// Skip bytes that are already identical, so a no-op deploy is genuinely
		// free and mtimes on the site stay meaningful.
		if ( existsSync( dest ) ) {
			const a = statSync( src );
			const b = statSync( dest );

			if ( a.size === b.size && a.mtimeMs <= b.mtimeMs ) {
				continue;
			}
		}

		cpSync( src, dest );
		written++;
	}

	return { written, removed };
}

const target = resolveTarget();

if ( ! target ) {
	console.log(
		'[allterrain-work] No local WordPress checkout found — skipping deploy. ' +
			'Set ATWORK_DEPLOY_TARGET to override.'
	);
	process.exit( 0 );
}

if ( existsSync( target ) && ! existsSync( join( target, OWNERSHIP_MARKER ) ) ) {
	console.error(
		`[allterrain-work] Refusing to sync into ${ target }: it exists but has no ${ OWNERSHIP_MARKER }.\n` +
			'That directory does not look like an AllTerrain Work install, and syncing removes files.'
	);
	process.exit( 1 );
}

for ( const required of [ 'assets/js/board.min.js', 'assets/js/widget.min.js' ] ) {
	if ( ! existsSync( join( root, required ) ) ) {
		console.error(
			`[allterrain-work] ${ required } is missing. Run \`npm run build\` rather than deploying alone.`
		);
		process.exit( 1 );
	}
}

const { written, removed } = mirror( root, target, true );

console.log(
	`[allterrain-work] Deployed to ${ target } (${ written } file${ written === 1 ? '' : 's' } updated` +
		`${ removed ? `, ${ removed } removed` : '' }).`
);

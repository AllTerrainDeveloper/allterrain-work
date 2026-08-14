/**
 * What actually ships inside the plugin.
 *
 * One list, imported by the local deploy, because two answers to this question
 * is how a running site ends up carrying `node_modules` or missing a file the
 * QA site has been running happily for weeks. If it is not here, it is
 * development scaffolding and stays in the repository.
 */

/** Directories and files that never reach a running site or a release. */
export const EXCLUDED = new Set( [
	// Dependency trees.
	'node_modules',
	'vendor',

	// Sources and the tools that turn them into the built bundles.
	'bin',
	'src',
	'tests',
	'package.json',
	'package-lock.json',
	'composer.json',
	'composer.lock',
	'phpcs.xml.dist',
	'vite.config.js',
	'tsconfig.json',

	// Developer documentation. `readme.txt` is the one users see, and it ships.
	'README.md',

	// Output of a packaging step.
	'dist',
] );

/**
 * Whether a top-level entry belongs in a distributed copy of the plugin.
 *
 * Nothing beginning with a dot ever ships, and that rule is deliberately blind
 * rather than a list of known offenders. Version control, editor directories and
 * every agent config that accumulates in a repository over time are all
 * development scaffolding, and a deny-list only excludes the ones somebody
 * remembered to add. WordPress.org's Plugin Check flags hidden files, so a leak
 * here is not merely untidy: it fails review.
 *
 * @param {string} name Entry name, relative to the repository root.
 * @return {boolean} True when it ships.
 */
export function ships( name ) {
	return ! name.startsWith( '.' ) && ! EXCLUDED.has( name );
}

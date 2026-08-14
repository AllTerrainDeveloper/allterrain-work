import { defineConfig } from 'vite';

/**
 * Two bundles, four passes.
 *
 * `board` is the native window's script; `widget` is the desktop widget's. They
 * are separate because they load on different schedules -- the board when its
 * window opens, the widget when somebody has it on their desktop -- and a single
 * bundle would mean every widget user paying for a board they may never open.
 *
 * Each target builds twice: `--mode development` emits the readable file
 * WordPress serves under `SCRIPT_DEBUG`, `--mode production` the minified one.
 * `emptyOutDir` is off so the second pass does not delete the first pass's
 * output -- and so `board` does not delete `widget`.
 *
 * Which target a pass builds comes from `ATWORK_TARGET`, because Vite's library
 * mode takes one entry per config.
 */
const TARGETS = {
	board: {
		entry: 'src/index.ts',
		fileBase: 'board',
		iifeName: 'allTerrainWorkBoard',
	},
	widget: {
		entry: 'src/widget.ts',
		fileBase: 'widget',
		iifeName: 'allTerrainWorkWidget',
	},
	editor: {
		entry: 'src/editor.ts',
		fileBase: 'editor',
		iifeName: 'allTerrainWorkEditorPanel',
	},
	explorer: {
		entry: 'src/explorer.ts',
		fileBase: 'explorer',
		iifeName: 'allTerrainWorkExplorer',
	},
};

export default defineConfig( ( { mode } ) => {
	const name = process.env.ATWORK_TARGET || 'board';
	const target = TARGETS[ name ];

	if ( ! target ) {
		throw new Error(
			`Unknown ATWORK_TARGET "${ name }". Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`
		);
	}

	const isProd = mode === 'production';

	return {
		build: {
			outDir: 'assets/js',
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: target.entry,
				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () => `${ target.fileBase }${ isProd ? '.min' : '' }.js`,
			},
		},
		test: {
			environment: 'jsdom',
			include: [ 'tests/vitest/**/*.test.ts' ],
		},
	};
} );

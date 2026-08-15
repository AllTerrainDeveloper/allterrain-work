/**
 * Reaching the shell's component kit at runtime.
 *
 * `ensureComponents()` is the one place this plugin talks to
 * `wp.os.loadComponents()`, and almost all of it is the unhappy paths: a site
 * on a shell older than that API, the standalone admin page with no shell at
 * all, a fetch that fails, a tag list that was already satisfied. Each of those
 * has to end with the board rendering native controls rather than throwing or
 * hanging, because the alternative is a screen of inert markup.
 *
 * The return value is load-bearing in its own right: the board redraws on
 * `true`, so answering `true` when nothing changed spends a full re-render for
 * no reason, and answering `false` when tags did arrive leaves native inputs on
 * screen next to components.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPONENT_TAGS, ensureComponents } from '../../src/os-ui';

type Loader = ( tags: readonly string[] ) => Promise< void >;

/** Pretends a set of tags is registered, without defining real elements. */
function withRegistry( defined: Set< string > ): void {
	vi.spyOn( customElements, 'get' ).mockImplementation( ( tag: string ) =>
		defined.has( tag ) ? ( function () {} as unknown as CustomElementConstructor ) : undefined
	);
}

/** Installs a `wp.os.loadComponents` that registers `registers` when called. */
function withShell( registers: string[], defined: Set< string > ): { calls: string[][] } {
	const calls: string[][] = [];

	const load: Loader = ( tags ) => {
		calls.push( [ ...tags ] );
		registers.forEach( ( tag ) => defined.add( tag ) );

		return Promise.resolve();
	};

	( window as unknown as { wp: { os: { loadComponents: Loader } } } ).wp = {
		os: { loadComponents: load },
	};

	return { calls };
}

describe( 'ensureComponents', () => {
	beforeEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	it( 'does not call the shell when every tag is already registered', async () => {
		const defined = new Set( COMPONENT_TAGS );
		withRegistry( defined );
		const { calls } = withShell( [], defined );

		expect( await ensureComponents() ).toBe( false );
		expect( calls ).toHaveLength( 0 );
	} );

	it( 'asks for the tags it is about to render, so the loader can skip the fetch', async () => {
		const defined = new Set< string >();
		withRegistry( defined );
		const { calls } = withShell( [ ...COMPONENT_TAGS ], defined );

		await ensureComponents();

		// The argument is what lets the shell answer without a request next
		// time; calling with no tags would always fetch the whole kit.
		expect( calls[ 0 ] ).toEqual( [ ...COMPONENT_TAGS ] );
	} );

	it( 'reports true when a missing tag actually arrives', async () => {
		const defined = new Set< string >( [ 'os-select', 'os-option', 'os-button' ] );
		withRegistry( defined );
		withShell( [ 'os-text-field' ], defined );

		expect( await ensureComponents() ).toBe( true );
	} );

	/*
	 * The shell can resolve without registering anything -- a page with no
	 * bundle URL configured does exactly that. A redraw then paints the same
	 * native controls a second time.
	 */
	it( 'reports false when the call resolves but nothing upgraded', async () => {
		const defined = new Set< string >();
		withRegistry( defined );
		withShell( [], defined );

		expect( await ensureComponents() ).toBe( false );
	} );

	it( 'resolves quietly on a shell too old to have the API', async () => {
		withRegistry( new Set() );
		( window as unknown as { wp: { os: Record< string, unknown > } } ).wp = { os: {} };

		expect( await ensureComponents() ).toBe( false );
	} );

	it( 'resolves quietly with no shell at all', async () => {
		withRegistry( new Set() );

		expect( await ensureComponents() ).toBe( false );
	} );

	/*
	 * The board is usable with native controls, so a kit that will not download
	 * is a cosmetic loss. It must not reject: `mountBoard` fires this without a
	 * catch of its own, and an unhandled rejection in a native window is noise
	 * in every console on the desktop.
	 */
	it( 'swallows a failed fetch rather than rejecting', async () => {
		withRegistry( new Set() );
		( window as unknown as { wp: { os: { loadComponents: Loader } } } ).wp = {
			os: { loadComponents: () => Promise.reject( new Error( 'offline' ) ) },
		};

		await expect( ensureComponents() ).resolves.toBe( false );
	} );

	it( 'honours an explicit tag list over the default', async () => {
		const defined = new Set< string >( COMPONENT_TAGS );
		withRegistry( defined );
		const { calls } = withShell( [ 'os-table' ], defined );

		expect( await ensureComponents( [ 'os-table' ] ) ).toBe( true );
		expect( calls[ 0 ] ).toEqual( [ 'os-table' ] );
	} );
} );

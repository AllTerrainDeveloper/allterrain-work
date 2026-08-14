/**
 * Reading what the desktop dropped on a card.
 *
 * These payloads are built by *other* code — WP Explorer tiles, wallpaper file
 * tiles, plugins nobody has written yet — and arrive as plain objects that
 * TypeScript cannot check at the boundary. So the parsing is pinned hard: both
 * shapes, single and multi, which kinds may be attached, and every way a
 * payload can be malformed without taking the board down with it.
 *
 * The refusals matter more than the acceptances. Attaching a *term* by its id
 * would link a task to a row in another table entirely, and a half-built
 * payload that produced an attachment called "undefined" would be worse than
 * one that was simply declined.
 */

import { describe, expect, it } from 'vitest';
import {
	assigneeIn,
	attachableEntities,
	entitiesIn,
	isDesktopPayload,
	sourcePostId,
} from '../../src/desktop-drops';
import type { DragPayload } from '../../src/types';

/** A payload of the given type carrying `data`. */
function payload( type: string, data: Record< string, unknown > ): DragPayload {
	return { type, source: document.createElement( 'div' ), data };
}

/** What a WP Explorer tile emits for a single entity. */
function shortcut( kind: string, ref: string, title?: string ): DragPayload {
	return payload( 'shortcut', { kind, ref, title } );
}

/** What a wallpaper file tile emits. */
function desktopFile( type: string, ref: string, title?: string ): DragPayload {
	return payload( 'desktop-file', {
		placement: { file: { type, ref, title } },
		sourceFolderId: 0,
	} );
}

describe( 'isDesktopPayload', () => {
	it( 'recognises the two framework shapes', () => {
		expect( isDesktopPayload( shortcut( 'post', '1' ) ) ).toBe( true );
		expect( isDesktopPayload( desktopFile( 'post', '1' ) ) ).toBe( true );
	} );

	it( 'ignores this plugin\'s own card payload', () => {
		// Cards reorder through their own path; treating one as droppable
		// content would create a task about a task.
		expect( isDesktopPayload( payload( 'allterrain-work/task', {} ) ) ).toBe( false );
	} );

	it( 'ignores a payload type it has never heard of', () => {
		expect( isDesktopPayload( payload( 'some-plugin/thing', { ref: '1' } ) ) ).toBe( false );
	} );
} );

describe( 'entitiesIn', () => {
	it( 'reads a single shortcut', () => {
		expect( entitiesIn( shortcut( 'post', '42', 'Hello' ) ) ).toEqual( [
			{ kind: 'post', ref: '42', title: 'Hello' },
		] );
	} );

	it( 'reads every item of a multi-selection drag', () => {
		const multi = payload( 'shortcut', {
			kind: 'post',
			ref: '1',
			title: 'One',
			items: [
				{ kind: 'post', ref: '1', title: 'One' },
				{ kind: 'post', ref: '2', title: 'Two' },
				{ kind: 'page', ref: '3', title: 'Three' },
			],
		} );

		expect( entitiesIn( multi ).map( ( e ) => e.ref ) ).toEqual( [ '1', '2', '3' ] );
	} );

	it( 'reads a desktop-file placement', () => {
		expect( entitiesIn( desktopFile( 'attachment', '7', 'photo.jpg' ) ) ).toEqual( [
			{ kind: 'attachment', ref: '7', title: 'photo.jpg' },
		] );
	} );

	it( 'reads every placement of a multi-tile drag', () => {
		const multi = payload( 'desktop-file', {
			placement: { file: { type: 'post', ref: '1' } },
			placements: [
				{ file: { type: 'post', ref: '1' } },
				{ file: { type: 'post', ref: '2' } },
			],
		} );

		expect( entitiesIn( multi ).map( ( e ) => e.ref ) ).toEqual( [ '1', '2' ] );
	} );

	it( 'drops entries with no kind or no ref rather than inventing them', () => {
		const ragged = payload( 'shortcut', {
			kind: 'post',
			ref: '1',
			items: [
				{ kind: 'post', ref: '1' },
				{ kind: 'post' },
				{ ref: '9' },
				{},
			],
		} );

		expect( entitiesIn( ragged ) ).toEqual( [ { kind: 'post', ref: '1', title: '' } ] );
	} );

	it( 'survives a desktop-file payload with no placement at all', () => {
		expect( entitiesIn( payload( 'desktop-file', {} ) ) ).toEqual( [] );
	} );

	it( 'returns nothing for a foreign payload', () => {
		expect( entitiesIn( payload( 'allterrain-work/task', { task: { id: 1 } } ) ) ).toEqual( [] );
	} );
} );

describe( 'attachableEntities', () => {
	it( 'accepts anything that lives in wp_posts', () => {
		// One field of post ids covers posts, pages, media and every custom
		// type, because all of them are posts.
		expect( attachableEntities( shortcut( 'post', '1' ) ) ).toHaveLength( 1 );
		expect( attachableEntities( shortcut( 'page', '2' ) ) ).toHaveLength( 1 );
		expect( attachableEntities( shortcut( 'attachment', '3' ) ) ).toHaveLength( 1 );
	} );

	it( 'refuses kinds whose id belongs to another table', () => {
		// A term id and a comment id are integers too. Attaching one would
		// link a task to the wrong row entirely.
		expect( attachableEntities( shortcut( 'term', '1' ) ) ).toEqual( [] );
		expect( attachableEntities( shortcut( 'comment', '1' ) ) ).toEqual( [] );
		expect( attachableEntities( shortcut( 'user', '1' ) ) ).toEqual( [] );
		expect( attachableEntities( shortcut( 'folder', '1' ) ) ).toEqual( [] );
	} );

	it( 'keeps only the attachable half of a mixed drag', () => {
		const mixed = payload( 'shortcut', {
			kind: 'post',
			ref: '1',
			items: [
				{ kind: 'post', ref: '1' },
				{ kind: 'user', ref: '2' },
				{ kind: 'page', ref: '3' },
			],
		} );

		expect( attachableEntities( mixed ).map( ( e: { kind: string } ) => e.kind ) ).toEqual( [ 'post', 'page' ] );
	} );

	it( 'refuses a ref that is not a usable id', () => {
		expect( attachableEntities( shortcut( 'post', 'abc' ) ) ).toEqual( [] );
		expect( attachableEntities( shortcut( 'post', '0' ) ) ).toEqual( [] );
	} );

	it( 'reads an attachable tile dragged off the wallpaper', () => {
		expect( attachableEntities( desktopFile( 'attachment', '9', 'photo.jpg' ) ) ).toHaveLength( 1 );
	} );
} );

describe( 'assigneeIn', () => {
	it( 'accepts exactly one user', () => {
		expect( assigneeIn( shortcut( 'user', '5', 'Ana' ) ) ).toEqual( {
			kind: 'user',
			ref: '5',
			title: 'Ana',
		} );
	} );

	it( 'refuses several users rather than guessing which one', () => {
		// A card has one assignee. Silently taking the first of four dropped
		// avatars is a guess dressed as a feature.
		const many = payload( 'shortcut', {
			kind: 'user',
			ref: '5',
			items: [
				{ kind: 'user', ref: '5' },
				{ kind: 'user', ref: '6' },
			],
		} );

		expect( assigneeIn( many ) ).toBeNull();
	} );

	it( 'refuses a post', () => {
		expect( assigneeIn( shortcut( 'post', '5' ) ) ).toBeNull();
	} );

	it( 'refuses a mixed drag that merely contains a user', () => {
		const mixed = payload( 'shortcut', {
			kind: 'user',
			ref: '5',
			items: [
				{ kind: 'user', ref: '5' },
				{ kind: 'post', ref: '6' },
			],
		} );

		expect( assigneeIn( mixed ) ).toBeNull();
	} );
} );

describe( 'sourcePostId', () => {
	it( 'links post-backed kinds by their id', () => {
		expect( sourcePostId( { kind: 'post', ref: '42', title: '' } ) ).toBe( 42 );
		expect( sourcePostId( { kind: 'page', ref: '7', title: '' } ) ).toBe( 7 );
		expect( sourcePostId( { kind: 'attachment', ref: '9', title: '' } ) ).toBe( 9 );
	} );

	it( 'refuses to link kinds whose ref is not a post id', () => {
		// A term id and a post id are both integers and mean different rows. A
		// link to the wrong table is worse than no link.
		expect( sourcePostId( { kind: 'term', ref: '42', title: '' } ) ).toBe( 0 );
		expect( sourcePostId( { kind: 'comment', ref: '42', title: '' } ) ).toBe( 0 );
	} );

	it( 'refuses a ref that is not a usable id', () => {
		expect( sourcePostId( { kind: 'post', ref: 'abc', title: '' } ) ).toBe( 0 );
		expect( sourcePostId( { kind: 'post', ref: '0', title: '' } ) ).toBe( 0 );
		expect( sourcePostId( { kind: 'post', ref: '-3', title: '' } ) ).toBe( 0 );
	} );
} );

/**
 * `slugify` and `@mtg/dsl`'s `tokenSlug` name the same token in two
 * namespaces and are meant to disagree. The reasoning lives on `slugify`;
 * this pins the behavior so a later "clean this duplication up" cannot
 * quietly unify them.
 */
import { tokenSlug } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

import { slugify } from '../src/naming';

describe('the Forge file slug and the DSL card id are two namespaces', () => {
  it('separates words differently, because each matches its own corpus', () => {
    expect(slugify('Angelic Arbiter')).toBe('angelic_arbiter');
    expect(tokenSlug('Angelic Arbiter')).toBe('angelic-arbiter');
  });

  it('drops punctuation where Forge drops it and collapses it where an id does', () => {
    expect(slugify("Akroma's Memorial")).toBe('akromas_memorial');
    expect(tokenSlug("Akroma's Memorial")).toBe('akroma-s-memorial');
  });

  it('answers an empty name in each namespace’s own terms', () => {
    expect(slugify('!!!')).toBe('');
    expect(tokenSlug('!!!')).toBe('token');
  });
});

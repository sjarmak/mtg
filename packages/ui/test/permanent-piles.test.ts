// @vitest-environment jsdom
/**
 * Permanent piles keep crowded boards readable without hiding object identity.
 *
 * The grouping half is deliberately tested apart from the drawing: a future
 * state field must be an explicit decision here rather than silently joining
 * two permanents that no longer do the same thing. The interaction half holds
 * the user-visible contract — one truthful face at rest, every exact object
 * available after expansion, and both global dismissal paths.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Card as DslCard } from '@mtg/dsl';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Battlefield, groupAttachments, groupPermanentPiles } from '../src/board/Battlefield';
import type { BoardPermanent, PermanentGroup } from '../src/board/Battlefield';

afterEach(cleanup);

function creature(offset = 0): DslCard {
  const cards = EXAMPLE_CARDS.filter((card) => card.kind === 'creature');
  const card = cards[offset];
  if (card === undefined) throw new Error(`the DSL examples have no creature ${String(offset)}`);
  return card;
}

function permanent(key: string, fields: Partial<BoardPermanent> = {}): BoardPermanent {
  return { key, card: creature(), ...fields };
}

function boardPlaces(count: number): readonly BoardPermanent[] {
  return Array.from({ length: count }, (_unused, index) =>
    permanent(String(index), {
      card: index < 2 ? creature() : { ...creature(), id: `${creature().id}-${String(index)}` },
    }),
  );
}

function pilesOf(permanents: readonly BoardPermanent[]) {
  return groupPermanentPiles(groupAttachments(permanents));
}

function keysOf(pile: readonly PermanentGroup[]): readonly string[] {
  return pile.map((group) => group.host.key);
}

interface ElementLike {
  readonly textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

interface DocumentLike {
  readonly activeElement: unknown;
  readonly body: Parameters<typeof fireEvent.pointerDown>[0];
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.querySelectorAll !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function documentLike(): DocumentLike & Parameters<typeof fireEvent.keyDown>[0] {
  const candidate = (globalThis as { readonly document?: unknown }).document;
  if (candidate === undefined) throw new Error('this test needs a jsdom document');
  return candidate as DocumentLike & Parameters<typeof fireEvent.keyDown>[0];
}

function focus(value: unknown): void {
  const candidate = value as { readonly focus?: unknown };
  if (typeof candidate.focus !== 'function') throw new Error('expected a focusable element');
  candidate.focus();
}

describe('pileId names the pile when the card id cannot', () => {
  it('piles observed copies sharing a printed identity and keeps distinct identities apart', () => {
    const observed = Array.from({ length: 12 }, (_unused, index) =>
      permanent(`token-${String(index)}`, {
        card: { ...creature(), id: `observed-${String(index)}` },
        pileId: index < 10 ? 'tscd-token:0007' : 'tscd-token:0008',
      }),
    );
    const piles = pilesOf(observed);
    expect(piles.map((pile) => keysOf(pile.groups))).toEqual([
      observed.slice(0, 10).map((entry) => entry.key),
      ['token-10', 'token-11'],
    ]);
  });
});

describe('permanent pile identity', () => {
  it('keeps duplicate permanents separate below ten board places and begins exact-state piling at ten', () => {
    const nine = boardPlaces(9);
    const ten = boardPlaces(10);

    expect(pilesOf(nine).map((pile) => keysOf(pile.groups))).toEqual(nine.map((entry) => [entry.key]));
    expect(pilesOf(ten).map((pile) => keysOf(pile.groups))).toEqual([
      ['0', '1'],
      ...ten.slice(2).map((entry) => [entry.key]),
    ]);
  });

  it('combines crowded identical state deterministically and preserves first-seen order', () => {
    const matching = Array.from({ length: 10 }, (_unused, index) =>
      permanent(`matching-${String(index)}`, { tapped: true, counters: 2 }),
    );
    const piles = pilesOf([
      matching[0] ?? permanent('missing'),
      permanent('other', { card: creature(1) }),
      ...matching.slice(1),
    ]);

    expect(piles.map((pile) => keysOf(pile.groups))).toEqual([matching.map((entry) => entry.key), ['other']]);
  });

  it.each([
    ['card', { card: creature(1) }],
    ['tapped', { tapped: true }],
    ['summoning sickness', { summoningSick: true }],
    ['damage', { damage: 1 }],
    ['counters', { counters: 1 }],
    ['named counters', { namedCounters: { charge: 1 } }],
    ['soulbond pair', { pair: { number: 1, partner: 'Thraben Valiant' } }],
    ['loyalty', { loyalty: 3 }],
    ['defense', { defense: 4 }],
    ['protector', { protector: 1 as const }],
    ['attacking', { attacking: true, attackingDefender: 'Bot' }],
    ['blocking', { blocking: true, blockingAttackers: ['Raider'], blockingKeys: ['raider'] }],
    [
      'blocking a different attacker',
      { blocking: true, blockingAttackers: ['Raider'], blockingKeys: ['raider-2'] },
    ],
    ['detained', { detained: true }],
    ['staged attack', { staged: true }],
    ['staged block', { stagedBlock: 'Raider', stagedBlockKeys: ['raider'] }],
    ['damage order', { damageOrder: 2 }],
    ['derived size', { stats: { power: 3, toughness: 4 } }],
    ['attachments named on the host', { attachments: ['Short Sword'] }],
    ['gained keywords', { gainedKeywords: ['flying'] }],
    ['target marks', { targetedBy: [{ order: 1, source: "Bot's Shock" }] }],
    ['enabled playability', { playable: true }],
    ['disabled playability', { playable: false }],
  ] satisfies readonly [string, Partial<BoardPermanent>][])(
    'splits a crowded pile on %s',
    (_name, changed) => {
      const base = Array.from({ length: 10 }, (_unused, index) => permanent(`base-${String(index)}`));
      const changedCopies = Array.from(
        { length: 'card' in changed && changed.card !== undefined ? 10 : 1 },
        (_unused, index) => permanent(`changed-${String(index)}`, changed),
      );
      const piles = pilesOf([...base, ...changedCopies]);
      expect(keysOf(piles[0]?.groups ?? [])).toEqual(base.map((entry) => entry.key));
      expect(keysOf(piles[1]?.groups ?? [])).toEqual(changedCopies.map((entry) => entry.key));
    },
  );

  it('does not split a pile over a zero named counter or the order a backend listed its counters in', () => {
    const listed = { charge: 1, time: 2 };
    const reordered = { time: 2, charge: 1, energy: 0 };
    const permanents = Array.from({ length: 10 }, (_unused, index) =>
      permanent(`counted-${String(index)}`, { namedCounters: index % 2 === 0 ? listed : reordered }),
    );

    expect(pilesOf(permanents).map((pile) => keysOf(pile.groups))).toEqual([
      permanents.map((entry) => entry.key),
    ]);
  });

  it('piles matching attachment trays without separating what each host holds', () => {
    const permanents = Array.from({ length: 10 }, (_unused, index) => {
      const suffix = String(index);
      return [
        permanent(`host-${suffix}`, { attachments: ['Blade'] }),
        permanent(`blade-${suffix}`, {
          card: creature(1),
          attachedTo: creature().name,
          attachedToKey: `host-${suffix}`,
        }),
      ];
    }).flat();

    const [pile] = pilesOf(permanents);
    expect(keysOf(pile?.groups ?? [])).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `host-${String(index)}`),
    );
    expect(pile?.groups.map((group) => group.held.map((held) => held.key))).toEqual(
      Array.from({ length: 10 }, (_unused, index) => [`blade-${String(index)}`]),
    );
  });

  it('keeps a selected or externally pointed exact object out of its resting pile', () => {
    const permanents = Array.from({ length: 10 }, (_unused, index) => permanent(String(index)));
    const groups = groupAttachments(permanents);
    expect(groupPermanentPiles(groups, { selectedKey: '9' }).map((pile) => keysOf(pile.groups))).toEqual([
      permanents.slice(0, 9).map((entry) => entry.key),
      ['9'],
    ]);
    expect(
      groupPermanentPiles(groups, { pointed: new Set(['0']) }).map((pile) => keysOf(pile.groups)),
    ).toEqual([['0'], permanents.slice(1).map((entry) => entry.key)]);
  });
});

describe('a permanent pile on the battlefield', () => {
  function places(count: number, onSelect: (chosen: BoardPermanent) => void = () => undefined) {
    return render(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: boardPlaces(count),
        onSelect,
      }),
    );
  }

  function opener() {
    return screen.getByRole('button', {
      name: `2 ${creature().name} permanents, collapsed; expand to choose one`,
    });
  }

  it('draws every place directly when the row has fewer than ten', () => {
    const { container } = places(9);
    expect(asElement(container).querySelectorAll('[data-permanent-key]')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: /permanents, collapsed/ })).toBeNull();
  });

  it('piles the matching pair at ten places and expands to both exact objects', () => {
    const { container } = places(10);
    expect(asElement(container).querySelectorAll('[data-permanent-key]')).toHaveLength(9);
    expect(asElement(opener()).textContent).toBe('2');

    fireEvent.click(opener());

    const pile = screen.getByRole('group', {
      name: `2 ${creature().name} permanents, expanded`,
    });
    expect(within(pile).getAllByRole('button', { name: new RegExp(creature().name) })).toHaveLength(2);
    expect(asElement(container).querySelectorAll('[data-permanent-key]')).toHaveLength(10);
  });

  it('expands through the native button activation for Enter or Space', async () => {
    const user = userEvent.setup();
    const first = places(10);
    focus(opener());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('group', { name: /permanents, expanded/ })).toBeTruthy();
    first.unmount();

    places(10);
    focus(opener());
    await user.keyboard(' ');
    expect(screen.getByRole('group', { name: /permanents, expanded/ })).toBeTruthy();
  });

  it('chooses the exact expanded object through the existing selection callback', () => {
    const chosen: string[] = [];
    places(10, (entry) => chosen.push(entry.key));
    fireEvent.click(opener());

    const pile = screen.getByRole('group', { name: /permanents, expanded/ });
    const faces = within(pile).getAllByRole('button', { name: new RegExp(creature().name) });
    fireEvent.click(faces[1] ?? faces[0]);
    expect(chosen).toEqual(['1']);
  });

  it('collapses on Escape and restores focus to its opener', () => {
    places(10);
    fireEvent.click(opener());
    fireEvent.keyDown(documentLike(), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /permanents, expanded/ })).toBeNull();
    expect(documentLike().activeElement).toBe(opener());
  });

  it('collapses on an outside pointer press without stealing focus', () => {
    places(10);
    fireEvent.click(opener());
    fireEvent.pointerDown(documentLike().body);
    expect(screen.queryByRole('group', { name: /permanents, expanded/ })).toBeNull();
  });
});

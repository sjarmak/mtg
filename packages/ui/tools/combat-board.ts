/**
 * The mid-combat table, as a session and as a page, for every rig that measures
 * one.
 *
 * Two files build this fixture and a third was about to.
 * `../test/play/combat-allocation.browser.test.ts` asks whether the row holds
 * the card it draws; `./combat-cap.ts` and `../test/play/combat-cap.browser.test.ts`
 * ask how big that card is allowed to be. Different questions, one board, and a
 * second copy of the board is a second chance for the two rigs to be measuring
 * different tables while both report on "the combat board".
 *
 * Here rather than beside the first test because a tool may not import a test:
 * `../test/support/chrome.ts` reaches `vitest`, which throws the moment it is
 * imported outside a `vitest` command, and that file's own docblock is the
 * record of one tool taking the whole harness down that way. So the fixture
 * lives under `tools/`, where both a test and a plain Node program can take it,
 * and it uses no assertion library: a spec it cannot build throws.
 *
 * Node-only, like everything else under `tools/`. It renders to a string and
 * opens nothing.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

/**
 * The neutral example set. Every claim these rigs make is the size of a box and
 * none of them is about a card, so the fixture never reaches for a real set.
 */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

/** Give a geometry fixture distinct identities so product piling does not erase its stated density. */
function distinctCard(card: (typeof SPELLS)[number], position: string): (typeof SPELLS)[number] {
  return { ...card, id: `${card.id}-${position}` };
}

export interface BoardSpec {
  readonly nearSpells: number;
  readonly nearLands: number;
  readonly farSpells: number;
  readonly farLands: number;
  /** Whether the near seat's permanents are turned, which is what rotates a face. */
  readonly nearTapped: boolean;
  /** Which seat declares, and how many creatures it declares with. */
  readonly attacker: 'near' | 'far';
  readonly attackers: number;
}

/**
 * A stated mid-combat position: the board is built one step early and the attack
 * is declared through `reduce`, so the seam holds what the kernel put there
 * rather than a hand-written `combat.attacks` the projection was never asked to
 * agree with.
 */
export function combatBoard(spec: BoardSpec): GameSession {
  const attackerSeat: PlayerId = spec.attacker === 'near' ? 0 : 1;
  const battlefield = [
    ...Array.from({ length: spec.nearSpells }, (_unused, index) => ({
      card: distinctCard(SPELLS[index % SPELLS.length] ?? SPELLS[0], `near-${String(index)}`),
      controller: 0 as PlayerId,
      tapped: spec.nearTapped,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.nearLands }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: 0 as PlayerId,
      tapped: index % 2 === 1,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.farSpells }, (_unused, index) => ({
      card: distinctCard(SPELLS[(index + 2) % SPELLS.length] ?? SPELLS[0], `far-${String(index)}`),
      controller: 1 as PlayerId,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.farLands }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: 1 as PlayerId,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/combat-allocation',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3]],
    ],
    step: 'declareAttackers',
    active: attackerSeat,
    turn: 10,
  });
  const attackers: readonly ObjectId[] = built.state.battlefield
    .filter((oid) => {
      const object = built.state.objects[oid];
      return object !== undefined && object.controller === attackerSeat && object.card.kind === 'creature';
    })
    .slice(0, spec.attackers);
  if (attackers.length !== spec.attackers) {
    throw new Error(
      `the stated attack declares ${String(spec.attackers)} and the board built ${String(attackers.length)} creatures to declare with`,
    );
  }
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: attackerSeat,
    attackers: attackers.map((oid) => ({ oid, defender: (attackerSeat === 0 ? 1 : 0) as PlayerId })),
  });
  const state: GameState = declared.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [...built.events, ...declared.events],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

export interface CombatPageOptions {
  /** The document title, so a page left on disk says which rig wrote it. */
  readonly title?: string;
  /**
   * CSS appended after the app's own sheet.
   *
   * `./combat-cap.ts` restates one shipped rule with a different number, and a
   * later declaration of equal specificity is how a sweep changes a rule
   * without editing the sheet it is measuring.
   */
  readonly extraCss?: string;
}

export function combatPage(game: GameSession, options: CombatPageOptions = {}): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = options.title ?? 'Combat board';
  const sheet = `${uiStyleSheet()}html,body{margin:0;padding:0}${options.extraCss ?? ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${sheet}</style></head><body>${markup}</body></html>`;
}

/**
 * The two positions the 2026-08-16 captures show, plus a control and a crowded
 * one.
 *
 * `far-attacks-tapped` is `references/UI_issues/view_issue3.png`: the near seat
 * holds two turned creatures and five lands while the opponent declares one
 * attacker, which is the state whose rotated names came out cut.
 * `near-attacks` is `view_issue2.png`, where the viewer's own creatures have all
 * left the row for the seam and the lane is left holding an empty row over a
 * mana band. The upright pair is the control for the tapped one: a quarter turn
 * is what makes the face's width the row's height problem, so the same board
 * untapped says whether a finding is about rotation or about the row.
 * `crowded-tapped` is a late board, and it is the one where the face ceiling
 * stops being free: twelve permanents overflow the row on the inline axis, so a
 * larger face is fewer creatures reachable without scrolling.
 */
export const COMBAT_BOARDS: ReadonlyMap<string, BoardSpec> = new Map([
  [
    'far-attacks-tapped',
    {
      nearSpells: 2,
      nearLands: 5,
      farSpells: 2,
      farLands: 4,
      nearTapped: true,
      attacker: 'far',
      attackers: 1,
    },
  ],
  [
    'far-attacks-upright',
    {
      nearSpells: 2,
      nearLands: 5,
      farSpells: 2,
      farLands: 4,
      nearTapped: false,
      attacker: 'far',
      attackers: 1,
    },
  ],
  [
    'near-attacks',
    {
      nearSpells: 4,
      nearLands: 6,
      farSpells: 4,
      farLands: 4,
      nearTapped: false,
      attacker: 'near',
      attackers: 4,
    },
  ],
  [
    'crowded-tapped',
    {
      nearSpells: 12,
      nearLands: 8,
      farSpells: 12,
      farLands: 8,
      nearTapped: true,
      attacker: 'far',
      attackers: 4,
    },
  ],
]);

/**
 * The four viewports the rest-layout rig states, plus the width the 2026-08-16
 * captures came from and the short table that squashes a slot on the block axis.
 * All six are at or above `THREE_COLUMN_MIN_WIDTH_PX`, which is the width the
 * combat face ceiling is declared inside.
 */
export const COMBAT_VIEWPORTS = [
  [1440, 900],
  [1394, 824],
  [1280, 800],
  [1024, 768],
  [1392, 766],
  [1440, 560],
] as const;

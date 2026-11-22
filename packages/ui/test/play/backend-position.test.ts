import { describe, expect, it } from 'vitest';
import type { ObjectView, PendingDecision, PlayInteraction, SeatId, TableView } from '@mtg/engine';
import { BASIC_LAND_PRINTINGS } from '../../src/card/basic-land-printings';
import { OFFICIAL_TOKEN_PRINTINGS } from '../../src/card/token-printings';
import {
  backendBoardPosition,
  commanderCost,
  movesByObject,
  movesBySeat,
  unambiguousMoveByObject,
} from '../../src/routes/play/backend-position';

function object(oid: string, name: string, controller: SeatId = 0): ObjectView {
  return {
    oid,
    name,
    typeLine: name === 'Mountain' ? 'Basic Land — Mountain' : 'Artifact Creature',
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
  };
}

const mountain = object('opaque-hand-mountain', 'Mountain');
const relic = object('opaque-battlefield-relic', 'Observed Relic');
const opposing = object('opaque-opposing-creature', 'Observed Target', 1);

const VIEW: TableView = {
  version: 4,
  turn: { number: 1, active: 0, phase: 'opaque phase', step: 'opaque step' },
  priority: 0,
  stack: [],
  seats: [
    {
      id: 0,
      name: 'North',
      life: 20,
      hand: [mountain],
      handSize: 1,
      librarySize: 33,
      graveyard: [],
      exile: [],
      battlefield: [relic],
    },
    {
      id: 1,
      name: 'South',
      life: 20,
      hand: null,
      handSize: 7,
      librarySize: 33,
      graveyard: [],
      exile: [],
      battlefield: [opposing],
    },
  ],
};

function decision(options: PendingDecision['options'], seat: SeatId = 0): PendingDecision {
  return {
    seat,
    kind: 'opaque decision kind',
    prompt: 'Choose an action',
    options,
    complete: true,
  };
}

function interaction(
  objectActions: PlayInteraction['objectActions'],
  seatActions: NonNullable<PlayInteraction['seatActions']> = [],
): PlayInteraction {
  return { turnStep: 'precombatMain', passPriority: null, concede: null, objectActions, seatActions };
}

const emmara: ObjectView = {
  ...object('opaque-command-emmara', 'Emmara, Soul of the Accord'),
  typeLine: 'Legendary Creature — Elf Cleric',
  power: 2,
  toughness: 2,
  characteristics: { colors: ['W', 'G'], manaCost: '{W}{G}', token: false },
};

const COMMANDER_VIEW: TableView = {
  ...VIEW,
  seats: [
    {
      ...VIEW.seats[0]!,
      life: 40,
      commandZone: [emmara],
      commanderDamage: {},
      commanderCasts: { [emmara.oid]: 1 },
    },
    { ...VIEW.seats[1]!, life: 40, commandZone: [], commanderDamage: {}, commanderCasts: {} },
  ],
};

const momir: ObjectView = {
  ...object('avatar-north', 'Momir Vig, Simic Visionary Avatar'),
  typeLine: 'Vanguard',
};

const MOMIR_VIEW: TableView = {
  ...VIEW,
  seats: [{ ...VIEW.seats[0]!, life: 24, avatars: [momir] }, VIEW.seats[1]!],
};

describe('backend avatar zone', () => {
  it('projects the visible avatar separately from the command zone', () => {
    const position = backendBoardPosition(MOMIR_VIEW, 0);
    expect(position.you.avatars?.label).toBe('North avatar');
    expect(position.you.avatars?.cards.map((card) => [card.key, card.card.name, card.playable])).toEqual([
      [momir.oid, 'Momir Vig, Simic Visionary Avatar', false],
    ]);
    expect(position.you.commandZone).toBeUndefined();
    expect(position.opponent.avatars).toBeUndefined();
  });
});

describe('backend command zone', () => {
  it('folds the commander tax into the next cost the way the payment prompt prints it', () => {
    expect(commanderCost('{W}{G}', 0)).toBe('{W}{G}');
    expect(commanderCost('{W}{G}', 1)).toBe('{2}{W}{G}');
    expect(commanderCost('{3}{R}{R}', 2)).toBe('{7}{R}{R}');
    expect(commanderCost(null, 0)).toBeNull();
    expect(commanderCost(null, 1)).toBe('{2}');
  });

  it('projects each seat’s command zone beside its battlefield, with the engine’s cast count and the taxed cost', () => {
    const position = backendBoardPosition(COMMANDER_VIEW, 0);
    expect(position.you.commandZone?.label).toBe('North command zone');
    expect(
      position.you.commandZone?.commanders.map((card) => [
        card.key,
        card.card.name,
        card.casts,
        card.cost,
        card.playable,
      ]),
    ).toEqual([[emmara.oid, 'Emmara, Soul of the Accord', 1, '{2}{W}{G}', false]]);
    expect(position.you.commandZone?.tally).toBe(1);
    expect(position.opponent.commandZone).toEqual({ label: 'South command zone', commanders: [], tally: 0 });
    expect(backendBoardPosition(VIEW, 0).you.commandZone).toBeUndefined();
  });

  it('binds a declared command-zone cast to the commander so the card can be pressed', () => {
    const play = interaction([{ oid: emmara.oid, move: 'ability-9-0', category: 'cast' }]);
    const moves = movesByObject(
      COMMANDER_VIEW,
      0,
      decision([{ id: 'ability-9-0', text: 'Cast', targets: [] }]),
      play,
    );
    expect(moves.get(emmara.oid)).toEqual(['ability-9-0']);
    expect(
      movesByObject(VIEW, 0, decision([{ id: 'ability-9-0', text: 'Cast', targets: [] }]), play).size,
    ).toBe(0);
  });
});

describe('backend library top', () => {
  const forest: ObjectView = {
    ...object('opaque-library-forest', 'Forest'),
    typeLine: 'Basic Land — Forest',
  };
  const revealed: TableView = {
    ...VIEW,
    seats: [{ ...VIEW.seats[0]!, libraryTop: [forest] }, VIEW.seats[1]!],
  };

  it('projects a public top card beside the battlefield, inert until a play is declared on it', () => {
    const position = backendBoardPosition(revealed, 0);
    expect(position.you.libraryTop?.label).toBe('North library top');
    expect(position.you.libraryTop?.cards.map((card) => [card.key, card.card.name, card.playable])).toEqual([
      [forest.oid, 'Forest', false],
    ]);
    expect(position.opponent.libraryTop).toBeUndefined();
    expect(backendBoardPosition(VIEW, 0).you.libraryTop).toBeUndefined();
    // Revealed to the table, so the other seat's board draws it too.
    expect(backendBoardPosition(revealed, 1).opponent.libraryTop?.cards.map((card) => card.key)).toEqual([
      forest.oid,
    ]);
  });

  it('binds a declared play from the top of the library to the card so it can be pressed', () => {
    const play = interaction([{ oid: forest.oid, move: 'ability-7-0', category: 'play' }]);
    const options = decision([{ id: 'ability-7-0', text: 'Play Forest', targets: [] }]);
    expect(movesByObject(revealed, 0, options, play).get(forest.oid)).toEqual(['ability-7-0']);
    expect(movesByObject(VIEW, 0, options, play).size).toBe(0);
  });
});

describe('backend player counters', () => {
  function withCounters(north: Partial<TableView['seats'][number]>, south = {}): TableView {
    return {
      ...VIEW,
      seats: [
        { ...VIEW.seats[0]!, ...north },
        { ...VIEW.seats[1]!, ...south },
      ],
    };
  }

  it('lists poison first and every other counter by name, in the backend’s own word lowercased', () => {
    const position = backendBoardPosition(
      withCounters(
        { poison: 3, playerCounters: { RAD: 2, ENERGY: 5 } },
        { playerCounters: { EXPERIENCE: 1 } },
      ),
      0,
    );

    expect(position.you.status.counters).toEqual([
      { name: 'poison', amount: 3 },
      { name: 'energy', amount: 5 },
      { name: 'rad', amount: 2 },
    ]);
    expect(position.opponent.status.counters).toEqual([{ name: 'experience', amount: 1 }]);
  });

  it('draws nothing for a seat that holds none, whether it reported zero poison or reported nothing', () => {
    expect(backendBoardPosition(VIEW, 0).you.status).not.toHaveProperty('counters');
    expect(backendBoardPosition(withCounters({ poison: 0 }), 0).you.status).not.toHaveProperty('counters');
    expect(
      backendBoardPosition(withCounters({ playerCounters: { ENERGY: 0 } }), 0).you.status,
    ).not.toHaveProperty('counters');
  });

  it('leaves poison to the seat rail at a pod, and still draws the other counters', () => {
    const seat = (id: SeatId): TableView['seats'][number] => ({
      ...VIEW.seats[1]!,
      id,
      name: `Seat ${String(id)}`,
      hand: id === 0 ? [] : null,
      battlefield: [],
      poison: 4,
      playerCounters: { ENERGY: id + 1 },
    });
    const pod: TableView = { ...VIEW, seats: [seat(0), seat(1), seat(2)] };

    const position = backendBoardPosition(pod, 0);

    expect(position.you.status.counters).toEqual([{ name: 'energy', amount: 1 }]);
    expect(position.opponent.status.counters).toEqual([{ name: 'energy', amount: 2 }]);
    expect(position.pod?.rail.seats.map((entry) => entry.poison)).toEqual([4, 4, 4]);
  });
});

describe('backend board actions', () => {
  it('omits the hidden opposing hand rail while retaining its count and actual permanents', () => {
    const emptyOpponent: TableView = {
      ...VIEW,
      seats: [VIEW.seats[0], { ...VIEW.seats[1], battlefield: [] }],
    };
    const initial = backendBoardPosition(emptyOpponent, 0);
    expect(initial.opponent.hand).toBeUndefined();
    expect(initial.opponent.status.handCount).toBe(7);
    expect(initial.opponent.battlefield.permanents).toEqual([]);

    const occupied = backendBoardPosition(VIEW, 0);
    expect(occupied.opponent.hand).toBeUndefined();
    expect(occupied.opponent.battlefield.permanents.map((permanent) => permanent.key)).toEqual([
      opposing.oid,
    ]);
    expect(occupied.you.hand?.cards.map((card) => card.key)).toEqual([mountain.oid]);
  });

  it('keeps a declared attacker in the shared combat band', () => {
    const attackingRelic = { ...relic, tapped: true, attacking: true } as ObjectView & {
      readonly attacking: boolean;
    };
    const combat = backendBoardPosition(
      {
        ...VIEW,
        seats: [{ ...VIEW.seats[0], battlefield: [attackingRelic] }, VIEW.seats[1]],
      },
      0,
    );

    expect(combat.you.battlefield.permanents[0]).toMatchObject({
      key: relic.oid,
      tapped: true,
      attacking: true,
    });
  });

  it('says a declared block from both ends, by name and by key', () => {
    const attacker = { ...relic, attacking: true, blockedBy: [opposing.oid] };
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [attacker] }, VIEW.seats[1]],
    };
    for (const viewer of [0, 1] as const) {
      const board = backendBoardPosition(view, viewer);
      const [mine, theirs] = viewer === 0 ? [board.you, board.opponent] : [board.opponent, board.you];
      expect(mine.battlefield.permanents[0]).toMatchObject({
        key: relic.oid,
        attacking: true,
        blockedBy: [opposing.name],
      });
      expect(mine.battlefield.permanents[0]).not.toHaveProperty('blocking');
      expect(theirs.battlefield.permanents[0]).toMatchObject({
        key: opposing.oid,
        attacking: false,
        blocking: true,
        blockingAttackers: [relic.name],
        blockingKeys: [relic.oid],
      });
    }
  });

  it('keeps a blocker the table does not hold by its oid rather than dropping it', () => {
    const attacker = { ...relic, attacking: true, blockedBy: ['opaque-vanished-blocker'] };
    const board = backendBoardPosition(
      { ...VIEW, seats: [{ ...VIEW.seats[0], battlefield: [attacker] }, VIEW.seats[1]] },
      0,
    );
    expect(board.you.battlefield.permanents[0]).toMatchObject({ blockedBy: ['opaque-vanished-blocker'] });
    expect(board.opponent.battlefield.permanents[0]).not.toHaveProperty('blocking');
  });

  describe('a soulbond pair', () => {
    const sword = object('opaque-second-creature', 'Second Observed Creature');
    const shield = object('opaque-third-creature', 'Third Observed Creature');
    const spare = object('opaque-fourth-creature', 'Fourth Observed Creature', 1);

    function tableOf(north: readonly ObjectView[], south: readonly ObjectView[]): TableView {
      return {
        ...VIEW,
        seats: [
          { ...VIEW.seats[0], battlefield: north },
          { ...VIEW.seats[1], battlefield: south },
        ],
      };
    }

    it("carries the same numbered pair and the partner's name on both members", () => {
      const board = backendBoardPosition(
        tableOf(
          [
            { ...relic, pairedWith: sword.oid },
            { ...sword, pairedWith: relic.oid },
          ],
          [opposing],
        ),
        0,
      );
      const [first, second, third] = board.you.battlefield.permanents;

      expect(first?.pair).toEqual({ number: 1, partner: sword.name });
      expect(second?.pair).toEqual({ number: 1, partner: relic.name });
      expect(third).toBeUndefined();
      expect(board.opponent.battlefield.permanents[0]).not.toHaveProperty('pair');
    });

    it('tells two pairs apart by number, including a pair that spans both seats', () => {
      const board = backendBoardPosition(
        tableOf(
          [
            { ...relic, pairedWith: opposing.oid },
            { ...sword, pairedWith: shield.oid },
            { ...shield, pairedWith: sword.oid },
          ],
          [{ ...opposing, pairedWith: relic.oid }, spare],
        ),
        0,
      );

      expect(board.you.battlefield.permanents.map((entry) => entry.pair?.number)).toEqual([1, 2, 2]);
      expect(board.opponent.battlefield.permanents.map((entry) => entry.pair?.number)).toEqual([
        1,
        undefined,
      ]);
      expect(board.you.battlefield.permanents[0]?.pair?.partner).toBe(opposing.name);
    });

    it('numbers the pair the same way from either seat', () => {
      const view = tableOf(
        [
          { ...relic, pairedWith: sword.oid },
          { ...sword, pairedWith: relic.oid },
        ],
        [opposing],
      );

      expect(
        backendBoardPosition(view, 1).opponent.battlefield.permanents.map((entry) => entry.pair),
      ).toEqual(backendBoardPosition(view, 0).you.battlefield.permanents.map((entry) => entry.pair));
    });

    it('draws nothing once the partner is gone, which is how the projection says the pair ended', () => {
      const board = backendBoardPosition(tableOf([relic], [opposing]), 0);

      expect(board.you.battlefield.permanents[0]).not.toHaveProperty('pair');
    });

    it('keeps a partner the table does not hold by its oid rather than dropping the pair', () => {
      const board = backendBoardPosition(
        tableOf([{ ...relic, pairedWith: 'opaque-vanished-partner' }], [opposing]),
        0,
      );

      expect(board.you.battlefield.permanents[0]?.pair).toEqual({
        number: 1,
        partner: 'opaque-vanished-partner',
      });
    });
  });

  it('keeps move ids opaque while binding one exact target identity', () => {
    const actions = unambiguousMoveByObject(
      VIEW,
      0,
      decision([
        {
          id: 'id-that-does-not-describe-the-target',
          text: 'Choose that permanent',
          targets: [{ oid: relic.oid, name: relic.name }],
        },
      ]),
    );

    expect([...actions]).toEqual([[relic.oid, 'id-that-does-not-describe-the-target']]);
  });

  it('binds only adapter-declared source actions and never interprets their text', () => {
    const actions = unambiguousMoveByObject(
      VIEW,
      0,
      decision([
        { id: 'opaque-land-action', text: 'words that do not describe a land', targets: [] },
        { id: 'opaque-relic-action', text: 'words that do not describe an activation', targets: [] },
      ]),
      interaction([
        { oid: mountain.oid, move: 'opaque-land-action' },
        { oid: relic.oid, move: 'opaque-relic-action' },
      ]),
    );

    expect([...actions]).toEqual([
      [mountain.oid, 'opaque-land-action'],
      [relic.oid, 'opaque-relic-action'],
    ]);
  });

  it('fails closed for undeclared text, duplicate source moves, absent objects, and the other seat', () => {
    expect([
      ...movesByObject(
        VIEW,
        0,
        decision([
          { id: 'land-a', text: 'opaque', targets: [] },
          { id: 'land-b', text: 'opaque', targets: [] },
        ]),
        interaction([
          { oid: mountain.oid, move: 'land-a' },
          { oid: mountain.oid, move: 'land-b' },
        ]),
      ),
    ]).toEqual([[mountain.oid, ['land-a', 'land-b']]]);
    expect([
      ...unambiguousMoveByObject(
        VIEW,
        0,
        decision([
          { id: 'land-a', text: 'opaque', targets: [] },
          { id: 'land-b', text: 'opaque', targets: [] },
        ]),
        interaction([
          { oid: mountain.oid, move: 'land-a' },
          { oid: mountain.oid, move: 'land-b' },
        ]),
      ),
    ]).toEqual([]);
    expect([
      ...unambiguousMoveByObject(
        VIEW,
        0,
        decision([{ id: 'misleading', text: 'Play Mountain', targets: [] }]),
      ),
    ]).toEqual([]);
    expect([
      ...unambiguousMoveByObject(
        VIEW,
        0,
        decision([{ id: 'absent-object', text: 'opaque', targets: [] }]),
        interaction([{ oid: 'not-in-the-position', move: 'absent-object' }]),
      ),
    ]).toEqual([]);
    expect([
      ...unambiguousMoveByObject(
        VIEW,
        0,
        decision([{ id: 'other-seat', text: 'opaque', targets: [] }], 1),
        interaction([{ oid: mountain.oid, move: 'other-seat' }]),
      ),
    ]).toEqual([]);
  });

  it('does not turn an enumerable card surface into a text-answer surface', () => {
    expect([
      ...unambiguousMoveByObject(
        VIEW,
        0,
        {
          ...decision([{ id: 'ignored', text: 'Play Mountain', targets: [] }]),
          input: {
            kind: 'text',
            id: 'opaque-text-input',
            label: 'Name a card',
            minLength: 1,
            maxLength: 40,
          },
        },
        interaction([{ oid: mountain.oid, move: 'ignored' }]),
      ),
    ]).toEqual([]);
  });

  it('binds exact declared player targets and fails closed when one pod has several moves', () => {
    const offered = decision([
      { id: 'opaque-player-a', text: 'first', targets: [] },
      { id: 'opaque-player-b', text: 'second', targets: [] },
    ]);
    expect([
      ...movesBySeat(
        0,
        offered,
        interaction(
          [],
          [
            { seat: 1, move: 'opaque-player-a' },
            { seat: 1, move: 'opaque-player-b' },
          ],
        ),
      ),
    ]).toEqual([[1, ['opaque-player-a', 'opaque-player-b']]]);
    expect([...movesBySeat(1, offered, interaction([], [{ seat: 1, move: 'opaque-player-a' }]))]).toEqual([]);
  });
});

describe('Legacy Cube basic-land presentation', () => {
  it('pins one complete presentation-only M11 printing for each basic land', () => {
    expect(BASIC_LAND_PRINTINGS.map((card) => card.name)).toEqual([
      'Plains',
      'Island',
      'Swamp',
      'Mountain',
      'Forest',
    ]);
    expect(new Set(BASIC_LAND_PRINTINGS.map((card) => card.scryfallId)).size).toBe(5);
    for (const card of BASIC_LAND_PRINTINGS) {
      expect(card.physicalId).toBe(`m11:${String(card.position).padStart(4, '0')}:${card.scryfallId}`);
      expect(card.typeLine).toBe(`Basic Land — ${card.name}`);
      expect(card.art.status).toBe('available');
      if (card.art.status === 'missing') throw new Error(`${card.name} unexpectedly lacks art`);
      expect(card.art.images).toHaveLength(1);
      expect(card.art.images[0]?.uris['art_crop']).toContain(card.scryfallId);
      expect(card.art.images[0]?.uris['normal']).toBeUndefined();
      expect('forgeScript' in card).toBe(false);
      expect('forgeScriptSha256' in card).toBe(false);
    }
  });

  it('uses one deterministic official image when a format supplies several printings of a basic', () => {
    const base = BASIC_LAND_PRINTINGS.find((card) => card.name === 'Mountain');
    if (base === undefined || base.art.status === 'missing') throw new Error('missing Mountain fixture');
    const variants = ['akh:mountain-a', 'hou:mountain-b'].map((physicalId, index) => ({
      ...base,
      physicalId,
      scryfallId: `00000000-0000-0000-0000-00000000000${String(index + 1)}`,
      art: {
        ...base.art,
        scryfallId: `00000000-0000-0000-0000-00000000000${String(index + 1)}`,
        images: [
          {
            face: null,
            uris: { art_crop: `https://cards.example/${physicalId}.jpg` },
          },
        ],
      },
    }));
    const first = backendBoardPosition(VIEW, 0, variants).you.hand?.cards[0]?.art;
    const repeated = backendBoardPosition(VIEW, 0, variants).you.hand?.cards[0]?.art;

    expect(first?.src).toMatch(/^https:\/\/cards\.example\/(?:akh|hou):mountain-[ab]\.jpg$/);
    expect(repeated?.src).toBe(first?.src);
  });
});

describe('observed token presentation', () => {
  it('pins the official M13 Goblin token without claiming a Forge capability', () => {
    expect(OFFICIAL_TOKEN_PRINTINGS).toHaveLength(1);
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    expect(goblin).toMatchObject({
      physicalId: 'm13-token:0006:0e67efea-8a80-42ec-8e77-07d387d933d4',
      position: 6,
      name: 'Goblin',
      observedNames: ['Goblin Token'],
      typeLine: 'Token Creature — Goblin',
      power: '1',
      toughness: '1',
      colors: ['R'],
    });
    expect(goblin.art.status).toBe('available');
    if (goblin.art.status === 'missing') throw new Error('Goblin token unexpectedly lacks art');
    expect(goblin.art.images[0]?.uris['art_crop']).toBe(
      'https://cards.scryfall.io/art_crop/front/0/e/0e67efea-8a80-42ec-8e77-07d387d933d4.jpg',
    );
    expect('forgeScript' in goblin).toBe(false);
    expect('forgeScriptSha256' in goblin).toBe(false);
  });

  it('fails closed when two different cards share an observed token name', () => {
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    const observedGoblin: ObjectView = {
      oid: 'foreign:goblin-token:1',
      name: 'Goblin Token',
      typeLine: 'Creature — Goblin',
      power: 1,
      toughness: 1,
      tapped: false,
      attacking: false,
      damage: 0,
      controller: 0,
      counters: {},
    };
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [observedGoblin] }, VIEW.seats[1]],
    };
    // A different oracle id: this is not the same card, so no fact the
    // backend states (nor its age) makes picking one of them safe.
    const unrelated = {
      ...goblin,
      physicalId: 'different-printing-with-the-same-observed-name',
      scryfallId: '00000000-0000-0000-0000-000000000099',
      oracleId: '00000000-0000-0000-0000-000000000098',
    };

    const position = backendBoardPosition(view, 0, [goblin, unrelated]);
    const permanent = position.you.battlefield.permanents[0];
    if (permanent?.art === null || permanent?.art === undefined) {
      throw new Error('ambiguous token did not retain an explicit pending-art record');
    }

    expect(permanent.art.src).toBe('');
    // The frame is still the object's own facts; only the picture is withheld.
    expect(permanent.art.printedFrame?.physicalId).toBe('observed:goblin-token:creature-goblin');
    expect(permanent.art.printedFrame?.typeLine).toBe('Creature — Goblin');
  });

  it('prefers the older printing when two rows for the same card collide, rather than going blank', () => {
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    const observedGoblin: ObjectView = {
      oid: 'foreign:goblin-token:1',
      name: 'Goblin Token',
      typeLine: 'Creature — Goblin',
      power: 1,
      toughness: 1,
      tapped: false,
      attacking: false,
      damage: 0,
      controller: 0,
      counters: {},
    };
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [observedGoblin] }, VIEW.seats[1]],
    };
    // Same oracle id as the M13 Goblin (a duplicate catalog row for the same
    // card, the way a token sheet can reprint one token under several
    // collector numbers): the backend states no fact that tells them apart,
    // but they are provably one card, so the older printing wins instead of
    // leaving the token blank.
    const older = { ...goblin, physicalId: 'older-akh-row', setCode: 'AKH', position: 200 };
    const newer = { ...goblin, physicalId: 'newer-hou-row', setCode: 'HOU', position: 1 };

    const position = backendBoardPosition(view, 0, [newer, older]);
    expect(position.you.battlefield.permanents[0]?.art?.printedFrame?.physicalId).toBe('older-akh-row');
  });

  it('breaks a same-set tie by the lower catalog position, the earlier entry on that sheet', () => {
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    const observedGoblin: ObjectView = {
      oid: 'foreign:goblin-token:1',
      name: 'Goblin Token',
      typeLine: 'Creature — Goblin',
      power: 1,
      toughness: 1,
      tapped: false,
      attacking: false,
      damage: 0,
      controller: 0,
      counters: {},
    };
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [observedGoblin] }, VIEW.seats[1]],
    };
    // Innistrad's own token sheet reprints "Zombie" three times (collector
    // numbers 7-9) as the same card; the lowest position is the primary one.
    const later = { ...goblin, physicalId: 'tisd-0009', setCode: 'TISD', position: 9 };
    const earlier = { ...goblin, physicalId: 'tisd-0007', setCode: 'TISD', position: 7 };
    const middle = { ...goblin, physicalId: 'tisd-0008', setCode: 'TISD', position: 8 };

    const position = backendBoardPosition(view, 0, [later, middle, earlier]);
    expect(position.you.battlefield.permanents[0]?.art?.printedFrame?.physicalId).toBe('tisd-0007');
  });

  it('settles a shared token name by the colors and token-ness the backend states', () => {
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    const blue = {
      ...goblin,
      physicalId: 'thopter-blue',
      name: 'Thopter',
      observedNames: ['Thopter Token'],
      colors: ['U' as const],
    };
    const colorless = {
      ...blue,
      physicalId: 'thopter-colorless',
      colors: [] as ('W' | 'U' | 'B' | 'R' | 'G')[],
    };
    const thopter: ObjectView = {
      ...object('foreign:thopter:1', 'Thopter Token'),
      characteristics: { colors: [], manaCost: null, token: true },
    };
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [thopter] }, VIEW.seats[1]],
    };
    const permanent = backendBoardPosition(view, 0, [blue, colorless]).you.battlefield.permanents[0];
    expect(permanent?.art?.printedFrame?.physicalId).toBe('thopter-colorless');
    expect(permanent?.pileId).toBe('thopter-colorless');
  });

  it('piles permanents by printed identity while keeping each object its own key', () => {
    const goblin = OFFICIAL_TOKEN_PRINTINGS[0]!;
    const first = object('foreign:goblin:1', 'Goblin Token');
    const second = object('foreign:goblin:2', 'Goblin Token');
    const nobody = object('foreign:nobody:1', 'Unprinted Token');
    const view: TableView = {
      ...VIEW,
      seats: [{ ...VIEW.seats[0], battlefield: [first, second, nobody] }, VIEW.seats[1]],
    };
    const permanents = backendBoardPosition(view, 0, [goblin]).you.battlefield.permanents;
    expect(permanents.map((permanent) => permanent.key)).toEqual([
      'foreign:goblin:1',
      'foreign:goblin:2',
      'foreign:nobody:1',
    ]);
    expect(permanents.map((permanent) => permanent.pileId)).toEqual([
      goblin.physicalId,
      goblin.physicalId,
      'observed:unprinted-token:artifact-creature',
    ]);
  });

  it('prefers an ordinary set printing over an otherwise identical bonus printing', () => {
    const base = BASIC_LAND_PRINTINGS[0]!;
    const ordinary = {
      ...base,
      physicalId: 'hou:the-locust-god',
      name: 'The Locust God',
      oracleId: 'locust-god-oracle',
      typeLine: 'Legendary Creature — God',
      rarity: 'rare' as const,
      faces: [
        {
          ...base.faces[0]!,
          name: 'The Locust God',
          manaCost: '{4}{U}{R}',
          typeLine: 'Legendary Creature — God',
        },
      ],
      art: {
        ...base.art,
        images: [{ face: null, uris: { art_crop: 'https://cards.example/hou-locust.jpg' } }],
      },
    };
    const bonus = {
      ...ordinary,
      physicalId: 'mp2:the-locust-god',
      rarity: 'special' as const,
      art: {
        ...ordinary.art,
        images: [{ face: null, uris: { art_crop: 'https://cards.example/mp2-locust.jpg' } }],
      },
    };
    const locust = {
      ...relic,
      oid: 'foreign:the-locust-god:1',
      name: 'The Locust God',
      typeLine: 'Creature',
    };
    const position = backendBoardPosition(
      { ...VIEW, seats: [{ ...VIEW.seats[0], battlefield: [locust] }, VIEW.seats[1]] },
      0,
      [ordinary, bonus],
    );

    expect(position.you.battlefield.permanents[0]?.art?.src).toBe('https://cards.example/hou-locust.jpg');
    expect(position.you.battlefield.permanents[0]?.art?.printedFrame?.manaCost).toBe('{4}{U}{R}');
  });
});

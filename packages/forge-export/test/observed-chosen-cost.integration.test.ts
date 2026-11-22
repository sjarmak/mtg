/** Human choices pay actual installed-Forge costs; canceled attempts leave no board change. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type Seat = ObservedSession['view']['seats'][0];

function table(cards: SessionSpec['seats'][0]['deck']['cards'], seed: string, walls = false): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Human', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: {
          name: 'passive-board',
          cards: walls
            ? [
                { name: 'Plains', count: 36 },
                { name: 'Wall of Omens', count: 24 },
              ]
            : [{ name: 'Mountain', count: 60 }],
        },
      },
    ],
    seed,
    maximumTurns: 30,
  };
}

async function play(
  spec: SessionSpec,
  choose: (session: ObservedSession) => string | undefined,
): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  let trace: readonly string[] = [];
  try {
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let moves = 0; session.status === 'awaiting' && moves < 2000; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing Forge decision');
      trace = [...trace.slice(-70), JSON.stringify({ decision, view: session.view })];
      const move =
        choose(session) ??
        decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
      if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }
    expect(session.status).not.toBe('awaiting');
    if (session.view.turn.number >= 30)
      throw new Error('Probe did not reach its outcome before the turn limit');
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

function payLand(session: ObservedSession, name: string): string | undefined {
  return session.decision?.options.find(
    (option) => option.id.startsWith('mana-source-') && option.targets.some((target) => target.name === name),
  )?.id;
}

function discardDuplicate(session: ObservedSession, names: string | readonly string[]): string | undefined {
  const options = session.decision?.options;
  const commit = options?.find((option) => option.id === 'discard-selection-commit');
  if (commit !== undefined) return commit.id;
  const candidates = typeof names === 'string' ? [names] : names;
  const copies = candidates
    .map((name) => session.view.seats[0].hand?.filter((card) => card.name === name) ?? [])
    .find((cards) => cards.length >= 2);
  if (copies === undefined) throw new Error(`No redundant ${candidates.join(' or ')} to discard`);
  return options?.find((option) => option.targets.some((target) => target.oid === copies[0]?.oid))?.id;
}

forgeIt(
  'Exhume asks for the human graveyard card and returns one creature for each player',
  async () => {
    const spec = table(
      [
        { name: 'Scrubland', count: 18 },
        { name: 'Entomb', count: 14 },
        { name: 'Exhume', count: 8 },
        { name: 'Day of Judgment', count: 8 },
        { name: 'Griselbrand', count: 6 },
        { name: 'Wall of Omens', count: 6 },
      ],
      'chosen-graveyard-exhume',
      true,
    );
    let graveIds: readonly string[] = [];
    let entombsCast = 0;
    let dayCast = false;
    let exhumeCast = false;
    let humanChosen: string | undefined;
    let opposingGrave: Seat['graveyard'] | undefined;
    let resolved = false;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const opponent = session.view.seats[1];
      if (humanChosen !== undefined && seat.graveyard.some((card) => card.name === 'Exhume')) {
        expect(
          seat.battlefield.some((card) => card.oid === humanChosen && card.name === 'Wall of Omens'),
        ).toBe(true);
        expect(seat.graveyard.some((card) => card.oid === graveIds[0] && card.name === 'Griselbrand')).toBe(
          true,
        );
        const returned = opponent.battlefield.filter((card) =>
          opposingGrave?.some((entry) => entry.oid === card.oid),
        );
        expect(returned).toHaveLength(1);
        expect(returned[0]?.name).toBe('Wall of Omens');
        resolved = true;
      }
      if (decision.kind === 'mana-payment') return payLand(session, 'Scrubland');
      if (decision.kind === 'discard-selection')
        return discardDuplicate(session, [
          'Entomb',
          'Exhume',
          'Day of Judgment',
          'Griselbrand',
          'Wall of Omens',
        ]);
      if (decision.kind === 'zone-card-selection') {
        if (exhumeCast) {
          const choices = decision.options.filter((option) => option.targets.length === 1);
          expect(choices).toHaveLength(2);
          expect(choices.every((option) => graveIds.includes(option.targets[0]?.oid ?? ''))).toBe(true);
          expect(
            choices.every((option) => !opposingGrave?.some((card) => card.oid === option.targets[0]?.oid)),
          ).toBe(true);
          const chosen = choices.find((option) => option.targets[0]?.oid === graveIds[1]);
          expect(chosen?.targets[0]?.name).toBe('Wall of Omens');
          humanChosen = chosen?.targets[0]?.oid;
          return chosen?.id;
        }
        const name = graveIds.length === 0 ? 'Griselbrand' : 'Wall of Omens';
        const chosen = decision.options.find((option) => option.targets[0]?.name === name);
        const oid = chosen?.targets[0]?.oid;
        if (oid === undefined) throw new Error(`Entomb did not offer ${name}`);
        graveIds = [...graveIds, oid];
        return chosen?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      const lands = seat.battlefield.filter((card) => card.name === 'Scrubland' && !card.tapped);
      const playLand = decision.options.find((option) => option.text === 'Play Scrubland');
      if (playLand !== undefined) return playLand.id;
      if (entombsCast < 2 && lands.length > 0) {
        const cast = decision.options.find((option) => option.text.startsWith('Entomb:'));
        if (cast !== undefined) {
          entombsCast += 1;
          return cast.id;
        }
      }
      if (
        graveIds.length === 2 &&
        !dayCast &&
        lands.length >= 6 &&
        opponent.battlefield.some((card) => card.name === 'Wall of Omens')
      ) {
        const cast = decision.options.find((option) => option.text.startsWith('Day of Judgment:'));
        if (cast !== undefined) {
          dayCast = true;
          return cast.id;
        }
      }
      if (
        dayCast &&
        !exhumeCast &&
        lands.length >= 2 &&
        opponent.graveyard.some((card) => card.name === 'Wall of Omens')
      ) {
        const cast = decision.options.find((option) => option.text.startsWith('Exhume:'));
        if (cast !== undefined) {
          exhumeCast = true;
          opposingGrave = opponent.graveyard;
          return cast.id;
        }
      }
      return undefined;
    });
    expect(humanChosen).toBeDefined();
    expect(resolved).toBe(true);
  },
  420_000,
);

forgeIt(
  'Grim Lavamancer exiles the two exact graveyard cards chosen by the human and deals two damage',
  async () => {
    const spec = table(
      [
        { name: 'Mountain', count: 30 },
        { name: 'Lightning Bolt', count: 18 },
        { name: 'Grim Lavamancer', count: 12 },
      ],
      'chosen-cost-grim-lavamancer',
    );
    let boltsCast = 0;
    let grimOid: string | undefined;
    let activated = false;
    let lifeBefore: number | undefined;
    let chosen: readonly string[] = [];
    let resolved = false;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const opponent = session.view.seats[1];
      grimOid ??= seat.battlefield.find((card) => card.name === 'Grim Lavamancer')?.oid;
      if (
        chosen.length === 2 &&
        lifeBefore !== undefined &&
        opponent.life === lifeBefore - 2 &&
        chosen.every((oid) => seat.exile.some((card) => card.oid === oid))
      ) {
        expect(seat.battlefield.find((card) => card.oid === grimOid)?.tapped).toBe(true);
        resolved = true;
      }
      if (decision.kind === 'mana-payment') return payLand(session, 'Mountain');
      if (decision.kind === 'cost-card-selection') {
        if (chosen.length === 0) chosen = seat.graveyard.slice(0, 2).map((card) => card.oid);
        const next = chosen.find((oid) => decision.options.some((option) => option.targets[0]?.oid === oid));
        if (next === undefined) throw new Error('Forge did not offer the exact Grim graveyard card');
        return decision.options.find((option) => option.targets[0]?.oid === next)?.id;
      }
      if (decision.kind === 'target-selection') {
        return decision.options.find((option) => option.text.startsWith('Target Forge AI'))?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      const playLand = decision.options.find((option) => option.text === 'Play Mountain');
      if (playLand !== undefined) return playLand.id;
      const untapped = seat.battlefield.filter((card) => card.name === 'Mountain' && !card.tapped).length;
      const boltOnStack = session.view.stack.some((card) => card.name === 'Lightning Bolt');
      if (boltsCast < 2 && !boltOnStack && untapped >= 1) {
        const cast = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
        if (cast !== undefined) {
          boltsCast += 1;
          return cast.id;
        }
      }
      if (grimOid === undefined && boltsCast === 2 && seat.graveyard.length >= 2 && untapped >= 1) {
        const cast = decision.options.find((option) => option.text.startsWith('Grim Lavamancer:'));
        if (cast !== undefined) return cast.id;
      }
      if (!activated && grimOid !== undefined && seat.graveyard.length >= 2 && untapped >= 1) {
        const activate = decision.options.find((option) => option.text.startsWith('Grim Lavamancer:'));
        if (activate !== undefined) {
          activated = true;
          lifeBefore = opponent.life;
          return activate.id;
        }
      }
      return undefined;
    });
    expect(activated).toBe(true);
    expect(chosen).toHaveLength(2);
    expect(resolved).toBe(true);
  },
  420_000,
);

for (const [name, land] of [
  ['Opposition', 'Tropical Island'],
  ['Glare of Subdual', 'Savannah'],
] as const) {
  forgeIt(
    `${name} takes the human's fresh creature, cancels target setup, and taps only the new target`,
    async () => {
      const spec = table(
        [
          { name: land, count: 30 },
          { name: 'Llanowar Elves', count: 18 },
          { name, count: 12 },
        ],
        `chosen-cost-${name}`,
        true,
      );
      let arrivals: readonly { oid: string; turn: number }[] = [];
      let attempt = 0;
      let canceled = false;
      let refunded = false;
      let paidCreature: string | undefined;
      let before: ObservedSession['view'] | undefined;
      let firstTarget: string | undefined;
      let finalTarget: string | undefined;
      let resolved = false;
      await play(spec, (session) => {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const seat = session.view.seats[0];
        const elves = seat.battlefield.filter((card) => card.name === 'Llanowar Elves');
        const walls = session.view.seats[1].battlefield.filter((card) => card.name === 'Wall of Omens');
        arrivals = [
          ...arrivals,
          ...elves
            .filter((card) => !arrivals.some((entry) => entry.oid === card.oid))
            .map((card) => ({ oid: card.oid, turn: session.view.turn.number })),
        ];
        if (paidCreature !== undefined && walls.some((card) => card.oid === finalTarget && card.tapped)) {
          expect(elves.find((card) => card.oid === paidCreature)?.tapped).toBe(true);
          expect(elves.filter((card) => card.oid !== paidCreature).every((card) => !card.tapped)).toBe(true);
          expect(walls.find((card) => card.oid === firstTarget)?.tapped).toBe(false);
          resolved = true;
        }
        if (decision.kind === 'mana-payment') return payLand(session, land);
        if (decision.kind === 'discard-selection') return discardDuplicate(session, name);
        if (decision.kind === 'target-selection') {
          const target = attempt === 1 ? walls[0] : walls.find((card) => card.oid !== firstTarget);
          expect(target).toBeDefined();
          if (attempt === 1) firstTarget = target?.oid;
          else finalTarget = target?.oid;
          return decision.options.find((option) => option.targets.some((entry) => entry.oid === target?.oid))
            ?.id;
        }
        if (decision.kind === 'cost-tap-selection') {
          const eligible = decision.options.filter((option) => option.targets.length === 1);
          expect(eligible).toHaveLength(2);
          expect(eligible.every((option) => elves.some((card) => card.oid === option.targets[0]?.oid))).toBe(
            true,
          );
          expect(
            eligible.every((option) =>
              arrivals.some(
                (entry) => entry.oid === option.targets[0]?.oid && entry.turn === session.view.turn.number,
              ),
            ),
          ).toBe(true);
          if (!canceled) {
            canceled = true;
            return decision.options.find((option) => option.id === 'cost-tap-cancel')?.id;
          }
          paidCreature = eligible[0]?.targets[0]?.oid;
          return eligible[0]?.id;
        }
        if (decision.kind !== 'priority') return undefined;
        if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
        if (canceled && !refunded) {
          expect(session.view.seats).toEqual(before?.seats);
          expect(session.view.stack).toEqual(before?.stack);
          refunded = true;
        }
        const lands = seat.battlefield.filter((card) => card.name === land);
        const playLand = decision.options.find((option) => option.text === `Play ${land}`);
        if (playLand !== undefined) return playLand.id;
        const enchantment = seat.battlefield.find((card) => card.name === name);
        if (enchantment === undefined && lands.filter((card) => !card.tapped).length >= 4) {
          return decision.options.find((option) => option.text.startsWith(`${name}: ${name}`))?.id;
        }
        if (
          enchantment !== undefined &&
          elves.length < 2 &&
          lands.some((card) => !card.tapped) &&
          elves.length + (seat.hand?.filter((card) => card.name === 'Llanowar Elves').length ?? 0) >= 2
        ) {
          return decision.options.find((option) => option.text.startsWith('Llanowar Elves: Llanowar Elves -'))
            ?.id;
        }
        if (elves.length === 2 && walls.length >= 2 && attempt < 2 && (attempt === 0 || refunded)) {
          const activate = decision.options.find(
            (option) => option.text.startsWith(`${name}:`) && option.text.includes('Tap target'),
          );
          if (activate !== undefined) {
            attempt += 1;
            before = session.view;
            return activate.id;
          }
        }
        return undefined;
      });
      expect(refunded).toBe(true);
      expect(resolved).toBe(true);
    },
    420_000,
  );
}

forgeIt(
  'Dermotaxi imprints a real creature, cancels a partial tap selection, and copies it using two fresh creatures',
  async () => {
    const spec = table(
      [
        { name: 'Bayou', count: 16 },
        { name: 'Llanowar Elves', count: 10 },
        { name: 'Dermotaxi', count: 6 },
        { name: 'Entomb', count: 6 },
        { name: 'Griselbrand', count: 2 },
      ],
      '1514',
    );
    let entombed: string | undefined;
    let entombCast = false;
    let imprinted = false;
    let taxiOid: string | undefined;
    let canceled = false;
    let checkingRefund = false;
    let refunded = false;
    let selections: readonly string[] = [];
    let before: Seat | undefined;
    let activationTurn: number | undefined;
    let arrivals: readonly { oid: string; turn: number }[] = [];
    let resolved = false;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const elves = seat.battlefield.filter((card) => card.name === 'Llanowar Elves');
      arrivals = [
        ...arrivals,
        ...elves
          .filter((card) => !arrivals.some((entry) => entry.oid === card.oid))
          .map((card) => ({ oid: card.oid, turn: session.view.turn.number })),
      ];
      const taxi = seat.battlefield.find((card) => card.oid === taxiOid);
      imprinted ||= taxi !== undefined && seat.exile.some((card) => card.oid === entombed);
      if (taxi?.power === 7 && taxi.toughness === 7) {
        expect(taxi.name).toBe('Griselbrand');
        expect(taxi.typeLine).toContain('Artifact');
        expect(taxi.typeLine).toContain('Vehicle');
        expect(selections).toHaveLength(2);
        expect(new Set(selections).size).toBe(2);
        expect(
          elves
            .filter((card) => card.tapped)
            .map((card) => card.oid)
            .sort(),
        ).toEqual([...selections].sort());
        expect(elves.filter((card) => !card.tapped)).toHaveLength(1);
        expect(seat.exile.some((card) => card.oid === entombed)).toBe(true);
        resolved = true;
      }
      if (decision.kind === 'mana-payment') return payLand(session, 'Bayou');
      if (decision.kind === 'discard-selection') {
        const extraElf = (seat.hand?.filter((card) => card.name === 'Llanowar Elves').length ?? 0) > 3;
        return discardDuplicate(
          session,
          extraElf ? 'Llanowar Elves' : ['Dermotaxi', 'Entomb', 'Bayou', 'Griselbrand'],
        );
      }
      if (decision.kind === 'zone-card-selection') {
        const pick = decision.options.find((option) =>
          option.targets.some((target) => target.name === 'Griselbrand'),
        );
        expect(pick).toBeDefined();
        if (entombed === undefined) entombed = pick?.targets[0]?.oid;
        else {
          expect(pick?.targets[0]?.oid).toBe(entombed);
          imprinted = true;
        }
        return pick?.id;
      }
      if (decision.kind === 'cost-tap-selection') {
        const eligible = decision.options.filter((option) => option.targets.length === 1);
        expect(eligible).toHaveLength(3 - selections.length);
        expect(eligible.every((option) => !selections.includes(option.targets[0]?.oid ?? ''))).toBe(true);
        if (!canceled && selections.length === 1) {
          canceled = true;
          checkingRefund = true;
          return decision.options.find((option) => option.id === 'cost-tap-cancel')?.id;
        }
        const pick = eligible[0];
        const oid = pick?.targets[0]?.oid;
        if (oid === undefined) throw new Error('No distinct creature offered for Dermotaxi');
        expect(arrivals.some((entry) => entry.oid === oid && entry.turn === activationTurn)).toBe(true);
        selections = [...selections, oid];
        return pick?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      if (checkingRefund) {
        expect(seat).toEqual(before);
        expect(session.view.stack).toHaveLength(0);
        selections = [];
        checkingRefund = false;
        refunded = true;
      }
      const lands = seat.battlefield.filter((card) => card.name === 'Bayou');
      const playLand = decision.options.find((option) => option.text === 'Play Bayou');
      if (playLand !== undefined) return playLand.id;
      if (!entombCast && lands.some((card) => !card.tapped)) {
        const cast = decision.options.find((option) => option.text.startsWith('Entomb:'));
        if (cast !== undefined) {
          entombCast = true;
          return cast.id;
        }
      }
      if (taxiOid === undefined) taxiOid = seat.battlefield.find((card) => card.name === 'Dermotaxi')?.oid;
      if (
        taxiOid === undefined &&
        seat.graveyard.some((card) => card.oid === entombed) &&
        lands.filter((card) => !card.tapped).length >= 2
      ) {
        return decision.options.find((option) => option.text.startsWith('Dermotaxi: Dermotaxi'))?.id;
      }
      if (
        taxiOid !== undefined &&
        elves.length < 3 &&
        elves.length + (seat.hand?.filter((card) => card.name === 'Llanowar Elves').length ?? 0) >= 3 &&
        lands.filter((card) => !card.tapped).length >= 3 - elves.length
      ) {
        return decision.options.find((option) => option.text.startsWith('Llanowar Elves: Llanowar Elves -'))
          ?.id;
      }
      if (imprinted && elves.length === 3 && selections.length === 0) {
        const activate = decision.options.find((option) =>
          option.text.includes('becomes a copy of the exiled card'),
        );
        if (activate !== undefined) {
          before = seat;
          activationTurn = session.view.turn.number;
          return activate.id;
        }
      }
      return undefined;
    });
    expect(imprinted).toBe(true);
    expect(refunded).toBe(true);
    expect(resolved).toBe(true);
  },
  420_000,
);

forgeIt(
  'Relic cancels its paid source-exile cost and then exiles itself and the graveyard and draws',
  async () => {
    const spec = table(
      [
        { name: 'Swamp', count: 30 },
        { name: 'Relic of Progenitus', count: 12 },
        { name: 'Entomb', count: 12 },
        { name: 'Griselbrand', count: 6 },
      ],
      'chosen-cost-relic',
    );
    let entombCast = false;
    let entombed: string | undefined;
    let relicOid: string | undefined;
    let before: Seat | undefined;
    let attempted = false;
    let canceled = false;
    let refunded = false;
    let exiled = false;
    let resolved = false;
    let targetedSelf = false;
    let firstChosen: string | undefined;
    let beforeFirstGrave: Seat['graveyard'] | undefined;
    let firstResolved = false;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      if (
        firstChosen !== undefined &&
        !firstResolved &&
        seat.exile.some((card) => card.oid === firstChosen)
      ) {
        expect(seat.graveyard).toEqual(beforeFirstGrave?.filter((card) => card.oid !== firstChosen));
        expect(seat.exile).toHaveLength(1);
        firstResolved = true;
      }
      if (exiled && seat.librarySize === (before?.librarySize ?? 0) - 1) {
        expect(seat.exile.some((card) => card.oid === relicOid)).toBe(true);
        expect(seat.exile.some((card) => card.oid === entombed)).toBe(true);
        expect(before?.graveyard.every((card) => seat.exile.some((entry) => entry.oid === card.oid))).toBe(
          true,
        );
        expect(seat.graveyard).toHaveLength(0);
        expect(seat.handSize).toBe((before?.handSize ?? 0) + 1);
        expect(seat.battlefield.some((card) => card.oid === relicOid)).toBe(false);
        resolved = true;
      }
      if (decision.kind === 'mana-payment') return payLand(session, 'Swamp');
      if (decision.kind === 'discard-selection') return discardDuplicate(session, 'Relic of Progenitus');
      if (decision.kind === 'target-selection') {
        expect(decision.options.some((option) => option.id === 'target-player-1')).toBe(true);
        return decision.options.find((option) => option.id === 'target-player-0')?.id;
      }
      if (decision.kind === 'zone-card-selection') {
        if (targetedSelf) {
          const choices = decision.options.filter((option) => option.targets.length === 1);
          expect(choices).toHaveLength(2);
          firstChosen = choices[1]?.targets[0]?.oid;
          expect(firstChosen).not.toBe(choices[0]?.targets[0]?.oid);
          beforeFirstGrave = seat.graveyard;
          return choices[1]?.id;
        }
        const pick = decision.options.find((option) =>
          option.targets.some((target) => target.name === 'Griselbrand'),
        );
        entombed = pick?.targets[0]?.oid;
        return pick?.id;
      }
      if (decision.kind === 'cost-exile-confirm') {
        expect(before).toBeDefined();
        expect(seat.battlefield.filter((card) => card.name === 'Swamp' && card.tapped).length).toBe(
          (before?.battlefield.filter((card) => card.name === 'Swamp' && card.tapped).length ?? 0) + 1,
        );
        expect(seat.battlefield.some((card) => card.oid === relicOid)).toBe(true);
        if (!canceled) {
          canceled = true;
          return decision.options.find((option) => option.text.includes('Cancel'))?.id;
        }
        exiled = true;
        return decision.options.find((option) => option.text.startsWith('Exile'))?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      if (canceled && !refunded) {
        expect(seat).toEqual(before);
        expect(session.view.stack).toHaveLength(0);
        refunded = true;
        attempted = false;
      }
      const lands = seat.battlefield.filter((card) => card.name === 'Swamp');
      const playLand = decision.options.find((option) => option.text === 'Play Swamp');
      if (playLand !== undefined) return playLand.id;
      if (!entombCast && lands.some((card) => !card.tapped)) {
        const cast = decision.options.find((option) => option.text.startsWith('Entomb:'));
        if (cast !== undefined) {
          entombCast = true;
          return cast.id;
        }
      }
      if (relicOid === undefined)
        relicOid = seat.battlefield.find((card) => card.name === 'Relic of Progenitus')?.oid;
      if (relicOid === undefined && lands.some((card) => !card.tapped)) {
        return decision.options.find((option) =>
          option.text.startsWith('Relic of Progenitus: Relic of Progenitus'),
        )?.id;
      }
      if (!targetedSelf && relicOid !== undefined && seat.graveyard.length >= 2) {
        const activate = decision.options.find((option) =>
          option.text.includes('Target player exiles a card'),
        );
        if (activate !== undefined) {
          targetedSelf = true;
          return activate.id;
        }
      }
      if (
        !attempted &&
        firstResolved &&
        relicOid !== undefined &&
        seat.graveyard.length > 0 &&
        lands.some((card) => !card.tapped)
      ) {
        const activate = decision.options.find((option) => option.text.includes('Exile all graveyards'));
        if (activate !== undefined) {
          before = seat;
          attempted = true;
          return activate.id;
        }
      }
      return undefined;
    });
    expect(refunded).toBe(true);
    expect(firstResolved).toBe(true);
    expect(resolved).toBe(true);
  },
  420_000,
);

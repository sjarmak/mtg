/** Installed Forge owns derived amounts, loyalty costs, and emblem-granted abilities. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(cards: SessionSpec['seats'][0]['deck']['cards'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Human', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: {
          name: 'passive-mountains',
          cards: [{ name: 'Mountain', count: 60 }],
        },
      },
    ],
    seed,
    maximumTurns: 24,
  };
}

async function play(
  spec: SessionSpec,
  choose: (session: ObservedSession) => string | undefined,
): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  expect(backend, 'required installed Forge').not.toBeNull();
  if (backend === null) throw new Error('Required Forge is absent');
  let session: ObservedSession | undefined;
  let trace: readonly string[] = [];
  try {
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 1800; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Awaiting session has no decision');
      trace = [
        ...trace.slice(-60),
        JSON.stringify({
          turn: session.view.turn,
          stack: session.view.stack,
          decision,
          seats: session.view.seats.map(({ battlefield, life }) => ({ battlefield, life })),
        }),
      ];
      const chosen = choose(session);
      const move =
        chosen ??
        decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
      if (move === undefined) throw new Error(`Unhandled decision ${decision.kind}`);
      const result = await session.submit(move);
      if (!result.ok) throw new Error(result.error.message);
      session = result.session;
    }
    expect(session.status).not.toBe('awaiting');
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

const kothTable = table(
  [
    { name: 'Mountain', count: 36 },
    { name: 'Koth of the Hammer', count: 12 },
    { name: 'Stonecoil Serpent', count: 12 },
  ],
  'derived-amount-koth-01',
);

forgeIt(
  'pays Koth source loyalty and spends exactly one red mana per Mountain on a real creature',
  async () => {
    let activated = false;
    let mountainsAtActivation = 0;
    let kothOid: string | undefined;
    let measuredPool = false;
    let serpentCast = false;
    let resolved = false;
    await play(kothTable, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const mountains = seat.battlefield.filter((card) => card.name === 'Mountain');
      const koth = seat.battlefield.find((card) => card.name === 'Koth of the Hammer');
      const serpent = seat.battlefield.find((card) => card.name === 'Stonecoil Serpent');
      if (activated) expect(koth?.oid).toBe(kothOid);
      if (activated) expect(koth?.counters['LOYALTY']).toBe(1);
      if (serpent !== undefined) {
        expect(serpent.power).toBe(mountainsAtActivation);
        expect(serpent.toughness).toBe(mountainsAtActivation);
        resolved = true;
      }
      if (decision.kind === 'number') {
        expect(decision.prompt).toContain('Stonecoil Serpent');
        return decision.options.find((option) => option.id === `number-${mountainsAtActivation}`)?.id;
      }
      if (decision.kind === 'mana-payment') {
        if (serpentCast) {
          const floating = decision.options.filter((option) => option.id.startsWith('mana-pool-'));
          if (!measuredPool) {
            expect(floating).toHaveLength(mountainsAtActivation);
            expect(floating.every((option) => option.text.startsWith('Spend floating {R}'))).toBe(true);
            measuredPool = true;
          }
          return floating[0]?.id;
        }
        return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      if (!activated) {
        const land = decision.options.find((option) => option.text === 'Play Mountain');
        if (land !== undefined) return land.id;
        if (koth === undefined && mountains.length >= 4) {
          return decision.options.find((option) => option.text.startsWith('Koth of the Hammer'))?.id;
        }
        const activate = decision.options.find((option) => option.text.includes('for each Mountain'));
        if (activate !== undefined && seat.hand?.some((card) => card.name === 'Stonecoil Serpent')) {
          expect(koth?.counters['LOYALTY']).toBe(3);
          activated = true;
          kothOid = koth?.oid;
          mountainsAtActivation = mountains.length;
          return activate.id;
        }
      } else if (!serpentCast) {
        const cast = decision.options.find((option) => option.text.startsWith('Stonecoil Serpent'));
        if (cast !== undefined) {
          serpentCast = true;
          return cast.id;
        }
      }
      return undefined;
    });
    expect(mountainsAtActivation).toBeGreaterThanOrEqual(4);
    expect(measuredPool).toBe(true);
    expect(resolved).toBe(true);
  },
  420_000,
);

forgeIt(
  'refunds nested Nykthos payments, asks its color, and spends exact devotion mana into creatures',
  async () => {
    const spec = table(
      [
        { name: 'Plains', count: 28 },
        { name: 'Nykthos, Shrine to Nyx', count: 8 },
        { name: 'Wall of Omens', count: 12 },
        { name: 'Stonecoil Serpent', count: 12 },
      ],
      'derived-amount-nykthos-01',
    );
    let activated = false;
    let choseColor = false;
    let devotion = 0;
    let measuredPool = false;
    let serpentsCast = 0;
    let resolved = false;
    let untappedPlainsBefore = 0;
    let canceledPayments = 0;
    let nestedSourcesPaid = 0;
    let checkingRefund = false;
    let outerPrompt: string | undefined;
    let beforeNykthos: ObservedSession['view']['seats'][0] | undefined;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const plains = seat.battlefield.filter((card) => card.name === 'Plains');
      const nykthos = seat.battlefield.find((card) => card.name === 'Nykthos, Shrine to Nyx');
      const walls = seat.battlefield.filter((card) => card.name === 'Wall of Omens');
      const serpents = seat.battlefield.filter((card) => card.name === 'Stonecoil Serpent');
      if (serpents.length === 2) {
        expect(serpents.map((card) => card.power)).toEqual([devotion - 1, 1]);
        expect(serpents.map((card) => card.toughness)).toEqual([devotion - 1, 1]);
        resolved = true;
      }
      if (decision.kind === 'discard-selection') {
        const commit = decision.options.find((option) => option.id === 'discard-selection-commit');
        if (commit !== undefined) return commit.id;
        // Keep one Serpent for each mana observation and discard only a redundant copy.
        const copies = seat.hand?.filter((card) => card.name === 'Stonecoil Serpent') ?? [];
        if (copies.length > 2)
          return decision.options.find((option) =>
            option.targets.some((target) => target.oid === copies[0]?.oid),
          )?.id;
        throw new Error('No redundant Serpent to discard');
      }
      if (decision.kind === 'color-choice') {
        expect(decision.prompt).toContain('Nykthos, Shrine to Nyx');
        expect(decision.options.map((option) => option.id).sort()).toEqual([
          'color-choice-B',
          'color-choice-G',
          'color-choice-R',
          'color-choice-U',
          'color-choice-W',
        ]);
        expect(nykthos?.tapped).toBe(true);
        expect(plains.filter((card) => !card.tapped)).toHaveLength(untappedPlainsBefore - 2);
        choseColor = true;
        return decision.options.find((option) => option.id === 'color-choice-W')?.id;
      }
      if (decision.kind === 'number') {
        expect(decision.prompt).toContain('Stonecoil Serpent');
        return decision.options.find(
          (option) => option.id === `number-${serpentsCast === 1 ? devotion - 1 : 1}`,
        )?.id;
      }
      if (decision.kind === 'mana-payment') {
        if (checkingRefund) {
          expect(decision.prompt).toBe(outerPrompt);
          expect(seat.battlefield).toEqual(beforeNykthos?.battlefield);
          expect(seat.hand).toEqual(beforeNykthos?.hand);
          expect(seat.life).toBe(beforeNykthos?.life);
          checkingRefund = false;
          activated = false;
        }
        if (serpentsCast === 1 && !activated) {
          const sources = decision.options.filter(
            (option) =>
              (option.id.startsWith('mana-source-') || option.id.startsWith('mana-activate-')) &&
              option.targets.some((target) => target.oid === nykthos?.oid),
          );
          expect(sources.some((option) => option.text.includes('{C}'))).toBe(true);
          // This action activates the ability. Its resolution must ask the seat
          // for a color, including colors whose devotion happens to be zero.
          const source = sources.find((option) => option.text.includes('Choose a color'));
          expect(source, 'Nykthos devotion is an offered human mana source').toBeDefined();
          untappedPlainsBefore = plains.filter((card) => !card.tapped).length;
          beforeNykthos = seat;
          outerPrompt = decision.prompt;
          nestedSourcesPaid = 0;
          activated = true;
          return source?.id;
        }
        if (serpentsCast === 1 && activated && canceledPayments < 2) {
          expect(nykthos?.tapped).toBe(true);
          expect(
            decision.options.some((option) => option.targets.some((target) => target.oid === nykthos?.oid)),
          ).toBe(false);
          // Cancel once before paying and once after a real mana activation.
          // Both must return to this spell's payment with every source restored.
          if (canceledPayments === 0 || nestedSourcesPaid === 1) {
            canceledPayments += 1;
            checkingRefund = true;
            return decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
          }
          nestedSourcesPaid += 1;
        }
        if (serpentsCast === 2) {
          const floating = decision.options.filter((option) => option.id.startsWith('mana-pool-'));
          if (!measuredPool) {
            expect(floating).toHaveLength(1);
            expect(floating.every((option) => option.text.startsWith('Spend floating {W}'))).toBe(true);
            measuredPool = true;
          }
          return floating[0]?.id;
        }
        return decision.options.find(
          (option) =>
            option.id.startsWith('mana-source-') &&
            option.targets.some((target) => plains.some((plainsCard) => plainsCard.oid === target.oid)),
        )?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      if (choseColor && serpentsCast === 1 && serpents.length === 1) {
        const cast = decision.options.find((option) => option.text.startsWith('Stonecoil Serpent'));
        if (cast !== undefined) {
          serpentsCast = 2;
          return cast.id;
        }
      }
      if (activated) return undefined;
      if (nykthos === undefined && plains.length >= 2) {
        const playNykthos = decision.options.find((option) => option.text === 'Play Nykthos, Shrine to Nyx');
        if (playNykthos !== undefined) return playNykthos.id;
      }
      const land = decision.options.find((option) => option.text === 'Play Plains');
      if (land !== undefined) return land.id;
      if (walls.length < 2 && plains.filter((card) => !card.tapped).length >= 2) {
        const castWall = decision.options.find((option) => option.text.startsWith('Wall of Omens'));
        if (castWall !== undefined) return castWall.id;
      }
      if (
        walls.length >= 2 &&
        plains.filter((card) => !card.tapped).length >= 2 &&
        seat.hand?.some((card) => card.name === 'Stonecoil Serpent')
      ) {
        const cast = decision.options.find((option) => option.text.startsWith('Stonecoil Serpent'));
        if (nykthos !== undefined && cast !== undefined) {
          serpentsCast = 1;
          devotion = walls.length;
          return cast.id;
        }
      }
      return undefined;
    });
    expect(choseColor).toBe(true);
    expect(canceledPayments).toBe(2);
    expect(checkingRefund).toBe(false);
    expect(devotion).toBeGreaterThanOrEqual(2);
    expect(measuredPool).toBe(true);
    expect(resolved).toBe(true);
  },
  420_000,
);

forgeIt(
  'offers Koth emblem-granted Mountain damage targets and damages the player the human chooses',
  async () => {
    let ultimate = false;
    let damageActivated = false;
    let damageTargeted = false;
    let resolved = false;
    let loyaltyBefore: number | undefined;
    await play(kothTable, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      const mountains = seat.battlefield.filter((card) => card.name === 'Mountain');
      const koth = seat.battlefield.find((card) => card.name === 'Koth of the Hammer');
      if (damageTargeted && session.view.seats[1].life === 19) {
        expect(seat.life).toBe(20);
        resolved = true;
      }
      if (decision.kind === 'target-selection') {
        if (damageActivated) {
          expect(decision.options.some((option) => option.id === 'target-player-0')).toBe(true);
          expect(decision.options.some((option) => option.id === 'target-player-1')).toBe(true);
          damageTargeted = true;
          return decision.options.find((option) => option.id === 'target-player-1')?.id;
        }
        return decision.options.find((option) =>
          option.targets.some((target) => mountains.some((mountain) => mountain.oid === target.oid)),
        )?.id;
      }
      if (decision.kind === 'mana-payment') {
        return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (resolved) return decision.options.find((option) => option.text === 'Concede')?.id;
      const damage = decision.options.find((option) => option.text.includes('deals 1 damage to any target'));
      if (ultimate && damage !== undefined && !damageActivated) {
        expect(loyaltyBefore).toBe(5);
        expect(koth).toBeUndefined();
        damageActivated = true;
        return damage.id;
      }
      if (ultimate) return undefined;
      const land = decision.options.find((option) => option.text === 'Play Mountain');
      if (land !== undefined) return land.id;
      if (koth === undefined && mountains.length >= 4) {
        return decision.options.find((option) => option.text.startsWith('Koth of the Hammer'))?.id;
      }
      const emblem = decision.options.find((option) => option.text.includes('You get an emblem'));
      if (koth?.counters['LOYALTY'] === 3 || koth?.counters['LOYALTY'] === 4) {
        expect(emblem, 'Insufficient loyalty must not offer the ultimate').toBeUndefined();
      }
      if (
        koth?.counters['LOYALTY'] === 5 &&
        decision.options.some((option) => option.text.includes('Untap target Mountain'))
      ) {
        expect(emblem, 'Five loyalty must legally pay the ultimate, even when Koth dies').toBeDefined();
      }
      if (emblem !== undefined) {
        ultimate = true;
        loyaltyBefore = koth?.counters['LOYALTY'];
        return emblem.id;
      }
      return decision.options.find((option) => option.text.includes('Untap target Mountain'))?.id;
    });
    expect(damageTargeted).toBe(true);
    expect(resolved).toBe(true);
  },
  420_000,
);

// Quarantined: mtg-6jevp. This test's premise was that Forge lets a cast
// attempt begin before it is fully payable ("Core legality permits trying a
// spell whose mana is not yet paid"), letting the pilot tap one Mountain and
// then hit the mana-payment cancellation/rollback path. Two things are wrong
// with that premise against the real, installed Forge engine:
// - Koth of the Hammer's real cost is `{2}{R}{R}` (mv 4, per the vendored
//   cardsfolder's `ManaCost:2 R R`), not `{2}{R}` (mv 3) as this test
//   assumed, so "1 Mountain" was never within 1 land of affordable.
// - Forge does not offer a spell as a priority option until total untapped
//   producible mana already covers its full cost -- confirmed here by
//   walking the pilot up to 4 Mountains before the cast option ever
//   appeared, and consistent with this file's other three tests, which all
//   already gate on `mountains.length >= 4` before attempting Koth. Forge
//   gates the *offer*, not just the payment, so a fixed-cost spell can never
//   be legally attempted while underfunded; the mana-payment cancel/rollback
//   path this test wants to exercise needs a scenario where a precheck and
//   the real payment can disagree (e.g. a color requirement a raw mana-count
//   precheck wouldn't catch), which is a real redesign, not a number change.
forgeIt.skip(
  'cancels an underfunded spell after tapping mana and restores the unpaid position',
  async () => {
    const spec = table(
      [
        { name: 'Mountain', count: 24 },
        { name: 'Koth of the Hammer', count: 36 },
      ],
      '1514',
    );
    let attempted = false;
    let tapped = false;
    let canceled = false;
    let restored = false;
    let before: ObservedSession['view']['seats'][0] | undefined;
    await play(spec, (session) => {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing decision');
      const seat = session.view.seats[0];
      if (decision.kind === 'mana-payment') {
        expect(attempted).toBe(true);
        const sources = decision.options.filter((option) => option.id.startsWith('mana-source-'));
        if (!tapped) {
          expect(sources).toHaveLength(1);
          tapped = true;
          return sources[0]?.id;
        }
        expect(sources).toHaveLength(0);
        expect(seat.battlefield.filter((card) => card.tapped)).toHaveLength(1);
        canceled = true;
        return decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
      }
      if (decision.kind !== 'priority') return undefined;
      if (canceled) {
        expect(before).toBeDefined();
        expect(seat.battlefield).toEqual(before?.battlefield);
        expect(seat.hand?.map((card) => card.oid).sort()).toEqual(
          before?.hand?.map((card) => card.oid).sort(),
        );
        expect(seat.life).toBe(before?.life);
        expect(session.view.stack).toHaveLength(0);
        expect(decision.options.some((option) => option.text === 'Pass priority')).toBe(true);
        restored = true;
        return decision.options.find((option) => option.text === 'Concede')?.id;
      }
      if (seat.battlefield.length === 0) {
        return decision.options.find((option) => option.text === 'Play Mountain')?.id;
      }
      if (!attempted) {
        const cast = decision.options.find((option) => option.text.startsWith('Koth of the Hammer'));
        expect(cast, 'Core legality permits trying a spell whose mana is not yet paid').toBeDefined();
        before = seat;
        attempted = true;
        return cast?.id;
      }
      throw new Error('Unpaid casting attempt returned to priority without cancellation');
    });
    expect(tapped).toBe(true);
    expect(restored).toBe(true);
  },
  420_000,
);

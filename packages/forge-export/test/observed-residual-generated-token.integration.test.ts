/** Installed-Forge board outcomes for the residual generated-token cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function hermitTable(route: 'pay' | 'decline'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Hermit ${route} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-deranged-hermit-${route}`,
          cards: [
            { name: 'Mana Confluence', count: 42 },
            { name: 'Deranged Hermit', count: 18 },
          ],
        },
      },
      {
        name: 'Hermit observer',
        controller: 'engine',
        deck: { name: 'z5q4-hermit-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-deranged-hermit-echo-${route}`,
    maximumTurns: 18,
  };
}

for (const route of ['decline', 'pay'] as const) {
  forgeIt(
    `Deranged Hermit creates four exact boosted Squirrels and ${route === 'pay' ? 'survives paid Echo' : 'is sacrificed when Echo is declined'}`,
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      let hermitOid: string | undefined;
      let squirrelOids: readonly string[] = [];
      let boosted = false;
      let echoDecisionSeen = false;
      let inventedRejected = false;
      let staleRejected = false;
      let outcome = false;
      try {
        const spec = hermitTable(route);
        expect(await backend.supports(spec)).toEqual([]);
        const opened = await backend.open(spec);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;

        for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no Deranged Hermit decision');
          const local = session.view.seats[0];
          const hermit = local.battlefield.find((card) => card.name === 'Deranged Hermit');
          const squirrels = local.battlefield.filter(
            (card) => card.name.includes('Squirrel') && card.typeLine.includes('Creature'),
          );
          hermitOid ??= hermit?.oid;
          if (squirrelOids.length === 0 && squirrels.length === 4) {
            squirrelOids = squirrels.map((card) => card.oid);
          }
          boosted ||=
            hermit !== undefined &&
            squirrels.length === 4 &&
            squirrels.every((card) => card.power === 2 && card.toughness === 2);
          if (echoDecisionSeen && session.view.stack.length === 0) {
            const exactSquirrels = local.battlefield.filter((card) => squirrelOids.includes(card.oid));
            outcome =
              exactSquirrels.length === 4 &&
              (route === 'pay'
                ? local.battlefield.some((card) => card.oid === hermitOid) &&
                  exactSquirrels.every((card) => card.power === 2 && card.toughness === 2)
                : !local.battlefield.some((card) => card.oid === hermitOid) &&
                  exactSquirrels.every((card) => card.power === 1 && card.toughness === 1));
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );

          let move: string | undefined;
          if (
            decision.kind === 'mana-payment' &&
            decision.seat === 0 &&
            boosted &&
            session.view.turn.step === 'UPKEEP'
          ) {
            echoDecisionSeen = true;
            if (!inventedRejected) {
              await expect(session.submit('mana-payment-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            move = decision.options.find((option) =>
              route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
            )?.id;
            if (move !== undefined && !staleRejected) {
              const staleSession = session;
              const advanced = await session.submit(move);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              await expect(staleSession.submit(move)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
              continue;
            }
          } else if (decision.kind === 'priority') {
            const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
            move =
              (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
              (hermitOid === undefined && lands >= 5
                ? decision.options.find((option) => option.text.startsWith('Deranged Hermit:'))?.id
                : undefined);
          }

          move ??= routineMove(decision) ?? decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no Deranged Hermit move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
        }

        const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(hermitOid, evidence).toMatch(/^forge-card-/u);
        expect(squirrelOids, evidence).toHaveLength(4);
        expect(new Set(squirrelOids).size, evidence).toBe(4);
        expect(boosted, evidence).toBe(true);
        expect(echoDecisionSeen, evidence).toBe(true);
        expect(inventedRejected, evidence).toBe(true);
        expect(staleRejected, evidence).toBe(true);
        expect(outcome, evidence).toBe(true);
      } catch (cause) {
        throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
      } finally {
        try {
          await session?.close();
        } finally {
          await backend.shutdown?.();
        }
      }
    },
    300_000,
  );
}

const XENAGOS_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Xenagos pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-xenagos-residual-generated-token',
        cards: [
          { name: 'Mana Confluence', count: 24 },
          { name: 'Llanowar Elves', count: 12 },
          { name: 'Lightning Bolt', count: 12 },
          { name: 'Xenagos, the Reveler', count: 12 },
        ],
      },
    },
    {
      name: 'Xenagos observer',
      controller: 'engine',
      deck: { name: 'z5q4-xenagos-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-xenagos-installed-forge-outcomes',
  maximumTurns: 30,
};

function loyaltyOf(session: ObservedSession, oid: string | undefined): number | undefined {
  const walker = session.view.seats[0].battlefield.find((card) => card.oid === oid);
  if (walker === undefined) return undefined;
  return Object.entries(walker.counters)
    .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
    .reduce((sum, [, count]) => sum + count, 0);
}

forgeIt(
  'Xenagos routes its one-creature mana through the exact single-color callback',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let xenagosOid: string | undefined;
    let colorChoices = 0;
    let inventedRejected = false;
    let staleRejected = false;
    let outcome = false;
    try {
      expect(await backend.supports(XENAGOS_TABLE)).toEqual([]);
      const opened = await backend.open({
        ...XENAGOS_TABLE,
        seed: 'z5q4-xenagos-single-mana-installed-forge',
        maximumTurns: 20,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no single-mana Xenagos decision');
        const local = session.view.seats[0];
        const xenagos = local.battlefield.find((card) => card.name === 'Xenagos, the Reveler');
        const elves = local.battlefield.filter((card) => card.name === 'Llanowar Elves');
        const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence');
        xenagosOid ??= xenagos?.oid;
        outcome ||=
          colorChoices === 1 && session.view.stack.length === 0 && loyaltyOf(session, xenagosOid) === 4;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'color-choice' && decision.seat === 0) {
          colorChoices += 1;
          expect(elves, trace.at(-1)).toHaveLength(1);
          expect(decision.options.map((option) => option.id).sort(), trace.at(-1)).toEqual([
            'color-choice-G',
            'color-choice-R',
          ]);
          if (!inventedRejected) {
            await expect(session.submit('color-choice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          const red = decision.options.find((option) => option.id === 'color-choice-R');
          expect(red, trace.at(-1)).toBeDefined();
          if (!staleRejected) {
            const staleSession = session;
            const advanced = await session.submit(red!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(staleSession.submit(red!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
          move = red!.id;
        } else if (decision.kind === 'priority') {
          const castElf = decision.options.find((option) => option.text.startsWith('Llanowar Elves:'));
          const castXenagos = decision.options.find((option) =>
            option.text.startsWith('Xenagos, the Reveler:'),
          );
          const addMana = decision.options.find(
            (option) => option.text.startsWith('Xenagos, the Reveler:') && option.text.includes('Add X mana'),
          );
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (session.view.stack.length === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : undefined) ??
            (session.view.stack.length === 0 && xenagos === undefined && elves.length === 0
              ? castElf?.id
              : undefined) ??
            (session.view.stack.length === 0 &&
            xenagos === undefined &&
            elves.length === 1 &&
            lands.filter((card) => !card.tapped).length >= 4
              ? castXenagos?.id
              : undefined) ??
            (session.view.stack.length === 0 && xenagos !== undefined && colorChoices === 0
              ? addMana?.id
              : undefined);
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no single-mana Xenagos move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(xenagosOid, evidence).toMatch(/^forge-card-/u);
      expect(colorChoices, evidence).toBe(1);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(outcome, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);

forgeIt(
  'Xenagos creates the exact hasty Satyr, spends a counted red-green split, and moves only chosen ultimate cards',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let xenagosOid: string | undefined;
    let satyrOid: string | undefined;
    let satyrCreated = false;
    let hasteOffered = false;
    let manaActivations = 0;
    let firstManaExpected = 0;
    let firstManaChoices = 0;
    const firstManaColors: string[] = [];
    let manaInventedRejected = false;
    let manaStaleRejected = false;
    let manaReadyToSpend = false;
    let poolLife = 0;
    let boltOid: string | undefined;
    let boltResolved = false;
    let elfCountBeforeSpend = 0;
    let elfCastFromPool = false;
    let mixedManaSpentWithoutLand = false;
    let ultimateActivated = false;
    let ultimateInventedRejected = false;
    let ultimateStaleRejected = false;
    let ultimateInitialExile: readonly string[] = [];
    let ultimateEligible: readonly string[] = [];
    const ultimateChosen: string[] = [];
    let ultimateFinished = false;
    try {
      expect(await backend.supports(XENAGOS_TABLE)).toEqual([]);
      const opened = await backend.open(XENAGOS_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Xenagos decision');
        const local = session.view.seats[0];
        const xenagos = local.battlefield.find((card) => card.name === 'Xenagos, the Reveler');
        const satyr = local.battlefield.find(
          (card) => card.name.includes('Satyr') && card.typeLine.includes('Creature'),
        );
        xenagosOid ??= xenagos?.oid;
        satyrOid ??= satyr?.oid;
        satyrCreated ||=
          satyr !== undefined &&
          satyr.power === 2 &&
          satyr.toughness === 2 &&
          satyr.typeLine.includes('Satyr');
        boltResolved ||=
          boltOid !== undefined &&
          local.graveyard.some((card) => card.oid === boltOid) &&
          session.view.seats[1].life === 17 &&
          session.view.stack.length === 0;
        if (
          elfCastFromPool &&
          local.battlefield.filter((card) => card.name === 'Llanowar Elves').length > elfCountBeforeSpend &&
          boltResolved
        ) {
          mixedManaSpentWithoutLand =
            local.life === poolLife &&
            local.battlefield.filter((card) => card.name === 'Mana Confluence').every((card) => !card.tapped);
        }
        if (ultimateActivated && ultimateChosen.length === 2 && session.view.stack.length === 0) {
          const chosenOnBattlefield = ultimateChosen.every((oid) =>
            local.battlefield.some((card) => card.oid === oid),
          );
          const unchosenEligibleStayExiled = ultimateEligible
            .filter((oid) => !ultimateChosen.includes(oid))
            .every((oid) => local.exile.some((card) => card.oid === oid));
          const ineligibleStayExiled = ultimateInitialExile
            .filter((oid) => !ultimateEligible.includes(oid))
            .every((oid) => local.exile.some((card) => card.oid === oid));
          ultimateFinished = chosenOnBattlefield && unchosenEligibleStayExiled && ineligibleStayExiled;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyaltyOf(session, xenagosOid))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'color-choice' && decision.seat === 0) {
          const red = decision.options.find((option) => option.id.endsWith('-R'));
          const green = decision.options.find((option) => option.id.endsWith('-G'));
          expect(red, trace.at(-1)).toBeDefined();
          expect(green, trace.at(-1)).toBeDefined();
          if (!manaInventedRejected) {
            await expect(session.submit('color-choice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            manaInventedRejected = true;
          }
          const selected = manaActivations === 1 && firstManaChoices === 1 ? green! : red!;
          if (manaActivations === 1) {
            firstManaChoices += 1;
            firstManaColors.push(selected.id.endsWith('-G') ? 'G' : 'R');
          }
          if (!manaStaleRejected) {
            const staleSession = session;
            const advanced = await session.submit(selected.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(staleSession.submit(selected.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            manaStaleRejected = true;
            continue;
          }
          move = selected.id;
        } else if (decision.kind === 'target-selection' && boltOid !== undefined && !boltResolved) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'zone-card-selection' && ultimateActivated) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          if (ultimateInitialExile.length === 0) {
            ultimateInitialExile = local.exile.map((card) => card.oid);
            ultimateEligible = candidates.map((option) => option.targets[0]!.oid);
            expect(candidates.length, trace.at(-1)).toBeGreaterThanOrEqual(2);
            expect(
              candidates.every((option) => {
                const target = option.targets[0]!;
                const exiled = local.exile.find((card) => card.oid === target.oid);
                return (
                  exiled !== undefined &&
                  (exiled.typeLine.includes('Creature') || exiled.typeLine.includes('Land'))
                );
              }),
              trace.at(-1),
            ).toBe(true);
          }
          if (!ultimateInventedRejected) {
            await expect(session.submit('zone-card-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            ultimateInventedRejected = true;
          }
          const wanted =
            ultimateChosen.length === 0
              ? candidates.find((option) => {
                  const oid = option.targets[0]?.oid;
                  return (
                    oid !== undefined &&
                    local.exile.find((card) => card.oid === oid)?.typeLine.includes('Land')
                  );
                })
              : candidates.find((option) => {
                  const oid = option.targets[0]?.oid;
                  return (
                    oid !== undefined &&
                    local.exile.find((card) => card.oid === oid)?.typeLine.includes('Creature')
                  );
                });
          if (ultimateChosen.length < 2 && wanted !== undefined) {
            ultimateChosen.push(wanted.targets[0]!.oid);
            if (!ultimateStaleRejected) {
              const staleSession = session;
              const advanced = await session.submit(wanted.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              await expect(staleSession.submit(wanted.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              ultimateStaleRejected = true;
              continue;
            }
            move = wanted.id;
          } else {
            move = decision.options.find((option) => option.id === 'zone-card-selection-done')?.id;
          }
        } else if (decision.kind === 'combat-attackers' && satyrOid !== undefined) {
          const satyrNumber = satyrOid.replace('forge-card-', '');
          hasteOffered ||= decision.options.some((option) =>
            option.id.startsWith(`combat-attack-add-${satyrNumber}-`),
          );
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence');
          const untappedLands = lands.filter((card) => !card.tapped).length;
          const elves = local.battlefield.filter((card) => card.name === 'Llanowar Elves');
          const castElf = decision.options.find((option) => option.text.startsWith('Llanowar Elves:'));
          const castBolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const castXenagos = decision.options.find((option) =>
            option.text.startsWith('Xenagos, the Reveler:'),
          );
          const makeSatyr = decision.options.find(
            (option) => option.text.startsWith('Xenagos, the Reveler:') && option.text.includes('Satyr'),
          );
          const addMana = decision.options.find(
            (option) => option.text.startsWith('Xenagos, the Reveler:') && option.text.includes('Add X mana'),
          );
          const ultimate = decision.options.find(
            (option) => option.text.startsWith('Xenagos, the Reveler:') && option.text.includes('top seven'),
          );
          const loyalty = loyaltyOf(session, xenagosOid) ?? 0;
          if (manaActivations === 1 && firstManaChoices === firstManaExpected && !manaReadyToSpend) {
            manaReadyToSpend = true;
            poolLife = local.life;
            elfCountBeforeSpend = elves.length;
          }
          if (
            session.view.stack.length === 0 &&
            manaReadyToSpend &&
            !boltResolved &&
            boltOid === undefined &&
            castBolt !== undefined
          ) {
            boltOid = local.hand?.find((card) => card.name === 'Lightning Bolt')?.oid;
            move = castBolt.id;
          } else if (
            session.view.stack.length === 0 &&
            manaReadyToSpend &&
            boltResolved &&
            !elfCastFromPool &&
            castElf !== undefined
          ) {
            elfCastFromPool = true;
            move = castElf.id;
          } else {
            move =
              (ultimateFinished
                ? decision.options.find((option) => option.text === 'Concede')?.id
                : undefined) ??
              (session.view.stack.length === 0
                ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
                : undefined) ??
              (session.view.stack.length === 0 &&
              xenagos === undefined &&
              elves.length < 2 &&
              untappedLands >= 1
                ? castElf?.id
                : undefined) ??
              (session.view.stack.length === 0 &&
              xenagos === undefined &&
              elves.length >= 2 &&
              untappedLands >= 4
                ? castXenagos?.id
                : undefined) ??
              (session.view.stack.length === 0 && xenagos !== undefined && !satyrCreated
                ? makeSatyr?.id
                : undefined) ??
              (session.view.stack.length === 0 &&
              xenagos !== undefined &&
              satyrCreated &&
              manaActivations === 0
                ? addMana?.id
                : undefined) ??
              (session.view.stack.length === 0 &&
              xenagos !== undefined &&
              mixedManaSpentWithoutLand &&
              loyalty < 6
                ? addMana?.id
                : undefined) ??
              (session.view.stack.length === 0 &&
              xenagos !== undefined &&
              mixedManaSpentWithoutLand &&
              loyalty >= 6 &&
              !ultimateActivated
                ? ultimate?.id
                : undefined);
            if (addMana !== undefined && move === addMana.id) {
              manaActivations += 1;
              if (manaActivations === 1) firstManaExpected = elves.length + (satyr === undefined ? 0 : 1);
            }
            if (ultimate !== undefined && move === ultimate.id) ultimateActivated = true;
          }
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Xenagos move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-520).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(xenagosOid, evidence).toMatch(/^forge-card-/u);
      expect(satyrOid, evidence).toMatch(/^forge-card-/u);
      expect(satyrCreated, evidence).toBe(true);
      expect(hasteOffered, evidence).toBe(true);
      expect(firstManaExpected, evidence).toBeGreaterThanOrEqual(3);
      expect(firstManaChoices, evidence).toBe(firstManaExpected);
      expect(firstManaColors, evidence).toContain('R');
      expect(firstManaColors, evidence).toContain('G');
      expect(manaInventedRejected, evidence).toBe(true);
      expect(manaStaleRejected, evidence).toBe(true);
      expect(boltResolved, evidence).toBe(true);
      expect(elfCastFromPool, evidence).toBe(true);
      expect(mixedManaSpentWithoutLand, evidence).toBe(true);
      expect(ultimateActivated, evidence).toBe(true);
      expect(ultimateInitialExile, evidence).toHaveLength(7);
      expect(ultimateEligible.length, evidence).toBeGreaterThanOrEqual(2);
      expect(ultimateChosen, evidence).toHaveLength(2);
      expect(ultimateInventedRejected, evidence).toBe(true);
      expect(ultimateStaleRejected, evidence).toBe(true);
      expect(ultimateFinished, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-620).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  420_000,
);

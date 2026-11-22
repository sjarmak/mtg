/** Installed-Forge outcomes for generated objects composed with bounded choices. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(
  cards: SessionSpec['seats'][0]['deck']['cards'],
  opponentCards: SessionSpec['seats'][0]['deck']['cards'],
  seed: string,
  maximumTurns = 24,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Generated-object pilot', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Opposing pilot',
        controller: 'local',
        deck: { name: `${seed}-opponent`, cards: opponentCards },
      },
    ],
    seed,
    maximumTurns,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  if (decision.kind === 'confirm-trigger') {
    return decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
  }
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

async function open(spec: SessionSpec): Promise<{
  backend: NonNullable<ReturnType<typeof installedForgeBackend>>;
  session: ObservedSession;
}> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  return { backend, session: opened.session };
}

function counterTotal(card: ObservedSession['view']['seats'][number]['battlefield'][number], kind: string) {
  return Object.entries(card.counters)
    .filter(([name]) => name.toUpperCase().includes(kind.toUpperCase()))
    .reduce((sum, [, count]) => sum + count, 0);
}

forgeIt(
  'Liliana cancels and declines her optional target, then creates exact emblem Zombies',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Swamp', count: 40 },
          { name: 'Liliana, the Last Hope', count: 20 },
          { name: 'Llanowar Elves', count: 40 },
        ],
        [
          { name: 'Mountain', count: 40 },
          { name: 'Goblin Guide', count: 20 },
        ],
        'z5q4-liliana-last-hope-generated-zombies',
        60,
      ),
    );
    let session = running.session;
    let lilianaOid: string | undefined;
    let canceled = false;
    let cancellationRestored = false;
    let declined = false;
    let declineResolved = false;
    let targeted = false;
    let targetEffectObserved = false;
    let millActivations = 0;
    let millDeclined = false;
    let millCreatureOid: string | undefined;
    let millReturnResolved = false;
    let millInventedRejected = false;
    let millStaleRejected = false;
    let inventedRejected = false;
    let staleRejected = false;
    let ultimateActivated = false;
    let targetCount = 0;
    const trace: string[] = [];
    const lilianaTrace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 3_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Liliana decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const liliana = local.battlefield.find((card) => card.oid === lilianaOid);
        lilianaOid ??= local.battlefield.find((card) => card.name === 'Liliana, the Last Hope')?.oid;
        const goblin = opponent.battlefield.find((card) => card.name === 'Goblin Guide');
        const zombies = local.battlefield.filter(
          (card) => card.name.includes('Zombie') && card.name !== 'Liliana, the Last Hope',
        );
        declineResolved ||= declined && session.view.stack.length === 0 && liliana !== undefined;
        targetEffectObserved ||= targeted && goblin?.power === 0 && goblin.toughness === 1;
        millReturnResolved ||=
          millCreatureOid !== undefined &&
          local.hand?.some((card) => card.oid === millCreatureOid) === true &&
          !local.graveyard.some((card) => card.oid === millCreatureOid);
        const outcome: boolean =
          ultimateActivated &&
          millReturnResolved &&
          zombies.length >= 2 &&
          zombies.every(
            (card) => card.power === 2 && card.toughness === 2 && /Creature.*Zombie/u.test(card.typeLine),
          );
        const traceLine = `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(liliana?.counters['LOYALTY'])} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
        trace.push(traceLine);
        if (
          decision.kind === 'target-selection' ||
          decision.kind === 'zone-card-selection' ||
          decision.options.some((option) => option.text.startsWith('Liliana, the Last Hope:'))
        ) {
          lilianaTrace.push(traceLine);
        }

        let move: string | undefined;
        if (decision.kind === 'zone-card-selection' && millActivations > 0 && millCreatureOid === undefined) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThan(0);
          expect(
            candidates.every(
              (option) =>
                option.targets[0]?.name === 'Llanowar Elves' &&
                local.graveyard.some((card) => card.oid === option.targets[0]?.oid),
            ),
            trace.at(-1),
          ).toBe(true);
          const creature = candidates.find((option) => option.targets[0]?.name === 'Llanowar Elves');
          expect(creature, trace.at(-1)).toBeDefined();
          const none = decision.options.find((option) => option.id === 'zone-card-none');
          expect(none, trace.at(-1)).toBeDefined();
          if (!millDeclined) {
            const advanced = await session.submit(none!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            millDeclined = true;
            continue;
          }
          if (!millInventedRejected) {
            await expect(session.submit('zone-card-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            millInventedRejected = true;
          }
          millCreatureOid = creature!.targets[0]!.oid;
          const stale = session;
          const advanced = await session.submit(creature!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(creature!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          millStaleRejected = true;
          continue;
        }
        if (decision.kind === 'target-selection' && decision.seat === 0) {
          const cancel = decision.options.find((option) => option.id === 'target-cancel');
          const none = decision.options.find((option) => option.id === 'target-none');
          const target = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.oid === goblin?.oid,
          );
          expect(cancel, trace.at(-1)).toBeDefined();
          expect(none, trace.at(-1)).toBeDefined();
          expect(target, trace.at(-1)).toBeDefined();
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            const loyaltyBefore = liliana?.counters['LOYALTY'];
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceled = true;
            cancellationRestored =
              session.view.seats[0].battlefield.find((card) => card.oid === lilianaOid)?.counters[
                'LOYALTY'
              ] === loyaltyBefore && session.view.stack.length === 0;
            continue;
          }
          const selected = !declined ? none! : target!;
          const stale = session;
          const advanced = await session.submit(selected.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          if (!staleRejected) {
            await expect(stale.submit(selected.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
          }
          if (!declined) declined = true;
          else targeted = true;
          targetCount += 1;
          continue;
        }
        if (decision.kind === 'priority') {
          const swamps = local.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
          const mountains = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const plus = decision.options.find(
            (option) => option.text.startsWith('Liliana, the Last Hope:') && option.text.includes('-2/-1'),
          );
          const ultimate = decision.options.find(
            (option) => option.text.startsWith('Liliana, the Last Hope:') && option.text.includes('emblem'),
          );
          const mill = decision.options.find(
            (option) => option.text.startsWith('Liliana, the Last Hope:') && option.text.includes('Mill two'),
          );
          const shouldMill =
            millCreatureOid === undefined && millActivations < 8 && (liliana?.counters['LOYALTY'] ?? 0) >= 3;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Swamp')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 1 && goblin === undefined && mountains >= 1
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && lilianaOid === undefined && swamps >= 3
              ? decision.options.find((option) => option.text.startsWith('Liliana, the Last Hope:'))?.id
              : undefined) ??
            (decision.seat === 0 && lilianaOid !== undefined && targetCount < 2 ? plus?.id : undefined) ??
            (decision.seat === 0 && targetCount >= 2 && shouldMill ? mill?.id : undefined) ??
            (decision.seat === 0 && !ultimateActivated && (liliana?.counters['LOYALTY'] ?? 0) >= 7
              ? ultimate?.id
              : undefined) ??
            (decision.seat === 0 && !ultimateActivated ? plus?.id : undefined) ??
            routineMove(decision);
          ultimateActivated ||= move !== undefined && move === ultimate?.id;
          if (move !== undefined && move === mill?.id) millActivations += 1;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Liliana move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `Liliana milestones:\n${lilianaTrace.join('\n')}\nRecent trace:\n${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(lilianaOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(declined, evidence).toBe(true);
      expect(declineResolved, evidence).toBe(true);
      expect(targeted, evidence).toBe(true);
      expect(targetEffectObserved, evidence).toBe(true);
      expect(millActivations, evidence).toBeGreaterThanOrEqual(2);
      expect(millActivations, evidence).toBeLessThanOrEqual(8);
      expect(millDeclined, evidence).toBe(true);
      expect(millCreatureOid, evidence).toMatch(/^forge-card-/u);
      expect(millReturnResolved, evidence).toBe(true);
      expect(millInventedRejected, evidence).toBe(true);
      expect(millStaleRejected, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(ultimateActivated, evidence).toBe(true);
      expect(
        session.view.seats[0].battlefield.filter((card) => card.name.includes('Zombie')).length,
        evidence,
      ).toBeGreaterThanOrEqual(2);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Ranger Class creates its exact Wolf and counters the exact attacking identity',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Forest', count: 30 },
          { name: 'Ranger Class', count: 10 },
          { name: 'Llanowar Elves', count: 20 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-ranger-class-generated-wolf',
      ),
    );
    let session = running.session;
    let wolfOid: string | undefined;
    let levelTwo = false;
    let levelThree = false;
    let attackAdded = false;
    let targetSelected = false;
    let inventedRejected = false;
    let staleRejected = false;
    let topCreatureOid: string | undefined;
    let topCreatureCast = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Ranger Class decision');
        const local = session.view.seats[0];
        const ranger = local.battlefield.find((card) => card.name === 'Ranger Class');
        const wolf = local.battlefield.find((card) => card.name.includes('Wolf'));
        wolfOid ??= wolf?.oid;
        const outcome: boolean =
          targetSelected &&
          levelThree &&
          topCreatureCast &&
          local.battlefield.some((card) => card.oid === topCreatureOid && card.name === 'Llanowar Elves') &&
          wolf !== undefined &&
          wolf.oid === wolfOid &&
          wolf.power === 3 &&
          wolf.toughness === 3 &&
          counterTotal(wolf, 'P1P1') === 1 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === wolfOid,
          );
          move =
            (!attackAdded && levelTwo && add !== undefined
              ? add.id
              : decision.options.find((option) => option.id === 'combat-attackers-commit')?.id) ??
            routineMove(decision);
          attackAdded ||= move === add?.id;
        } else if (decision.kind === 'target-selection') {
          expect(
            decision.options.some((option) => option.id === 'target-cancel'),
            trace.at(-1),
          ).toBe(false);
          const wolfTarget = decision.options.find((option) => option.targets[0]?.oid === wolfOid);
          expect(wolfTarget, trace.at(-1)).toBeDefined();
          expect(
            decision.options
              .filter((option) => option.targets.length === 1)
              .every((option) => option.targets[0]?.oid === wolfOid),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          const stale = session;
          const advanced = await session.submit(wolfTarget!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(wolfTarget!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          targetSelected = true;
          continue;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const forests = local.battlefield.filter((card) => card.name === 'Forest' && !card.tapped).length;
          const level = decision.options.find(
            (option) => option.text.startsWith('Ranger Class:') && option.text.includes('Level 2'),
          );
          const levelToThree = decision.options.find(
            (option) => option.text.startsWith('Ranger Class:') && option.text.includes('Level 3'),
          );
          const handOids = new Set(local.hand?.map((card) => card.oid.slice('forge-card-'.length)) ?? []);
          const topElf = decision.options.find((option) => {
            if (!option.text.startsWith('Llanowar Elves:') || !option.id.startsWith('ability-')) return false;
            const oid = option.id.slice('ability-'.length).replace(/-\d+$/u, '');
            return !handOids.has(oid);
          });
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (ranger === undefined && forests >= 2
              ? decision.options.find((option) => option.text.startsWith('Ranger Class:'))?.id
              : undefined) ??
            (ranger !== undefined && wolfOid !== undefined && !levelTwo && forests >= 2
              ? level?.id
              : undefined) ??
            (targetSelected && levelTwo && !levelThree && forests >= 4 ? levelToThree?.id : undefined) ??
            (levelThree && forests >= 1 ? topElf?.id : undefined) ??
            routineMove(decision);
          levelTwo ||= move !== undefined && move === level?.id;
          levelThree ||= move !== undefined && move === levelToThree?.id;
          if (move !== undefined && move === topElf?.id) {
            topCreatureOid = `forge-card-${topElf.id.slice('ability-'.length).replace(/-\d+$/u, '')}`;
            topCreatureCast = true;
          }
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ranger Class move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(wolfOid, evidence).toMatch(/^forge-card-/u);
      expect(levelTwo, evidence).toBe(true);
      expect(levelThree, evidence).toBe(true);
      expect(attackAdded, evidence).toBe(true);
      expect(targetSelected, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(topCreatureOid, evidence).toMatch(/^forge-card-/u);
      expect(topCreatureCast, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Vivien creates a counter-chosen Beast and finds an exact lesser-value creature',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Forest', count: 30 },
          { name: "Vivien, Monsters' Advocate", count: 10 },
          { name: 'Courser of Kruphix', count: 10 },
          { name: 'Llanowar Elves', count: 10 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-vivien-generated-beast-and-search',
        30,
      ),
    );
    let session = running.session;
    let vivienOid: string | undefined;
    let beastOid: string | undefined;
    let counterSelected = false;
    let counterInventedRejected = false;
    let counterStaleRejected = false;
    let delayedActivated = false;
    let courserCast = false;
    let selectedElfOid: string | undefined;
    let searchInventedRejected = false;
    let searchStaleRejected = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Vivien decision');
        const local = session.view.seats[0];
        vivienOid ??= local.battlefield.find((card) => card.name === "Vivien, Monsters' Advocate")?.oid;
        const vivien = local.battlefield.find((card) => card.oid === vivienOid);
        const beast = local.battlefield.find((card) => card.name.includes('Beast'));
        beastOid ??= beast?.oid;
        const elf = local.battlefield.find((card) => card.oid === selectedElfOid);
        const outcome: boolean =
          counterSelected &&
          beast !== undefined &&
          beast.oid === beastOid &&
          beast.power === 3 &&
          beast.toughness === 3 &&
          counterTotal(beast, 'Reach') === 1 &&
          selectedElfOid !== undefined &&
          elf?.name === 'Llanowar Elves' &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} loyalty=${String(vivien?.counters['LOYALTY'])} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'counter-type-choice') {
          expect(decision.options.map((option) => option.text)).toEqual([
            'Vigilance [counter-type-choice-0]',
            'Reach [counter-type-choice-1]',
            'Trample [counter-type-choice-2]',
          ]);
          if (!counterInventedRejected) {
            await expect(session.submit('counter-type-choice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            counterInventedRejected = true;
          }
          const reach = decision.options.find((option) => option.text.startsWith('Reach '));
          expect(reach, trace.at(-1)).toBeDefined();
          const stale = session;
          const advanced = await session.submit(reach!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(reach!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          counterStaleRejected = true;
          counterSelected = true;
          continue;
        }
        if (decision.kind === 'zone-card-selection' && delayedActivated && courserCast) {
          const elfChoice = decision.options.find((option) => option.targets[0]?.name === 'Llanowar Elves');
          expect(elfChoice, trace.at(-1)).toBeDefined();
          expect(
            decision.options
              .filter((option) => option.targets.length === 1)
              .every((option) => {
                const name = option.targets[0]?.name;
                return name === 'Llanowar Elves' || name === 'Courser of Kruphix';
              }),
            trace.at(-1),
          ).toBe(true);
          if (!searchInventedRejected) {
            await expect(session.submit('zone-card-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            searchInventedRejected = true;
          }
          selectedElfOid = elfChoice!.targets[0]!.oid;
          const stale = session;
          const advanced = await session.submit(elfChoice!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(elfChoice!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          searchStaleRejected = true;
          continue;
        }
        if (decision.kind === 'priority' && decision.seat === 0) {
          const forests = local.battlefield.filter((card) => card.name === 'Forest' && !card.tapped).length;
          const create = decision.options.find(
            (option) =>
              option.text.startsWith("Vivien, Monsters' Advocate:") &&
              option.text.includes('3/3 green Beast'),
          );
          const delayed = decision.options.find(
            (option) =>
              option.text.startsWith("Vivien, Monsters' Advocate:") &&
              option.text.includes('next creature spell'),
          );
          const courser = decision.options.find((option) => option.text.startsWith('Courser of Kruphix:'));
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (vivienOid === undefined && forests >= 5
              ? decision.options.find((option) => option.text.startsWith("Vivien, Monsters' Advocate:"))?.id
              : undefined) ??
            (vivienOid !== undefined && !counterSelected ? create?.id : undefined) ??
            (counterSelected && !delayedActivated ? delayed?.id : undefined) ??
            (delayedActivated && !courserCast && forests >= 3 ? courser?.id : undefined) ??
            routineMove(decision);
          delayedActivated ||= move !== undefined && move === delayed?.id;
          courserCast ||= move !== undefined && move === courser?.id;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Vivien move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(vivienOid, evidence).toBeDefined();
      expect(beastOid, evidence).toMatch(/^forge-card-/u);
      expect(counterSelected, evidence).toBe(true);
      expect(counterInventedRejected, evidence).toBe(true);
      expect(counterStaleRejected, evidence).toBe(true);
      expect(delayedActivated, evidence).toBe(true);
      expect(courserCast, evidence).toBe(true);
      expect(selectedElfOid, evidence).toMatch(/^forge-card-/u);
      expect(searchInventedRejected, evidence).toBe(true);
      expect(searchStaleRejected, evidence).toBe(true);
      expect(session.status, evidence).toBe('finished');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

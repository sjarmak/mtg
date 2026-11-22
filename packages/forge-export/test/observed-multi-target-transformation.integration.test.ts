/** Installed-Forge outcomes for the exact multi-target transformation cohort. */
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

function table(
  cards: SessionSpec['seats'][0]['deck']['cards'],
  opposingCards: SessionSpec['seats'][0]['deck']['cards'],
  seed: string,
  maximumTurns = 30,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Transformation pilot', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Transformation opponent',
        controller: 'local',
        deck: { name: `${seed}-opponent`, cards: opposingCards },
      },
    ],
    seed,
    maximumTurns,
  };
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

function loyaltyOf(session: ObservedSession, name: string): number | undefined {
  const walker = session.view.seats[0].battlefield.find((card) => card.name === name);
  if (walker === undefined) return undefined;
  return Object.entries(walker.counters)
    .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
    .reduce((sum, [, count]) => sum + count, 0);
}

forgeIt(
  'Terastodon accepts zero or distinct multiple targets and rewards the destroyed permanents owners',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Mana Confluence', count: 42 },
          { name: 'Terastodon', count: 18 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-terastodon-installed-forge',
        36,
      ),
    );
    let session = running.session;
    const trace: string[] = [];
    let triggers = 0;
    let selected = 0;
    let zeroResolved = false;
    let localTargetOid: string | undefined;
    let opposingTargetOid: string | undefined;
    let localElephantOid: string | undefined;
    let opposingElephantOid: string | undefined;
    let inventedRejected = false;
    let staleRejected = false;
    let duplicateRejected = false;
    let menusExact = false;
    let outcome = false;
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Terastodon decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const localElephants = local.battlefield.filter(
          (card) => card.name.includes('Elephant') && card.name !== 'Terastodon',
        );
        const opposingElephants = opponent.battlefield.filter((card) => card.name.includes('Elephant'));
        localElephantOid ??= localElephants[0]?.oid;
        opposingElephantOid ??= opposingElephants[0]?.oid;
        zeroResolved ||=
          triggers >= 1 &&
          selected === 0 &&
          session.view.stack.length === 0 &&
          localElephants.length === 0 &&
          opposingElephants.length === 0;
        outcome ||=
          localTargetOid !== undefined &&
          opposingTargetOid !== undefined &&
          local.graveyard.some((card) => card.oid === localTargetOid) &&
          opponent.graveyard.some((card) => card.oid === opposingTargetOid) &&
          localElephants.length === 1 &&
          opposingElephants.length === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (
          decision.kind === 'target-selection' &&
          decision.seat === 0 &&
          decision.options.some((option) => option.id === 'terastodon-targets-done')
        ) {
          if (selected === 0) triggers += 1;
          const targets = decision.options.filter((option) => option.targets.length === 1);
          const battlefieldNoncreatures = [...local.battlefield, ...opponent.battlefield]
            .filter((card) => !card.typeLine.includes('Creature'))
            .map((card) => card.oid);
          expect(
            decision.options.some((option) => option.id === 'target-cancel'),
            trace.at(-1),
          ).toBe(false);
          expect(
            targets.every((option) => battlefieldNoncreatures.includes(option.targets[0]!.oid)),
            trace.at(-1),
          ).toBe(true);
          menusExact = true;
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (triggers === 1) {
            move = 'terastodon-targets-done';
          } else if (selected === 0) {
            const target = targets.find((option) =>
              local.battlefield.some(
                (card) => card.oid === option.targets[0]?.oid && card.name === 'Mana Confluence',
              ),
            );
            if (target === undefined) throw new Error('Terastodon omitted the local land target');
            localTargetOid = target.targets[0]!.oid;
            const stale = session;
            const advanced = await session.submit(target.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit(target.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            await expect(session.submit(target.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            duplicateRejected = true;
            selected = 1;
            continue;
          } else if (selected === 1) {
            const target = targets.find((option) =>
              opponent.battlefield.some(
                (card) => card.oid === option.targets[0]?.oid && card.name === 'Mountain',
              ),
            );
            if (target === undefined) throw new Error('Terastodon omitted the opposing land target');
            opposingTargetOid = target.targets[0]!.oid;
            move = target.id;
            selected = 2;
          } else {
            move = 'terastodon-targets-done';
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const untappedLands = local.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const terastodons = local.battlefield.filter((card) => card.name === 'Terastodon').length;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && lands >= 8 && untappedLands >= 8 && terastodons < 2
              ? decision.options.find((option) => option.text.startsWith('Terastodon:'))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Terastodon move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(triggers, evidence).toBeGreaterThanOrEqual(2);
      expect(zeroResolved, evidence).toBe(true);
      expect(menusExact, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(duplicateRejected, evidence).toBe(true);
      expect(localElephantOid, evidence).toMatch(/^forge-card-/u);
      expect(opposingElephantOid, evidence).toMatch(/^forge-card-/u);
      expect(outcome, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Terastodon creates no token for an indestructible permanent that never reaches a graveyard',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Mana Confluence', count: 42 },
          { name: 'Kaldra Compleat', count: 9 },
          { name: 'Terastodon', count: 9 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-terastodon-indestructible-installed-forge',
        30,
      ),
    );
    let session = running.session;
    const trace: string[] = [];
    let kaldraOid: string | undefined;
    let opposingLandOid: string | undefined;
    let selected = 0;
    let outcome = false;
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing indestructible Terastodon decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        kaldraOid ??= local.battlefield.find((card) => card.name === 'Kaldra Compleat')?.oid;
        const localElephants = local.battlefield.filter(
          (card) => card.name.includes('Elephant') && card.name !== 'Terastodon',
        );
        const opposingElephants = opponent.battlefield.filter((card) => card.name.includes('Elephant'));
        outcome ||=
          kaldraOid !== undefined &&
          opposingLandOid !== undefined &&
          local.battlefield.some((card) => card.oid === kaldraOid) &&
          !local.graveyard.some((card) => card.oid === kaldraOid) &&
          opponent.graveyard.some((card) => card.oid === opposingLandOid) &&
          localElephants.length === 0 &&
          opposingElephants.length === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (
          decision.kind === 'target-selection' &&
          decision.seat === 0 &&
          decision.options.some((option) => option.id === 'terastodon-targets-done')
        ) {
          const targets = decision.options.filter((option) => option.targets.length === 1);
          if (selected === 0) {
            const target = targets.find((option) => option.targets[0]?.oid === kaldraOid);
            if (target === undefined) throw new Error('Terastodon omitted indestructible Kaldra Compleat');
            move = target.id;
            selected = 1;
          } else if (selected === 1) {
            const target = targets.find((option) =>
              opponent.battlefield.some(
                (card) => card.oid === option.targets[0]?.oid && card.name === 'Mountain',
              ),
            );
            if (target === undefined) throw new Error('Terastodon omitted the destroyable opposing land');
            opposingLandOid = target.targets[0]!.oid;
            move = target.id;
            selected = 2;
          } else {
            move = 'terastodon-targets-done';
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && lands >= 7 && kaldraOid === undefined
              ? decision.options.find((option) => option.text.startsWith('Kaldra Compleat:'))?.id
              : undefined) ??
            (decision.seat === 0 && lands >= 8 && kaldraOid !== undefined
              ? decision.options.find((option) => option.text.startsWith('Terastodon:'))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no indestructible Terastodon move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(kaldraOid, evidence).toMatch(/^forge-card-/u);
      expect(opposingLandOid, evidence).toMatch(/^forge-card-/u);
      expect(selected, evidence).toBe(2);
      expect(outcome, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Oko creates Food, makes the exact permanent Elk, and atomically exchanges two exact objects',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Mana Confluence', count: 42 },
          { name: 'Oko, Thief of Crowns', count: 18 },
        ],
        [
          { name: 'Mountain', count: 42 },
          { name: 'Goblin Guide', count: 18 },
        ],
        'z5q4-oko-installed-forge',
        30,
      ),
    );
    let session = running.session;
    const trace: string[] = [];
    let okoOid: string | undefined;
    let foodOid: string | undefined;
    let goblinOid: string | undefined;
    let foodCreated = false;
    let elkCreated = false;
    let canceled = false;
    let cancellationRestored = false;
    let exchangeRootSelected = false;
    let exchanged = false;
    let inventedRejected = false;
    let staleRejected = false;
    let targetMenusExact = false;
    let ultimateLoyaltyBefore: number | undefined;
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Oko decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const oko = local.battlefield.find((card) => card.name === 'Oko, Thief of Crowns');
        okoOid ??= oko?.oid;
        const food = [...local.battlefield, ...opponent.battlefield].find((card) => card.oid === foodOid);
        foodOid ??= local.battlefield.find((card) => card.name === 'Food Token')?.oid;
        goblinOid ??= opponent.battlefield.find((card) => card.name === 'Goblin Guide')?.oid;
        foodCreated ||= foodOid !== undefined;
        elkCreated ||=
          food !== undefined &&
          food.power === 3 &&
          food.toughness === 3 &&
          food.typeLine.includes('Creature') &&
          food.typeLine.includes('Elk');
        exchanged ||=
          foodOid !== undefined &&
          goblinOid !== undefined &&
          opponent.battlefield.some((card) => card.oid === foodOid) &&
          local.battlefield.some((card) => card.oid === goblinOid);
        const loyalty = loyaltyOf(session, 'Oko, Thief of Crowns');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyalty)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && decision.seat === 0) {
          const targets = decision.options.filter((option) => option.targets.length === 1);
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (decision.prompt.includes('artifact or creature you control')) {
            expect(
              targets.every((option) =>
                local.battlefield.some(
                  (card) =>
                    card.oid === option.targets[0]?.oid &&
                    (card.typeLine.includes('Artifact') || card.typeLine.includes('Creature')),
                ),
              ),
              trace.at(-1),
            ).toBe(true);
            const target = targets.find((option) => option.targets[0]?.oid === foodOid);
            if (target === undefined) throw new Error('Oko omitted the exact local exchange object');
            targetMenusExact = true;
            exchangeRootSelected = true;
            const stale = session;
            const advanced = await session.submit(target.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(stale.submit(target.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
          if (decision.prompt.includes('opponent controls')) {
            expect(exchangeRootSelected, trace.at(-1)).toBe(true);
            expect(
              targets.every((option) =>
                opponent.battlefield.some(
                  (card) =>
                    card.oid === option.targets[0]?.oid &&
                    card.typeLine.includes('Creature') &&
                    (card.power ?? 99) <= 3,
                ),
              ),
              trace.at(-1),
            ).toBe(true);
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            if (!canceled) {
              const loyaltyBefore = loyalty;
              if (loyaltyBefore === undefined) throw new Error('Oko loyalty disappeared');
              const advanced = await session.submit(cancel!.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              canceled = true;
              exchangeRootSelected = false;
              trace.push(
                `Oko cancellation before=${String(loyaltyBefore)} after=${String(loyaltyOf(session, 'Oko, Thief of Crowns'))} stack=${String(session.view.stack.length)} localFood=${String(session.view.seats[0].battlefield.some((card) => card.oid === foodOid))} opposingGoblin=${String(session.view.seats[1].battlefield.some((card) => card.oid === goblinOid))}`,
              );
              cancellationRestored =
                loyaltyOf(session, 'Oko, Thief of Crowns') === ultimateLoyaltyBefore &&
                session.view.stack.length === 0 &&
                session.view.seats[0].battlefield.some((card) => card.oid === foodOid) &&
                session.view.seats[1].battlefield.some((card) => card.oid === goblinOid);
              continue;
            }
            const target = targets.find((option) => option.targets[0]?.oid === goblinOid);
            if (target === undefined) throw new Error('Oko omitted the exact opposing creature');
            move = target.id;
          } else {
            const target = targets.find((option) => option.targets[0]?.oid === foodOid);
            if (target === undefined) throw new Error('Oko omitted the Food animation target');
            move = target.id;
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const mountains = opponent.battlefield.filter((card) => card.name === 'Mountain').length;
          const create = decision.options.find(
            (option) => option.text.startsWith('Oko, Thief of Crowns:') && option.text.includes('Food'),
          );
          const animate = decision.options.find(
            (option) => option.text.startsWith('Oko, Thief of Crowns:') && option.text.includes('3/3'),
          );
          const exchange = decision.options.find(
            (option) => option.text.startsWith('Oko, Thief of Crowns:') && option.text.includes('Exchange'),
          );
          move =
            (exchanged ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 1 && goblinOid === undefined && mountains >= 1
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && okoOid === undefined && lands >= 3
              ? decision.options.find((option) => option.text.startsWith('Oko, Thief of Crowns:'))?.id
              : undefined) ??
            (decision.seat === 0 && okoOid !== undefined && !foodCreated ? create?.id : undefined) ??
            (decision.seat === 0 && foodCreated && !elkCreated ? animate?.id : undefined) ??
            (decision.seat === 0 && elkCreated && !exchanged && (loyalty ?? 0) >= 5
              ? (() => {
                  ultimateLoyaltyBefore ??= loyalty;
                  return exchange?.id;
                })()
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Oko move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(okoOid, evidence).toMatch(/^forge-card-/u);
      expect(foodOid, evidence).toMatch(/^forge-card-/u);
      expect(goblinOid, evidence).toMatch(/^forge-card-/u);
      expect(foodCreated, evidence).toBe(true);
      expect(elkCreated, evidence).toBe(true);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(targetMenusExact, evidence).toBe(true);
      expect(exchanged, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Saheeli creates a Servo and temporarily copies another exact local permanent',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Mana Confluence', count: 34 },
          { name: 'Goblin Guide', count: 5 },
          { name: 'Lightning Bolt', count: 5 },
          { name: 'Saheeli, Sublime Artificer', count: 16 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-saheeli-installed-forge',
        24,
      ),
    );
    let session = running.session;
    const trace: string[] = [];
    let saheeliOid: string | undefined;
    let goblinOid: string | undefined;
    let servoOid: string | undefined;
    let rootSelected = false;
    let canceled = false;
    let cancellationRestored = false;
    let copied = false;
    let expired = false;
    let inventedRejected = false;
    let staleRejected = false;
    let rootExcluded = false;
    let copyLoyaltyBefore: number | undefined;
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Saheeli decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        saheeliOid ??= local.battlefield.find((card) => card.name === 'Saheeli, Sublime Artificer')?.oid;
        goblinOid ??= local.battlefield.find((card) => card.name === 'Goblin Guide')?.oid;
        servoOid ??= local.battlefield.find((card) => card.name.includes('Servo'))?.oid;
        const servo = local.battlefield.find((card) => card.oid === servoOid);
        copied ||=
          servoOid !== undefined &&
          servo?.name === 'Goblin Guide' &&
          servo.power === 2 &&
          servo.toughness === 2 &&
          servo.typeLine.includes('Artifact');
        expired ||=
          copied &&
          servo !== undefined &&
          servo.name.includes('Servo') &&
          servo.power === 1 &&
          servo.toughness === 1;
        const loyalty = loyaltyOf(session, 'Saheeli, Sublime Artificer');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyalty)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && decision.seat === 0) {
          const targets = decision.options.filter((option) => option.targets.length === 1);
          if (decision.prompt.includes('another target')) {
            expect(rootSelected, trace.at(-1)).toBe(true);
            rootExcluded = targets.every((option) => option.targets[0]?.oid !== servoOid);
            expect(rootExcluded, trace.at(-1)).toBe(true);
            expect(
              targets.every((option) =>
                local.battlefield.some(
                  (card) =>
                    card.oid === option.targets[0]?.oid &&
                    (card.typeLine.includes('Artifact') || card.typeLine.includes('Creature')),
                ),
              ),
              trace.at(-1),
            ).toBe(true);
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            if (!canceled) {
              const advanced = await session.submit(cancel!.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              canceled = true;
              rootSelected = false;
              cancellationRestored =
                loyaltyOf(session, 'Saheeli, Sublime Artificer') === copyLoyaltyBefore &&
                session.view.stack.length === 0 &&
                session.view.seats[0].battlefield.some((card) => card.oid === servoOid);
              continue;
            }
            const target = targets.find((option) => option.targets[0]?.oid === goblinOid);
            if (target === undefined) throw new Error('Saheeli omitted the exact copy source');
            move = target.id;
          } else if (decision.prompt.includes('artifact you control')) {
            if (!inventedRejected) {
              await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            const target = targets.find((option) => option.targets[0]?.oid === servoOid);
            if (target === undefined) throw new Error('Saheeli omitted the exact Servo root');
            rootSelected = true;
            const stale = session;
            const advanced = await session.submit(target.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(stale.submit(target.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          } else {
            const opponentTarget = targets.find((option) =>
              opponent.battlefield.some((card) => card.oid === option.targets[0]?.oid),
            );
            move =
              decision.options.find((option) => option.id === 'target-player-1')?.id ??
              opponentTarget?.id ??
              targets[0]?.id;
          }
        } else if (decision.kind === 'priority') {
          const lands = local.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const copy = decision.options.find(
            (option) => option.text.startsWith('Saheeli, Sublime Artificer:') && option.text.includes('copy'),
          );
          move =
            (expired ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && goblinOid === undefined && lands >= 1
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && saheeliOid === undefined && lands >= 3
              ? decision.options.find((option) => option.text.startsWith('Saheeli, Sublime Artificer:'))?.id
              : undefined) ??
            (decision.seat === 0 && saheeliOid !== undefined && servoOid === undefined
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))?.id
              : undefined) ??
            (decision.seat === 0 && servoOid !== undefined && !copied
              ? (() => {
                  copyLoyaltyBefore ??= loyalty;
                  return copy?.id;
                })()
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Saheeli move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      if (saheeliOid === undefined) throw new Error(evidence);
      expect(saheeliOid, evidence).toMatch(/^forge-card-/u);
      expect(goblinOid, evidence).toMatch(/^forge-card-/u);
      expect(servoOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(rootExcluded, evidence).toBe(true);
      expect(copied, evidence).toBe(true);
      expect(expired, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

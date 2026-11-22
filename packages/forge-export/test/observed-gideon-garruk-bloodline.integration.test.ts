/** Installed-Forge board proof for Gideon, Garruk, and Bloodline Keeper. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function loyaltyOf(session: ObservedSession, oid: string | undefined): number | undefined {
  const walker = session.view.seats[0].battlefield.find((card) => card.oid === oid);
  if (walker === undefined) return undefined;
  return Object.entries(walker.counters)
    .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
    .reduce((sum, [, count]) => sum + count, 0);
}

const GARRUK_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Garruk pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-garruk-outcomes',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Llanowar Elves', count: 15 },
          { name: 'Garruk Wildspeaker', count: 15 },
        ],
      },
    },
    {
      name: 'Garruk opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-garruk-opponent',
        cards: [
          { name: 'Plains', count: 45 },
          { name: 'Mother of Runes', count: 15 },
        ],
      },
    },
  ],
  seed: 'z5q4-garruk-installed-forge',
  maximumTurns: 24,
};

forgeIt(
  'Garruk atomically untaps two distinct lands, creates the pinned Beast, and overruns only locally',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(GARRUK_TABLE)).toEqual([]);
    const opened = await backend.open(GARRUK_TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let garrukOid: string | undefined;
    let elfOid: string | undefined;
    let motherOid: string | undefined;
    let canceled = false;
    let cancellationRestored = false;
    let inventedRejected = false;
    let staleRejected = false;
    let firstTargetOid: string | undefined;
    let secondTargetOid: string | undefined;
    let untapResolved = false;
    let beastCreated = false;
    let beastOid: string | undefined;
    let overrunResolved = false;
    let overrunExpired = false;
    let selectedThisActivation = 0;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Garruk decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        garrukOid ??= local.battlefield.find((card) => card.name === 'Garruk Wildspeaker')?.oid;
        elfOid ??= local.battlefield.find((card) => card.name === 'Llanowar Elves')?.oid;
        motherOid ??= opponent.battlefield.find((card) => card.name === 'Mother of Runes')?.oid;
        const beast = local.battlefield.find(
          (card) => card.name.includes('Beast') && card.name !== 'Garruk Wildspeaker',
        );
        beastOid ??= beast?.oid;
        beastCreated ||= beast?.power === 3 && beast.toughness === 3;
        const elf = local.battlefield.find((card) => card.oid === elfOid);
        const mother = opponent.battlefield.find((card) => card.oid === motherOid);
        if (beastCreated && !overrunResolved && elf?.power === 4 && beast?.power === 6) {
          expect(mother, trace.at(-1)).toMatchObject({ power: 1, toughness: 1 });
          overrunResolved = true;
        }
        if (overrunResolved && session.view.turn.active === 1 && elf?.power === 1 && beast?.power === 3) {
          overrunExpired = true;
        }
        const finished = overrunExpired && session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyaltyOf(session, garrukOid))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && decision.seat === 0) {
          const targets = decision.options.filter((option) => option.targets.length === 1);
          expect(targets.length, trace.at(-1)).toBeGreaterThanOrEqual(2);
          const offeredOids = new Set(targets.map((option) => option.targets[0]!.oid));
          const battlefieldLandOids = new Set(
            [...local.battlefield, ...opponent.battlefield]
              .filter((card) => card.typeLine.includes('Land'))
              .map((card) => card.oid),
          );
          expect(
            [...offeredOids].every((oid) => battlefieldLandOids.has(oid)),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceled) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            const loyaltyBefore = loyaltyOf(session, garrukOid);
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceled = true;
            cancellationRestored =
              loyaltyOf(session, garrukOid) === loyaltyBefore &&
              session.view.stack.length === 0 &&
              session.view.seats[0].battlefield
                .filter((card) => card.name === 'Forest')
                .filter((card) => card.tapped).length >= 2;
            continue;
          }
          const target = targets.find((option) => option.targets[0]?.oid !== firstTargetOid);
          if (target === undefined) throw new Error('Forge omitted a distinct Garruk land target');
          if (selectedThisActivation === 0) firstTargetOid = target.targets[0]?.oid;
          else secondTargetOid = target.targets[0]?.oid;
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
          selectedThisActivation += 1;
          continue;
        }
        if (decision.kind === 'priority') {
          if (
            selectedThisActivation === 2 &&
            firstTargetOid !== undefined &&
            secondTargetOid !== undefined &&
            session.view.stack.length === 0
          ) {
            const all = [...local.battlefield, ...opponent.battlefield];
            untapResolved ||=
              all.find((card) => card.oid === firstTargetOid)?.tapped === false &&
              all.find((card) => card.oid === secondTargetOid)?.tapped === false;
          }
          const forests = local.battlefield.filter((card) => card.name === 'Forest').length;
          const plains = opponent.battlefield.filter((card) => card.name === 'Plains').length;
          const loyalty = loyaltyOf(session, garrukOid);
          const untap = decision.options.find(
            (option) => option.text.startsWith('Garruk Wildspeaker:') && option.text.includes('Untap two'),
          );
          const create = decision.options.find(
            (option) =>
              option.text.startsWith('Garruk Wildspeaker:') && option.text.includes('3/3 green Beast'),
          );
          const overrun = decision.options.find(
            (option) => option.text.startsWith('Garruk Wildspeaker:') && option.text.includes('+3/+3'),
          );
          move =
            (finished ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && elfOid === undefined && forests >= 1
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined) ??
            (decision.seat === 1 && motherOid === undefined && plains >= 1
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            (decision.seat === 0 && garrukOid === undefined && forests >= 4
              ? decision.options.find((option) => option.text.startsWith('Garruk Wildspeaker:'))?.id
              : undefined) ??
            (decision.seat === 0 && garrukOid !== undefined && !untapResolved ? untap?.id : undefined) ??
            (decision.seat === 0 && untapResolved && !beastCreated ? create?.id : undefined) ??
            (decision.seat === 0 && beastCreated && !overrunResolved && (loyalty ?? 0) >= 4
              ? overrun?.id
              : undefined) ??
            (decision.seat === 0 && beastCreated && !overrunResolved ? untap?.id : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Garruk move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(firstTargetOid, evidence).toMatch(/^forge-card-/u);
      expect(secondTargetOid, evidence).toMatch(/^forge-card-/u);
      expect(secondTargetOid, evidence).not.toBe(firstTargetOid);
      expect(untapResolved, evidence).toBe(true);
      expect(beastCreated, evidence).toBe(true);
      expect(beastOid, evidence).toMatch(/^forge-card-/u);
      expect(overrunResolved, evidence).toBe(true);
      expect(overrunExpired, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

const BLOODLINE_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Bloodline pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-bloodline-outcomes',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Bloodghast', count: 15 },
          { name: 'Bloodline Keeper', count: 15 },
        ],
      },
    },
    {
      name: 'Bloodline opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-bloodline-opponent',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Vampire Nighthawk', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-bloodline-installed-forge',
  maximumTurns: 24,
};

forgeIt(
  'Bloodline Keeper stays front at four Vampires, creates the pinned fifth, and transforms in place',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(BLOODLINE_TABLE)).toEqual([]);
    const opened = await backend.open(BLOODLINE_TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let keeperOid: string | undefined;
    let opposingVampireOid: string | undefined;
    let fourVampiresRefused = false;
    let tokenActivationStarted = false;
    let tokenOid: string | undefined;
    let tokenObserved = false;
    let transformStarted = false;
    let sameIdentity = false;
    let anthemObserved = false;
    let opposingUnaffected = false;
    let inventedRejected = false;
    let staleRejected = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Bloodline decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        keeperOid ??= local.battlefield.find((card) => card.name === 'Bloodline Keeper')?.oid;
        opposingVampireOid ??= opponent.battlefield.find((card) => card.name === 'Vampire Nighthawk')?.oid;
        const vampires = local.battlefield.filter(
          (card) => card.typeLine.includes('Creature') && card.typeLine.includes('Vampire'),
        );
        const token = vampires.find(
          (card) => card.oid !== keeperOid && card.name.includes('Vampire') && card.name !== 'Bloodghast',
        );
        tokenOid ??= token?.oid;
        tokenObserved ||=
          token !== undefined &&
          token.power === 2 &&
          token.toughness === 2 &&
          token.typeLine.includes('Vampire');
        const lord = local.battlefield.find((card) => card.oid === keeperOid);
        if (transformStarted && lord?.name === 'Lord of Lineage') {
          sameIdentity ||= lord.power === 5 && lord.toughness === 5;
          const otherVampires = vampires.filter((card) => card.oid !== keeperOid);
          anthemObserved ||=
            otherVampires.length >= 4 &&
            otherVampires.every((card) =>
              card.oid === tokenOid
                ? card.power === 4 && card.toughness === 4
                : card.power === 4 && card.toughness === 3,
            );
          const opposing = opponent.battlefield.find((card) => card.oid === opposingVampireOid);
          opposingUnaffected ||= opposing?.power === 2 && opposing.toughness === 3;
        }
        const finished = sameIdentity && anthemObserved && opposingUnaffected;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} vampires=${String(vampires.length)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'priority') {
          const swamps = local.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
          const opposingSwamps = opponent.battlefield.filter(
            (card) => card.name === 'Swamp' && !card.tapped,
          ).length;
          const tokenAction = decision.options.find(
            (option) =>
              option.text.startsWith('Bloodline Keeper:') && option.text.includes('2/2 black Vampire'),
          );
          const transform = decision.options.find(
            (option) => option.text.startsWith('Bloodline Keeper:') && option.text.includes('Transform'),
          );
          if (decision.seat === 0 && keeperOid !== undefined && vampires.length === 4) {
            expect(transform, trace.at(-1)).toBeUndefined();
            fourVampiresRefused = true;
          }
          move =
            (finished ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (decision.seat === 1 && opposingVampireOid === undefined && opposingSwamps >= 3
              ? decision.options.find((option) => option.text.startsWith('Vampire Nighthawk:'))?.id
              : undefined) ??
            (decision.seat === 0 &&
            vampires.filter((card) => card.name === 'Bloodghast').length < 3 &&
            swamps >= 2
              ? decision.options.find((option) => option.text.startsWith('Bloodghast:'))?.id
              : undefined) ??
            (decision.seat === 0 && keeperOid === undefined && vampires.length >= 3 && swamps >= 4
              ? decision.options.find((option) => option.text.startsWith('Bloodline Keeper:'))?.id
              : undefined) ??
            (decision.seat === 0 && fourVampiresRefused && !tokenActivationStarted
              ? tokenAction?.id
              : undefined) ??
            (decision.seat === 0 && tokenObserved && !transformStarted ? transform?.id : undefined) ??
            routineMove(decision);
          if (move === tokenAction?.id && !tokenActivationStarted) {
            if (!inventedRejected) {
              await expect(session.submit('priority-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            const stale = session;
            const advanced = await session.submit(move!);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit(move!)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            tokenActivationStarted = true;
            continue;
          }
          transformStarted ||= move === transform?.id;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Bloodline move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      if (keeperOid === undefined)
        throw new Error(`Bloodline Keeper never entered the battlefield\n${evidence}`);
      expect(keeperOid, evidence).toMatch(/^forge-card-/u);
      expect(opposingVampireOid, evidence).toMatch(/^forge-card-/u);
      expect(fourVampiresRefused, evidence).toBe(true);
      expect(tokenActivationStarted, evidence).toBe(true);
      expect(tokenOid, evidence).toMatch(/^forge-card-/u);
      expect(tokenObserved, evidence).toBe(true);
      expect(transformStarted, evidence).toBe(true);
      expect(sameIdentity, evidence).toBe(true);
      expect(anthemObserved, evidence).toBe(true);
      expect(opposingUnaffected, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

const GIDEON_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Gideon pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-gideon-outcomes',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Usher of the Fallen', count: 15 },
          { name: 'Gideon Blackblade', count: 15 },
        ],
      },
    },
    {
      name: 'Gideon opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-gideon-opponent',
        cards: [
          { name: 'Plateau', count: 30 },
          { name: 'Wall of Omens', count: 15 },
          { name: 'Lightning Bolt', count: 15 },
        ],
      },
    },
  ],
  seed: 'z5q4-gideon-installed-forge',
  maximumTurns: 20,
};

forgeIt(
  'Gideon animates only locally, prevents real damage, expires a chosen keyword, and exiles one nonland',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(GIDEON_TABLE)).toEqual([]);
    const opened = await backend.open(GIDEON_TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let usherOid: string | undefined;
    let wallOid: string | undefined;
    let gideonOid: string | undefined;
    let sawOwnTurnCreature = false;
    let sawOpposingTurnWalker = false;
    let boltCast = false;
    let boltTargeted = false;
    let damagePrevented = false;
    let canceled = false;
    let cancellationRestored = false;
    let targetInventedRejected = false;
    let keywordInventedRejected = false;
    let keywordStaleRejected = false;
    let choseLifelink = false;
    let choseNoTarget = false;
    let lifelinkLife: number | undefined;
    let keywordExpired = false;
    let exiledWall = false;
    let attackerSelected = false;
    let attacksCommitted = 0;
    let targetActivations = 0;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Gideon decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        usherOid ??= local.battlefield.find((card) => card.name === 'Usher of the Fallen')?.oid;
        wallOid ??= opponent.battlefield.find((card) => card.name === 'Wall of Omens')?.oid;
        gideonOid ??= local.battlefield.find((card) => card.name === 'Gideon Blackblade')?.oid;
        const gideon = local.battlefield.find((card) => card.oid === gideonOid);
        if (gideon !== undefined && session.view.turn.active === 0) {
          sawOwnTurnCreature ||=
            gideon.typeLine.includes('Creature') && gideon.power === 4 && gideon.toughness === 4;
        }
        if (gideon !== undefined && session.view.turn.active === 1) {
          sawOpposingTurnWalker ||= !gideon.typeLine.includes('Creature') && gideon.power === null;
        }
        if (boltTargeted && !damagePrevented && session.view.stack.length === 0) {
          damagePrevented = loyaltyOf(session, gideonOid) === 4 && gideon?.damage === 0;
        }
        if (choseLifelink && attacksCommitted >= 1 && lifelinkLife === undefined && local.life > 20) {
          lifelinkLife = local.life;
        }
        if (
          lifelinkLife !== undefined &&
          attacksCommitted >= 2 &&
          session.view.turn.active === 1 &&
          local.life === lifelinkLife
        ) {
          keywordExpired = true;
        }
        exiledWall ||= wallOid !== undefined && opponent.exile.some((card) => card.oid === wallOid);
        const finished = exiledWall && keywordExpired && sawOpposingTurnWalker;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} life=${String(local.life)} loyalty=${String(loyaltyOf(session, gideonOid))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection') {
          const targets = decision.options.filter((option) => option.targets.length === 1);
          if (decision.seat === 1 && boltCast && !boltTargeted) {
            const exact = targets.find((option) => option.targets[0]?.oid === gideonOid);
            expect(exact, trace.at(-1)).toBeDefined();
            move = exact?.id;
            boltTargeted = move !== undefined;
          } else if (decision.seat === 0 && targetActivations < 2) {
            expect(new Set(targets.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
              new Set([usherOid]),
            );
            expect(decision.options.some((option) => option.id === 'target-none')).toBe(true);
            expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(true);
            if (!targetInventedRejected) {
              await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              targetInventedRejected = true;
            }
            if (!canceled) {
              const loyaltyBefore = loyaltyOf(session, gideonOid);
              const advanced = await session.submit('target-cancel');
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              canceled = true;
              cancellationRestored =
                loyaltyOf(session, gideonOid) === loyaltyBefore && session.view.stack.length === 0;
              continue;
            }
            move = targetActivations === 0 ? targets[0]?.id : 'target-none';
            targetActivations += 1;
            choseNoTarget ||= move === 'target-none';
          } else if (decision.seat === 0) {
            const landOids = new Set(
              [...local.battlefield, ...opponent.battlefield]
                .filter((card) => card.typeLine.includes('Land'))
                .map((card) => card.oid),
            );
            expect(targets.every((option) => !landOids.has(option.targets[0]!.oid))).toBe(true);
            const exact = targets.find((option) => option.targets[0]?.oid === wallOid);
            expect(exact, trace.at(-1)).toBeDefined();
            move = exact?.id;
          }
        } else if (decision.kind === 'keyword-choice' && decision.seat === 0) {
          expect(
            new Set(decision.options.map((option) => option.text.split(' [', 1)[0])),
            trace.at(-1),
          ).toEqual(new Set(['Vigilance', 'Lifelink', 'Indestructible']));
          if (!keywordInventedRejected) {
            await expect(session.submit('keyword-choice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            keywordInventedRejected = true;
          }
          const lifelink = decision.options.find((option) => option.text.startsWith('Lifelink'));
          if (lifelink === undefined) throw new Error('Forge omitted Gideon lifelink');
          const stale = session;
          const advanced = await session.submit(lifelink.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(lifelink.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          keywordStaleRejected = true;
          choseLifelink = true;
          continue;
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0) {
          if (choseLifelink && attacksCommitted < 2 && !attackerSelected) {
            const add = decision.options.find(
              (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === usherOid,
            );
            if (add !== undefined) {
              move = add.id;
              attackerSelected = true;
            }
          }
          if (move === undefined) {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            if (attackerSelected) {
              attacksCommitted += 1;
              attackerSelected = false;
            }
          }
        } else if (decision.kind === 'priority') {
          const plains = local.battlefield.filter((card) => card.name === 'Plains').length;
          const plateaus = opponent.battlefield.filter((card) => card.name === 'Plateau').length;
          const plusOne = decision.options.find(
            (option) => option.text.startsWith('Gideon Blackblade:') && option.text.includes('vigilance'),
          );
          const exile = decision.options.find(
            (option) => option.text.startsWith('Gideon Blackblade:') && option.text.includes('Exile target'),
          );
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (finished ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Plateau')?.id) ??
            (decision.seat === 0 && usherOid === undefined && plains >= 1
              ? decision.options.find((option) => option.text.startsWith('Usher of the Fallen:'))?.id
              : undefined) ??
            (decision.seat === 1 && wallOid === undefined && plateaus >= 2
              ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
              : undefined) ??
            (decision.seat === 0 && gideonOid === undefined && plains >= 3
              ? decision.options.find((option) => option.text.startsWith('Gideon Blackblade:'))?.id
              : undefined) ??
            (decision.seat === 1 && gideonOid !== undefined && !boltCast && bolt !== undefined
              ? bolt.id
              : undefined) ??
            (decision.seat === 0 && damagePrevented && targetActivations < 2 ? plusOne?.id : undefined) ??
            (decision.seat === 0 && choseNoTarget && (loyaltyOf(session, gideonOid) ?? 0) >= 6
              ? exile?.id
              : undefined) ??
            routineMove(decision);
          boltCast ||= move === bolt?.id;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gideon move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(sawOwnTurnCreature, evidence).toBe(true);
      expect(sawOpposingTurnWalker, evidence).toBe(true);
      expect(boltCast, evidence).toBe(true);
      expect(boltTargeted, evidence).toBe(true);
      expect(damagePrevented, evidence).toBe(true);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(targetInventedRejected, evidence).toBe(true);
      expect(keywordInventedRejected, evidence).toBe(true);
      expect(keywordStaleRejected, evidence).toBe(true);
      expect(choseLifelink, evidence).toBe(true);
      expect(choseNoTarget, evidence).toBe(true);
      expect(lifelinkLife, evidence).toBeGreaterThan(20);
      expect(keywordExpired, evidence).toBe(true);
      expect(exiledWall, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

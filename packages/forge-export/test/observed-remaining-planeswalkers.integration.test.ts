/** Installed-Forge board proofs for the final reviewed planeswalker cohort. */
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
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function loyaltyOf(session: ObservedSession, oid: string | undefined): number | undefined {
  const walker = session.view.seats[0].battlefield.find((card) => card.oid === oid);
  if (walker === undefined) return undefined;
  return Object.entries(walker.counters)
    .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
    .reduce((sum, [, count]) => sum + count, 0);
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

forgeIt(
  'Chandra creates exactly two hasty Elementals and sacrifices those identities at end step',
  async () => {
    const running = await open({
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Chandra pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-chandra-acolyte-token',
            cards: [
              { name: 'Mountain', count: 45 },
              { name: 'Chandra, Acolyte of Flame', count: 15 },
            ],
          },
        },
        {
          name: 'Chandra opponent',
          controller: 'local',
          deck: { name: 'z5q4-chandra-opponent', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-chandra-acolyte-token',
      maximumTurns: 12,
    });
    let session = running.session;
    let cast = false;
    let activated = false;
    let tokenOids: string[] = [];
    let created = false;
    let sacrificed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Chandra decision');
        const local = session.view.seats[0];
        const tokens = local.battlefield.filter(
          (card) => card.power === 1 && card.toughness === 1 && card.typeLine.includes('Elemental'),
        );
        if (activated && !created && tokens.length === 2) {
          tokenOids = tokens.map((card) => card.oid);
          created = true;
        }
        sacrificed ||=
          created &&
          tokenOids.every((oid) => !local.battlefield.some((card) => card.oid === oid)) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const mountains = local.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const chandra = local.battlefield.find((card) => card.name === 'Chandra, Acolyte of Flame');
          const castOption = decision.options.find((option) =>
            option.text.startsWith('Chandra, Acolyte of Flame:'),
          );
          const tokenOption = decision.options.find((option) =>
            option.text.includes('two 1/1 red Elemental'),
          );
          move =
            (sacrificed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mountain')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !cast && mountains >= 3 ? castOption?.id : undefined) ??
            (decision.seat === 0 && chandra !== undefined && !activated ? tokenOption?.id : undefined);
          cast ||= move !== undefined && move === castOption?.id;
          activated ||= move !== undefined && move === tokenOption?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Chandra move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-200).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(activated, evidence).toBe(true);
      expect(tokenOids, evidence).toHaveLength(2);
      expect(new Set(tokenOids).size, evidence).toBe(2);
      expect(created, evidence).toBe(true);
      expect(sacrificed, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Nissa searches the selected basic Forest, transforms at seven lands, and creates pinned Ashaya',
  async () => {
    const running = await open({
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Nissa pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-nissa-vastwood',
            cards: [
              { name: 'Forest', count: 45 },
              { name: 'Nissa, Vastwood Seer', count: 15 },
            ],
          },
        },
        {
          name: 'Nissa opponent',
          controller: 'local',
          deck: { name: 'z5q4-nissa-opponent', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-nissa-vastwood',
      maximumTurns: 36,
    });
    let session = running.session;
    let cast = false;
    let confirmed = false;
    let searchedOid: string | undefined;
    let searchResolved = false;
    let nissaOid: string | undefined;
    let transformed = false;
    let tokenActivated = false;
    let ashayaOid: string | undefined;
    let plusActivated = false;
    let plusResolved = false;
    let landsBeforePlus = 0;
    let canceledUltimate = false;
    let cancellationRestored = false;
    let inventedRejected = false;
    let staleRejected = false;
    const animatedLandOids: string[] = [];
    let ultimateResolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_500; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Nissa decision');
        const local = session.view.seats[0];
        nissaOid ??= local.battlefield.find((card) => card.name === 'Nissa, Vastwood Seer')?.oid;
        transformed ||=
          nissaOid !== undefined &&
          local.battlefield.some((card) => card.oid === nissaOid && card.name === 'Nissa, Sage Animist');
        const ashaya = local.battlefield.find((card) => card.name.includes('Ashaya'));
        ashayaOid ??= ashaya?.oid;
        plusResolved ||=
          plusActivated &&
          local.battlefield.filter((card) => card.typeLine.includes('Land')).length > landsBeforePlus &&
          session.view.stack.length === 0;
        ultimateResolved ||=
          animatedLandOids.length === 2 &&
          animatedLandOids.every((oid) => {
            const card = local.battlefield.find((candidate) => candidate.oid === oid);
            return card?.power === 6 && card.toughness === 6 && card.typeLine.includes('Creature');
          }) &&
          session.view.stack.length === 0;
        searchResolved ||=
          searchedOid !== undefined &&
          local.hand?.some((card) => card.oid === searchedOid) === true &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'target-selection' && decision.seat === 0) {
          const loyalty = loyaltyOf(session, nissaOid);
          if (!inventedRejected) {
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!canceledUltimate) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceledUltimate = true;
            cancellationRestored =
              loyaltyOf(session, nissaOid) === loyalty && session.view.stack.length === 0;
            continue;
          }
          if (animatedLandOids.length < 2) {
            const choice = decision.options.find(
              (option) =>
                option.targets[0]?.name === 'Forest' &&
                !animatedLandOids.includes(option.targets[0]?.oid ?? ''),
            );
            const oid = choice?.targets[0]?.oid;
            if (choice === undefined || oid === undefined)
              throw new Error('Forge offered no distinct Nissa land');
            animatedLandOids.push(oid);
            const stale = session;
            const advanced = await session.submit(choice.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(stale.submit(choice.id)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
          move = decision.options.find((option) => option.id === 'nissa-targets-done')?.id;
        } else if (
          decision.kind === 'confirm-trigger' &&
          decision.prompt.startsWith('Nissa, Vastwood Seer:')
        ) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'zone-card-selection' && confirmed && searchedOid === undefined) {
          const forest = decision.options.find((option) => option.targets[0]?.name === 'Forest');
          searchedOid = forest?.targets[0]?.oid;
          move = forest?.id;
        } else if (decision.kind === 'priority') {
          const forests = local.battlefield.filter((card) => card.name === 'Forest' && !card.tapped).length;
          const castOption = decision.options.find((option) =>
            option.text.startsWith('Nissa, Vastwood Seer:'),
          );
          const tokenOption = decision.options.find((option) => option.text.includes('Create Ashaya'));
          const plusOption = decision.options.find((option) => option.text.includes('Reveal the top card'));
          const ultimateOption = decision.options.find((option) => option.text.includes('Untap up to six'));
          const loyalty = loyaltyOf(session, nissaOid);
          move =
            (ultimateResolved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Forest')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && !cast && forests >= 3 ? castOption?.id : undefined) ??
            (decision.seat === 0 && transformed && !tokenActivated ? tokenOption?.id : undefined) ??
            (decision.seat === 0 && tokenActivated && !plusActivated ? plusOption?.id : undefined) ??
            (decision.seat === 0 && plusResolved && (loyalty ?? 0) < 7 ? plusOption?.id : undefined) ??
            (decision.seat === 0 && plusResolved && (loyalty ?? 0) >= 7 ? ultimateOption?.id : undefined);
          cast ||= move !== undefined && move === castOption?.id;
          tokenActivated ||= move !== undefined && move === tokenOption?.id;
          if (!plusActivated && move !== undefined && move === plusOption?.id) {
            landsBeforePlus = local.battlefield.filter((card) => card.typeLine.includes('Land')).length;
            plusActivated = true;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Nissa move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(confirmed, evidence).toBe(true);
      expect(searchedOid, evidence).toMatch(/^forge-card-/u);
      expect(searchResolved, evidence).toBe(true);
      expect(nissaOid, evidence).toMatch(/^forge-card-/u);
      expect(transformed, evidence).toBe(true);
      expect(tokenActivated, evidence).toBe(true);
      expect(ashayaOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].battlefield.find((card) => card.oid === ashayaOid),
        evidence,
      ).toMatchObject({
        power: 4,
        toughness: 4,
      });
      expect(plusActivated, evidence).toBe(true);
      expect(plusResolved, evidence).toBe(true);
      expect(canceledUltimate, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(animatedLandOids, evidence).toHaveLength(2);
      expect(ultimateResolved, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  360_000,
);

forgeIt(
  'Kytheon transforms in place after three attackers and Gideon routes all three loyalty outcomes',
  async () => {
    const running = await open({
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Kytheon pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-kytheon-transform',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Kytheon, Hero of Akros', count: 10 },
              { name: 'Mother of Runes', count: 10 },
              { name: 'Usher of the Fallen', count: 10 },
            ],
          },
        },
        {
          name: 'Gideon target pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-kytheon-opponent',
            cards: [
              { name: 'Mountain', count: 45 },
              { name: 'Goblin Guide', count: 15 },
            ],
          },
        },
      ],
      seed: 'z5q4-kytheon-transform',
      maximumTurns: 24,
    });
    let session = running.session;
    let kytheonOid: string | undefined;
    let wallOid: string | undefined;
    const localCreatureOids = new Set<string>();
    const selectedAttackers = new Set<string>();
    let stagingThreeAttackers = false;
    let attackCommitted = false;
    let transformed = false;
    let canceled = false;
    let cancellationRestored = false;
    let inventedRejected = false;
    let staleRejected = false;
    let delayedTargeted = false;
    let wallForcedToAttack = false;
    let plusOneTargeted = false;
    let wallUntapped = false;
    let animated = false;
    let animationExpired = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Kytheon decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        kytheonOid ??= local.battlefield.find((card) => card.name === 'Kytheon, Hero of Akros')?.oid;
        wallOid ??= opponent.battlefield.find((card) => card.name === 'Goblin Guide')?.oid;
        for (const card of local.battlefield) {
          if (card.typeLine.includes('Creature')) localCreatureOids.add(card.oid);
        }
        const gideon = local.battlefield.find((card) => card.oid === kytheonOid);
        transformed ||= gideon?.name === 'Gideon, Battle-Forged';
        wallUntapped ||=
          plusOneTargeted && opponent.battlefield.find((card) => card.oid === wallOid)?.tapped === false;
        animated ||=
          transformed &&
          gideon?.typeLine.includes('Creature') === true &&
          gideon.power === 4 &&
          gideon.toughness === 4;
        animationExpired ||=
          animated && session.view.turn.active === 1 && gideon?.typeLine.includes('Creature') === false;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyaltyOf(session, kytheonOid))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
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
          if (!canceled) {
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            const loyalty = loyaltyOf(session, kytheonOid);
            const advanced = await session.submit(cancel!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            canceled = true;
            cancellationRestored =
              loyaltyOf(session, kytheonOid) === loyalty && session.view.stack.length === 0;
            continue;
          }
          const exact = targets.find((option) => option.targets[0]?.oid === wallOid);
          expect(exact, trace.at(-1)).toBeDefined();
          const stale = session;
          move = exact?.id;
          if (!delayedTargeted) delayedTargeted = true;
          else plusOneTargeted = true;
          if (move !== undefined) {
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            if (!staleRejected) {
              await expect(stale.submit(move)).resolves.toMatchObject({
                ok: false,
                error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
              });
              staleRejected = true;
            }
            continue;
          }
        } else if (decision.kind === 'combat-attackers') {
          if (decision.seat === 0 && !attackCommitted) {
            const available = decision.options.filter(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                localCreatureOids.has(option.targets[0]?.oid ?? ''),
            );
            stagingThreeAttackers ||= selectedAttackers.size === 0 && available.length >= 3;
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                localCreatureOids.has(option.targets[0]?.oid ?? '') &&
                !selectedAttackers.has(option.targets[0]?.oid ?? ''),
            );
            if (stagingThreeAttackers && add !== undefined && selectedAttackers.size < 3) {
              selectedAttackers.add(add.targets[0]!.oid);
              move = add.id;
            } else {
              move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
              if (stagingThreeAttackers && selectedAttackers.size >= 3) attackCommitted = true;
              else selectedAttackers.clear();
              stagingThreeAttackers = false;
            }
          } else if (decision.seat === 1 && delayedTargeted && !wallForcedToAttack) {
            const addWall = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets[0]?.oid === wallOid &&
                option.targets.some((target) => target.oid === kytheonOid),
            );
            if (addWall !== undefined) {
              move = addWall.id;
              wallForcedToAttack = true;
            } else {
              move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            }
          }
        } else if (decision.kind === 'priority') {
          const plains = local.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
          const opposingMountains = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const delayed = decision.options.find((option) =>
            option.text.includes('Up to one target creature an opponent controls attacks Gideon'),
          );
          const plusOne = decision.options.find((option) =>
            option.text.includes('target creature gains indestructible'),
          );
          const animate = decision.options.find((option) => option.text.includes('becomes a 4/4'));
          move =
            (animationExpired
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 1 && wallOid === undefined && opposingMountains >= 1
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && kytheonOid === undefined && plains >= 1
              ? decision.options.find((option) => option.text.startsWith('Kytheon, Hero of Akros:'))?.id
              : undefined) ??
            (decision.seat === 0 && localCreatureOids.size < 3 && plains >= 1
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Mother of Runes:') ||
                    option.text.startsWith('Usher of the Fallen:'),
                )?.id
              : undefined) ??
            (decision.seat === 0 && transformed && !delayedTargeted ? delayed?.id : undefined) ??
            (decision.seat === 0 && wallForcedToAttack && !plusOneTargeted ? plusOne?.id : undefined) ??
            (decision.seat === 0 && wallUntapped && !animated ? animate?.id : undefined);
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Kytheon move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(selectedAttackers.size, evidence).toBeGreaterThanOrEqual(3);
      expect(attackCommitted, evidence).toBe(true);
      expect(kytheonOid, evidence).toMatch(/^forge-card-/u);
      expect(transformed, evidence).toBe(true);
      expect(canceled, evidence).toBe(true);
      expect(cancellationRestored, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(delayedTargeted, evidence).toBe(true);
      expect(wallForcedToAttack, evidence).toBe(true);
      expect(plusOneTargeted, evidence).toBe(true);
      expect(wallUntapped, evidence).toBe(true);
      expect(animated, evidence).toBe(true);
      expect(animationExpired, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Jace transforms in place after five exact loots, casts the chosen graveyard spell, and mills for his emblem',
  async () => {
    const running = await open({
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Jace pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-jace-transform',
            cards: [
              { name: 'Island', count: 35 },
              { name: "Jace, Vryn's Prodigy", count: 15 },
              { name: 'Ponder', count: 10 },
            ],
          },
        },
        {
          name: 'Jace target pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-jace-opponent',
            cards: [
              { name: 'Mountain', count: 45 },
              { name: 'Goblin Guide', count: 15 },
            ],
          },
        },
      ],
      seed: 'z5q4-jace-transform',
      maximumTurns: 48,
    });
    let session = running.session;
    let jaceOid: string | undefined;
    let goblinOid: string | undefined;
    let gravePonderOid: string | undefined;
    let lootActivations = 0;
    let transformed = false;
    let plusOneTargeted = false;
    let weakened = false;
    let weaknessExpired = false;
    let gravePermissionActivated = false;
    let graveSpellCast = false;
    let graveSpellExiled = false;
    let emblemActivated = false;
    let emblemResolved = false;
    let emblemSpellCast = false;
    let emblemTargeted = false;
    let opponentLibraryBeforeEmblem = 0;
    let milledFive = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 3_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Jace decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        jaceOid ??= pilot.battlefield.find((card) => card.name === "Jace, Vryn's Prodigy")?.oid;
        goblinOid ??= opponent.battlefield.find((card) => card.name === 'Goblin Guide')?.oid;
        const jace = pilot.battlefield.find((card) => card.oid === jaceOid);
        transformed ||= jace?.name === 'Jace, Telepath Unbound';
        const goblin = opponent.battlefield.find((card) => card.oid === goblinOid);
        weakened ||= plusOneTargeted && goblin?.power === 0;
        weaknessExpired ||= weakened && session.view.turn.active === 0 && goblin?.power === 2;
        graveSpellExiled ||=
          graveSpellCast &&
          pilot.exile.some((card) => card.oid === gravePonderOid) &&
          session.view.stack.length === 0;
        emblemResolved ||= emblemActivated && jace === undefined && session.view.stack.length === 0;
        milledFive ||=
          emblemTargeted &&
          session.view.stack.length === 0 &&
          opponentLibraryBeforeEmblem - opponent.librarySize === 5;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} loyalty=${String(loyaltyOf(session, jaceOid))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'hand-card-selection' && decision.seat === 0) {
          const ponder = decision.options.find((option) => option.targets[0]?.name === 'Ponder');
          const selected = gravePonderOid === undefined ? ponder : decision.options[0];
          expect(selected, trace.at(-1)).toBeDefined();
          if (gravePonderOid === undefined) gravePonderOid = selected!.targets[0]?.oid;
          move = selected!.id;
        } else if (decision.kind === 'target-selection' && decision.seat === 0) {
          if (gravePermissionActivated && !graveSpellCast) {
            const gravePonder = decision.options.find((option) =>
              option.targets.some((target) => target.oid === gravePonderOid),
            );
            expect(gravePonder, trace.at(-1)).toBeDefined();
            move = gravePonder!.id;
          } else if (!plusOneTargeted) {
            const goblinTarget = decision.options.find((option) =>
              option.targets.some((target) => target.oid === goblinOid),
            );
            expect(goblinTarget, trace.at(-1)).toBeDefined();
            move = goblinTarget!.id;
            plusOneTargeted = true;
          } else if (emblemResolved && emblemSpellCast) {
            move = decision.options.find((option) => option.id === 'target-player-1')?.id;
            if (move !== undefined) emblemTargeted = true;
          } else {
            move = decision.options.find((option) => option.id === 'target-none')?.id;
          }
        } else if (decision.kind === 'priority') {
          const islands = pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length;
          const mountains = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const castJace = decision.options.find(
            (option) => option.text.startsWith("Jace, Vryn's Prodigy:") && option.text.includes('Creature'),
          );
          const loot = decision.options.find(
            (option) =>
              option.text.startsWith("Jace, Vryn's Prodigy:") && option.text.includes('Draw a card'),
          );
          const plusOne = decision.options.find((option) => option.text.includes('gets -2/-0'));
          const gravePermission = decision.options.find((option) =>
            option.text.includes('cast target instant or sorcery card from your graveyard'),
          );
          const emblem = decision.options.find((option) =>
            option.text.includes('target opponent mills five cards'),
          );
          const gravePonderId = gravePonderOid?.replace('forge-card-', '');
          const gravePonder = decision.options.find(
            (option) => gravePonderId !== undefined && option.id.startsWith(`ability-${gravePonderId}-`),
          );
          const handPonder = decision.options.find(
            (option) =>
              option.text.startsWith('Ponder:') &&
              pilot.hand?.some((card) => {
                const cardId = card.oid.replace('forge-card-', '');
                return card.name === 'Ponder' && option.id.startsWith(`ability-${cardId}-`);
              }) === true,
          );
          move =
            (milledFive ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 1 && goblinOid === undefined && mountains >= 1
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && jaceOid === undefined && islands >= 2 ? castJace?.id : undefined) ??
            (decision.seat === 0 && !transformed && lootActivations < 5 ? loot?.id : undefined) ??
            (decision.seat === 0 && transformed && !plusOneTargeted ? plusOne?.id : undefined) ??
            (decision.seat === 0 && weaknessExpired && !gravePermissionActivated
              ? gravePermission?.id
              : undefined) ??
            (decision.seat === 0 && gravePermissionActivated && !graveSpellCast
              ? gravePonder?.id
              : undefined) ??
            (decision.seat === 0 && graveSpellExiled && !emblemActivated && emblem !== undefined
              ? emblem.id
              : undefined) ??
            (decision.seat === 0 && graveSpellExiled && !emblemActivated ? plusOne?.id : undefined) ??
            (decision.seat === 0 && emblemResolved && !emblemSpellCast ? handPonder?.id : undefined);
          if (loot !== undefined && move === loot.id) lootActivations += 1;
          if (gravePermission !== undefined && move === gravePermission.id) {
            gravePermissionActivated = true;
          }
          if (gravePonder !== undefined && move === gravePonder.id) graveSpellCast = true;
          if (emblem !== undefined && move === emblem.id) emblemActivated = true;
          if (handPonder !== undefined && move === handPonder.id) {
            emblemSpellCast = true;
            opponentLibraryBeforeEmblem = opponent.librarySize;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Jace move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-300).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(lootActivations, evidence).toBe(5);
      expect(jaceOid, evidence).toMatch(/^forge-card-/u);
      expect(transformed, evidence).toBe(true);
      expect(plusOneTargeted, evidence).toBe(true);
      expect(weakened, evidence).toBe(true);
      expect(weaknessExpired, evidence).toBe(true);
      expect(gravePermissionActivated, evidence).toBe(true);
      expect(graveSpellCast, evidence).toBe(true);
      expect(graveSpellExiled, evidence).toBe(true);
      expect(emblemActivated, evidence).toBe(true);
      expect(emblemResolved, evidence).toBe(true);
      expect(emblemSpellCast, evidence).toBe(true);
      expect(emblemTargeted, evidence).toBe(true);
      expect(milledFive, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  420_000,
);

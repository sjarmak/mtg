/** Installed-Forge outcomes for exact alternate costs that create pinned tokens. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(
  pilotCards: SessionSpec['seats'][0]['deck']['cards'],
  seed: string,
  observer: 'engine' | 'local' = 'engine',
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Alternate-cost pilot', controller: 'local', deck: { name: seed, cards: pilotCards } },
      {
        name: 'Forge AI',
        controller: observer,
        deck: { name: `${seed}-observer`, cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 24,
  };
}

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      (decision.kind === 'priority' && option.text === 'Pass priority') ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function abilitySourceOid(moveId: string): string | undefined {
  const sourceId = /^ability-(\d+)-/u.exec(moveId)?.[1];
  return sourceId === undefined ? undefined : `forge-card-${sourceId}`;
}

forgeIt(
  'cycles Shark Typhoon for exact X and creates both exact-size Shark outcomes',
  async () => {
    const spec = table(
      [
        { name: 'Island', count: 32 },
        { name: 'Shark Typhoon', count: 16 },
        { name: 'Opt', count: 12 },
      ],
      'z5q4-shark-typhoon-alternate-cost-generated-object',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cycledOid: string | undefined;
    let cycledLibrarySize = -1;
    let choseX = false;
    let inventedRejected = false;
    let staleRejected = false;
    let cycledSharkOid: string | undefined;
    let enchantmentResolved = false;
    let optOid: string | undefined;
    let spellSharkOid: string | undefined;

    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Shark Typhoon decision');
        const local = session.view.seats[0];
        const sharks = local.battlefield.filter((card) => card.name === 'Shark Token');
        cycledSharkOid ??= sharks.find((card) => card.power === 2 && card.toughness === 2)?.oid;
        enchantmentResolved ||= local.battlefield.some((card) => card.name === 'Shark Typhoon');
        spellSharkOid ??= sharks.find(
          (card) => card.oid !== cycledSharkOid && card.power === 1 && card.toughness === 1,
        )?.oid;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        let staleSnapshot: ObservedSession | undefined;
        if (decision.kind === 'number' && decision.seat === 0 && decision.prompt.includes('Shark Typhoon')) {
          if (!inventedRejected) {
            await expect(session.submit('number-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          move = decision.options.find((option) => option.id === 'number-2')?.id;
          choseX ||= move !== undefined;
          if (!staleRejected) staleSnapshot = session;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'priority') {
          const untappedIslands = local.battlefield.filter(
            (card) => card.name === 'Island' && !card.tapped,
          ).length;
          const cycle = decision.options.find(
            (option) => option.text.startsWith('Shark Typhoon:') && option.text.includes('Cycling'),
          );
          const castTyphoon = decision.options.find(
            (option) => option.text.startsWith('Shark Typhoon:') && !option.text.includes('Cycling'),
          );
          const castOpt = decision.options.find((option) => option.text.startsWith('Opt:'));
          move =
            (spellSharkOid !== undefined &&
            optOid !== undefined &&
            local.graveyard.some((card) => card.oid === optOid)
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (cycledOid === undefined && untappedIslands >= 4 ? cycle?.id : undefined) ??
            (cycledSharkOid !== undefined && !enchantmentResolved && untappedIslands >= 6
              ? castTyphoon?.id
              : undefined) ??
            (enchantmentResolved && optOid === undefined && untappedIslands >= 1 ? castOpt?.id : undefined);
          if (cycle !== undefined && move === cycle.id) {
            cycledOid = abilitySourceOid(cycle.id);
            cycledLibrarySize = local.librarySize;
          }
          if (castOpt !== undefined && move === castOpt.id) {
            optOid = abilitySourceOid(castOpt.id);
          }
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Shark Typhoon move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
        if (staleSnapshot !== undefined) {
          await expect(staleSnapshot.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const local = session.view.seats[0];
      const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cycledOid, evidence).toMatch(/^forge-card-/u);
      expect(choseX, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(
        local.graveyard.some((card) => card.oid === cycledOid),
        evidence,
      ).toBe(true);
      expect(local.librarySize, evidence).toBeLessThan(cycledLibrarySize);
      expect(cycledSharkOid, evidence).toMatch(/^forge-card-/u);
      expect(enchantmentResolved, evidence).toBe(true);
      expect(optOid, evidence).toMatch(/^forge-card-/u);
      expect(
        local.graveyard.some((card) => card.oid === optOid),
        evidence,
      ).toBe(true);
      expect(spellSharkOid, evidence).toMatch(/^forge-card-/u);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);

forgeIt(
  'dashes Ragavan, creates and spends its exact Treasure, exiles the top card, and returns to hand',
  async () => {
    const spec = table(
      [
        { name: 'Mountain', count: 36 },
        { name: 'Ragavan, Nimble Pilferer', count: 18 },
        { name: 'Lightning Bolt', count: 6 },
      ],
      'z5q4-ragavan-dash-generated-treasure',
      'local',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let ragavanOid: string | undefined;
    let dashSubmitted = false;
    let attacked = false;
    let treasureOid: string | undefined;
    let exiledOid: string | undefined;
    let boltOid: string | undefined;
    let treasureSpent = false;
    let inventedRejected = false;
    let staleRejected = false;
    let returned = false;

    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Ragavan decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const treasure = local.battlefield.find((card) => card.name === 'Treasure Token');
        treasureOid ??= treasure?.oid;
        exiledOid ??= opponent.exile[0]?.oid;
        returned ||=
          ragavanOid !== undefined &&
          local.hand?.some((card) => card.oid === ragavanOid) === true &&
          !local.battlefield.some((card) => card.oid === ragavanOid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        let staleSnapshot: ObservedSession | undefined;
        if (decision.kind === 'mana-payment') {
          const treasurePayment = decision.options.find((option) =>
            option.targets.some((target) => target.oid === treasureOid),
          );
          if (treasurePayment !== undefined && boltOid !== undefined) {
            if (!inventedRejected) {
              await expect(session.submit('mana-source-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            move = treasurePayment.id;
            treasureSpent = true;
            if (!staleRejected) staleSnapshot = session;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find(
            (option) =>
              option.text.includes('Forge AI') || option.targets.some((target) => target.name === 'Forge AI'),
          )?.id;
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0) {
          const ragavan = decision.options.find((option) =>
            option.targets.some((target) => target.oid === ragavanOid),
          );
          move =
            (!attacked ? ragavan?.id : undefined) ??
            decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          attacked ||= ragavan !== undefined && move === ragavan.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const untappedMountains = local.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const dash = decision.options.find(
            (option) => option.text.startsWith('Ragavan, Nimble Pilferer:') && option.text.includes('Dash'),
          );
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (returned && treasureSpent && opponent.life === 15
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (!dashSubmitted && decision.seat === 0 && untappedMountains >= 2 ? dash?.id : undefined) ??
            (treasureOid !== undefined && boltOid === undefined && decision.seat === 0
              ? bolt?.id
              : undefined);
          if (dash !== undefined && move === dash.id) {
            ragavanOid = abilitySourceOid(dash.id);
            dashSubmitted = true;
          }
          if (bolt !== undefined && move === bolt.id) {
            boltOid = abilitySourceOid(bolt.id);
          }
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Ragavan move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
        if (staleSnapshot !== undefined) {
          await expect(staleSnapshot.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
      }

      const local = session.view.seats[0];
      const opponent = session.view.seats[1];
      const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(ragavanOid, evidence).toMatch(/^forge-card-/u);
      expect(dashSubmitted, evidence).toBe(true);
      expect(attacked, evidence).toBe(true);
      expect(treasureOid, evidence).toMatch(/^forge-card-/u);
      expect(exiledOid, evidence).toMatch(/^forge-card-/u);
      expect(
        opponent.exile.some((card) => card.oid === exiledOid && card.name === 'Mountain'),
        evidence,
      ).toBe(true);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(
        local.graveyard.some((card) => card.oid === boltOid),
        evidence,
      ).toBe(true);
      expect(treasureSpent, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(
        local.battlefield.some((card) => card.oid === treasureOid),
        evidence,
      ).toBe(false);
      expect(returned, evidence).toBe(true);
      expect(opponent.life, evidence).toBe(15);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);

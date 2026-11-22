/** Installed-Forge outcomes for exact trigger targets composed with other reviewed decisions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
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

forgeIt(
  "Gatekeeper of Malakir pays its chosen kicker, targets the opposing player, and sacrifices that player's selected creature",
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Gatekeeper pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-gatekeeper-trigger-target',
            cards: [
              { name: 'Swamp', count: 30 },
              { name: 'Gatekeeper of Malakir', count: 30 },
            ],
          },
        },
        {
          name: 'Sacrifice pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-gatekeeper-trigger-target-opponent',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Blade Splicer', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-gatekeeper-trigger-target',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let gatekeeperCast = false;
    let choseKicker = false;
    let targetedOpponent = false;
    let sacrificedOid: string | undefined;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Gatekeeper decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        observed =
          sacrificedOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === sacrificedOid) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'optional-cost-choice' && decision.prompt.includes('Gatekeeper')) {
          const cost = decision.options.find((option) => !option.id.endsWith('-done'));
          move = choseKicker ? decision.options.find((option) => option.id.endsWith('-done'))?.id : cost?.id;
          choseKicker ||= move === cost?.id;
        } else if (decision.kind === 'target-selection' && gatekeeperCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          targetedOpponent ||= move !== undefined;
        } else if (decision.kind === 'sacrifice-selection') {
          const blade = decision.options.find((option) => option.targets[0]?.name === 'Blade Splicer');
          sacrificedOid = blade?.targets[0]?.oid;
          move = blade?.id;
        } else if (decision.kind === 'priority') {
          const targetReady = opponent.battlefield.some((card) => card.name === 'Blade Splicer');
          const pilotMana = pilot.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const gatekeeper = decision.options.find((option) =>
            option.text.startsWith('Gatekeeper of Malakir:'),
          );
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Swamp')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && !targetReady && opponentMana >= 3
              ? decision.options.find((option) => option.text.startsWith('Blade Splicer:'))?.id
              : undefined) ??
            (decision.seat === 0 && targetReady && !gatekeeperCast && pilotMana >= 3
              ? gatekeeper?.id
              : undefined);
          gatekeeperCast ||= move !== undefined && move === gatekeeper?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gatekeeper move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(gatekeeperCast, evidence).toBe(true);
      expect(choseKicker, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Den Protector is cast face down, turned face up through megamorph, and returns the selected graveyard identity',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Den Protector pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-den-protector-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Lightning Bolt', count: 15 },
              { name: 'Den Protector', count: 15 },
            ],
          },
        },
        {
          name: 'Target pilot',
          controller: 'local',
          deck: { name: 'z5q4-den-protector-target', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-den-protector-trigger-target',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let denOid: string | undefined;
    let boltOid: string | undefined;
    let boltCast = false;
    let castFaceDown = false;
    let observedFaceDown = false;
    let turnedFaceUp = false;
    let selectedBolt = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Den Protector decision');
        const pilot = session.view.seats[0];
        denOid ??= pilot.hand?.find((card) => card.name === 'Den Protector')?.oid;
        boltOid ??= pilot.hand?.find((card) => card.name === 'Lightning Bolt')?.oid;
        const den = pilot.battlefield.find((card) => card.oid === denOid);
        observedFaceDown ||=
          castFaceDown &&
          den !== undefined &&
          (den.name !== 'Den Protector' || (den.power === 2 && den.toughness === 2));
        turnedFaceUp ||= observedFaceDown && den?.name === 'Den Protector';
        observed =
          selectedBolt &&
          boltOid !== undefined &&
          pilot.hand?.some((card) => card.oid === boltOid) === true &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && boltCast && !selectedBolt) {
          if (session.view.stack.some((card) => card.oid === boltOid)) {
            move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          } else {
            const bolt = decision.options.find((option) => option.targets[0]?.oid === boltOid);
            move = bolt?.id;
            selectedBolt ||= move !== undefined;
          }
        } else if (decision.kind === 'priority') {
          const mana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const faceDown = decision.options.find(
            (option) => option.text.includes('Den Protector') && /face down|morph/iu.test(option.text),
          );
          const faceUp = decision.options.find((option) => /turn.*face up/iu.test(option.text));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !boltCast && mana >= 1 ? bolt?.id : undefined) ??
            (decision.seat === 0 && boltCast && !castFaceDown && mana >= 3 ? faceDown?.id : undefined) ??
            (decision.seat === 0 && observedFaceDown && !turnedFaceUp && mana >= 2 ? faceUp?.id : undefined);
          boltCast ||= move !== undefined && move === bolt?.id;
          castFaceDown ||= move !== undefined && move === faceDown?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Den Protector move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(denOid, evidence).toMatch(/^forge-card-/u);
      expect(castFaceDown, evidence).toBe(true);
      expect(observedFaceDown, evidence).toBe(true);
      expect(turnedFaceUp, evidence).toBe(true);
      expect(selectedBolt, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Vendilion Clique targets the opposing player, moves the selected hidden-hand identity, and replaces it with a draw',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Vendilion pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-vendilion-trigger-target',
            cards: [
              { name: 'Island', count: 30 },
              { name: 'Vendilion Clique', count: 30 },
            ],
          },
        },
        {
          name: 'Hidden-hand pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-vendilion-trigger-target-opponent',
            cards: [
              { name: 'Mountain', count: 30 },
              { name: 'Flame Rift', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-vendilion-trigger-target',
      maximumTurns: 16,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let cliqueCast = false;
    let targetedOpponent = false;
    let selectedOid: string | undefined;
    let handSizeBefore = -1;
    let librarySizeBefore = -1;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Vendilion Clique decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const opponentHand = opponent.hand;
        if (opponentHand === null) throw new Error('Vendilion Clique probe must observe the targeted hand');
        observed =
          selectedOid !== undefined &&
          opponentHand.some((card) => card.oid === selectedOid) === false &&
          opponentHand.length === handSizeBefore &&
          opponent.librarySize === librarySizeBefore &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'target-selection' && cliqueCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          targetedOpponent ||= move !== undefined;
        } else if (
          decision.kind === 'card-selection' ||
          decision.kind === 'zone-card-selection' ||
          decision.kind === 'entity-selection'
        ) {
          const rift = decision.options.find((option) => option.targets[0]?.name === 'Flame Rift');
          selectedOid = rift?.targets[0]?.oid;
          handSizeBefore = opponentHand.length;
          librarySizeBefore = opponent.librarySize;
          move = rift?.id;
        } else if (decision.kind === 'priority') {
          const mana = pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length;
          const clique = decision.options.find((option) => option.text.startsWith('Vendilion Clique:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && !cliqueCast && mana >= 3 ? clique?.id : undefined);
          cliqueCast ||= move !== undefined && move === clique?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Vendilion Clique move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-140).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cliqueCast, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Torrential Gearhulk replays the exact targeted instant without mana and exiles that object after resolution',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Gearhulk pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-gearhulk-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Lightning Bolt', count: 15 },
              { name: 'Torrential Gearhulk', count: 15 },
            ],
          },
        },
        {
          name: 'Damage target',
          controller: 'local',
          deck: { name: 'z5q4-gearhulk-target', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-gearhulk-trigger-target',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let boltOid: string | undefined;
    let boltCast = false;
    let gearhulkCast = false;
    let selectedBolt = false;
    let acceptedReplay = false;
    let observedReviewedFreeCast = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Torrential Gearhulk decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        boltOid ??= pilot.hand?.find((card) => card.name === 'Lightning Bolt')?.oid;
        observed =
          selectedBolt &&
          boltOid !== undefined &&
          pilot.exile.some((card) => card.oid === boltOid) &&
          opponent.life === 14 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'target-selection') {
          const exactBolt = decision.options.find((option) => option.targets[0]?.oid === boltOid);
          move = exactBolt?.id ?? decision.options.find((option) => option.id === 'target-player-1')?.id;
          selectedBolt ||= exactBolt !== undefined && move === exactBolt.id;
        } else if (decision.kind === 'priority') {
          const mana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const gearhulk = decision.options.find((option) => option.text.startsWith('Torrential Gearhulk:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !boltCast && mana >= 1 ? bolt?.id : undefined) ??
            (decision.seat === 0 &&
            boltCast &&
            !gearhulkCast &&
            pilot.graveyard.some((card) => card.oid === boltOid) &&
            mana >= 6
              ? gearhulk?.id
              : undefined);
          boltCast ||= move !== undefined && move === bolt?.id;
          gearhulkCast ||= move !== undefined && move === gearhulk?.id;
        } else if (decision.kind === 'confirm-free-cast') {
          const accept = decision.options.find((option) => option.id === 'confirm-free-cast-yes');
          const decline = decision.options.find((option) => option.id === 'confirm-free-cast-no');
          expect(decision.complete).toBe(true);
          expect(accept?.targets[0]?.oid).toBe(boltOid);
          expect(accept?.targets[1]?.object).toMatchObject({
            name: 'Torrential Gearhulk',
            controller: 0,
          });
          expect(decline?.targets.map((target) => target.oid)).toEqual(
            accept?.targets.map((target) => target.oid),
          );
          move = accept?.id;
          observedReviewedFreeCast = true;
          acceptedReplay ||= selectedBolt && move !== undefined;
        } else {
          const affirmative = decision.options.find((option) => /^(?:yes|play|cast)/iu.test(option.text));
          move = affirmative?.id;
          acceptedReplay ||= selectedBolt && move !== undefined;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Torrential Gearhulk move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(boltCast, evidence).toBe(true);
      expect(gearhulkCast, evidence).toBe(true);
      expect(selectedBolt, evidence).toBe(true);
      expect(acceptedReplay, evidence).toBe(true);
      expect(observedReviewedFreeCast, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Gonti targets the opposing library and exiles the exact selected top-four identity face down',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Gonti pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-gonti-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Gonti, Lord of Luxury', count: 30 },
            ],
          },
        },
        {
          name: 'Library target',
          controller: 'local',
          deck: { name: 'z5q4-gonti-target', cards: [{ name: 'Lightning Bolt', count: 60 }] },
        },
      ],
      seed: 'z5q4-gonti-trigger-target',
      maximumTurns: 16,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let gontiCast = false;
    let targetedOpponent = false;
    let selectedOid: string | undefined;
    let librarySizeBefore = -1;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_100; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Gonti decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        observed =
          selectedOid !== undefined &&
          opponent.exile.some((card) => card.oid === selectedOid) &&
          opponent.librarySize === librarySizeBefore - 1 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'target-selection' && gontiCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          if (move !== undefined) {
            targetedOpponent = true;
            librarySizeBefore = opponent.librarySize;
          }
        } else if (
          decision.kind === 'card-selection' ||
          decision.kind === 'zone-card-selection' ||
          decision.kind === 'entity-selection'
        ) {
          const card = decision.options.find(
            (option) => option.targets.length === 1 && option.id !== 'card-selection-done',
          );
          selectedOid ??= card?.targets[0]?.oid;
          move =
            selectedOid === undefined
              ? undefined
              : (decision.options.find((option) => option.targets[0]?.oid === selectedOid)?.id ??
                decision.options.find((option) => option.id === 'card-selection-done')?.id);
        } else if (decision.kind === 'priority') {
          const mana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const gonti = decision.options.find((option) => option.text.startsWith('Gonti, Lord of Luxury:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : undefined) ??
            (decision.seat === 0 && !gontiCast && mana >= 4 ? gonti?.id : undefined);
          gontiCast ||= move !== undefined && move === gonti?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gonti move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(gontiCast, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      if (selectedOid === undefined) throw new Error(`Gonti never offered a card selection\n${evidence}`);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Cavalier of Night sacrifices the exact other creature and destroys the exact opposing target',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Cavalier pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-cavalier-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Blade Splicer', count: 15 },
              { name: 'Cavalier of Night', count: 15 },
            ],
          },
        },
        {
          name: 'Destroy target',
          controller: 'local',
          deck: {
            name: 'z5q4-cavalier-target',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Blade Splicer', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-cavalier-trigger-target',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let ownBladeCast = false;
    let opposingBladeCast = false;
    let cavalierCast = false;
    let ownBladeOid: string | undefined;
    let opposingBladeOid: string | undefined;
    let choseSacrifice = false;
    let confirmedReflexiveTrigger = false;
    let choseDestroyTarget = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Cavalier of Night decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        ownBladeOid ??= ownBladeCast
          ? pilot.battlefield.find((card) => card.name === 'Blade Splicer')?.oid
          : undefined;
        opposingBladeOid ??= opposingBladeCast
          ? opponent.battlefield.find((card) => card.name === 'Blade Splicer')?.oid
          : undefined;
        observed =
          ownBladeOid !== undefined &&
          opposingBladeOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === ownBladeOid) &&
          opponent.graveyard.some((card) => card.oid === opposingBladeOid) &&
          pilot.battlefield.some((card) => card.name === 'Cavalier of Night') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Cavalier of Night:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmedReflexiveTrigger ||= move !== undefined;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const ownBlade = decision.options.find((option) => option.targets[0]?.oid === ownBladeOid);
          move = ownBlade?.id;
          choseSacrifice ||= ownBlade !== undefined && move === ownBlade.id;
        } else if (decision.kind === 'target-selection' && cavalierCast) {
          const opposingBlade = decision.options.find(
            (option) => option.targets[0]?.oid === opposingBladeOid,
          );
          move = opposingBlade?.id;
          choseDestroyTarget ||= move !== undefined;
        } else if (decision.kind === 'priority') {
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const ownBlade = decision.options.find((option) => option.text.startsWith('Blade Splicer:'));
          const opposingBlade = decision.options.find((option) => option.text.startsWith('Blade Splicer:'));
          const cavalier = decision.options.find((option) => option.text.startsWith('Cavalier of Night:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !ownBladeCast && pilotMana >= 3 ? ownBlade?.id : undefined) ??
            (decision.seat === 1 && !opposingBladeCast && opponentMana >= 3
              ? opposingBlade?.id
              : undefined) ??
            (decision.seat === 0 &&
            ownBladeOid !== undefined &&
            opposingBladeOid !== undefined &&
            !cavalierCast &&
            pilotMana >= 5
              ? cavalier?.id
              : undefined);
          ownBladeCast ||= decision.seat === 0 && move !== undefined && move === ownBlade?.id;
          opposingBladeCast ||= decision.seat === 1 && move !== undefined && move === opposingBlade?.id;
          cavalierCast ||= move !== undefined && move === cavalier?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Cavalier of Night move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(ownBladeCast, evidence).toBe(true);
      expect(opposingBladeCast, evidence).toBe(true);
      expect(cavalierCast, evidence).toBe(true);
      expect(confirmedReflexiveTrigger, evidence).toBe(true);
      expect(choseSacrifice, evidence).toBe(true);
      expect(choseDestroyTarget, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

forgeIt(
  'Necromancy reanimates the exact graveyard creature and its delayed trigger sacrifices that object when the Aura leaves',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Necromancy pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-necromancy-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 20 },
              { name: 'Lightning Bolt', count: 20 },
              { name: 'Necromancy', count: 20 },
            ],
          },
        },
        {
          name: 'Reanimation source',
          controller: 'local',
          deck: {
            name: 'z5q4-necromancy-trigger-target-opponent',
            cards: [
              { name: 'Mana Confluence', count: 20 },
              { name: 'Blade Splicer', count: 20 },
              { name: 'Abrupt Decay', count: 20 },
            ],
          },
        },
      ],
      seed: 'z5q4-necromancy-trigger-target',
      maximumTurns: 24,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let bladeCast = false;
    let boltCast = false;
    let necromancyCast = false;
    let disenchantCast = false;
    let bladeOid: string | undefined;
    let choseBoltTarget = false;
    let choseReanimationTarget = false;
    let choseAuraTarget = false;
    let reanimated = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Necromancy decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        bladeOid ??= bladeCast
          ? opponent.battlefield.find((card) => card.name === 'Blade Splicer')?.oid
          : undefined;
        reanimated ||=
          bladeOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === bladeOid) &&
          pilot.battlefield.some((card) => card.name === 'Necromancy');
        observed =
          reanimated &&
          bladeOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === bladeOid) &&
          pilot.graveyard.some((card) => card.name === 'Necromancy') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection') {
          if (disenchantCast) {
            const necromancy = decision.options.find((option) => option.targets[0]?.name === 'Necromancy');
            move = necromancy?.id;
            choseAuraTarget ||= move !== undefined;
          } else if (necromancyCast) {
            const blade = decision.options.find((option) => option.targets[0]?.oid === bladeOid);
            move = blade?.id;
            choseReanimationTarget ||= move !== undefined;
          } else if (boltCast) {
            const blade = decision.options.find((option) => option.targets[0]?.oid === bladeOid);
            move = blade?.id;
            choseBoltTarget ||= move !== undefined;
          }
        } else if (decision.kind === 'priority') {
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const blade = decision.options.find((option) => option.text.startsWith('Blade Splicer:'));
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const necromancy = decision.options.find((option) => option.text.startsWith('Necromancy:'));
          const disenchant = decision.options.find((option) => option.text.startsWith('Abrupt Decay:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mana Confluence')?.id) ??
            (decision.seat === 1 && !bladeCast && opponentMana >= 3 ? blade?.id : undefined) ??
            (decision.seat === 0 && bladeOid !== undefined && !boltCast && pilotMana >= 1
              ? bolt?.id
              : undefined) ??
            (decision.seat === 0 &&
            bladeOid !== undefined &&
            opponent.graveyard.some((card) => card.oid === bladeOid) &&
            !necromancyCast &&
            pilotMana >= 3
              ? necromancy?.id
              : undefined) ??
            (decision.seat === 1 && reanimated && !disenchantCast && opponentMana >= 2
              ? disenchant?.id
              : undefined);
          bladeCast ||= decision.seat === 1 && move !== undefined && move === blade?.id;
          boltCast ||= decision.seat === 0 && move !== undefined && move === bolt?.id;
          necromancyCast ||= decision.seat === 0 && move !== undefined && move === necromancy?.id;
          disenchantCast ||= decision.seat === 1 && move !== undefined && move === disenchant?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Necromancy move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(bladeCast, evidence).toBe(true);
      expect(choseBoltTarget, evidence).toBe(true);
      expect(choseReanimationTarget, evidence).toBe(true);
      expect(reanimated, evidence).toBe(true);
      expect(disenchantCast, evidence).toBe(true);
      expect(choseAuraTarget, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Chandra creates her ultimate emblem and its spell-cast trigger deals five damage to the human-selected target',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Chandra pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-chandra-trigger-target',
            cards: [
              { name: 'Mountain', count: 20 },
              { name: 'Chandra, Torch of Defiance', count: 20 },
              { name: 'Lightning Bolt', count: 20 },
            ],
          },
        },
        {
          name: 'Emblem target',
          controller: 'local',
          deck: { name: 'z5q4-chandra-target', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-chandra-trigger-target',
      maximumTurns: 24,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let chandraCast = false;
    let ultimateActivated = false;
    let emblemResolved = false;
    let boltCast = false;
    let boltTargeted = false;
    let emblemTargeted = false;
    let postEmblemTargetSelections = 0;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Chandra decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        emblemResolved ||=
          ultimateActivated &&
          !pilot.battlefield.some((card) => card.name === 'Chandra, Torch of Defiance') &&
          session.view.stack.length === 0;
        observed =
          emblemResolved &&
          boltTargeted &&
          emblemTargeted &&
          opponent.life === 12 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && emblemResolved && boltCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          if (move !== undefined) {
            postEmblemTargetSelections += 1;
            if (postEmblemTargetSelections === 1) boltTargeted = true;
            else if (postEmblemTargetSelections === 2) emblemTargeted = true;
          }
        } else if (decision.kind === 'priority') {
          const chandra = pilot.battlefield.find((card) => card.name === 'Chandra, Torch of Defiance');
          const untappedMountains = pilot.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const castChandra = decision.options.find((option) =>
            option.text.startsWith('Chandra, Torch of Defiance:'),
          );
          const addMana = decision.options.find((option) => option.text.includes('Add {R}{R}'));
          const emblem = decision.options.find((option) => option.text.includes('You get an emblem'));
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mountain')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && !chandraCast && untappedMountains >= 4 ? castChandra?.id : undefined) ??
            (decision.seat === 0 && chandra !== undefined && !ultimateActivated && emblem !== undefined
              ? emblem.id
              : undefined) ??
            (decision.seat === 0 && chandra !== undefined && !ultimateActivated ? addMana?.id : undefined) ??
            (decision.seat === 0 && emblemResolved && !boltCast && untappedMountains >= 1
              ? bolt?.id
              : undefined);
          chandraCast ||= decision.seat === 0 && move !== undefined && move === castChandra?.id;
          ultimateActivated ||= decision.seat === 0 && move !== undefined && move === emblem?.id;
          boltCast ||= decision.seat === 0 && move !== undefined && move === bolt?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Chandra move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(chandraCast, evidence).toBe(true);
      expect(ultimateActivated, evidence).toBe(true);
      expect(emblemResolved, evidence).toBe(true);
      expect(boltCast, evidence).toBe(true);
      expect(boltTargeted, evidence).toBe(true);
      expect(emblemTargeted, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  420_000,
);

forgeIt(
  'Teferi untaps the exact selected lands and his draw emblem exiles the exact opposing permanent',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Teferi pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-teferi-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Teferi, Hero of Dominaria', count: 30 },
            ],
          },
        },
        {
          name: 'Emblem exile target',
          controller: 'local',
          deck: {
            name: 'z5q4-teferi-trigger-target-opponent',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Blade Splicer', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-teferi-trigger-target',
      maximumTurns: 30,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let opposingBladeOid: string | undefined;
    let bladeCast = false;
    let teferiCast = false;
    let plusOneActivations = 0;
    const selectedLandOids: string[] = [];
    let untapSelectionCompleted = false;
    let exactLandsUntapped = false;
    let ultimateActivated = false;
    let emblemResolved = false;
    let choseEmblemTarget = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Teferi decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        opposingBladeOid ??= bladeCast
          ? opponent.battlefield.find((card) => card.name === 'Blade Splicer')?.oid
          : undefined;
        untapSelectionCompleted ||= selectedLandOids.length === 2 && decision.kind !== 'card-selection';
        exactLandsUntapped ||=
          untapSelectionCompleted &&
          selectedLandOids.length === 2 &&
          selectedLandOids.every((oid) => pilot.battlefield.some((card) => card.oid === oid && !card.tapped));
        emblemResolved ||=
          ultimateActivated &&
          !pilot.battlefield.some((card) => card.name === 'Teferi, Hero of Dominaria') &&
          session.view.stack.length === 0;
        observed =
          exactLandsUntapped &&
          choseEmblemTarget &&
          opposingBladeOid !== undefined &&
          opponent.exile.some((card) => card.oid === opposingBladeOid) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'card-selection' && teferiCast && !untapSelectionCompleted) {
          const land = decision.options.find(
            (option) =>
              option.targets.length === 1 &&
              option.targets[0]?.name === 'Mana Confluence' &&
              !selectedLandOids.includes(option.targets[0].oid),
          );
          if (selectedLandOids.length < 2 && land !== undefined) {
            selectedLandOids.push(land.targets[0]!.oid);
            move = land.id;
          } else {
            move = decision.options.find((option) => option.id === 'card-selection-done')?.id;
            untapSelectionCompleted ||= move !== undefined;
          }
        } else if (decision.kind === 'card-selection') {
          move = decision.options.find((option) => option.id === 'card-selection-done')?.id;
        } else if (decision.kind === 'target-selection' && emblemResolved) {
          move = decision.options.find((option) => option.targets[0]?.oid === opposingBladeOid)?.id;
          choseEmblemTarget ||= move !== undefined;
        } else if (decision.kind === 'priority') {
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const blade = decision.options.find((option) => option.text.startsWith('Blade Splicer:'));
          const castTeferi = decision.options.find((option) =>
            option.text.startsWith('Teferi, Hero of Dominaria:'),
          );
          const draw = decision.options.find((option) => option.text.includes('Draw a card'));
          const emblem = decision.options.find((option) => option.text.includes('You get an emblem'));
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && !bladeCast && opponentMana >= 3 ? blade?.id : undefined) ??
            (decision.seat === 0 && !teferiCast && pilotMana >= 5 ? castTeferi?.id : undefined) ??
            (decision.seat === 0 && teferiCast && !ultimateActivated && emblem !== undefined
              ? emblem.id
              : undefined) ??
            (decision.seat === 0 && teferiCast && !ultimateActivated ? draw?.id : undefined);
          bladeCast ||= decision.seat === 1 && move !== undefined && move === blade?.id;
          teferiCast ||= decision.seat === 0 && move !== undefined && move === castTeferi?.id;
          if (decision.seat === 0 && move !== undefined && move === draw?.id) plusOneActivations += 1;
          ultimateActivated ||= decision.seat === 0 && move !== undefined && move === emblem?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Teferi move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-260).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(bladeCast, evidence).toBe(true);
      expect(teferiCast, evidence).toBe(true);
      expect(plusOneActivations, evidence).toBeGreaterThanOrEqual(4);
      expect(selectedLandOids, evidence).toHaveLength(2);
      expect(untapSelectionCompleted, evidence).toBe(true);
      expect(exactLandsUntapped, evidence).toBe(true);
      expect(ultimateActivated, evidence).toBe(true);
      expect(emblemResolved, evidence).toBe(true);
      expect(choseEmblemTarget, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  480_000,
);

forgeIt(
  "Zareth San returns the exact unblocked Rogue and reanimates the exact damaged player's graveyard permanent",
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Zareth pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-zareth-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 20 },
              { name: "Oona's Prowler", count: 10 },
              { name: 'Lightning Bolt', count: 10 },
              { name: 'Zareth San, the Trickster', count: 20 },
            ],
          },
        },
        {
          name: 'Graveyard target',
          controller: 'local',
          deck: {
            name: 'z5q4-zareth-trigger-target-opponent',
            cards: [
              { name: 'Mana Confluence', count: 30 },
              { name: 'Vampire Nighthawk', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-zareth-trigger-target',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let prowlerOid: string | undefined;
    let targetOid: string | undefined;
    let prowlerCast = false;
    let targetCasts = 0;
    let boltCast = false;
    let choseBoltTarget = false;
    let declaredProwler = false;
    let committedAttack = false;
    let zarethActivated = false;
    let choseReturnCost = false;
    let confirmedTrigger = false;
    let choseGraveyardTarget = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Zareth San decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        prowlerOid ??= prowlerCast
          ? pilot.battlefield.find((card) => card.name === "Oona's Prowler")?.oid
          : undefined;
        targetOid ??=
          targetCasts > 0
            ? opponent.battlefield.find((card) => card.name === 'Vampire Nighthawk')?.oid
            : undefined;
        observed =
          zarethActivated &&
          choseReturnCost &&
          confirmedTrigger &&
          choseGraveyardTarget &&
          prowlerOid !== undefined &&
          pilot.hand?.some((card) => card.oid === prowlerOid) === true &&
          targetOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === targetOid && card.controller === 0) &&
          pilot.battlefield.some((card) => card.name === 'Zareth San, the Trickster') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection') {
          if (zarethActivated) {
            move = decision.options.find((option) => option.targets[0]?.oid === targetOid)?.id;
            choseGraveyardTarget ||= move !== undefined;
          } else if (boltCast) {
            move = decision.options.find((option) => option.targets[0]?.oid === targetOid)?.id;
            choseBoltTarget ||= move !== undefined;
          }
        } else if (decision.kind === 'cost-return-selection') {
          move = decision.options.find((option) => option.targets[0]?.oid === prowlerOid)?.id;
          choseReturnCost ||= move !== undefined;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find(
            (option) => option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === prowlerOid,
          )?.id;
          declaredProwler ||= move !== undefined;
          if (move === undefined) {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            committedAttack ||= move !== undefined;
          }
        } else if (zarethActivated && decision.kind === 'confirm-trigger') {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmedTrigger ||= move !== undefined;
        } else if (decision.kind === 'priority') {
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const opponentMana = opponent.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const prowler = decision.options.find((option) => option.text.startsWith("Oona's Prowler:"));
          const target = decision.options.find((option) => option.text.startsWith('Vampire Nighthawk:'));
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          const zareth = decision.options.find((option) =>
            option.text.includes('Put Zareth San, the Trickster from your hand onto the battlefield'),
          );
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Mana Confluence')?.id) ??
            (decision.seat === 0 && !prowlerCast && pilotMana >= 2 ? prowler?.id : undefined) ??
            (decision.seat === 1 && targetCasts < 2 && opponentMana >= 3 ? target?.id : undefined) ??
            (decision.seat === 0 && targetOid !== undefined && !boltCast && pilotMana >= 1
              ? bolt?.id
              : undefined) ??
            (decision.seat === 0 && committedAttack && !zarethActivated && pilotMana >= 4
              ? zareth?.id
              : undefined);
          prowlerCast ||= decision.seat === 0 && move !== undefined && move === prowler?.id;
          if (decision.seat === 1 && move !== undefined && move === target?.id) targetCasts += 1;
          boltCast ||= decision.seat === 0 && move !== undefined && move === bolt?.id;
          zarethActivated ||= decision.seat === 0 && move !== undefined && move === zareth?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Zareth San move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-260).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(prowlerCast, evidence).toBe(true);
      expect(targetCasts, evidence).toBeGreaterThanOrEqual(2);
      expect(choseBoltTarget, evidence).toBe(true);
      expect(declaredProwler, evidence).toBe(true);
      expect(committedAttack, evidence).toBe(true);
      expect(zarethActivated, evidence).toBe(true);
      expect(choseReturnCost, evidence).toBe(true);
      expect(confirmedTrigger, evidence).toBe(true);
      expect(choseGraveyardTarget, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  480_000,
);

forgeIt(
  "Emrakul controls the targeted opponent's next turn and grants that opponent the following extra turn",
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Emrakul pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-emrakul-trigger-target',
            cards: [
              { name: 'Mana Confluence', count: 45 },
              { name: 'Emrakul, the Promised End', count: 15 },
            ],
          },
        },
        {
          name: 'Controlled opponent',
          controller: 'engine',
          deck: { name: 'z5q4-emrakul-trigger-target-opponent', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-emrakul-trigger-target',
      maximumTurns: 40,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let emrakulCast = false;
    let targetedOpponent = false;
    let controlledTurn: number | undefined;
    let playedControlledLand = false;
    let controlledLandCount: number | undefined;
    let observedExtraTurn = false;
    let observed = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Emrakul decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (
          controlledTurn !== undefined &&
          session.view.turn.active === 0 &&
          session.view.turn.number === controlledTurn + 2
        ) {
          observedExtraTurn = true;
        }
        observed =
          emrakulCast &&
          targetedOpponent &&
          controlledTurn !== undefined &&
          playedControlledLand &&
          controlledLandCount !== undefined &&
          observedExtraTurn &&
          opponent.hand === null &&
          opponent.battlefield.filter((card) => card.name === 'Plains').length > controlledLandCount &&
          pilot.battlefield.some((card) => card.name === 'Emrakul, the Promised End') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} ${decision.seat}/${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'target-selection' && emrakulCast) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          targetedOpponent ||= move !== undefined;
        } else if (decision.kind === 'priority') {
          const pilotMana = pilot.battlefield.filter(
            (card) => card.name === 'Mana Confluence' && !card.tapped,
          ).length;
          const emrakul = decision.options.find((option) =>
            option.text.startsWith('Emrakul, the Promised End:'),
          );
          const land = decision.options.find((option) => option.text === 'Play Plains');
          // The wire never re-attributes decision.seat or reveals a controlled seat's hand
          // (seat-projection.ts redacts the other seat's hand unconditionally by identity), so
          // the only observable sign the pilot is now deciding the opponent's turn is being
          // offered their land drop, which a non-active player is never otherwise offered.
          const controlled = session.view.turn.active === 1 && land !== undefined;
          if (controlled) controlledTurn ??= session.view.turn.number;
          move =
            (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (controlled
              ? land?.id
              : decision.options.find((option) => option.text === 'Play Mana Confluence')?.id) ??
            (!controlled && !emrakulCast && pilotMana >= 13 ? emrakul?.id : undefined);
          emrakulCast ||= !controlled && move !== undefined && move === emrakul?.id;
          if (controlled && move !== undefined && move === land?.id) playedControlledLand = true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Emrakul move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-300).join('\n')}`);
        session = advanced.session;
        if (playedControlledLand && controlledLandCount === undefined) {
          const count = session.view.seats[1].battlefield.filter((card) => card.name === 'Plains').length;
          if (count > 0) controlledLandCount = count;
        }
      }
      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(emrakulCast, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(controlledTurn, evidence).toBeTypeOf('number');
      expect(playedControlledLand, evidence).toBe(true);
      expect(observedExtraTurn, evidence).toBe(true);
      expect(observed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  480_000,
);

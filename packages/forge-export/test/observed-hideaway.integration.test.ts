/** Installed-Forge proof for the exact Windbrisk Heights and Shelldock Isle Hideaway 4 cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(source: 'Windbrisk Heights' | 'Shelldock Isle'): SessionSpec {
  const basic = source === 'Windbrisk Heights' ? 'Plains' : 'Island';
  const creature = source === 'Windbrisk Heights' ? 'Student of Warfare' : 'Llanowar Elves';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${source} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${source.toLowerCase().replaceAll(' ', '-')}`,
          cards: [
            { name: basic, count: 30 },
            { name: source, count: 15 },
            { name: creature, count: 15 },
          ],
        },
      },
      {
        name: 'Passive opponent',
        controller: 'local',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-hideaway-entry-${source}`,
    maximumTurns: 12,
  };
}

forgeIt.each(['Windbrisk Heights', 'Shelldock Isle'] as const)(
  '%s chooses exactly one of the top four and preserves the other three',
  async (source) => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let played = false;
    let sawChoice = false;
    let libraryBefore: number | null = null;
    let exileBefore: number | null = null;
    let selectedOid: string | null = null;
    let staleSnapshot: ObservedSession | null = null;
    let staleMove: string | null = null;
    let outcome = false;
    try {
      expect(await backend.supports(table(source))).toEqual([]);
      const opened = await backend.open(table(source));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error(`Forge offered no ${source} decision`);
        const pilot = session.view.seats[0];
        const hideaway = pilot.battlefield.find((card) => card.name === source);
        outcome ||=
          sawChoice &&
          hideaway?.tapped === true &&
          libraryBefore !== null &&
          pilot.librarySize === libraryBefore - 1 &&
          exileBefore !== null &&
          pilot.exile.length === exileBefore + 1 &&
          selectedOid !== null &&
          pilot.exile.some((card) => card.oid === selectedOid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'entity-selection') {
          expect(decision.seat).toBe(0);
          const cards = decision.options.filter((option) => option.targets.length === 1);
          expect(cards).toHaveLength(4);
          expect(decision.options.some((option) => option.id.endsWith('-done'))).toBe(false);
          await expect(session.submit('entity-selection-forge-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = cards[0];
          if (selected === undefined) throw new Error(`Forge omitted the ${source} top-four choice`);
          selectedOid = selected.targets[0]?.oid ?? null;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
          sawChoice = true;
        } else if (decision.kind === 'priority') {
          if (outcome) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else if (decision.seat === 0) {
            const playSource = decision.options.find((option) => option.text === `Play ${source}`);
            if (!played && playSource !== undefined) {
              played = true;
              libraryBefore = pilot.librarySize;
              exileBefore = pilot.exile.length;
              move = playSource.id;
            } else {
              move =
                decision.options.find(
                  (option) => option.text === 'Play Plains' || option.text === 'Play Island',
                )?.id ?? move;
            }
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }
        if (move === undefined) throw new Error(`Unhandled ${source} decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      expect(played).toBe(true);
      expect(sawChoice).toBe(true);
      expect(outcome).toBe(true);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${trace.join('\n')}`);
    } finally {
      if (session !== undefined) await session.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt.each([
  ['Windbrisk Heights', 'Plains', 'Student of Warfare'],
  ['Shelldock Isle', 'Island', 'Opt'],
] as const)(
  '%s stays condition-gated and produces its stated color from %s to cast %s',
  async (source, basic, spell) => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: `${source} mana pilot`,
          controller: 'local',
          deck: {
            name: `z5q4-${source.toLowerCase().replaceAll(' ', '-')}-mana`,
            cards: [
              { name: basic, count: 20 },
              { name: source, count: 20 },
              { name: spell, count: 20 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: `z5q4-hideaway-mana-${source}`,
      maximumTurns: 8,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let basicPlayed = false;
    let sourceOid: string | undefined;
    let spellOid: string | undefined;
    let paidWithSource = false;
    let conditionRefused = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error(`Forge offered no ${source} mana decision`);
        const pilot = session.view.seats[0];
        let hideaway = pilot.battlefield.find((card) => card.oid === sourceOid);
        if (sourceOid === undefined) {
          hideaway = pilot.battlefield.find((card) => card.name === source);
          sourceOid = hideaway?.oid;
        }
        const spellResolved =
          spell === 'Student of Warfare'
            ? pilot.battlefield.some((card) => card.oid === spellOid)
            : pilot.graveyard.some((card) => card.oid === spellOid);
        if (paidWithSource && hideaway?.tapped === true && spellResolved) break;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id.endsWith('-done') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'entity-selection') {
          move = decision.options.find((option) => option.targets.length === 1)?.id ?? move;
        } else if (decision.kind === 'mana-payment') {
          const exact = decision.options.find(
            (option) => option.id.startsWith('mana-source-') && option.targets[0]?.oid === sourceOid,
          );
          expect(exact, trace.at(-1)).toBeDefined();
          move = exact?.id;
          paidWithSource = true;
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const activate = decision.options.find((option) =>
              option.text.includes('play the exiled card without paying its mana cost'),
            );
            if (sourceOid !== undefined && hideaway?.tapped === false) {
              expect(activate, trace.at(-1)).toBeUndefined();
              conditionRefused = true;
            }
            const playBasic = decision.options.find((option) => option.text === `Play ${basic}`);
            const playSource = decision.options.find((option) => option.text === `Play ${source}`);
            const castSpell = decision.options.find((option) => option.text.startsWith(`${spell}:`));
            move =
              (!basicPlayed ? playBasic?.id : undefined) ??
              (sourceOid === undefined ? playSource?.id : undefined) ??
              (hideaway?.tapped === false && spellOid === undefined ? castSpell?.id : undefined) ??
              move;
            basicPlayed ||= move !== undefined && move === playBasic?.id;
            if (move !== undefined && move === castSpell?.id) {
              const cardId = /^ability-(\d+)-/u.exec(castSpell.id)?.[1];
              spellOid = cardId === undefined ? undefined : `forge-card-${cardId}`;
            }
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }
        if (move === undefined) throw new Error(`Unhandled ${source} mana decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = trace.join('\n');
      expect(basicPlayed, evidence).toBe(true);
      expect(sourceOid, evidence).toMatch(/^forge-card-/u);
      expect(spellOid, evidence).toMatch(/^forge-card-/u);
      expect(conditionRefused, evidence).toBe(true);
      expect(paidWithSource, evidence).toBe(true);
      expect(session.view.seats[0].battlefield.find((card) => card.oid === sourceOid)?.tapped, evidence).toBe(
        true,
      );
      expect(
        spell === 'Student of Warfare'
          ? session.view.seats[0].battlefield.some((card) => card.oid === spellOid)
          : session.view.seats[0].graveyard.some((card) => card.oid === spellOid),
        evidence,
      ).toBe(true);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${trace.join('\n')}`);
    } finally {
      if (session !== undefined) await session.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt.each([
  ['Windbrisk Heights', 'Plains', 'Student of Warfare'],
  ['Shelldock Isle', 'Island', 'Opt'],
] as const)(
  '%s puts all three unchosen top-four objects below the untouched library object',
  async (source, basic, filler) => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: `${source} bottom-order pilot`,
          controller: 'local',
          deck: {
            name: `z5q4-${source.toLowerCase().replaceAll(' ', '-')}-bottom-order`,
            cards: [
              { name: basic, count: 4 },
              { name: source, count: 4 },
              { name: filler, count: 4 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 12 }] },
        },
      ],
      seed: `z5q4-hideaway-bottom-${source}`,
      maximumTurns: 10,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourcePlayed = false;
    let selectedOid: string | undefined;
    let unchosenOids: readonly string[] = [];
    let handAfterHideaway: Set<string> | undefined;
    const drawnOids: string[] = [];
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error(`Forge offered no ${source} bottom-order decision`);
        const pilot = session.view.seats[0];
        if (
          selectedOid !== undefined &&
          handAfterHideaway === undefined &&
          pilot.exile.some((card) => card.oid === selectedOid)
        ) {
          handAfterHideaway = new Set(pilot.hand?.map((card) => card.oid) ?? []);
        } else if (handAfterHideaway !== undefined) {
          for (const card of pilot.hand ?? []) {
            if (!handAfterHideaway.has(card.oid)) {
              handAfterHideaway.add(card.oid);
              drawnOids.push(card.oid);
            }
          }
        }
        if (drawnOids.length === 4) break;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'entity-selection') {
          const cards = decision.options.filter((option) => option.targets.length === 1);
          expect(cards).toHaveLength(4);
          const chosen = cards[0];
          if (chosen === undefined) throw new Error(`${source} omitted its top-four objects`);
          selectedOid = chosen.targets[0]?.oid;
          unchosenOids = cards.slice(1).map((option) => option.targets[0]?.oid ?? 'missing');
          move = chosen.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0 && !sourcePlayed) {
            const playSource = decision.options.find((option) => option.text === `Play ${source}`);
            if (playSource !== undefined) {
              move = playSource.id;
              sourcePlayed = true;
            }
          } else if (decision.seat === 1) {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }
        if (move === undefined)
          throw new Error(`Unhandled ${source} bottom-order decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = trace.join('\n');
      expect(sourcePlayed, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(unchosenOids, evidence).toHaveLength(3);
      expect(
        unchosenOids.every((oid) => /^forge-card-/u.test(oid)),
        evidence,
      ).toBe(true);
      expect(drawnOids, evidence).toHaveLength(4);
      expect(unchosenOids, evidence).not.toContain(drawnOids[0]);
      expect(new Set(drawnOids.slice(1)), evidence).toEqual(new Set(unchosenOids));
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${trace.join('\n')}`);
    } finally {
      if (session !== undefined) await session.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt(
  'Shelldock Isle offers its exact linked card at twenty or fewer cards and casts it without mana',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Shelldock activation pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-shelldock-activation',
            cards: [
              { name: 'Island', count: 8 },
              { name: 'Shelldock Isle', count: 8 },
              { name: 'Wurmcoil Engine', count: 8 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 24 }] },
        },
      ],
      seed: 'z5q4-shelldock-linked-free-cast-v1',
      maximumTurns: 8,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourcePlayed = false;
    let islandPlayed = false;
    let linkedOid: string | undefined;
    let linkedName: string | undefined;
    let activated = false;
    let confirmed = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Shelldock activation decision');
        const pilot = session.view.seats[0];
        const linked = pilot.exile.find((card) => card.oid === linkedOid);
        const wurmcoil = pilot.battlefield.find(
          (card) => card.oid === linkedOid && card.name === 'Wurmcoil Engine',
        );
        if (wurmcoil !== undefined) {
          expect(linked).toBeUndefined();
          expect(activated).toBe(true);
          expect(confirmed).toBe(true);
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'entity-selection') {
          const exact = decision.options.find((option) => option.text.includes('Wurmcoil Engine'));
          if (exact === undefined) throw new Error('Shelldock top four omitted Wurmcoil Engine');
          linkedOid = exact.targets[0]?.oid;
          linkedName = exact.text;
          move = exact.id;
        } else if (decision.kind === 'confirm-action') {
          expect(decision.seat).toBe(0);
          expect(decision.options.map((option) => option.text)).toEqual(['Yes', 'No']);
          expect(decision.options.every((option) => option.targets[0]?.oid === linkedOid)).toBe(true);
          move = decision.options.find((option) => option.text === 'Yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const playSource = decision.options.find((option) => option.text === 'Play Shelldock Isle');
            const playIsland = decision.options.find((option) => option.text === 'Play Island');
            const activate = decision.options.find((option) =>
              option.text.includes('play the exiled card without paying its mana cost'),
            );
            move =
              (!sourcePlayed ? playSource?.id : undefined) ??
              (sourcePlayed && !islandPlayed ? playIsland?.id : undefined) ??
              (sourcePlayed && islandPlayed && !activated ? activate?.id : undefined) ??
              move;
            sourcePlayed ||= move !== undefined && move === playSource?.id;
            islandPlayed ||= move !== undefined && move === playIsland?.id;
            activated ||= move !== undefined && move === activate?.id;
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }
        if (move === undefined) throw new Error(`Unhandled Shelldock decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = trace.join('\n');
      expect(sourcePlayed, evidence).toBe(true);
      expect(islandPlayed, evidence).toBe(true);
      expect(linkedOid, evidence).toMatch(/^forge-card-/u);
      expect(linkedName, evidence).toContain('Wurmcoil Engine');
      expect(activated, evidence).toBe(true);
      expect(confirmed, evidence).toBe(true);
      expect(
        session.view.seats[0].battlefield.some(
          (card) => card.oid === linkedOid && card.name === 'Wurmcoil Engine',
        ),
        evidence,
      ).toBe(true);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${trace.join('\n')}`);
    } finally {
      if (session !== undefined) await session.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt(
  'Windbrisk Heights stays gated until three attackers, then declines and later free-casts its linked card',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Windbrisk activation pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-windbrisk-activation',
            cards: [
              { name: 'Plains', count: 15 },
              { name: 'Windbrisk Heights', count: 10 },
              { name: 'Student of Warfare', count: 20 },
              { name: 'Wurmcoil Engine', count: 15 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-windbrisk-three-attackers-v1',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    const attackers = new Set<string>();
    let sourcePlayed = false;
    let linkedOid: string | undefined;
    let attacksCommitted = 0;
    let activationCount = 0;
    let confirmations = 0;
    let declinePreserved = false;
    let gatedBeforeThree = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Windbrisk activation decision');
        const pilot = session.view.seats[0];
        const students = pilot.battlefield.filter((card) => card.name === 'Student of Warfare');
        const linked = pilot.exile.find((card) => card.oid === linkedOid);
        const wurmcoil = pilot.battlefield.find(
          (card) => card.oid === linkedOid && card.name === 'Wurmcoil Engine',
        );
        declinePreserved ||= confirmations === 1 && linked !== undefined;
        if (wurmcoil !== undefined) break;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'entity-selection') {
          const exact = decision.options.find((option) => option.text.includes('Wurmcoil Engine'));
          if (exact === undefined) throw new Error('Windbrisk top four omitted Wurmcoil Engine');
          linkedOid = exact.targets[0]?.oid;
          move = exact.id;
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.name === 'Student of Warfare' &&
              !attackers.has(option.targets[0]?.oid ?? ''),
          );
          if (students.length >= 3 && add !== undefined) {
            const oid = add.targets[0]?.oid;
            if (oid !== undefined) attackers.add(oid);
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            if (students.length >= 3 && attackers.size === 3) attacksCommitted += 1;
            attackers.clear();
          }
        } else if (decision.kind === 'confirm-action') {
          expect(decision.seat).toBe(0);
          expect(decision.options.map((option) => option.text)).toEqual(['Yes', 'No']);
          expect(decision.options.every((option) => option.targets[0]?.oid === linkedOid)).toBe(true);
          move = decision.options.find((option) => option.text === (confirmations === 0 ? 'No' : 'Yes'))?.id;
          confirmations += 1;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find(
            (option) => option.id.startsWith('mana-source-') && option.text.includes('Plains'),
          )?.id;
        } else if (decision.kind === 'priority') {
          const activate = decision.options.find((option) => option.text.includes('three or more creatures'));
          if (decision.seat === 0 && sourcePlayed && students.length < 3) {
            expect(activate, trace.at(-1)).toBeUndefined();
            gatedBeforeThree = true;
          }
          if (decision.seat === 0) {
            const untappedPlains = pilot.battlefield.filter(
              (card) => card.name === 'Plains' && !card.tapped,
            ).length;
            const playPlains = decision.options.find((option) => option.text === 'Play Plains');
            const playSource = decision.options.find((option) => option.text === 'Play Windbrisk Heights');
            const castStudent = decision.options.find((option) =>
              option.text.startsWith('Student of Warfare:'),
            );
            move =
              (!sourcePlayed && students.length >= 2 ? playSource?.id : undefined) ??
              (students.length < 2 ? playPlains?.id : undefined) ??
              (!sourcePlayed ? playSource?.id : undefined) ??
              (students.length < 3 && untappedPlains >= 1 ? castStudent?.id : undefined) ??
              (attacksCommitted > activationCount && activationCount < 2 ? activate?.id : undefined) ??
              move;
            sourcePlayed ||= move !== undefined && move === playSource?.id;
            if (move !== undefined && move === activate?.id) activationCount += 1;
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
          }
        }
        if (move === undefined) throw new Error(`Unhandled Windbrisk decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = trace.join('\n');
      expect(sourcePlayed, evidence).toBe(true);
      expect(linkedOid, evidence).toMatch(/^forge-card-/u);
      expect(gatedBeforeThree, evidence).toBe(true);
      expect(attacksCommitted, evidence).toBeGreaterThanOrEqual(2);
      expect(activationCount, evidence).toBe(2);
      expect(confirmations, evidence).toBe(2);
      expect(declinePreserved, evidence).toBe(true);
      expect(
        session.view.seats[0].battlefield.some(
          (card) => card.oid === linkedOid && card.name === 'Wurmcoil Engine',
        ),
        evidence,
      ).toBe(true);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${trace.join('\n')}`);
    } finally {
      if (session !== undefined) await session.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

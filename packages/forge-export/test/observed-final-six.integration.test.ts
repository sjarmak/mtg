/** Installed-Forge board-outcome proofs for the final reviewed Legacy Cube cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type Decision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: Decision): string | undefined {
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

function sylvanTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Sylvan Library pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-sylvan-library-outcome',
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Sylvan Library', count: 30 },
          ],
        },
      },
      {
        name: 'Sylvan Library observer',
        controller: 'local',
        deck: {
          name: 'z5q4-sylvan-library-observer',
          cards: [{ name: 'Plains', count: 60 }],
        },
      },
    ],
    seed: 'z5q4-sylvan-library-installed-outcomes',
    maximumTurns: 10,
  };
}

function whisperwoodTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Whisperwood pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-whisperwood-outcome',
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Whisperwood Elemental', count: 30 },
          ],
        },
      },
      {
        name: 'Whisperwood observer',
        controller: 'local',
        deck: {
          name: 'z5q4-whisperwood-observer',
          cards: [{ name: 'Plains', count: 60 }],
        },
      },
    ],
    seed: 'z5q4-whisperwood-installed-outcomes',
    maximumTurns: 16,
  };
}

function whisperwoodSacrificeTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Whisperwood sacrifice pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-whisperwood-sacrifice-outcome',
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Sakura-Tribe Elder', count: 15 },
            { name: 'Whisperwood Elemental', count: 15 },
          ],
        },
      },
      {
        name: 'Whisperwood sacrifice observer',
        controller: 'local',
        deck: {
          name: 'z5q4-whisperwood-sacrifice-observer',
          cards: [{ name: 'Plains', count: 60 }],
        },
      },
    ],
    seed: 'z5q4-whisperwood-sacrifice-installed-outcomes',
    maximumTurns: 30,
  };
}

function masterTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Master pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-master-outcome',
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Master of the Wild Hunt', count: 30 },
          ],
        },
      },
      {
        name: 'Master opponent',
        controller: 'local',
        deck: {
          name: 'z5q4-master-opponent',
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Solemn Simulacrum', count: 30 },
          ],
        },
      },
    ],
    seed: 'z5q4-master-installed-outcomes',
    maximumTurns: 18,
  };
}

function sawtuskTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Sawtusk pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-sawtusk-outcome',
          cards: [
            { name: 'Forest', count: 24 },
            { name: 'Llanowar Elves', count: 18 },
            { name: 'Sawtusk Demolisher', count: 18 },
          ],
        },
      },
      {
        name: 'Sawtusk opponent',
        controller: 'local',
        deck: {
          name: 'z5q4-sawtusk-opponent',
          cards: [{ name: 'Plains', count: 60 }],
        },
      },
    ],
    seed: 'z5q4-sawtusk-installed-outcomes',
    maximumTurns: 16,
  };
}

function yawgmothTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Yawgmoth pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-yawgmoth-outcome',
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Gutterbones', count: 15 },
            { name: 'Yawgmoth, Thran Physician', count: 15 },
          ],
        },
      },
      {
        name: 'Yawgmoth opponent',
        controller: 'local',
        deck: {
          name: 'z5q4-yawgmoth-opponent',
          cards: [
            { name: 'Forest', count: 30 },
            { name: 'Questing Beast', count: 30 },
          ],
        },
      },
    ],
    seed: 'z5q4-yawgmoth-installed-outcomes',
    maximumTurns: 20,
  };
}

function mindslaverTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Mindslaver pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-mindslaver-outcome',
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Mindslaver', count: 30 },
          ],
        },
      },
      {
        name: 'Mindslaver opponent',
        controller: 'engine',
        deck: {
          name: 'z5q4-mindslaver-opponent',
          cards: [{ name: 'Forest', count: 60 }],
        },
      },
    ],
    seed: 'z5q4-mindslaver-installed-outcomes',
    maximumTurns: 30,
  };
}

function counterTotal(card: { readonly counters: Readonly<Record<string, number>> }): number {
  return Object.values(card.counters).reduce((total, count) => total + count, 0);
}

forgeIt(
  'executes Sylvan Library choices and life payment in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let accepted = false;
    let choseCards = 0;
    let payments = 0;
    let ordered = 0;
    let beforeHandSize: number | undefined;
    let beforeLibrarySize: number | undefined;
    let returnedOid: string | undefined;
    let inventedReturnRejected = false;
    let staleReturnRejected = false;
    try {
      const spec = sylvanTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Sylvan Library decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        const pilot = session.view.seats[0];
        const libraryInPlay = pilot.battlefield.some((card) => card.name === 'Sylvan Library');
        let move: string | undefined;
        if (decision.seat === 0 && decision.kind === 'priority') {
          const forest = decision.options.find((option) => option.text === 'Play Forest');
          const spell = decision.options.find((option) => option.text.startsWith('Sylvan Library:'));
          const untappedForests = pilot.battlefield.filter(
            (card) => card.name === 'Forest' && !card.tapped,
          ).length;
          move =
            forest?.id ??
            (!libraryInPlay && spell !== undefined && untappedForests >= 2 ? spell.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move === spell?.id;
        } else if (
          decision.seat === 0 &&
          decision.kind === 'confirm-trigger' &&
          decision.prompt.startsWith('Sylvan Library:')
        ) {
          beforeHandSize ??= pilot.handSize;
          beforeLibrarySize ??= pilot.librarySize;
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          accepted = true;
        } else if (
          decision.seat === 0 &&
          (decision.kind === 'card-selection' || decision.kind === 'entity-selection')
        ) {
          move = decision.options.find((option) => option.id !== 'choose-done')?.id;
          if (move !== undefined) choseCards += 1;
        } else if (decision.seat === 0 && decision.kind === 'zone-order') {
          move = decision.options[0]?.id;
          if (move !== undefined) ordered += 1;
        } else if (decision.seat === 0 && decision.kind === 'confirm-payment') {
          const choice = payments === 0 ? 'confirm-payment-yes' : 'confirm-payment-no';
          move = decision.options.find((option) => option.id === choice)?.id;
          if (move !== undefined) payments += 1;
        } else if (decision.seat === 0 && decision.kind === 'zone-card-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates, trace.at(-1)).toHaveLength(1);
          const returned = candidates[0]!;
          returnedOid = returned.targets[0]!.oid;
          expect(pilot.hand?.some((card) => card.oid === returnedOid) ?? false, trace.at(-1)).toBe(true);
          await expect(session.submit('zone-card-selection-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedReturnRejected = true;
          const stale = session;
          const advanced = await session.submit(returned.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(returned.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleReturnRejected = true;
          break;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Sylvan Library move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-250).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(accepted, evidence).toBe(true);
      expect(choseCards, evidence).toBeGreaterThanOrEqual(2);
      expect(ordered, evidence).toBeGreaterThanOrEqual(1);
      expect(payments, evidence).toBe(2);
      expect(inventedReturnRejected, evidence).toBe(true);
      expect(staleReturnRejected, evidence).toBe(true);
      expect(returnedOid, evidence).toBeDefined();
      expect(beforeHandSize, evidence).toBeDefined();
      expect(beforeLibrarySize, evidence).toBeDefined();
      expect(session.view.seats[0].life, evidence).toBe(16);
      expect(session.view.seats[0].handSize, evidence).toBe(beforeHandSize! + 1);
      expect(session.view.seats[0].librarySize, evidence).toBe(beforeLibrarySize! - 1);
      expect(session.view.seats[0].hand?.some((card) => card.oid === returnedOid) ?? false, evidence).toBe(
        false,
      );
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-250).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'manifests the actual top card for Whisperwood Elemental in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let libraryBeforeManifest: number | undefined;
    try {
      const spec = whisperwoodTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Whisperwood decision');
        const pilot = session.view.seats[0];
        const whisperwood = pilot.battlefield.find((card) => card.name === 'Whisperwood Elemental');
        const manifested = pilot.battlefield.find(
          (card) =>
            card.name !== 'Whisperwood Elemental' &&
            card.name !== 'Forest' &&
            card.power === 2 &&
            card.toughness === 2 &&
            card.typeLine.includes('Creature'),
        );
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        if (manifested !== undefined) break;
        if (whisperwood !== undefined) libraryBeforeManifest ??= pilot.librarySize;

        let move: string | undefined;
        if (decision.seat === 0 && decision.kind === 'priority') {
          const forest = decision.options.find((option) => option.text === 'Play Forest');
          const spell = decision.options.find((option) => option.text.startsWith('Whisperwood Elemental:'));
          const untappedForests = pilot.battlefield.filter(
            (card) => card.name === 'Forest' && !card.tapped,
          ).length;
          move =
            forest?.id ??
            (whisperwood === undefined && spell !== undefined && untappedForests >= 5
              ? spell.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move === spell?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Whisperwood move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const manifested = pilot.battlefield.filter(
        (card) =>
          card.name !== 'Whisperwood Elemental' &&
          card.name !== 'Forest' &&
          card.power === 2 &&
          card.toughness === 2 &&
          card.typeLine.includes('Creature'),
      );
      const evidence = `${trace.slice(-250).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(libraryBeforeManifest, evidence).toBeDefined();
      expect(manifested, evidence).toHaveLength(1);
      expect(pilot.librarySize, evidence).toBe(libraryBeforeManifest! - 1);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-250).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'grants and resolves Whisperwood Elemental death manifests in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let elderCast = false;
    let whisperwoodCast = false;
    let grantActivated = false;
    let grantResolved = false;
    let elderActivated = false;
    let libraryBeforeElderDeath: number | undefined;
    let battlefieldBeforeElderDeath: Set<string> | undefined;
    try {
      const spec = whisperwoodSacrificeTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Whisperwood sacrifice decision');
        const pilot = session.view.seats[0];
        const elder = pilot.battlefield.find((card) => card.name === 'Sakura-Tribe Elder');
        const whisperwood = pilot.battlefield.find((card) => card.name === 'Whisperwood Elemental');
        grantResolved ||= grantActivated && whisperwood === undefined && session.view.stack.length === 0;
        const newManifest =
          battlefieldBeforeElderDeath === undefined
            ? undefined
            : pilot.battlefield.find(
                (card) =>
                  !battlefieldBeforeElderDeath!.has(card.oid) &&
                  card.name !== 'Forest' &&
                  card.power === 2 &&
                  card.toughness === 2 &&
                  card.typeLine.includes('Creature'),
              );
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        if (
          elderActivated &&
          newManifest !== undefined &&
          session.view.stack.length === 0 &&
          pilot.graveyard.some((card) => card.name === 'Sakura-Tribe Elder')
        ) {
          break;
        }

        let move: string | undefined;
        if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Forest');
            const castElder = decision.options.find((option) =>
              option.text.startsWith('Sakura-Tribe Elder: Sakura-Tribe Elder'),
            );
            const castWhisperwood = decision.options.find((option) =>
              option.text.startsWith('Whisperwood Elemental: Whisperwood Elemental'),
            );
            const activateGrant = decision.options.find((option) =>
              option.text.includes('face-up, nontoken creatures you control gain'),
            );
            const activateElder = decision.options.find((option) =>
              option.text.includes('Sacrifice Sakura-Tribe Elder'),
            );
            const untappedForests = pilot.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (elder === undefined && castElder !== undefined && untappedForests >= 2
                ? castElder.id
                : undefined) ??
              (!whisperwoodCast &&
              whisperwood === undefined &&
              castWhisperwood !== undefined &&
              untappedForests >= 5
                ? castWhisperwood.id
                : undefined) ??
              (!grantActivated && elder !== undefined && whisperwood !== undefined
                ? activateGrant?.id
                : undefined) ??
              (grantResolved && !elderActivated && elder !== undefined ? activateElder?.id : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            elderCast ||= elder === undefined && move === castElder?.id;
            whisperwoodCast ||= whisperwood === undefined && move === castWhisperwood?.id;
            grantActivated ||= move === activateGrant?.id;
            if (move === activateElder?.id) {
              elderActivated = true;
              libraryBeforeElderDeath = pilot.librarySize;
              battlefieldBeforeElderDeath = new Set(pilot.battlefield.map((card) => card.oid));
            }
          } else {
            move =
              decision.options.find((option) => option.text === 'Play Plains')?.id ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
        } else if (decision.seat === 0 && decision.kind === 'zone-card-selection' && elderActivated) {
          move = decision.options.find((option) => option.targets[0]?.name === 'Forest')?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Whisperwood sacrifice move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const newManifests = pilot.battlefield.filter(
        (card) =>
          battlefieldBeforeElderDeath !== undefined &&
          !battlefieldBeforeElderDeath.has(card.oid) &&
          card.name !== 'Forest' &&
          card.power === 2 &&
          card.toughness === 2 &&
          card.typeLine.includes('Creature'),
      );
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(elderCast, evidence).toBe(true);
      expect(whisperwoodCast, evidence).toBe(true);
      expect(grantActivated, evidence).toBe(true);
      expect(grantResolved, evidence).toBe(true);
      expect(elderActivated, evidence).toBe(true);
      expect(libraryBeforeElderDeath, evidence).toBeDefined();
      expect(
        pilot.battlefield.some((card) => card.name === 'Whisperwood Elemental'),
        evidence,
      ).toBe(false);
      expect(
        pilot.graveyard.some((card) => card.name === 'Whisperwood Elemental'),
        evidence,
      ).toBe(true);
      expect(
        pilot.graveyard.some((card) => card.name === 'Sakura-Tribe Elder'),
        evidence,
      ).toBe(true);
      expect(newManifests, evidence).toHaveLength(1);
      expect(pilot.librarySize, evidence).toBe(libraryBeforeElderDeath! - 2);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-300).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'executes both directions of Master of the Wild Hunt damage in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    const assignedWolves = new Set<string>();
    let masterCast = false;
    let solemnCast = false;
    let activated = false;
    let targeted = false;
    let inventedTargetRejected = false;
    let staleTargetRejected = false;
    let inventedDamageRejected = false;
    let staleDamageRejected = false;
    try {
      const spec = masterTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Master decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const master = pilot.battlefield.find((card) => card.name === 'Master of the Wild Hunt');
        const wolves = pilot.battlefield.filter(
          (card) => card.name.includes('Wolf') && card.typeLine.includes('Creature'),
        );
        const solemn = opponent.battlefield.find((card) => card.name === 'Solemn Simulacrum');
        const outcome =
          activated &&
          targeted &&
          assignedWolves.size === 2 &&
          opponent.graveyard.some((card) => card.name === 'Solemn Simulacrum') &&
          wolves.length >= 2 &&
          wolves.filter((wolf) => assignedWolves.has(wolf.oid)).every((wolf) => wolf.damage === 1);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        if (outcome) break;

        let move: string | undefined;
        if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Forest');
            const castMaster = decision.options.find((option) =>
              option.text.startsWith('Master of the Wild Hunt: Master of the Wild Hunt'),
            );
            const activateMaster = decision.options.find((option) =>
              option.text.includes('Tap all untapped Wolf creatures you control'),
            );
            const untappedForests = pilot.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (master === undefined && castMaster !== undefined && untappedForests >= 4
                ? castMaster.id
                : undefined) ??
              (!activated &&
              master !== undefined &&
              !master.tapped &&
              wolves.length >= 2 &&
              solemn !== undefined
                ? activateMaster?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            masterCast ||= master === undefined && move === castMaster?.id;
            activated ||= master !== undefined && move === activateMaster?.id;
          } else {
            const land = decision.options.find((option) => option.text === 'Play Plains');
            const castSolemn = decision.options.find((option) =>
              option.text.startsWith('Solemn Simulacrum:'),
            );
            const untappedPlains = opponent.battlefield.filter(
              (card) => card.name === 'Plains' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (solemn === undefined && castSolemn !== undefined && untappedPlains >= 4
                ? castSolemn.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            solemnCast ||= solemn === undefined && move === castSolemn?.id;
          }
        } else if (decision.kind === 'target-selection' && activated) {
          const exact = decision.options.find((option) => option.targets[0]?.name === 'Solemn Simulacrum');
          expect(exact, trace.at(-1)).toBeDefined();
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedTargetRejected = true;
          const stale = session;
          const advanced = await session.submit(exact!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(exact!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleTargetRejected = true;
          targeted = true;
          continue;
        } else if (decision.kind === 'combat-damage' && targeted) {
          const wolfChoices = decision.options.filter((option) => option.targets[0]?.name.includes('Wolf'));
          expect(wolfChoices.length, trace.at(-1)).toBeGreaterThanOrEqual(2 - assignedWolves.size);
          const exact = wolfChoices.find((option) => !assignedWolves.has(option.targets[0]?.oid ?? ''));
          expect(exact?.targets[0]?.oid, trace.at(-1)).toBeDefined();
          if (!inventedDamageRejected) {
            await expect(session.submit('combat-damage-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedDamageRejected = true;
          }
          assignedWolves.add(exact!.targets[0]!.oid);
          const stale = session;
          const advanced = await session.submit(exact!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          if (!staleDamageRejected) {
            await expect(stale.submit(exact!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleDamageRejected = true;
          }
          continue;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Master move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const wolves = pilot.battlefield.filter((card) => assignedWolves.has(card.oid));
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(masterCast, evidence).toBe(true);
      expect(solemnCast, evidence).toBe(true);
      expect(activated, evidence).toBe(true);
      expect(targeted, evidence).toBe(true);
      expect(inventedTargetRejected, evidence).toBe(true);
      expect(staleTargetRejected, evidence).toBe(true);
      expect(inventedDamageRejected, evidence).toBe(true);
      expect(staleDamageRejected, evidence).toBe(true);
      expect(assignedWolves.size, evidence).toBe(2);
      expect(
        opponent.graveyard.some((card) => card.name === 'Solemn Simulacrum'),
        evidence,
      ).toBe(true);
      expect(wolves, evidence).toHaveLength(2);
      expect(wolves.map((wolf) => wolf.damage).sort(), evidence).toEqual([1, 1]);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-300).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'mutates Sawtusk Demolisher and replaces the destroyed permanent in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let elfCast = false;
    let mutateCast = false;
    let mutateTargeted = false;
    let putSawtuskOnTop = false;
    let triggerTargeted = false;
    let targetPlainsOid: string | undefined;
    let inventedTargetRejected = false;
    let staleTargetRejected = false;
    try {
      const spec = sawtuskTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Sawtusk decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const elf = pilot.battlefield.find((card) => card.name === 'Llanowar Elves');
        const targetPlainsGone =
          targetPlainsOid !== undefined &&
          !opponent.battlefield.some((card) => card.oid === targetPlainsOid) &&
          opponent.graveyard.some((card) => card.oid === targetPlainsOid);
        const beasts = opponent.battlefield.filter(
          (card) => card.name.includes('Beast') && card.power === 3 && card.toughness === 3,
        );
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        if (targetPlainsGone && beasts.length === 1) break;

        let move: string | undefined;
        if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Forest');
            const castElf = decision.options.find((option) =>
              option.text.startsWith('Llanowar Elves: Llanowar Elves'),
            );
            const castMutate = decision.options.find(
              (option) =>
                option.text.startsWith('Sawtusk Demolisher:') && option.text.includes('Mutate {3}{G}'),
            );
            const untappedForests = pilot.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (elf === undefined && castElf !== undefined && untappedForests >= 1 ? castElf.id : undefined) ??
              (!mutateCast && elf !== undefined && castMutate !== undefined && untappedForests >= 4
                ? castMutate.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            elfCast ||= elf === undefined && move === castElf?.id;
            mutateCast ||= move === castMutate?.id;
          } else {
            move =
              decision.options.find((option) => option.text === 'Play Plains')?.id ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
        } else if (decision.seat === 0 && decision.kind === 'target-selection' && mutateCast) {
          const exactElf = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Llanowar Elves',
          );
          const exactPlains = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Plains',
          );
          if (!mutateTargeted && exactElf !== undefined) {
            move = exactElf.id;
            mutateTargeted = true;
          } else if (mutateTargeted && exactPlains !== undefined) {
            targetPlainsOid = exactPlains.targets[0]!.oid;
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTargetRejected = true;
            const stale = session;
            const advanced = await session.submit(exactPlains.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit(exactPlains.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleTargetRejected = true;
            triggerTargeted = true;
            continue;
          }
        } else if (decision.seat === 0 && decision.kind === 'entity-selection' && mutateTargeted) {
          const exact = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Sawtusk Demolisher',
          );
          expect(exact, trace.at(-1)).toBeDefined();
          move = exact!.id;
          putSawtuskOnTop = true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Sawtusk move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const sawtusks = pilot.battlefield.filter((card) => card.name === 'Sawtusk Demolisher');
      const beasts = opponent.battlefield.filter(
        (card) => card.name.includes('Beast') && card.power === 3 && card.toughness === 3,
      );
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(elfCast, evidence).toBe(true);
      expect(mutateCast, evidence).toBe(true);
      expect(mutateTargeted, evidence).toBe(true);
      expect(putSawtuskOnTop, evidence).toBe(true);
      expect(triggerTargeted, evidence).toBe(true);
      expect(inventedTargetRejected, evidence).toBe(true);
      expect(staleTargetRejected, evidence).toBe(true);
      expect(sawtusks, evidence).toHaveLength(1);
      expect(sawtusks[0]?.power, evidence).toBe(6);
      expect(sawtusks[0]?.toughness, evidence).toBe(6);
      expect(targetPlainsOid, evidence).toBeDefined();
      expect(
        opponent.battlefield.some((card) => card.oid === targetPlainsOid),
        evidence,
      ).toBe(false);
      expect(
        opponent.graveyard.some((card) => card.oid === targetPlainsOid),
        evidence,
      ).toBe(true);
      expect(beasts, evidence).toHaveLength(1);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-300).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'pays both Yawgmoth costs and proliferates the exact counter-bearing object in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let gutterbonesCast = false;
    let yawgmothCast = false;
    let questingBeastCast = false;
    let counterAbilityActivated = false;
    let targetSelected = false;
    let sacrificeSelected = false;
    let sacrificeInventedRejected = false;
    let sacrificeStaleRejected = false;
    let firstResolved = false;
    let proliferateActivated = false;
    let discardSelected = false;
    let discardInventedRejected = false;
    let proliferateTargetSelected = false;
    let proliferateCommitted = false;
    let proliferateInventedRejected = false;
    let proliferateStaleRejected = false;
    let lifeBeforeCounter: number | undefined;
    let handBeforeCounter: number | undefined;
    let libraryBeforeCounter: number | undefined;
    let gutterbonesOid: string | undefined;
    let questingBeastOid: string | undefined;
    let discardedOid: string | undefined;
    try {
      const spec = yawgmothTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Yawgmoth decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null || opponent.hand === null) throw new Error('Forge hid a Yawgmoth test hand');
        const gutterbones = pilot.battlefield.find((card) => card.name === 'Gutterbones');
        const yawgmoth = pilot.battlefield.find((card) => card.name === 'Yawgmoth, Thran Physician');
        const questingBeast = opponent.battlefield.find((card) => card.name === 'Questing Beast');
        gutterbonesOid ??= gutterbones?.oid;
        questingBeastOid ??= questingBeast?.oid;
        firstResolved ||=
          counterAbilityActivated &&
          gutterbonesOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === gutterbonesOid) &&
          questingBeast !== undefined &&
          counterTotal(questingBeast) === 1 &&
          lifeBeforeCounter !== undefined &&
          pilot.life === lifeBeforeCounter - 1 &&
          handBeforeCounter !== undefined &&
          pilot.handSize === handBeforeCounter + 1 &&
          libraryBeforeCounter !== undefined &&
          pilot.librarySize === libraryBeforeCounter - 1 &&
          session.view.stack.length === 0;
        const proliferateResolved =
          proliferateCommitted &&
          questingBeast !== undefined &&
          counterTotal(questingBeast) === 2 &&
          discardedOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === discardedOid) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        if (proliferateResolved) break;

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection' && decision.seat === 0) {
          const exact = decision.options.find((option) => option.targets[0]?.oid === gutterbonesOid);
          expect(exact, trace.at(-1)).toBeDefined();
          expect(
            decision.options
              .filter((option) => option.targets.length === 1)
              .map((option) => option.targets[0]?.oid),
            trace.at(-1),
          ).toEqual([gutterbonesOid]);
          if (!sacrificeInventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            sacrificeInventedRejected = true;
          }
          const stale = session;
          const advanced = await session.submit(exact!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(exact!.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          sacrificeStaleRejected = true;
          sacrificeSelected = true;
          continue;
        }
        if (decision.kind === 'cost-discard-selection' && decision.seat === 0) {
          const exact = decision.options.find(
            (option) => option.targets[0]?.name === 'Swamp' && option.id.startsWith('cost-discard-'),
          );
          expect(exact, trace.at(-1)).toBeDefined();
          if (!discardInventedRejected) {
            await expect(session.submit('cost-discard-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            discardInventedRejected = true;
          }
          discardedOid = exact!.targets[0]!.oid;
          move = exact!.id;
          discardSelected = true;
        } else if (decision.kind === 'target-selection' && decision.seat === 0 && counterAbilityActivated) {
          const exact = decision.options.find((option) => option.targets[0]?.oid === questingBeastOid);
          expect(exact, trace.at(-1)).toBeDefined();
          move = exact!.id;
          targetSelected = true;
        } else if (decision.kind === 'entity-selection' && decision.seat === 0 && proliferateActivated) {
          if (!proliferateTargetSelected) {
            const exact = decision.options.find((option) => option.targets[0]?.oid === questingBeastOid);
            expect(exact, trace.at(-1)).toBeDefined();
            expect(
              decision.options
                .filter((option) => option.targets.length === 1)
                .map((option) => option.targets[0]?.oid),
              trace.at(-1),
            ).toEqual([questingBeastOid]);
            await expect(session.submit('entity-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            proliferateInventedRejected = true;
            const stale = session;
            const advanced = await session.submit(exact!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit(exact!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            proliferateStaleRejected = true;
            proliferateTargetSelected = true;
            proliferateCommitted = true;
            continue;
          } else {
            move = decision.options.find((option) => option.id === 'entity-selection-done')?.id;
            proliferateCommitted = move !== undefined;
          }
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Swamp');
            const castGutterbones = decision.options.find((option) => option.text.startsWith('Gutterbones:'));
            const castYawgmoth = decision.options.find((option) =>
              option.text.startsWith('Yawgmoth, Thran Physician:'),
            );
            const activateCounter = decision.options.find((option) =>
              option.text.includes('Put a -1/-1 counter on up to one target creature'),
            );
            const activateProliferate = decision.options.find((option) =>
              option.text.includes('{B}{B}, Discard a card: Proliferate.'),
            );
            const untappedSwamps = pilot.battlefield.filter(
              (card) => card.name === 'Swamp' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (!gutterbonesCast && gutterbones === undefined && untappedSwamps >= 1
                ? castGutterbones?.id
                : undefined) ??
              (!yawgmothCast && yawgmoth === undefined && untappedSwamps >= 4
                ? castYawgmoth?.id
                : undefined) ??
              (!counterAbilityActivated &&
              yawgmoth !== undefined &&
              gutterbones !== undefined &&
              questingBeast !== undefined
                ? activateCounter?.id
                : undefined) ??
              (firstResolved && !proliferateActivated && untappedSwamps >= 2
                ? activateProliferate?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            gutterbonesCast ||= move === castGutterbones?.id;
            yawgmothCast ||= move === castYawgmoth?.id;
            if (move === activateCounter?.id) {
              counterAbilityActivated = true;
              lifeBeforeCounter = pilot.life;
              handBeforeCounter = pilot.handSize;
              libraryBeforeCounter = pilot.librarySize;
            }
            proliferateActivated ||= move === activateProliferate?.id;
          } else {
            const land = decision.options.find((option) => option.text === 'Play Forest');
            const castQuestingBeast = decision.options.find((option) =>
              option.text.startsWith('Questing Beast:'),
            );
            const untappedForests = opponent.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            move =
              land?.id ??
              (!questingBeastCast && questingBeast === undefined && untappedForests >= 4
                ? castQuestingBeast?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            questingBeastCast ||= move === castQuestingBeast?.id;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Yawgmoth move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const questingBeast = opponent.battlefield.find((card) => card.oid === questingBeastOid);
      const evidence = `${trace.slice(-350).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(gutterbonesCast, evidence).toBe(true);
      expect(yawgmothCast, evidence).toBe(true);
      expect(questingBeastCast, evidence).toBe(true);
      expect(counterAbilityActivated, evidence).toBe(true);
      expect(targetSelected, evidence).toBe(true);
      expect(sacrificeSelected, evidence).toBe(true);
      expect(sacrificeInventedRejected, evidence).toBe(true);
      expect(sacrificeStaleRejected, evidence).toBe(true);
      expect(firstResolved, evidence).toBe(true);
      expect(proliferateActivated, evidence).toBe(true);
      expect(discardSelected, evidence).toBe(true);
      expect(discardInventedRejected, evidence).toBe(true);
      expect(proliferateTargetSelected, evidence).toBe(true);
      expect(proliferateCommitted, evidence).toBe(true);
      expect(proliferateInventedRejected, evidence).toBe(true);
      expect(proliferateStaleRejected, evidence).toBe(true);
      expect(questingBeast, evidence).toBeDefined();
      expect(counterTotal(questingBeast!), evidence).toBe(2);
      expect(discardedOid, evidence).toBeDefined();
      expect(
        pilot.graveyard.some((card) => card.oid === discardedOid),
        evidence,
      ).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-350).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'routes Mindslaver decisions to its controller for the exact complete next turn in installed Forge',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let mindslaverCast = false;
    let mindslaverActivated = false;
    let targetSelected = false;
    let inventedTargetRejected = false;
    let staleTargetRejected = false;
    let activationCanceled = false;
    let cancellationRolledBack = false;
    let controlledTurn: number | undefined;
    let controlledLandPlayed = false;
    let forestsBeforeControlledPlay: number | undefined;
    let controlExpired = false;
    try {
      const spec = mindslaverTable();
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Mindslaver decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const active = session.view.turn.active;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} active=${String(active)} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        if (
          controlledTurn !== undefined &&
          controlledLandPlayed &&
          active === 0 &&
          session.view.turn.number > controlledTurn
        ) {
          expect(opponent.hand, trace.at(-1)).toBeNull();
          expect(opponent.battlefield.filter((card) => card.name === 'Forest').length, trace.at(-1)).toBe(
            forestsBeforeControlledPlay! + 1,
          );
          controlExpired = true;
          break;
        }

        let move: string | undefined;
        if (decision.kind === 'target-selection' && mindslaverActivated) {
          const exact = decision.options.find((option) => option.id === 'target-player-1');
          expect(exact, trace.at(-1)).toBeDefined();
          if (!inventedTargetRejected) {
            await expect(session.submit('target-player-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTargetRejected = true;
          }
          const stale = staleTargetRejected ? undefined : session;
          const advanced = await session.submit(exact!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          if (stale !== undefined) {
            await expect(stale.submit(exact!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleTargetRejected = true;
          }
          targetSelected = true;
          continue;
        }

        if (
          decision.kind === 'mana-payment' &&
          mindslaverActivated &&
          targetSelected &&
          !activationCanceled
        ) {
          const source = pilot.battlefield.find((card) => card.name === 'Mindslaver');
          expect(source, trace.at(-1)).toBeDefined();
          const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
          expect(cancel, trace.at(-1)).toBeDefined();
          const advanced = await session.submit(cancel!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          const restored = session.view.seats[0].battlefield.find((card) => card.oid === source!.oid);
          cancellationRolledBack = restored !== undefined && !restored.tapped;
          activationCanceled = true;
          mindslaverActivated = false;
          targetSelected = false;
          continue;
        }

        if (targetSelected && active === 1) {
          controlledTurn ??= session.view.turn.number;
          expect(session.view.turn.number, trace.at(-1)).toBe(controlledTurn);
          expect(decision.seat, trace.at(-1)).toBe(0);
          expect(opponent.hand, trace.at(-1)).not.toBeNull();
          const land = decision.options.find((option) => option.text === 'Play Forest');
          if (!controlledLandPlayed && land !== undefined) {
            forestsBeforeControlledPlay = opponent.battlefield.filter(
              (card) => card.name === 'Forest',
            ).length;
            move = land.id;
            controlledLandPlayed = true;
          }
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const land = decision.options.find((option) => option.text === 'Play Plains');
          const cast = decision.options.find((option) => option.text.startsWith('Mindslaver:'));
          const activate = decision.options.find((option) =>
            option.text.includes("You control target player during that player's next turn."),
          );
          const untappedPlains = pilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          move =
            land?.id ??
            (!mindslaverCast && untappedPlains >= 6 ? cast?.id : undefined) ??
            (!mindslaverActivated && untappedPlains >= 4 ? activate?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          mindslaverCast ||= move === cast?.id;
          mindslaverActivated ||= move === activate?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Mindslaver move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const pilot = session.view.seats[0];
      const evidence = `${trace.slice(-400).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(mindslaverCast, evidence).toBe(true);
      expect(mindslaverActivated, evidence).toBe(true);
      expect(targetSelected, evidence).toBe(true);
      expect(inventedTargetRejected, evidence).toBe(true);
      expect(staleTargetRejected, evidence).toBe(true);
      expect(activationCanceled, evidence).toBe(true);
      expect(cancellationRolledBack, evidence).toBe(true);
      expect(controlledTurn, evidence).toBeDefined();
      expect(controlledLandPlayed, evidence).toBe(true);
      expect(controlExpired, evidence).toBe(true);
      expect(
        pilot.graveyard.some((card) => card.name === 'Mindslaver'),
        evidence,
      ).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-400).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

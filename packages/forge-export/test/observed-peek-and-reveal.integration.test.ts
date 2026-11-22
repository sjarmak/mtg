/** Installed-Forge outcomes for the exact Delver and Velomachus PeekAndReveal cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
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

forgeIt(
  'Delver declines one exact top card, reveals an instant later, and attacks as the 3/2 flying face',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Delver pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-delver-peek-and-reveal',
            cards: [
              { name: 'Island', count: 24 },
              { name: 'Delver of Secrets', count: 18 },
              { name: 'Opt', count: 18 },
            ],
          },
        },
        {
          name: 'Ground opponent',
          controller: 'local',
          deck: {
            name: 'z5q4-delver-ground-opponent',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Mother of Runes', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-delver-decline-reveal-transform',
      maximumTurns: 18,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let delverOid: string | undefined;
    let declined = false;
    let declinePreservedLibrary = false;
    let acceptedTopOid: string | undefined;
    let acceptedBeforeHand: ReadonlySet<string> | undefined;
    let inventedRejected = false;
    let staleRejected = false;
    let transformed = false;
    let attacked = false;
    let flewOverGroundCreature = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Delver decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        delverOid ??= pilot.battlefield.find((card) => card.name === 'Delver of Secrets')?.oid;
        const delver = pilot.battlefield.find((card) => card.oid === delverOid);
        transformed ||=
          delver?.name === 'Insectile Aberration' && delver.power === 3 && delver.toughness === 2;
        if (acceptedBeforeHand !== undefined && acceptedTopOid === undefined) {
          acceptedTopOid = pilot.hand?.find(
            (card) => !acceptedBeforeHand!.has(card.oid) && card.name === 'Opt',
          )?.oid;
        }
        flewOverGroundCreature ||=
          attacked &&
          opponent.life === 17 &&
          opponent.battlefield.some((card) => card.name === 'Mother of Runes');
        const complete = transformed && flewOverGroundCreature;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ` +
            `${decision.kind}: ${decision.prompt} || ${decision.options
              .map((option) => `${option.id}=${option.text}`)
              .join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'confirm-optional-reveal' && decision.seat === 0) {
          expect(
            decision.options.map((option) => option.id),
            trace.at(-1),
          ).toEqual(['confirm-optional-reveal-yes', 'confirm-optional-reveal-no']);
          expect(
            decision.options.every(
              (option) =>
                option.targets.length === 1 &&
                option.targets[0]?.oid === delverOid &&
                option.targets[0]?.name === 'Delver of Secrets',
            ),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('confirm-optional-reveal-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declined) {
            const before = pilot.librarySize;
            const advanced = await session.submit('confirm-optional-reveal-no');
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            declined = true;
            declinePreservedLibrary =
              session.view.seats[0].librarySize === before &&
              session.view.seats[0].battlefield.some(
                (card) => card.oid === delverOid && card.name === 'Delver of Secrets',
              );
            continue;
          }
          {
            const stale = session;
            const advanced = await session.submit('confirm-optional-reveal-yes');
            if (!advanced.ok) throw new Error(advanced.error.message);
            const transformedNow = advanced.session.view.seats[0].battlefield.some(
              (card) =>
                card.oid === delverOid &&
                card.name === 'Insectile Aberration' &&
                card.power === 3 &&
                card.toughness === 2,
            );
            if (transformedNow) {
              acceptedBeforeHand = new Set(pilot.hand?.map((card) => card.oid) ?? []);
            }
            session = advanced.session;
            await expect(stale.submit('confirm-optional-reveal-yes')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
        } else if (decision.kind === 'combat-attackers' && decision.seat === 0 && transformed) {
          const attack = decision.options.find((option) => option.targets[0]?.oid === delverOid);
          move = attacked ? routineMove(decision) : attack?.id;
          attacked ||= move === attack?.id;
        } else if (decision.kind === 'combat-blockers' && decision.seat === 1 && attacked) {
          expect(
            decision.options.every((option) => option.targets[0]?.name !== 'Mother of Runes'),
            trace.at(-1),
          ).toBe(true);
          move = routineMove(decision);
        } else if (decision.kind === 'priority') {
          const ownLand = decision.seat === 0 ? 'Island' : 'Plains';
          const battlefield = seatViewOf(session.view, decision.seat).battlefield;
          const untapped = battlefield.filter((card) => card.name === ownLand && !card.tapped).length;
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === `Play ${ownLand}`)?.id ??
            (decision.seat === 0 && delverOid === undefined && untapped >= 1
              ? decision.options.find((option) => option.text.startsWith('Delver of Secrets:'))?.id
              : undefined) ??
            (decision.seat === 1 &&
            !opponent.battlefield.some((card) => card.name === 'Mother of Runes') &&
            untapped >= 1
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error(`Forge offered no Delver move for ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(declined, evidence).toBe(true);
      expect(declinePreservedLibrary, evidence).toBe(true);
      expect(acceptedTopOid, evidence).toMatch(/^forge-card-/u);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(transformed, evidence).toBe(true);
      expect(flewOverGroundCreature, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-220).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt(
  'Velomachus declines and later casts the exact eligible top-seven spell for free, bottoming the rest',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Velomachus pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-velomachus-peek-and-reveal',
            cards: [
              { name: 'Plateau', count: 30 },
              { name: 'Velomachus Lorehold', count: 15 },
              { name: 'Lightning Bolt', count: 15 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-plains', cards: [{ name: 'Plains', count: 60 }] },
        },
      ],
      seed: 'z5q4-velomachus-decline-then-free-bolt',
      maximumTurns: 26,
    };
    const backend = installedForgeBackend({ timeoutMs: 240_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let velomachusOid: string | undefined;
    let attacks = 0;
    let declined = false;
    let declineLibrarySize: number | undefined;
    let selectedBoltOid: string | undefined;
    let acceptedLibrarySize: number | undefined;
    let opponentLifeBeforeBolt: number | undefined;
    let inventedRejected = false;
    let staleRejected = false;
    let manaAskedForFreeSpell = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Velomachus decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        velomachusOid ??= pilot.battlefield.find((card) => card.name === 'Velomachus Lorehold')?.oid;
        const boltResolved =
          selectedBoltOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === selectedBoltOid) &&
          opponentLifeBeforeBolt !== undefined &&
          opponent.life === opponentLifeBeforeBolt - 3;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ` +
            `lib=${String(pilot.librarySize)} life=${String(opponent.life)} ${decision.kind}: ` +
            `${decision.prompt} || ${decision.options
              .map((option) => `${option.id}=${option.text}`)
              .join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'entity-selection' && decision.seat === 0) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThan(0);
          expect(
            candidates.every((option) => option.targets[0]?.name === 'Lightning Bolt'),
            trace.at(-1),
          ).toBe(true);
          const done = decision.options.find((option) => option.id.endsWith('-done'));
          expect(done, trace.at(-1)).toBeDefined();
          if (!inventedRejected) {
            await expect(session.submit('entity-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declined) {
            const before = pilot.librarySize;
            const advanced = await session.submit(done!.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            declined = true;
            declineLibrarySize = session.view.seats[0].librarySize;
            expect(declineLibrarySize, trace.at(-1)).toBe(before);
            continue;
          }
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge omitted Velomachus eligible spells');
          selectedBoltOid = selected.targets[0]?.oid;
          acceptedLibrarySize = pilot.librarySize;
          opponentLifeBeforeBolt = opponent.life;
          const stale = session;
          const advanced = await session.submit(selected.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(selected.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          continue;
        }
        if (decision.kind === 'target-selection' && selectedBoltOid !== undefined) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'mana-payment' && selectedBoltOid !== undefined) {
          manaAskedForFreeSpell = true;
          move = routineMove(decision);
        } else if (
          decision.kind === 'combat-attackers' &&
          decision.seat === 0 &&
          velomachusOid !== undefined
        ) {
          const remove = decision.options.find((option) => option.id.startsWith('combat-attack-remove-'));
          const attack = decision.options.find((option) => option.targets[0]?.oid === velomachusOid);
          move = remove === undefined ? attack?.id : routineMove(decision);
          if (remove === undefined && attack !== undefined) attacks += 1;
        } else if (decision.kind === 'priority') {
          const plateaus = pilot.battlefield.filter((card) => card.name === 'Plateau');
          const untappedPlateaus = plateaus.filter((card) => !card.tapped).length;
          move =
            (boltResolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plateau')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && velomachusOid === undefined && untappedPlateaus >= 7
              ? decision.options.find((option) => option.text.startsWith('Velomachus Lorehold:'))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error(`Forge offered no Velomachus move for ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const pilot = session.view.seats[0];
      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(attacks, evidence).toBeGreaterThanOrEqual(2);
      expect(declined, evidence).toBe(true);
      expect(declineLibrarySize, evidence).toBeDefined();
      expect(selectedBoltOid, evidence).toMatch(/^forge-card-/u);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(manaAskedForFreeSpell, evidence).toBe(false);
      expect(
        pilot.graveyard.some((card) => card.oid === selectedBoltOid),
        evidence,
      ).toBe(true);
      expect(session.view.seats[1].life, evidence).toBe((opponentLifeBeforeBolt ?? 0) - 3);
      expect(pilot.librarySize, evidence).toBe((acceptedLibrarySize ?? 0) - 1);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-260).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

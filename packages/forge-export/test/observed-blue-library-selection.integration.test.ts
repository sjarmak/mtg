/** Installed-Forge outcomes for the exact Augur, Search, and Narset admission cohort. */
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

forgeIt(
  'Augur chooses an exact eligible top-three card and bottoms every remainder',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Augur pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-augur-library-selection',
            cards: [
              { name: 'Island', count: 24 },
              { name: 'Augur of Bolas', count: 18 },
              { name: 'Opt', count: 18 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-augur-top-three-outcome',
      maximumTurns: 12,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let choiceSeen = false;
    let inventedRejected = false;
    let staleRejected = false;
    let selectedOid: string | undefined;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 700; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Augur decision');
        const pilot = session.view.seats[0];
        const untappedIslands = pilot.battlefield.filter(
          (card) => card.name === 'Island' && !card.tapped,
        ).length;
        const complete =
          choiceSeen &&
          selectedOid !== undefined &&
          pilot.hand?.some((card) => card.oid === selectedOid) === true &&
          pilot.battlefield.some((card) => card.name === 'Augur of Bolas');
        cast ||= pilot.battlefield.some((card) => card.name === 'Augur of Bolas');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'entity-selection' && decision.seat === 0) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThan(0);
          expect(
            candidates.every((option) => option.targets[0]?.name === 'Opt'),
            trace.at(-1),
          ).toBe(true);
          expect(
            decision.options.some((option) => option.id.endsWith('-done')),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('entity-selection-forge-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge omitted Augur eligible cards');
          selectedOid = selected.targets[0]?.oid;
          const stale = session;
          const advanced = await session.submit(selected.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(selected.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          choiceSeen = true;
          continue;
        }
        if (decision.kind === 'zone-order') {
          move = decision.options[0]?.id;
        } else if (decision.kind === 'priority') {
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && !cast && untappedIslands >= 2
              ? decision.options.find((option) => option.text.startsWith('Augur of Bolas:'))?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Augur move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-200).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(choiceSeen, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].hand?.some((card) => card.oid === selectedOid),
        evidence,
      ).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-200).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

forgeIt(
  'Search surveils to the exact threshold, honors decline and accept, then resolves the land-face dig',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Search pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-search-library-selection',
            cards: [
              { name: 'Island', count: 24 },
              { name: 'Search for Azcanta', count: 18 },
              { name: 'Opt', count: 18 },
            ],
          },
        },
        {
          name: 'Passive opponent',
          controller: 'local',
          deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
        },
      ],
      seed: 'z5q4-search-threshold-and-land-face',
      maximumTurns: 28,
    };
    const backend = installedForgeBackend({ timeoutMs: 240_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let searchOid: string | undefined;
    let transformed = false;
    let declinedAtThreshold = false;
    let acceptedAfterDecline = false;
    let inventedRejected = false;
    let staleRejected = false;
    let digStarted = false;
    let digChoiceOid: string | undefined;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Search decision');
        const pilot = session.view.seats[0];
        searchOid ??= pilot.battlefield.find((card) => card.name === 'Search for Azcanta')?.oid;
        transformed ||=
          searchOid !== undefined &&
          pilot.battlefield.some(
            (card) => card.oid === searchOid && card.name === 'Azcanta, the Sunken Ruin',
          );
        const selectedInHand =
          digChoiceOid !== undefined && pilot.hand?.some((card) => card.oid === digChoiceOid) === true;
        const complete = transformed && digStarted && selectedInHand;
        const untappedIslands = pilot.battlefield.filter(
          (card) => card.name === 'Island' && !card.tapped,
        ).length;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} grave=${String(pilot.graveyard.length)} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'surveil-move' && decision.seat === 0) {
          const pick = decision.options.find((option) => option.id !== 'surveil-move-done');
          expect(pick?.targets).toHaveLength(1);
          move = pick?.id;
        } else if (decision.kind === 'confirm-action' && decision.seat === 0) {
          expect(pilot.graveyard.length, trace.at(-1)).toBeGreaterThanOrEqual(7);
          expect(
            decision.options.map((option) => option.id),
            trace.at(-1),
          ).toEqual(['confirm-action-yes', 'confirm-action-no']);
          expect(
            decision.options.every((option) => option.targets[0]?.oid === searchOid),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('confirm-action-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declinedAtThreshold) {
            move = 'confirm-action-no';
            declinedAtThreshold = true;
          } else {
            const stale = session;
            const advanced = await session.submit('confirm-action-yes');
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit('confirm-action-yes')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            acceptedAfterDecline = true;
            continue;
          }
        } else if (decision.kind === 'entity-selection' && transformed && decision.seat === 0) {
          digStarted = true;
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThan(0);
          expect(
            candidates.every((option) =>
              ['Opt', 'Search for Azcanta'].includes(option.targets[0]?.name ?? ''),
            ),
            trace.at(-1),
          ).toBe(true);
          expect(
            candidates.some((option) => option.targets[0]?.name === 'Island'),
            trace.at(-1),
          ).toBe(false);
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge omitted Azcanta eligible cards');
          digChoiceOid = selected.targets[0]?.oid;
          move = selected.id;
        } else if (decision.kind === 'zone-order') {
          move = decision.options[0]?.id;
        } else if (decision.kind === 'priority') {
          const dig = decision.options.find(
            (option) =>
              option.text.startsWith('Azcanta, the Sunken Ruin:') && option.text.includes('top four'),
          );
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && searchOid === undefined && untappedIslands >= 2
              ? decision.options.find((option) => option.text.startsWith('Search for Azcanta:'))?.id
              : undefined) ??
            (decision.seat === 0 &&
            transformed &&
            !digStarted &&
            untappedIslands >= 3 &&
            (session.view.turn.step === 'MAIN1' || session.view.turn.step === 'MAIN2')
              ? dig?.id
              : undefined) ??
            routineMove(decision);
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Search move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(searchOid, evidence).toMatch(/^forge-card-/u);
      expect(declinedAtThreshold, evidence).toBe(true);
      expect(acceptedAfterDecline, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(transformed, evidence).toBe(true);
      expect(digStarted, evidence).toBe(true);
      expect(digChoiceOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].hand?.some((card) => card.oid === digChoiceOid),
        evidence,
      ).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-240).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Narset pays two loyalty, chooses only an exact noncreature nonland card, and stops the next draw',
  async () => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Narset pilot',
          controller: 'local',
          deck: {
            name: 'z5q4-narset-library-selection',
            cards: [
              { name: 'Island', count: 24 },
              { name: 'Narset, Parter of Veils', count: 18 },
              { name: 'Opt', count: 18 },
            ],
          },
        },
        {
          name: 'Draw-limit opponent',
          controller: 'local',
          deck: {
            name: 'z5q4-narset-draw-limit-opponent',
            cards: [
              { name: 'Island', count: 30 },
              { name: 'Opt', count: 30 },
            ],
          },
        },
      ],
      seed: 'z5q4-narset-loyalty-selection-and-draw-limit',
      maximumTurns: 14,
    };
    const backend = installedForgeBackend({ timeoutMs: 240_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let narsetOid: string | undefined;
    let loyaltyBefore: number | undefined;
    let selectionSeen = false;
    let selectedOid: string | undefined;
    let opponentOptAnnounced = false;
    let opponentScrySeen = false;
    let opponentLibraryBeforeOpt: number | undefined;
    let opponentDrawStopped = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Narset decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const narset = pilot.battlefield.find((card) => card.name === 'Narset, Parter of Veils');
        narsetOid ??= narset?.oid;
        const selectedInHand =
          selectedOid !== undefined && pilot.hand?.some((card) => card.oid === selectedOid) === true;
        if (
          opponentOptAnnounced &&
          opponentScrySeen &&
          opponentLibraryBeforeOpt !== undefined &&
          session.view.stack.length === 0
        ) {
          opponentDrawStopped ||= opponent.librarySize === opponentLibraryBeforeOpt;
        }
        const complete = selectionSeen && selectedInHand && opponentDrawStopped;
        const pilotUntapped = pilot.battlefield.filter(
          (card) => card.name === 'Island' && !card.tapped,
        ).length;
        const opponentUntapped = opponent.battlefield.filter(
          (card) => card.name === 'Island' && !card.tapped,
        ).length;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'entity-selection' && decision.seat === 0 && narsetOid !== undefined) {
          loyaltyBefore ??= narset?.counters['LOYALTY'];
          expect(loyaltyBefore, trace.at(-1)).toBe(3);
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThan(0);
          expect(
            candidates.every((option) =>
              ['Opt', 'Narset, Parter of Veils'].includes(option.targets[0]?.name ?? ''),
            ),
            trace.at(-1),
          ).toBe(true);
          expect(
            candidates.some((option) => option.targets[0]?.name === 'Island'),
            trace.at(-1),
          ).toBe(false);
          const selected = candidates[0];
          if (selected === undefined) throw new Error('Forge omitted Narset eligible cards');
          selectedOid = selected.targets[0]?.oid;
          selectionSeen = true;
          move = selected.id;
        } else if (decision.kind === 'scry-move' && decision.seat === 1 && opponentOptAnnounced) {
          opponentScrySeen = true;
          move = decision.options.find((option) => option.id === 'scry-move-done')?.id;
        } else if (decision.kind === 'scry-keep' && decision.seat === 1 && opponentOptAnnounced) {
          opponentScrySeen = true;
          move = decision.options[0]?.id;
        } else if (decision.kind === 'priority') {
          const narsetDig = decision.options.find(
            (option) =>
              option.text.startsWith('Narset, Parter of Veils:') && option.text.includes('top four'),
          );
          const opponentOpt = decision.options.find((option) => option.text.startsWith('Opt:'));
          move =
            (complete ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Island')?.id) ??
            (decision.seat === 0 && narsetOid === undefined && pilotUntapped >= 3
              ? decision.options.find((option) => option.text.startsWith('Narset, Parter of Veils:'))?.id
              : undefined) ??
            (decision.seat === 0 && narsetOid !== undefined && !selectionSeen ? narsetDig?.id : undefined) ??
            (decision.seat === 1 &&
            selectionSeen &&
            !opponentOptAnnounced &&
            opponentUntapped >= 1 &&
            session.view.turn.active === 1 &&
            session.view.turn.step === 'MAIN1'
              ? opponentOpt?.id
              : undefined) ??
            routineMove(decision);
          if (move !== undefined && move === opponentOpt?.id) {
            opponentLibraryBeforeOpt = opponent.librarySize;
            opponentOptAnnounced = true;
          }
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Narset move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const narset = session.view.seats[0].battlefield.find((card) => card.oid === narsetOid);
      expect(narsetOid, evidence).toMatch(/^forge-card-/u);
      expect(selectionSeen, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(narset?.counters['LOYALTY'], evidence).toBe(3);
      expect(opponentOptAnnounced, evidence).toBe(true);
      expect(opponentScrySeen, evidence).toBe(true);
      expect(opponentDrawStopped, evidence).toBe(true);
      expect(session.view.seats[1].librarySize, evidence).toBe(opponentLibraryBeforeOpt);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-240).join('\n')}`, { cause });
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

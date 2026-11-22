/** Installed-Forge outcomes for Blessed Alliance's exact Escalate modal route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(modeCount: 1 | 2): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Blessed Alliance ${String(modeCount)}-mode pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-blessed-alliance-${String(modeCount)}-mode`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Blessed Alliance', count: 30 },
          ],
        },
      },
      {
        name: 'Blessed Alliance passive opponent',
        controller: 'local',
        deck: { name: 'z5q4-blessed-alliance-passive', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-blessed-alliance-${String(modeCount)}-mode-outcome`,
    maximumTurns: 20,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function traceDecision(session: ObservedSession): string {
  const decision = session.decision;
  if (decision === null) return 'no decision';
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

for (const modeCount of [1, 2] as const) {
  forgeIt(
    `charges exact mana and gains four life with ${String(modeCount)} distinct mode${modeCount === 1 ? '' : 's'}`,
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      const trace: string[] = [];
      let cast = false;
      let resolved = false;
      let modePicks = 0;
      const pickedModePhrases = new Set<string>();
      let manaPayments = 0;
      let lifeBefore = -1;
      let inventedModeRejected = false;
      let staleModeRejected = false;
      let inventedTargetRejected = false;
      try {
        const spec = table(modeCount);
        expect(await backend.supports(spec)).toEqual([]);
        const opened = await backend.open(spec);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;

        for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no Blessed Alliance decision');
          const pilot = session.view.seats[0]!;
          resolved =
            cast &&
            pilot.graveyard.some((card) => card.name === 'Blessed Alliance') &&
            session.view.stack.length === 0 &&
            pilot.life === lifeBefore + 4;
          trace.push(traceDecision(session));

          let move: string | undefined;
          if (decision.kind === 'mode-selection' && cast) {
            expect(
              decision.options.every((option) =>
                [...pickedModePhrases].every((phrase) => !option.text.includes(phrase)),
              ),
              trace.at(-1),
            ).toBe(true);
            if (!inventedModeRejected) {
              await expect(session.submit('mode-selection-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedModeRejected = true;
            }
            if (modePicks < modeCount) {
              const desired =
                modePicks === 0
                  ? decision.options.find((option) => option.text.includes('gains 4 life'))
                  : decision.options.find((option) => option.text.includes('Untap up to two'));
              expect(desired, trace.at(-1)).toBeDefined();
              pickedModePhrases.add(modePicks === 0 ? 'gains 4 life' : 'Untap up to two');
              const stale = session;
              const advanced = await session.submit(desired!.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              modePicks += 1;
              if (!staleModeRejected) {
                await expect(stale.submit(desired!.id)).resolves.toMatchObject({
                  ok: false,
                  error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
                });
                staleModeRejected = true;
              }
              continue;
            }
            move = decision.options.find((option) => option.id === 'mode-selection-done')?.id;
          } else if (
            (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') &&
            cast
          ) {
            if (!inventedTargetRejected) {
              await expect(session.submit('target-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedTargetRejected = true;
            }
            move = decision.prompt.includes('Untap up to two')
              ? decision.options.find((option) => option.id === 'blessed-alliance-targets-done')?.id
              : decision.options.find((option) => option.id === 'target-player-0')?.id;
          } else if (decision.kind === 'mana-payment' && cast) {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
            if (move !== undefined) manaPayments += 1;
          } else if (decision.kind === 'priority') {
            const untappedPlains = pilot.battlefield.filter(
              (card) => card.name === 'Plains' && !card.tapped,
            ).length;
            const alliance = decision.options.find((option) => option.text.startsWith('Blessed Alliance:'));
            move =
              (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              (decision.seat === 0
                ? decision.options.find((option) => option.text === 'Play Plains')?.id
                : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
              (decision.seat === 0 && !cast && untappedPlains >= modeCount * 2 ? alliance?.id : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            if (move === alliance?.id) {
              cast = true;
              lifeBefore = pilot.life;
            }
          } else {
            move = routineMove(decision);
          }

          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no Blessed Alliance move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-30).join('\n')}`);
          session = advanced.session;
        }

        const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(cast, evidence).toBe(true);
        expect(modePicks, evidence).toBe(modeCount);
        expect(manaPayments, evidence).toBe(modeCount * 2);
        expect(inventedModeRejected, evidence).toBe(true);
        expect(staleModeRejected, evidence).toBe(true);
        expect(inventedTargetRejected, evidence).toBe(true);
        expect(resolved, evidence).toBe(true);
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
}

const THREE_MODE_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Blessed Alliance three-mode pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-blessed-alliance-three-mode',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Usher of the Fallen', count: 15 },
          { name: 'Blessed Alliance', count: 15 },
        ],
      },
    },
    {
      name: 'Blessed Alliance attacking opponent',
      controller: 'local',
      deck: {
        name: 'z5q4-blessed-alliance-attacker',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Goblin Guide', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-blessed-alliance-three-mode-outcome',
  maximumTurns: 24,
};

forgeIt(
  'charges six mana, gains life, untaps the exact target, and makes the opponent sacrifice its attacker',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    const selectedAttackers = new Map<number, Set<string>>([
      [0, new Set<string>()],
      [1, new Set<string>()],
    ]);
    let pilotAttacked = false;
    let opponentAttacked = false;
    let cast = false;
    let modePicks = 0;
    const pickedModePhrases = new Set<string>();
    let manaPayments = 0;
    let lifeBefore = -1;
    let usherOid: string | undefined;
    let committedAttackingGuideOid: string | undefined;
    let attackingGuideOid: string | undefined;
    let untapTargeted = false;
    let sacrificeChosen = false;
    let inventedSacrificeRejected = false;
    let staleSacrificeRejected = false;
    let outcome = false;
    try {
      expect(await backend.supports(THREE_MODE_TABLE)).toEqual([]);
      const opened = await backend.open(THREE_MODE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 2_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no three-mode Blessed Alliance decision');
        const pilot = session.view.seats[0]!;
        const opponent = session.view.seats[1]!;
        const usher = pilot.battlefield.find((card) => card.name === 'Usher of the Fallen');
        usherOid ??= usher?.oid;
        outcome =
          cast &&
          lifeBefore >= 0 &&
          pilot.life === lifeBefore + 4 &&
          usherOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === usherOid && !card.tapped) &&
          attackingGuideOid !== undefined &&
          opponent.graveyard.some((card) => card.oid === attackingGuideOid) &&
          !opponent.battlefield.some((card) => card.oid === attackingGuideOid) &&
          session.view.stack.length === 0;
        trace.push(traceDecision(session));

        let move: string | undefined;
        if (decision.kind === 'mode-selection' && cast) {
          expect(
            decision.options.every((option) =>
              [...pickedModePhrases].every((picked) => !option.text.includes(picked)),
            ),
            trace.at(-1),
          ).toBe(true);
          const phrase =
            modePicks === 0
              ? 'gains 4 life'
              : modePicks === 1
                ? 'Untap up to two'
                : 'sacrifices an attacking creature';
          const selected = decision.options.find((option) => option.text.includes(phrase));
          expect(selected, trace.at(-1)).toBeDefined();
          pickedModePhrases.add(phrase);
          move = selected?.id;
          modePicks += 1;
        } else if (
          (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') &&
          cast
        ) {
          if (decision.prompt.includes('gain 4 life')) {
            move = decision.options.find((option) => option.id === 'target-player-0')?.id;
          } else if (decision.prompt.includes('Untap up to two')) {
            if (!untapTargeted) {
              const target = decision.options.find((option) => option.targets[0]?.oid === usherOid);
              expect(target, trace.at(-1)).toBeDefined();
              move = target?.id;
              untapTargeted = true;
            } else {
              move = decision.options.find((option) => option.id === 'blessed-alliance-targets-done')?.id;
            }
          } else if (decision.prompt.includes('sacrifice an attacking creature')) {
            expect(decision.seat, trace.at(-1)).toBe(0);
            expect(
              new Set(
                decision.options
                  .filter((option) => option.id.startsWith('target-player-'))
                  .map((option) => option.id),
              ),
              trace.at(-1),
            ).toEqual(new Set(['target-player-1']));
            move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          }
        } else if (decision.kind === 'sacrifice-selection' && cast) {
          expect(decision.seat, trace.at(-1)).toBe(1);
          const offered = decision.options.filter((option) => option.targets.length === 1);
          expect(new Set(offered.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
            new Set([committedAttackingGuideOid]),
          );
          if (!inventedSacrificeRejected) {
            await expect(session.submit('sacrifice-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedSacrificeRejected = true;
          }
          const selected = offered[0];
          expect(selected, trace.at(-1)).toBeDefined();
          attackingGuideOid = selected?.targets[0]?.oid;
          const stale = session;
          const advanced = await session.submit(selected!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          sacrificeChosen = true;
          if (!staleSacrificeRejected) {
            await expect(stale.submit(selected!.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleSacrificeRejected = true;
          }
          continue;
        } else if (decision.kind === 'mana-payment' && cast) {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          if (move !== undefined) manaPayments += 1;
        } else if (decision.kind === 'combat-attackers') {
          const selected = selectedAttackers.get(decision.seat)!;
          const readyForPilotAttack =
            decision.seat === 0 &&
            !pilotAttacked &&
            usher !== undefined &&
            pilot.battlefield.filter((card) => card.name === 'Plains').length >= 6 &&
            pilot.hand?.some((card) => card.name === 'Blessed Alliance') === true;
          const readyForOpponentAttack = decision.seat === 1 && pilotAttacked && !opponentAttacked;
          const shouldAttack = readyForPilotAttack || readyForOpponentAttack;
          const wantedName = decision.seat === 0 ? 'Usher of the Fallen' : 'Goblin Guide';
          const add = decision.options.find(
            (option) =>
              shouldAttack &&
              selected.size < 1 &&
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.name === wantedName &&
              !selected.has(option.targets[0].oid),
          );
          if (add?.targets[0]?.oid !== undefined) {
            selected.add(add.targets[0].oid);
            if (decision.seat === 1) committedAttackingGuideOid = add.targets[0].oid;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            if (shouldAttack && selected.size > 0) {
              if (decision.seat === 0) pilotAttacked = true;
              else opponentAttacked = true;
            }
            selected.clear();
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const plains = pilot.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
          const mountains = opponent.battlefield.filter(
            (card) => card.name === 'Mountain' && !card.tapped,
          ).length;
          const alliance = decision.options.find((option) => option.text.startsWith('Blessed Alliance:'));
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && usher === undefined && plains >= 1
              ? decision.options.find((option) => option.text.startsWith('Usher of the Fallen:'))?.id
              : undefined) ??
            (decision.seat === 1 && mountains >= 1 && !opponentAttacked
              ? decision.options.find((option) => option.text.startsWith('Goblin Guide:'))?.id
              : undefined) ??
            (decision.seat === 0 && opponentAttacked && !cast && plains >= 6 ? alliance?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === alliance?.id) {
            cast = true;
            lifeBefore = pilot.life;
          }
        } else {
          move = routineMove(decision);
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no three-mode Blessed Alliance move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(pilotAttacked, evidence).toBe(true);
      expect(opponentAttacked, evidence).toBe(true);
      expect(cast, evidence).toBe(true);
      expect(modePicks, evidence).toBe(3);
      expect(manaPayments, evidence).toBe(6);
      expect(untapTargeted, evidence).toBe(true);
      expect(sacrificeChosen, evidence).toBe(true);
      expect(inventedSacrificeRejected, evidence).toBe(true);
      expect(staleSacrificeRejected, evidence).toBe(true);
      expect(outcome, evidence).toBe(true);
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
  'cancels targeting and restores the exact hand, stack, mana, and battlefield state',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let castOid: string | undefined;
    let modeChosen = false;
    let canceled = false;
    let restored = false;
    try {
      const spec = table(1);
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let moves = 0; session.status === 'awaiting' && moves < 1_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Blessed Alliance cancellation decision');
        const pilot = session.view.seats[0]!;
        trace.push(traceDecision(session));

        let move: string | undefined;
        if (decision.kind === 'mode-selection' && castOid !== undefined) {
          move = decision.options.find((option) => option.text.includes('gains 4 life'))?.id;
          modeChosen = move !== undefined;
        } else if (
          (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') &&
          castOid !== undefined &&
          !canceled
        ) {
          modeChosen = true;
          const cancel = decision.options.find((option) => option.id === 'target-cancel');
          expect(cancel, trace.at(-1)).toBeDefined();
          const advanced = await session.submit(cancel!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          canceled = true;
          restored =
            session.view.stack.length === 0 &&
            session.view.seats[0]!.hand?.some((card) => card.oid === castOid) === true &&
            session.view.seats[0]!.battlefield.filter((card) => card.name === 'Plains').every(
              (card) => !card.tapped,
            ) &&
            session.view.seats[0]!.life === 20 &&
            session.view.seats[1]!.life === 20;
          continue;
        } else if (decision.kind === 'priority') {
          const untappedPlains = pilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const alliance = decision.options.find((option) => option.text.startsWith('Blessed Alliance:'));
          move =
            (restored ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && castOid === undefined && untappedPlains >= 2
              ? alliance?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (alliance !== undefined && move === alliance.id) {
            const id = /^ability-(\d+)-/u.exec(alliance.id)?.[1];
            if (id === undefined)
              throw new Error(`Cannot derive Blessed Alliance object from ${alliance.id}`);
            castOid = `forge-card-${id}`;
          }
        } else {
          move = routineMove(decision);
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Blessed Alliance cancellation move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-30).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castOid, evidence).toMatch(/^forge-card-/u);
      expect(modeChosen, evidence).toBe(true);
      expect(canceled, evidence).toBe(true);
      expect(restored, evidence).toBe(true);
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

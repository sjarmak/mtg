/** Installed-Forge outcomes for exact counterspell UnlessCost compositions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type FixedCounter = 'Mana Tithe' | 'Mana Leak' | 'Miscalculation' | 'Supreme Will';

function counterTable(counter: FixedCounter, seed: string): SessionSpec {
  const counterLand = counter === 'Mana Tithe' ? 'Plains' : 'Island';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Human',
        controller: 'local',
        deck: {
          name: `${seed}-human`,
          cards: [
            { name: 'Mountain', count: 36 },
            { name: 'Lightning Bolt', count: 24 },
          ],
        },
      },
      {
        name: 'Counter pilot',
        controller: 'local',
        deck: {
          name: `${seed}-ai`,
          cards: [
            { name: counterLand, count: 30 },
            { name: counter, count: 30 },
          ],
        },
      },
    ],
    seed,
    maximumTurns: 16,
  };
}

async function runFixedCounter(counter: FixedCounter, route: 'decline' | 'pay'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = counterTable(counter, `z5q4-${counter.toLowerCase().replaceAll(' ', '-')}-${route}`);
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let boltOid: string | undefined;
  let counterCast = false;
  let answered = false;
  let lifeBefore = -1;
  let outcome = false;
  try {
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no counter decision');
      const payer = session.view.seats[0];
      const counterPilot = session.view.seats[1];
      boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid;
      const boltInGrave = boltOid !== undefined && payer.graveyard.some((card) => card.oid === boltOid);
      if (answered && boltInGrave && session.view.stack.length === 0) {
        outcome = counterPilot.life === lifeBefore - (route === 'pay' ? 3 : 0);
      }
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = decision.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'mana-payment') {
        if (decision.prompt.startsWith(counter)) {
          move = decision.options.find((option) =>
            route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
          )?.id;
          answered = move !== undefined;
        } else {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.id === 'target-player-1' : option.targets[0]?.oid === boltOid,
        )?.id;
      } else if (decision.kind === 'mode-selection') {
        move = decision.options.find((option) => option.text.includes('Counter target spell'))?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const needed = counter === 'Mana Tithe' ? (route === 'pay' ? 2 : 1) : route === 'pay' ? 4 : 1;
        const payerUntapped = payer.battlefield.filter(
          (card) => card.name === 'Mountain' && !card.tapped,
        ).length;
        const counterLand = counter === 'Mana Tithe' ? 'Plains' : 'Island';
        const counterCastingCost =
          counter === 'Mana Tithe' ? 1 : counter === 'Mana Leak' || counter === 'Miscalculation' ? 2 : 3;
        const counterUntapped = counterPilot.battlefield.filter(
          (card) => card.name === counterLand && !card.tapped,
        ).length;
        const castBolt =
          decision.seat === 0 &&
          boltOid === undefined &&
          payerUntapped >= needed &&
          counterUntapped >= counterCastingCost
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castCounter =
          decision.seat === 1 &&
          !counterCast &&
          boltOid !== undefined &&
          session.view.stack.some((card) => card.oid === boltOid) &&
          !session.view.stack.some((card) => card.name === counter)
            ? decision.options.find((option) => option.text.startsWith(`${counter}:`))
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : decision.options.find((option) => option.text === `Play ${counterLand}`)?.id) ??
          castCounter?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (castBolt !== undefined && move === castBolt.id) {
          lifeBefore = counterPilot.life;
        }
        if (castCounter !== undefined && move === castCounter.id) {
          counterCast = true;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no counter move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(boltOid, evidence).toMatch(/^forge-card-/u);
    expect(answered, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

function pactTable(route: 'decline' | 'pay'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Pact pilot',
        controller: 'local',
        deck: {
          name: `z5q4-pact-${route}`,
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Pact of Negation', count: 30 },
          ],
        },
      },
      {
        name: 'Spell pilot',
        controller: 'local',
        deck: {
          name: `z5q4-pact-target-${route}`,
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Lightning Bolt', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-pact-${route}`,
    maximumTurns: 20,
  };
}

async function runPact(route: 'decline' | 'pay'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let boltOid: string | undefined;
  let pactCast = false;
  let paymentAsked = false;
  let paidOutcome = false;
  try {
    const spec = pactTable(route);
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Pact decision');
      const pactPilot = session.view.seats[0];
      const spellPilot = session.view.seats[1];
      boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid;
      if (route === 'pay' && paymentAsked && decision.kind !== 'mana-payment') {
        paidOutcome =
          pactPilot.battlefield.filter((card) => card.name === 'Island' && card.tapped).length >= 5 &&
          session.status === 'awaiting';
      }
      trace.push(
        decision.kind === 'priority'
          ? `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} priority`
          : `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = decision.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'mana-payment') {
        if (decision.prompt.startsWith('Pact of Negation')) {
          paymentAsked = true;
          move = decision.options.find((option) =>
            route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
          )?.id;
        } else {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        }
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          decision.seat === 0 ? option.targets[0]?.oid === boltOid : option.id === 'target-player-0',
        )?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const islands = pactPilot.battlefield.filter((card) => card.name === 'Island').length;
        const mountains = spellPilot.battlefield.filter((card) => card.name === 'Mountain').length;
        const castBolt =
          decision.seat === 1 &&
          boltOid === undefined &&
          mountains >= 1 &&
          islands >= (route === 'pay' ? 5 : 1)
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castPact: (typeof decision.options)[number] | undefined =
          decision.seat === 0 && boltOid !== undefined && !pactCast
            ? decision.options.find((option) => option.text.startsWith('Pact of Negation:'))
            : undefined;
        move =
          (paidOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castPact?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        pactCast ||= castPact !== undefined && move === castPact.id;
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Pact move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(boltOid, evidence).toMatch(/^forge-card-/u);
    expect(pactCast, evidence).toBe(true);
    expect(paymentAsked, evidence).toBe(true);
    if (route === 'decline') {
      expect(session.status, evidence).toBe('finished');
      expect(session.result?.winner, evidence).toBe(1);
    } else {
      expect(paidOutcome, evidence).toBe(true);
    }
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

async function runSupremeWillDig(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Dig pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-supreme-will-dig',
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Supreme Will', count: 30 },
          ],
        },
      },
      {
        name: 'Observer',
        controller: 'local',
        deck: { name: 'z5q4-supreme-will-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'z5q4-supreme-will-dig',
    maximumTurns: 14,
  };
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let cast = false;
  let selectedOid: string | undefined;
  let libraryBefore = -1;
  let outcome = false;
  try {
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Supreme Will dig decision');
      const pilot = session.view.seats[0];
      if (
        selectedOid !== undefined &&
        session.view.stack.length === 0 &&
        pilot.hand?.some((card) => card.oid === selectedOid) &&
        pilot.librarySize === libraryBefore - 1
      ) {
        outcome = true;
      }
      trace.push(
        decision.kind === 'priority'
          ? `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} priority`
          : `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move = decision.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
      } else if (decision.kind === 'mode-selection') {
        move = decision.options.find((option) => option.text.includes('Look at the top four cards'))?.id;
      } else if (decision.kind === 'entity-selection') {
        const selected = decision.options.find((option) => option.targets.length === 1);
        selectedOid = selected?.targets[0]?.oid;
        move = selected?.id;
      } else if (decision.kind === 'zone-order') {
        move = decision.options[0]?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const islands = pilot.battlefield.filter((card) => card.name === 'Island').length;
        const castSource =
          decision.seat === 0 && !cast && islands >= 3
            ? decision.options.find((option) => option.text.startsWith('Supreme Will:'))
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castSource?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (castSource !== undefined && move === castSource.id) {
          cast = true;
          libraryBefore = pilot.librarySize;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Supreme Will dig move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(cast, evidence).toBe(true);
    expect(selectedOid, evidence).toMatch(/^forge-card-/u);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

async function runMiscalculationCycling(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Cycling pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-miscalculation-cycling',
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Miscalculation', count: 30 },
          ],
        },
      },
      {
        name: 'Observer',
        controller: 'local',
        deck: { name: 'z5q4-miscalculation-cycling-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'z5q4-miscalculation-cycling',
    maximumTurns: 12,
  };
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let cycledOid: string | undefined;
  let libraryBefore = -1;
  let outcome = false;
  try {
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Miscalculation Cycling decision');
      const pilot = session.view.seats[0];
      if (
        cycledOid !== undefined &&
        session.view.stack.length === 0 &&
        pilot.graveyard.some((card) => card.oid === cycledOid) &&
        pilot.librarySize === libraryBefore - 1
      ) {
        outcome = true;
      }
      trace.push(
        decision.kind === 'priority'
          ? `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} priority || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`
          : `${session.view.turn.number}/${session.view.turn.step} ${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move = decision.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const cycle =
          decision.seat === 0 &&
          cycledOid === undefined &&
          pilot.battlefield.filter((card) => card.name === 'Island' && !card.tapped).length >= 2
            ? decision.options.find(
                (option) => option.text.startsWith('Miscalculation:') && option.text.includes('Cycling'),
              )
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          cycle?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (cycle !== undefined && move === cycle.id) {
          cycledOid = pilot.hand?.find((card) => card.name === 'Miscalculation')?.oid;
          libraryBefore = pilot.librarySize;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Miscalculation Cycling move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(cycledOid, evidence).toMatch(/^forge-card-/u);
    expect(outcome, evidence).toBe(true);
  } catch (cause) {
    throw new Error(`${String(cause)}\n${trace.slice(-320).join('\n')}`, { cause });
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

for (const counter of ['Mana Tithe', 'Mana Leak', 'Miscalculation', 'Supreme Will'] as const) {
  for (const route of ['decline', 'pay'] as const) {
    forgeIt(
      `${counter} human-routes its exact ${route} payment and changes the Stack outcome`,
      async () => {
        await runFixedCounter(counter, route);
      },
      360_000,
    );
  }
}

for (const route of ['decline', 'pay'] as const) {
  forgeIt(
    `Pact of Negation ${route}s its exact delayed upkeep cost with the actual game outcome`,
    async () => {
      await runPact(route);
    },
    360_000,
  );
}

forgeIt(
  'Supreme Will takes its exact Dig mode and moves the selected top-four identity to hand',
  async () => {
    await runSupremeWillDig();
  },
  360_000,
);

forgeIt(
  'Miscalculation pays exactly two to cycle its exact hand object and draw one card',
  async () => {
    await runMiscalculationCycling();
  },
  360_000,
);

/** Installed-Forge board proof for Emeria's Call and Turntimber Symbiosis. */
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

function turntimberTable(creature: 'Llanowar Elves' | 'Thragtusk'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Turntimber ${creature} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-turntimber-${creature.toLowerCase().replaceAll(' ', '-')}`,
          cards: [
            { name: 'Forest', count: 36 },
            { name: creature, count: 12 },
            { name: 'Turntimber Symbiosis', count: 12 },
          ],
        },
      },
      {
        name: 'Turntimber observer',
        controller: 'local',
        deck: { name: 'z5q4-turntimber-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-turntimber-${creature}-outcomes`,
    maximumTurns: 30,
  };
}

async function proveTurntimberCreature(creatureName: 'Llanowar Elves' | 'Thragtusk'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = turntimberTable(creatureName);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const trace: string[] = [];
  let casts = 0;
  let lastCastTurn: number | undefined;
  let declined = false;
  let selectedOid: string | undefined;
  let inventedRejected = false;
  let staleRejected = false;
  const milestones: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Turntimber decision');
      const pilot = session.view.seats[0];
      const selected = pilot.battlefield.find((card) => card.oid === selectedOid);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'entity-selection' && decision.seat === 0) {
        const creatureOptions = decision.options.filter(
          (option) => option.targets.length === 1 && option.targets[0]?.name === creatureName,
        );
        milestones.push(
          `entity turn=${session.view.turn.number} choices=${creatureOptions.length} casts=${casts}`,
        );
        expect(creatureOptions.length, trace.at(-1)).toBeGreaterThan(0);
        expect(
          decision.options
            .filter((option) => option.targets.length === 1)
            .every((option) => option.targets[0]?.name === creatureName),
          trace.at(-1),
        ).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('entity-selection-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        if (!declined) {
          const decline = decision.options.find((option) => option.id === 'entity-selection-done');
          expect(decline, trace.at(-1)).toBeDefined();
          const advanced = await session.submit(decline!.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          declined = true;
          continue;
        }
        const choice = creatureOptions[0]!;
        selectedOid = choice.targets[0]!.oid;
        const staleSession = session;
        const advanced = await session.submit(choice.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        await expect(staleSession.submit(choice.id)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      }
      if (decision.kind === 'priority') {
        const forests = pilot.battlefield.filter((card) => card.name === 'Forest').length;
        const cast = decision.options.find(
          (option) =>
            option.text.startsWith('Turntimber Symbiosis:') &&
            option.text.includes('top seven cards of your library'),
        );
        move =
          (selected !== undefined && session.view.stack.length === 0
            ? decision.options.find((option) => option.text === 'Concede')?.id
            : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Forest')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          (decision.seat === 0 &&
          forests >= 7 &&
          casts < 6 &&
          selectedOid === undefined &&
          lastCastTurn !== session.view.turn.number
            ? cast?.id
            : undefined) ??
          routineMove(decision);
        if (move !== undefined && move === cast?.id) {
          casts += 1;
          lastCastTurn = session.view.turn.number;
          milestones.push(`cast turn=${session.view.turn.number} step=${session.view.turn.step} id=${move}`);
        }
      } else {
        move = routineMove(decision);
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Turntimber move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}\nsummary=${JSON.stringify({ casts, declined, inventedRejected, staleRejected, selectedOid, milestones })}`;
    const selected = session.view.seats[0].battlefield.find((card) => card.oid === selectedOid);
    expect(casts, evidence).toBeGreaterThanOrEqual(2);
    expect(declined, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(selectedOid, evidence).toMatch(/^forge-card-/u);
    expect(selected?.name, evidence).toBe(creatureName);
    const counters = selected?.counters['P1P1'] ?? 0;
    expect(counters, evidence).toBe(creatureName === 'Llanowar Elves' ? 3 : 0);
    expect(selected?.power, evidence).toBe(creatureName === 'Llanowar Elves' ? 4 : 5);
    expect(selected?.toughness, evidence).toBe(creatureName === 'Llanowar Elves' ? 4 : 3);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

const EMERIA_TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Emeria pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-emeria-outcomes',
        cards: [
          { name: 'Plains', count: 28 },
          { name: 'Mother of Runes', count: 8 },
          { name: "Emeria's Call", count: 18 },
          { name: 'Wrath of God', count: 6 },
        ],
      },
    },
    {
      name: 'Emeria observer',
      controller: 'local',
      deck: {
        name: 'z5q4-emeria-observer',
        cards: [
          { name: 'Plains', count: 40 },
          { name: 'Wrath of God', count: 20 },
        ],
      },
    },
  ],
  seed: 'z5q4-emeria-installed-forge-outcomes',
  maximumTurns: 30,
};

async function proveEmeria(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(EMERIA_TABLE)).toEqual([]);
  const opened = await backend.open(EMERIA_TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const trace: string[] = [];
  let motherOid: string | undefined;
  let castEmeria = false;
  let exactTokens = false;
  let protectedThroughWrath = false;
  let expiredAtNextTurn = false;
  let opponentWrathCast = false;
  let pilotWrathCast = false;
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Emeria decision');
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      motherOid ??= pilot.battlefield.find((card) => card.name === 'Mother of Runes')?.oid;
      const angels = pilot.battlefield.filter((card) => card.name === 'Angel Warrior Token');
      if (angels.length === 2) {
        exactTokens ||= angels.every(
          (card) => card.power === 4 && card.toughness === 4 && card.controller === 0,
        );
      }
      if (opponentWrathCast && session.view.stack.length === 0) {
        protectedThroughWrath ||=
          pilot.battlefield.some((card) => card.oid === motherOid) &&
          pilot.battlefield.every((card) => card.name !== 'Angel Warrior Token');
      }
      if (pilotWrathCast && session.view.stack.length === 0) {
        expiredAtNextTurn ||= pilot.battlefield.every((card) => card.oid !== motherOid);
      }
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'priority') {
        const plains = pilot.battlefield.filter((card) => card.name === 'Plains').length;
        const opposingPlains = opponent.battlefield.filter((card) => card.name === 'Plains').length;
        const mother = decision.options.find((option) => option.text.startsWith('Mother of Runes:'));
        const emeria = decision.options.find(
          (option) => option.text.startsWith("Emeria's Call:") && option.text.includes('two 4/4 white Angel'),
        );
        const wrath = decision.options.find((option) => option.text.startsWith('Wrath of God:'));
        move =
          (expiredAtNextTurn
            ? decision.options.find((option) => option.text === 'Concede')?.id
            : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
          (decision.seat === 0 && motherOid === undefined && plains >= 1 ? mother?.id : undefined) ??
          (decision.seat === 0 && motherOid !== undefined && plains >= 7 && !castEmeria
            ? emeria?.id
            : undefined) ??
          (decision.seat === 1 && exactTokens && opposingPlains >= 4 && !opponentWrathCast
            ? wrath?.id
            : undefined) ??
          (decision.seat === 0 && protectedThroughWrath && session.view.turn.active === 0 && !pilotWrathCast
            ? wrath?.id
            : undefined) ??
          routineMove(decision);
        castEmeria ||= move !== undefined && move === emeria?.id;
        opponentWrathCast ||= decision.seat === 1 && move !== undefined && move === wrath?.id;
        pilotWrathCast ||=
          decision.seat === 0 && protectedThroughWrath && move !== undefined && move === wrath?.id;
      } else {
        move = routineMove(decision);
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Emeria move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(motherOid, evidence).toMatch(/^forge-card-/u);
    expect(castEmeria, evidence).toBe(true);
    expect(exactTokens, evidence).toBe(true);
    expect(opponentWrathCast, evidence).toBe(true);
    expect(protectedThroughWrath, evidence).toBe(true);
    expect(pilotWrathCast, evidence).toBe(true);
    expect(expiredAtNextTurn, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

interface ModalLandCase {
  readonly front: "Emeria's Call" | 'Turntimber Symbiosis';
  readonly back: 'Emeria, Shattered Skyclave' | 'Turntimber, Serpentine Wood';
  readonly spell: 'Mother of Runes' | 'Llanowar Elves';
}

async function proveLandRoute(card: ModalLandCase, payLife: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${card.front} land pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${card.front.toLowerCase().replaceAll(' ', '-')}-land`,
          cards: [
            { name: card.front, count: 30 },
            { name: card.spell, count: 30 },
          ],
        },
      },
      {
        name: 'modal land observer',
        controller: 'local',
        deck: { name: 'z5q4-modal-land-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-${card.front}-${payLife ? 'pay' : 'decline'}-land`,
    maximumTurns: 10,
  };
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const trace: string[] = [];
  let landPlayed = false;
  let entryObserved = false;
  let spellCast = false;
  let inventedRejected = false;
  let staleRejected = false;
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 800; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no modal land decision');
      const pilot = session.view.seats[0];
      const land = pilot.battlefield.find((candidate) => candidate.name === card.back);
      if (land !== undefined)
        entryObserved ||= pilot.life === (payLife ? 17 : 20) && land.tapped === !payLife;
      const spell = pilot.battlefield.find((candidate) => candidate.name === card.spell);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'optional-cost' && decision.seat === 0) {
        expect(
          decision.options.map((option) => option.id),
          trace.at(-1),
        ).toEqual(['optional-cost-pay-life-3', 'optional-cost-decline']);
        if (!inventedRejected) {
          await expect(session.submit('optional-cost-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        const chosen = payLife ? 'optional-cost-pay-life-3' : 'optional-cost-decline';
        const staleSession = session;
        const advanced = await session.submit(chosen);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        await expect(staleSession.submit(chosen)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      }
      if (decision.kind === 'priority') {
        const landActionId: string | undefined =
          decision.seat === 0 && !landPlayed
            ? decision.options.find((option) => option.text === `Play ${card.front}`)?.id
            : undefined;
        const cast = decision.options.find((option) => option.text.startsWith(`${card.spell}:`));
        move =
          (spell !== undefined
            ? decision.options.find((option) => option.text === 'Concede')?.id
            : undefined) ??
          landActionId ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : undefined) ??
          (decision.seat === 0 && entryObserved && land?.tapped === false && !spellCast
            ? cast?.id
            : undefined) ??
          routineMove(decision);
        landPlayed ||= move !== undefined && move === landActionId;
        spellCast ||= move !== undefined && move === cast?.id;
      } else {
        move = routineMove(decision);
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no modal land move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(landPlayed, evidence).toBe(true);
    expect(entryObserved, evidence).toBe(true);
    expect(spellCast, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(
      session.view.seats[0].battlefield.some((candidate) => candidate.name === card.spell),
      evidence,
    ).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves both Turntimber mana-value branches, optional decline, identity refusal, and board outcomes',
  async () => {
    await proveTurntimberCreature('Llanowar Elves');
    await proveTurntimberCreature('Thragtusk');
  },
  600_000,
);

forgeIt(
  "proves Emeria's two Angels and the exact non-Angel indestructibility duration",
  proveEmeria,
  420_000,
);

forgeIt(
  'proves both modal lands pay or decline exactly three life and produce their printed mana',
  async () => {
    const cards: readonly ModalLandCase[] = [
      { front: "Emeria's Call", back: 'Emeria, Shattered Skyclave', spell: 'Mother of Runes' },
      { front: 'Turntimber Symbiosis', back: 'Turntimber, Serpentine Wood', spell: 'Llanowar Elves' },
    ];
    for (const card of cards) {
      await proveLandRoute(card, true);
      await proveLandRoute(card, false);
    }
  },
  600_000,
);

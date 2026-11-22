/**
 * Whole-match witnesses that a 1v1 Commander table on the installed Forge
 * reaches the command-zone contracts: a general cast from the command zone,
 * the tax on its second cast, the zone-change replacement when it dies, and
 * commander damage in the projection, with the engine seat casting its own.
 *
 * These are whole games, kept beside the scenario probes in
 * `observed-scd-command-zone-scenario.integration.test.ts`: the scenario seats
 * a commander directly (a seat's `command` list), and these show the same
 * contracts arising from a real opening, the engine seat casting its own
 * general and commander damage landing in combat.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES } from '@mtg/engine';
import { compileInstalledForgeBridge, installedForgeDiagnosticBackend } from '../src/observed/installed';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
const TIMEOUT_MS = 180_000;
const EMMARA = 'Emmara, Soul of the Accord';
const KARDUR = 'Kardur, Doomscourge';
const REMOVAL = 'Beast Within';
const CARD_NAMES = new Set(['Forest', 'Plains', 'Swamp', 'Mountain', REMOVAL, EMMARA, KARDUR]);

let compiled: ReturnType<typeof compileInstalledForgeBridge>;
beforeAll(() => {
  if (required) compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

type Decision = NonNullable<ObservedSession['decision']>;
type Seat = ObservedSession['view']['seats'][number];

function table(local: SessionSpec['seats'][0]['deck'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'scd' },
    rules: COMMANDER_RULES,
    seats: [
      { name: 'Local general', controller: 'local', deck: local },
      {
        name: 'Native general',
        controller: 'engine',
        deck: {
          name: 'kardur',
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Mountain', count: 30 },
          ],
          commanders: [{ name: KARDUR, count: 1 }],
        },
      },
    ],
    seed,
    maximumTurns: 14,
  };
}

async function openMatch(spec: SessionSpec) {
  if (!compiled) throw new Error('Installed Forge required');
  const backend = installedForgeDiagnosticBackend(CARD_NAMES, {
    compiledBridgeClasses: compiled.classDirectory,
    timeoutMs: TIMEOUT_MS,
  });
  if (backend === null) throw new Error('Installed Forge required');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

function inZone(seat: Seat, zone: 'battlefield' | 'graveyard' | 'commandZone', name: string) {
  return (seat[zone] ?? []).find((card) => card.name === name);
}

/** Pay one shard with a source whose color the prompt still names, else any source. */
function payMana(decision: Decision): string | undefined {
  const sources = decision.options.filter((option) => option.id.startsWith('mana-source-'));
  const wanted = [...decision.prompt.matchAll(/\{([WUBRG])\}/gu)].map((match) => match[1]);
  return (sources.find((option) => wanted.includes(option.id.slice(-1))) ?? sources[0])?.id;
}

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment') return payMana(decision);
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

async function step(session: ObservedSession, move: string, trace: string[]): Promise<ObservedSession> {
  const advanced = await session.submit(move);
  if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
  return advanced.session;
}

describe.skipIf(!required)('SCD commander witnesses', () => {
  it(
    'casts Emmara from the command zone, taxes the recast, honors both zone-change answers, and projects commander damage',
    async () => {
      const running = await openMatch(
        table(
          {
            name: 'emmara',
            cards: [
              { name: 'Forest', count: 25 },
              { name: 'Plains', count: 25 },
              { name: REMOVAL, count: 10 },
            ],
            commanders: [{ name: EMMARA, count: 1 }],
          },
          'scd-commander-witness-local-v1',
        ),
      );
      let session = running.session;
      const trace: string[] = [];
      // The witness advances through these in order; each is proven by public state.
      type Stage = 'cast' | 'attack' | 'kill-to-command' | 'recast' | 'kill-to-graveyard' | 'done';
      let stage = 'cast' as Stage;
      const casts: { option: string; firstPayment: string; castsBefore: number | undefined }[] = [];
      let pendingCast = false;
      const replacements: { prompt: string; answer: string; options: string[] }[] = [];
      let commanderDamageOnEngine = 0;
      try {
        expect(session.view.seats.map((seat) => seat.life)).toEqual([40, 40]);
        expect(inZone(session.view.seats[0], 'commandZone', EMMARA)).toBeDefined();
        for (let index = 0; index < 900 && session.status === 'awaiting' && stage !== 'done'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing local decision');
          expect(decision.seat).toBe(0);
          const me = session.view.seats[0];
          const general = inZone(me, 'battlefield', EMMARA);
          commanderDamageOnEngine = Math.max(
            commanderDamageOnEngine,
            ...Object.values(session.view.seats[1].commanderDamage ?? {}),
          );
          trace.push(
            `T${session.view.turn.number} ${session.view.turn.step} ${stage} ${decision.kind}: ${decision.prompt}`,
          );
          if (stage === 'cast' && general !== undefined) stage = 'attack';
          if (stage === 'attack' && commanderDamageOnEngine > 0) stage = 'kill-to-command';
          if (stage === 'kill-to-command' && general === undefined && inZone(me, 'commandZone', EMMARA))
            stage = 'recast';
          if (stage === 'recast' && general !== undefined && casts.length === 2) stage = 'kill-to-graveyard';
          // The projection already shows her in the graveyard while the zone-change prompt is pending, so wait for the answer.
          if (stage === 'kill-to-graveyard' && replacements.length === 2 && inZone(me, 'graveyard', EMMARA)) {
            stage = 'done';
            break;
          }
          let move: string | undefined;
          const myMain =
            session.view.turn.active === 0 && ['MAIN1', 'MAIN2'].includes(session.view.turn.step);
          if (decision.kind === 'priority') {
            const land =
              decision.options.find(
                (option) =>
                  option.text ===
                  (me.battlefield.filter((card) => card.name === 'Forest').length <=
                  me.battlefield.filter((card) => card.name === 'Plains').length
                    ? 'Play Forest'
                    : 'Play Plains'),
              ) ?? decision.options.find((option) => option.text.startsWith('Play '));
            const castGeneral = decision.options.find((option) => option.text.startsWith(`${EMMARA}:`));
            const removal = decision.options.find((option) => option.text.startsWith(`${REMOVAL}:`));
            if (myMain && land !== undefined) move = land.id;
            else if (
              (stage === 'cast' || stage === 'recast') &&
              castGeneral !== undefined &&
              session.view.stack.length === 0
            ) {
              expect(
                inZone(me, 'commandZone', EMMARA),
                'the offered general sits in the command zone',
              ).toBeDefined();
              const offered = inZone(me, 'commandZone', EMMARA);
              casts.push({
                option: castGeneral.text,
                firstPayment: '',
                castsBefore: offered === undefined ? undefined : me.commanderCasts?.[offered.oid],
              });
              pendingCast = true;
              move = castGeneral.id;
            } else if (
              (stage === 'kill-to-command' || stage === 'kill-to-graveyard') &&
              myMain &&
              general !== undefined &&
              removal !== undefined &&
              session.view.stack.length === 0
            )
              move = removal.id;
            else move = routineMove(decision);
          } else if (decision.kind === 'mana-payment') {
            if (pendingCast) {
              casts[casts.length - 1]!.firstPayment = decision.prompt;
              pendingCast = false;
            }
            move = payMana(decision);
          } else if (decision.kind === 'target-selection') {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.name === EMMARA),
            )?.id;
          } else if (decision.kind === 'combat-attackers') {
            move =
              stage === 'attack' && general !== undefined
                ? (decision.options.find((option) =>
                    option.id.startsWith(`combat-attack-add-${general.oid.replace('forge-card-', '')}-`),
                  )?.id ?? decision.options.find((option) => option.id === 'combat-attackers-commit')?.id)
                : decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'confirm-replacement' && decision.prompt.startsWith(`${EMMARA}:`)) {
            // Forge asks CR 903.9a's command-zone return as a state-based "may"; the
            // bridge surfaces it as the commander's zone-change replacement (#209).
            const answer = stage === 'kill-to-graveyard' ? 'No' : 'Yes';
            replacements.push({
              prompt: decision.prompt,
              answer,
              options: decision.options.map((option) => option.text),
            });
            move = decision.options.find(
              (option) => option.id === `confirm-replacement-${answer.toLowerCase()}`,
            )?.id;
          } else move = routineMove(decision);
          if (move === undefined)
            throw new Error(
              `Unhandled ${decision.kind} at stage ${stage}\n${JSON.stringify(decision.options.map((option) => option.text))}\n${trace.slice(-12).join('\n')}`,
            );
          session = await step(session, move, trace);
        }
        const evidence = `${JSON.stringify({ casts, replacements, commanderDamageOnEngine }, null, 2)}\n${trace.join('\n')}`;
        expect(stage, evidence).toBe('done');
        // (1) cast from the command zone: the option named the general and it was offered while she sat there.
        expect(casts, evidence).toHaveLength(2);
        expect(casts[0]!.option.startsWith(`${EMMARA}:`), evidence).toBe(true);
        // (3) the second cast asks for two more generic mana than the first.
        expect(casts[0]!.firstPayment, evidence).toBe(`Pay for ${EMMARA}: {W}{G}`);
        expect(casts[1]!.firstPayment, evidence).toBe(`Pay for ${EMMARA}: {2}{W}{G}`);
        // The tax counter the board reads is the engine's own, and it moved with her through the graveyard.
        expect(
          casts.map((entry) => entry.castsBefore),
          evidence,
        ).toEqual([0, 1]);
        // (2) each zone-change answer was honored: first back to the command zone, then to the graveyard.
        expect(
          replacements.map((entry) => entry.answer),
          evidence,
        ).toEqual(['Yes', 'No']);
        for (const entry of replacements) {
          expect(entry.prompt, evidence).toContain('may put it into the command zone');
          expect(entry.options, evidence).toEqual([
            `Put ${EMMARA} into the command zone`,
            `Leave ${EMMARA} in the graveyard`,
          ]);
        }
        expect(inZone(session.view.seats[0], 'graveyard', EMMARA), evidence).toBeDefined();
        expect(inZone(session.view.seats[0], 'commandZone', EMMARA), evidence).toBeUndefined();
        // (4) commander damage is projected on the seat that took it.
        expect(commanderDamageOnEngine, evidence).toBeGreaterThan(0);
        expect(session.view.seats[1].hand).toBeNull();
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    },
    TIMEOUT_MS,
  );

  it(
    'lets the engine seat cast Kardur from its command zone and land commander damage on the local seat',
    async () => {
      const running = await openMatch(
        table(
          {
            name: 'forests',
            cards: [{ name: 'Forest', count: 60 }],
            commanders: [{ name: EMMARA, count: 1 }],
          },
          'scd-commander-witness-engine-v1',
        ),
      );
      let session = running.session;
      const trace: string[] = [];
      let cast = false;
      try {
        for (let index = 0; index < 900 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing local decision');
          expect(decision.seat).toBe(0);
          const engine = session.view.seats[1];
          cast ||=
            inZone(engine, 'battlefield', KARDUR) !== undefined ||
            session.view.stack.some((card) => card.name === KARDUR);
          if (cast && Object.keys(session.view.seats[0].commanderDamage ?? {}).length > 0) break;
          trace.push(
            `T${session.view.turn.number} ${session.view.turn.step} ${decision.kind}: ${decision.prompt}`,
          );
          const move =
            decision.kind === 'priority' && session.view.turn.active === 0
              ? (decision.options.find((option) => option.text === 'Play Forest')?.id ??
                routineMove(decision))
              : routineMove(decision);
          if (move === undefined)
            throw new Error(`Unhandled ${decision.kind}\n${trace.slice(-12).join('\n')}`);
          session = await step(session, move, trace);
        }
        const evidence = trace.join('\n');
        expect(cast, evidence).toBe(true);
        expect(inZone(session.view.seats[1], 'commandZone', KARDUR), evidence).toBeUndefined();
        const damage = session.view.seats[0].commanderDamage ?? {};
        expect(Object.keys(damage), evidence).toHaveLength(1);
        expect(Object.values(damage)[0], evidence).toBeGreaterThanOrEqual(4);
        expect(session.view.seats[0].life, evidence).toBeLessThan(40);
        expect(session.view.seats[1].hand).toBeNull();
      } finally {
        await session.close();
        await running.backend.shutdown?.();
      }
    },
    TIMEOUT_MS,
  );
});

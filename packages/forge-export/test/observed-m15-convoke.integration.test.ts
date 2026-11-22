/**
 * Extra Magic 2015 gameplay evidence for Convoke, a whole real match rather than a qualification
 * scenario probe: the reusable controller-contract bundle already covers mana-x and
 * zone-card-selection with no card-specific claim, so this witness is not required by
 * script-qualification coverage. It stays as a bilateral real-Forge check that Chord of Calling's
 * convoke payment (partly tapped creatures, partly mana) actually plays out correctly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installedForgeBackend } from '@mtg/forge-export';
import { compileInstalledForgeBridge } from '../src/observed/installed';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

function routineMove(decision: {
  kind: string;
  options: readonly { id: string; text: string }[];
}): string | undefined {
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

describe.skipIf(!required)('M15 convoke gameplay evidence', () => {
  it('lets the local Chord of Calling caster pay convoke partly by tapping creatures and partly by mana', async () => {
    const backend = installedForgeBackend({
      timeoutMs: 180_000,
      ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
    });
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open({
      content: { kind: 'printed', format: 'm15' },
      seats: [
        {
          name: 'Chord of Calling pilot',
          controller: 'local',
          deck: {
            name: 'm15-chord-of-calling-pilot',
            cards: [
              { name: 'Forest', count: 24 },
              { name: 'Elvish Mystic', count: 24 },
              { name: 'Chord of Calling', count: 12 },
            ],
          },
        },
        {
          name: 'Chord of Calling opponent',
          controller: 'local',
          deck: { name: 'm15-chord-of-calling-opponent', cards: [{ name: 'Swamp', count: 60 }] },
        },
      ],
      seed: 'm15-chord-of-calling-local-contract-v1',
      maximumTurns: 20,
    });
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    let cast = false;
    let paymentPromptSeen = false;
    let announcedX = false;
    let searchedOid: string | undefined;
    let outcome = false;
    const convokers = new Set<string>();
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Chord of Calling decision');
        const caster = session.view.seats[0];
        const subjectInGraveyard = caster.graveyard.some((card) => card.name === 'Chord of Calling');
        if (subjectInGraveyard && searchedOid !== undefined) {
          outcome = caster.battlefield.some((card) => card.oid === searchedOid);
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = routineMove(decision);
        if (decision.kind === 'number' && decision.seat === 0) {
          announcedX = true;
          move = decision.options.find((option) => option.id === 'number-1')?.id;
        } else if (decision.kind === 'convoke-payment' && decision.seat === 0) {
          paymentPromptSeen = true;
          const candidates = decision.options.filter((option) => option.id !== 'convoke-payment-done');
          const candidate = candidates.find((option) => {
            const oid = option.targets[0]?.oid;
            return oid !== undefined && !convokers.has(oid);
          });
          if (candidate !== undefined && convokers.size < 2) {
            const oid = candidate.targets[0]?.oid;
            expect(oid).toBeDefined();
            convokers.add(oid!);
            move = candidate.id;
          } else {
            move = 'convoke-payment-done';
          }
        } else if (decision.kind === 'zone-card-selection' && decision.seat === 0) {
          const target = decision.options.find((option) =>
            option.targets.some((candidate) => candidate.name === 'Elvish Mystic'),
          );
          searchedOid = target?.targets[0]?.oid;
          move = target?.id ?? decision.options.find((option) => option.id === 'zone-decline')?.id;
        } else if (decision.kind === 'priority') {
          if (outcome) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Forest')?.id;
            const mysticsInPlay = caster.battlefield.filter((card) => card.name === 'Elvish Mystic').length;
            const untappedForests = caster.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            const untappedMystics = caster.battlefield.filter(
              (card) => card.name === 'Elvish Mystic' && !card.tapped,
            ).length;
            const payableResources = untappedForests + untappedMystics;
            const mystic =
              mysticsInPlay < 2 && untappedForests >= 1
                ? decision.options.find((option) =>
                    option.text.startsWith('Elvish Mystic: Elvish Mystic - Creature'),
                  )?.id
                : undefined;
            const subject =
              mysticsInPlay >= 2 && payableResources >= 4 && !cast
                ? decision.options.find((option) => option.text.startsWith('Chord of Calling:'))?.id
                : undefined;
            move =
              land ??
              mystic ??
              subject ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            if (move !== undefined && move === subject) cast = true;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined)
          throw new Error(`Forge offered no Chord of Calling move\n${trace.slice(-40).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-300).join('\n');
      expect(cast, evidence).toBe(true);
      expect(paymentPromptSeen, evidence).toBe(true);
      expect(announcedX, evidence).toBe(true);
      expect(convokers.size, evidence).toBe(2);
      expect(outcome, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});

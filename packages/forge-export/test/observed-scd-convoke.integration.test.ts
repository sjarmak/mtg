/**
 * Starter Commander Decks gameplay evidence for Convoke, a whole real match rather than a
 * qualification scenario probe: the local pilot casts Nissa's Expedition paying part of its cost by
 * tapping creatures, then searches for basic lands. Commander: Token Triumph holds six convoke cards
 * and the bridge used to end the match the moment one was cast (mtg-uz0mz); the M15 sibling is
 * observed-m15-convoke.integration.test.ts.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMANDER_RULES } from '@mtg/engine';
import { installedForgeAdmittedBackend } from '@mtg/forge-export';
import { compileInstalledForgeBridge } from '../src/observed/installed';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

// Starter Commander Decks are matched through the format's own admitted card set, not the audited
// list, so the witness scopes the backend the way the launcher does. The admission covers every
// catalog card, and the catalog file keeps one name across admission rebinds.
const catalog = JSON.parse(
  readFileSync(new URL('../../data/data/scd/scd-printed-catalog-v1.json', import.meta.url), 'utf8'),
) as { readonly cards: readonly { readonly name: string }[] };
const admittedNames = new Set(catalog.cards.map((card) => card.name));

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const commanders = [{ name: 'Trostani Discordant', count: 1 }];

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

describe.skipIf(!required)('SCD convoke gameplay evidence', () => {
  it("lets the local Nissa's Expedition caster pay convoke partly by tapping creatures and partly by mana", async () => {
    const backend = installedForgeAdmittedBackend(admittedNames, {
      timeoutMs: 180_000,
      ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
    });
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open({
      content: { kind: 'printed', format: 'scd' },
      rules: COMMANDER_RULES,
      seats: [
        {
          name: "Nissa's Expedition pilot",
          controller: 'local',
          deck: {
            name: 'scd-nissas-expedition-pilot',
            cards: [
              { name: 'Forest', count: 24 },
              { name: "Avacyn's Pilgrim", count: 24 },
              { name: "Nissa's Expedition", count: 12 },
            ],
            commanders,
          },
        },
        {
          name: "Nissa's Expedition opponent",
          controller: 'local',
          deck: {
            name: 'scd-nissas-expedition-opponent',
            cards: [{ name: 'Forest', count: 60 }],
            commanders,
          },
        },
      ],
      seed: 'scd-nissas-expedition-local-contract-v1',
      maximumTurns: 20,
    });
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    let cast = false;
    let paymentPromptSeen = false;
    let forestsWhenCast = 0;
    let outcome = false;
    const convokers = new Set<string>();
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Nissa's Expedition decision");
        const caster = session.view.seats[0];
        const subjectInGraveyard = caster.graveyard.some((card) => card.name === "Nissa's Expedition");
        if (cast && subjectInGraveyard) {
          outcome = caster.battlefield.filter((card) => card.name === 'Forest').length > forestsWhenCast;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = routineMove(decision);
        if (decision.kind === 'convoke-payment' && decision.seat === 0) {
          expect(cast, trace.slice(-40).join('\n')).toBe(true);
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
          const land = decision.options.find((option) =>
            option.targets.some((candidate) => candidate.name === 'Forest'),
          );
          move = land?.id ?? decision.options.find((option) => option.id === 'zone-decline')?.id;
        } else if (decision.kind === 'priority') {
          if (outcome) {
            move = decision.options.find((option) => option.text === 'Concede')?.id;
          } else if (decision.seat === 0) {
            const land = decision.options.find((option) => option.text === 'Play Forest')?.id;
            const pilgrimsInPlay = caster.battlefield.filter(
              (card) => card.name === "Avacyn's Pilgrim",
            ).length;
            const untappedForests = caster.battlefield.filter(
              (card) => card.name === 'Forest' && !card.tapped,
            ).length;
            const pilgrim =
              pilgrimsInPlay < 2 && untappedForests >= 1
                ? decision.options.find((option) =>
                    option.text.startsWith("Avacyn's Pilgrim: Avacyn's Pilgrim - Creature"),
                  )?.id
                : undefined;
            const subject =
              pilgrimsInPlay >= 2 && untappedForests >= 3 && !cast
                ? decision.options.find((option) => option.text.startsWith("Nissa's Expedition:"))?.id
                : undefined;
            move =
              land ??
              pilgrim ??
              subject ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            if (move !== undefined && move === subject) {
              cast = true;
              forestsWhenCast = caster.battlefield.filter((card) => card.name === 'Forest').length;
            }
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined)
          throw new Error(`Forge offered no Nissa's Expedition move\n${trace.slice(-40).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-300).join('\n');
      expect(cast, evidence).toBe(true);
      expect(paymentPromptSeen, evidence).toBe(true);
      expect(convokers.size, evidence).toBe(2);
      expect(outcome, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 600_000);
});

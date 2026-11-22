/** Real Forge resolution, not merely X announcement or card admission. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const subject = "Green Sun's Zenith";

forgeIt.each(['Llanowar Elves', 'Noble Hierarch', 'decline'] as const)(
  'Zenith resolves X=1 with %s and shuffles itself back',
  async (selection) => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Zenith pilot',
          controller: 'local',
          deck: {
            name: 'zenith-regression',
            cards: [
              { name: 'Forest', count: 24 },
              { name: subject, count: 12 },
              { name: 'Llanowar Elves', count: 6 },
              { name: 'Noble Hierarch', count: 6 },
              { name: 'Acidic Slime', count: 6 },
              { name: 'Mother of Runes', count: 6 },
            ],
          },
        },
        {
          name: 'Opponent',
          controller: 'local',
          deck: {
            name: 'passive',
            cards: [{ name: 'Mountain', count: 60 }],
          },
        },
      ],
      seed: 'zenith-regression-v1',
      maximumTurns: 20,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cast = false;
    let chosen = false;
    let selectedOid: string | undefined;
    let libraryBefore = 0;
    let resolved = false;
    const trace: string[] = [];
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 900 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        if (chosen && session.view.stack.length === 0) {
          expect(pilot.librarySize).toBe(libraryBefore + (selection === 'decline' ? 1 : 0));
          expect(pilot.graveyard.some((card) => card.name === subject)).toBe(false);
          expect(pilot.battlefield.length).toBeGreaterThan(0);
          if (selection !== 'decline') {
            expect(pilot.battlefield.find((card) => card.oid === selectedOid)).toMatchObject({
              name: selection,
              tapped: false,
            });
          } else {
            expect(pilot.battlefield.every((card) => card.name === 'Forest')).toBe(true);
          }
          resolved = true;
          break;
        }
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'number') {
          move = decision.options.find((option) => option.id === 'number-1')?.id;
        } else if (decision.kind === 'zone-card-selection') {
          const names = decision.options.flatMap((option) => option.targets.map((target) => target.name));
          expect(new Set(names)).toEqual(new Set(['Llanowar Elves', 'Noble Hierarch']));
          expect(decision.options.some((option) => option.id === 'zone-decline')).toBe(true);
          await expect(session.submit('zone-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const option = decision.options.find((candidate) =>
            selection === 'decline'
              ? candidate.id === 'zone-decline'
              : candidate.targets.some((target) => target.name === selection),
          );
          move = option?.id;
          selectedOid = option?.targets[0]?.oid;
          libraryBefore = pilot.librarySize;
          chosen = true;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const lands = pilot.battlefield.filter((card) => card.name === 'Forest' && !card.tapped);
          const spell =
            !cast && lands.length >= 2
              ? decision.options.find((option) => option.text.startsWith(`${subject}:`))?.id
              : undefined;
          move = decision.options.find((option) => option.text === 'Play Forest')?.id ?? spell;
          if (move !== undefined && move === spell) cast = true;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('No move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-15).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-15).join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);

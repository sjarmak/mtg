/** Exact TwoPiles partition and chosen-pile outcome in installed Forge. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'liliana-two-piles',
        cards: [
          { name: 'Swamp', count: 36 },
          { name: 'Liliana of the Veil', count: 24 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'reviewed-liliana-two-piles-outcome',
  maximumTurns: 24,
};

forgeIt(
  'Liliana partitions exact permanents and sacrifices the pile the targeted human chooses',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let lilianaOid: string | null = null;
    let ultimateActivated = false;
    let partitionCandidates: readonly string[] = [];
    let partition: readonly string[] = [];
    let chosePile = false;
    let resolved = false;
    let trace: readonly string[] = [];
    try {
      expect(await backend.supports(TABLE)).toEqual([]);
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let moves = 0; session.status === 'awaiting' && moves < 1800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forge decision');
        const local = session.view.seats[0];
        trace = [...trace.slice(-100), JSON.stringify({ decision, view: session.view })];
        lilianaOid ??= local.battlefield.find((card) => card.name === 'Liliana of the Veil')?.oid ?? null;
        if (chosePile && partition.length === 2) {
          const sacrificed = partition.filter((oid) => local.graveyard.some((card) => card.oid === oid));
          const retained = partitionCandidates.filter(
            (oid) => !partition.includes(oid) && local.battlefield.some((card) => card.oid === oid),
          );
          if (sacrificed.length === 2 && retained.length === partitionCandidates.length - 2) {
            resolved = true;
          }
        }

        let move = decision.options.find(
          (option) =>
            option.text === 'Play first' ||
            option.text === 'Keep this hand' ||
            (decision.kind === 'priority' && option.text === 'Pass priority') ||
            option.id === 'combat-attackers-commit' ||
            option.id === 'combat-blockers-commit',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move =
            decision.options.find((option) => option.id.startsWith('mana-source-'))?.id ??
            decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'hand-card-selection') {
          move =
            decision.options.find((option) => option.targets.length === 1)?.id ??
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-0')?.id;
        } else if (decision.kind === 'card-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          if (partitionCandidates.length === 0) {
            partitionCandidates = candidates.flatMap((option) => option.targets.map((target) => target.oid));
            expect(partitionCandidates.length).toBeGreaterThanOrEqual(4);
          }
          if (partition.length < 2) {
            const next = candidates.find((option) => !partition.includes(option.targets[0]?.oid ?? ''));
            const oid = next?.targets[0]?.oid;
            if (next === undefined || oid === undefined) throw new Error('Missing pile candidate');
            partition = [...partition, oid];
            move = next.id;
          } else {
            move = decision.options.find((option) => option.id === 'card-selection-done')?.id;
          }
        } else if (decision.kind === 'choose-pile') {
          expect(decision.options[0]?.text).toContain('Pile 1 (2 cards)');
          chosePile = true;
          move = decision.options[0]?.id;
        } else if (decision.kind === 'priority') {
          const liliana = local.battlefield.find((card) => card.oid === lilianaOid);
          const loyalty = liliana?.counters['LOYALTY'] ?? 0;
          const plusOne = decision.options.find(
            (option) =>
              option.text.startsWith('Liliana of the Veil:') && option.text.includes('discards a card'),
          );
          const ultimate = decision.options.find(
            (option) => option.text.startsWith('Liliana of the Veil:') && option.text.includes('two piles'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (liliana === undefined &&
            local.battlefield.filter((card) => card.name === 'Swamp' && !card.tapped).length >= 3
              ? decision.options.find((option) => option.text.startsWith('Liliana of the Veil:'))?.id
              : undefined) ??
            (loyalty >= 6 ? ultimate?.id : plusOne?.id) ??
            move;
          ultimateActivated ||= move !== undefined && move === ultimate?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(ultimateActivated).toBe(true);
      expect(partition).toHaveLength(2);
      expect(chosePile).toBe(true);
      expect(resolved).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  420_000,
);

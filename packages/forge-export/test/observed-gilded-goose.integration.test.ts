/** Installed-Forge proof for Gilded Goose's exact Food sacrifice-for-color route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const spec: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Goose pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-gilded-goose-exact-outcomes',
        cards: [
          { name: 'Forest', count: 24 },
          { name: 'Gilded Goose', count: 18 },
          { name: 'Lightning Bolt', count: 18 },
        ],
      },
    },
    {
      name: 'Goose observer',
      controller: 'engine',
      deck: { name: 'z5q4-goose-observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-gilded-goose-food-sacrifice-outcome',
  maximumTurns: 20,
};

function routineMove(session: ObservedSession): string | undefined {
  const decision = session.decision;
  if (decision === null) return undefined;
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

forgeIt(
  'creates exact Food, rolls back cancellation, and sacrifices that identity for red mana used by Bolt',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let gooseOid: string | undefined;
    let foodOid: string | undefined;
    let boltOid: string | undefined;
    let activationAttempts = 0;
    let canceled = false;
    let rollbackObserved = false;
    let selectedFoodOid: string | undefined;
    let selectedRedManaSource = false;
    let staleRejected = false;
    let completed = false;
    try {
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Gilded Goose decision');
        const local = session.view.seats[0];
        if (local.hand === null) throw new Error('Forge hid the Gilded Goose pilot hand');
        const goose = local.battlefield.find((card) => card.name === 'Gilded Goose');
        const foods = local.battlefield.filter(
          (card) => card.name === 'Food Token' && card.typeLine.includes('Artifact'),
        );
        gooseOid ??= goose?.oid;
        foodOid ??= foods[0]?.oid;
        if (canceled && !rollbackObserved) {
          rollbackObserved =
            gooseOid !== undefined &&
            local.battlefield.some((card) => card.oid === gooseOid && !card.tapped) &&
            foodOid !== undefined &&
            local.battlefield.some((card) => card.oid === foodOid);
        }
        completed =
          selectedRedManaSource &&
          selectedFoodOid !== undefined &&
          gooseOid !== undefined &&
          local.battlefield.some((card) => card.oid === gooseOid && card.tapped) &&
          !local.battlefield.some((card) => card.oid === selectedFoodOid) &&
          boltOid !== undefined &&
          local.graveyard.some((card) => card.oid === boltOid) &&
          local.life === 20 &&
          session.view.seats[1].life === 17 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          const redGooseSource = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.id.endsWith('-R') &&
              option.targets.some((target) => target.name === 'Gilded Goose'),
          );
          if (boltOid !== undefined && redGooseSource !== undefined && activationAttempts < 2) {
            expect(redGooseSource.text).toBe('Activate Gilded Goose for {R}');
            move = redGooseSource.id;
            activationAttempts += 1;
            selectedRedManaSource = true;
          } else {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          }
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates).toHaveLength(1);
          const selected = candidates[0];
          expect(selected?.targets[0]).toMatchObject({ oid: foodOid, name: 'Food Token' });
          if (!canceled) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = move !== undefined;
          } else {
            if (selected === undefined) throw new Error('Forge offered no exact Food sacrifice');
            selectedFoodOid = selected.targets[0]!.oid;
            const staleSession = session;
            const staleMove = selected.id;
            move = selected.id;
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            const stale = await staleSession.submit(staleMove);
            expect(stale).toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'priority') {
          const forests = local.battlefield.filter((card) => card.name === 'Forest');
          const castGoose = decision.options.find((option) => option.text.startsWith('Gilded Goose:'));
          const castBolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (goose === undefined && forests.length >= 1 ? castGoose?.id : undefined) ??
            (foodOid !== undefined && session.view.turn.number >= 6 && boltOid === undefined
              ? castBolt?.id
              : undefined);
          if (castBolt !== undefined && move === castBolt.id) {
            boltOid = local.hand.find((card) => card.name === 'Lightning Bolt')?.oid;
          }
        }

        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gilded Goose move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(gooseOid, evidence).toMatch(/^forge-card-/u);
      expect(foodOid, evidence).toMatch(/^forge-card-/u);
      expect(activationAttempts, evidence).toBe(2);
      expect(canceled, evidence).toBe(true);
      expect(rollbackObserved, evidence).toBe(true);
      expect(selectedFoodOid, evidence).toBe(foodOid);
      expect(selectedRedManaSource, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(boltOid, evidence).toMatch(/^forge-card-/u);
      expect(completed, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  300_000,
);

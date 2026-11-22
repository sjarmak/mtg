/** Installed-Forge outcome for Fauna Shaman's exact creature-discard search. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Fauna pilot',
      controller: 'local',
      deck: {
        name: 'fauna-creature-discard',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Fauna Shaman', count: 12 },
          { name: 'Llanowar Elves', count: 9 },
          { name: 'Craterhoof Behemoth', count: 9 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-fauna-shaman-creature-discard',
  maximumTurns: 12,
};

forgeIt(
  'discards the selected creature identity and puts the selected library creature into hand',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let activated = false;
    let discardedOid: string | undefined;
    let searchedOid: string | undefined;
    let resolved = false;
    const trace: string[] = [];

    try {
      for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Fauna Shaman decision');
        const seat = session.view.seats[0];
        const fauna = seat.battlefield.find((card) => card.name === 'Fauna Shaman');
        resolved =
          discardedOid !== undefined &&
          searchedOid !== undefined &&
          seat.graveyard.some((card) => card.oid === discardedOid) &&
          (seat.hand?.some((card) => card.oid === searchedOid) ?? false) &&
          fauna?.tapped === true &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' | ')}`,
        );

        let move = decision.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        )?.id;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.targets.some((target) => target.name === 'Forest'),
          )?.id;
        } else if (decision.kind === 'cost-discard-selection') {
          const chosen = decision.options.find(
            (option) =>
              option.targets.length === 1 &&
              (option.targets[0]?.name === 'Craterhoof Behemoth' ||
                option.targets[0]?.name === 'Llanowar Elves'),
          );
          discardedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'zone-card-selection' && activated) {
          const chosen =
            decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Craterhoof Behemoth',
            ) ?? decision.options.find((option) => option.targets.length === 1);
          searchedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) => option.id === 'discard-selection-commit')?.id;
          move ??= decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const playForest = decision.options.find((option) => option.text === 'Play Forest');
          const castFauna = decision.options.find((option) => option.text.startsWith('Fauna Shaman:'));
          const activateFauna = decision.options.find(
            (option) => option.text.startsWith('Fauna Shaman:') && option.text.includes('Search'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            playForest?.id ??
            (fauna === undefined ? castFauna?.id : undefined) ??
            (!activated ? activateFauna?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= activateFauna !== undefined && move === activateFauna.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Fauna Shaman move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-140).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(discardedOid, evidence).toMatch(/^forge-card-/u);
      expect(searchedOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

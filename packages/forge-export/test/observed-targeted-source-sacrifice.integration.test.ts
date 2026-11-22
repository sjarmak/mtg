/** Installed-Forge outcome for the exact targeted source-sacrifice composition. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Wasteland pilot',
      controller: 'local',
      deck: { name: 'wasteland-source', cards: [{ name: 'Wasteland', count: 60 }] },
    },
    {
      name: 'Factory pilot',
      controller: 'local',
      deck: { name: 'factory-target', cards: [{ name: "Mishra's Factory", count: 60 }] },
    },
  ],
  seed: 'z5q4-targeted-source-sacrifice',
  maximumTurns: 6,
};

forgeIt(
  'sacrifices the exact Wasteland source and destroys the selected nonbasic land identity',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 120_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let wastelandOid: string | undefined;
    let factoryOid: string | undefined;
    let activated = false;
    let resolved = false;
    const trace: string[] = [];

    for (let submitted = 0; session.status === 'awaiting' && submitted < 250; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no source-sacrifice decision');
      const sourcePilot = session.view.seats[0];
      const targetPilot = session.view.seats[1];
      wastelandOid ??= sourcePilot.battlefield.find((card) => card.name === 'Wasteland')?.oid;
      factoryOid ??= targetPilot.battlefield.find((card) => card.name === "Mishra's Factory")?.oid;
      resolved =
        wastelandOid !== undefined &&
        factoryOid !== undefined &&
        sourcePilot.graveyard.some((card) => card.oid === wastelandOid) &&
        targetPilot.graveyard.some((card) => card.oid === factoryOid) &&
        session.view.stack.length === 0;
      trace.push(
        decision.kind === 'priority'
          ? `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`
          : `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt}`,
      );

      let move = decision.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id;
      if (decision.kind === 'target-selection') {
        move = decision.options.find((option) => option.targets[0]?.oid === factoryOid)?.id;
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const activate: (typeof decision.options)[number] | undefined =
          decision.seat === 0 && factoryOid !== undefined && !activated
            ? decision.options.find(
                (option) => option.text.startsWith('Wasteland:') && option.text.includes('Destroy'),
              )
            : undefined;
        move =
          (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Wasteland')?.id
            : decision.options.find((option) => option.text === "Play Mishra's Factory")?.id) ??
          activate?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        activated ||= activate !== undefined && move === activate.id;
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no source-sacrifice move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(activated, evidence).toBe(true);
    expect(wastelandOid, evidence).toMatch(/^forge-card-/u);
    expect(factoryOid, evidence).toMatch(/^forge-card-/u);
    expect(resolved, evidence).toBe(true);
    await session.close();
    await backend.shutdown?.();
  },
  180_000,
);

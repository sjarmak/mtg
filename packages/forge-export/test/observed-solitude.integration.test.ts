/** Installed-Forge proof for Solitude's exact Evoke and optional-target route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
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

forgeIt.each(['accept', 'decline'] as const)(
  'Solitude Evoke pays with the selected white card and can %s its singleton trigger target',
  async (route) => {
    const spec: SessionSpec = {
      content: { kind: 'printed', format: 'legacy-cube-2021-08' },
      seats: [
        {
          name: 'Solitude pilot',
          controller: 'local',
          deck: {
            name: `z5q4-solitude-${route}`,
            cards: [
              { name: 'Plains', count: 20 },
              { name: 'Solitude', count: 20 },
              { name: 'Blade Splicer', count: 20 },
            ],
          },
        },
        {
          name: 'Spirit pilot',
          controller: 'local',
          deck: {
            name: `z5q4-solitude-${route}-target`,
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Selfless Spirit', count: 30 },
            ],
          },
        },
      ],
      seed: `z5q4-solitude-${route}`,
      maximumTurns: 18,
    };
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let spiritCast = false;
    let solitudeCast = false;
    let paymentOid: string | undefined;
    let targetOid: string | undefined;
    let lifeBefore: number | undefined;
    let targetAnswered = false;
    let outcomeObserved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Solitude decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const spirit = opponent.battlefield.find((card) => card.name === 'Selfless Spirit');
        targetOid ??= spirit?.oid;
        outcomeObserved ||=
          targetAnswered &&
          paymentOid !== undefined &&
          pilot.exile.some((card) => card.oid === paymentOid) &&
          pilot.graveyard.some((card) => card.name === 'Solitude') &&
          targetOid !== undefined &&
          lifeBefore !== undefined &&
          (route === 'accept'
            ? opponent.exile.some((card) => card.oid === targetOid) && opponent.life === lifeBefore + 2
            : opponent.battlefield.some((card) => card.oid === targetOid) && opponent.life === lifeBefore);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'cost-card-selection' && solitudeCast) {
          const payment = decision.options.find((option) => option.targets[0]?.name === 'Blade Splicer');
          paymentOid ??= payment?.targets[0]?.oid;
          move = payment?.id;
        } else if (decision.kind === 'target-selection' && solitudeCast) {
          lifeBefore ??= opponent.life;
          move =
            route === 'accept'
              ? decision.options.find((option) => option.targets[0]?.oid === targetOid)?.id
              : decision.options.find((option) => option.id === 'target-none')?.id;
          targetAnswered ||= move !== undefined;
        } else if (decision.kind === 'priority') {
          const opponentPlains = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const spiritOption = decision.options.find((option) => option.text.startsWith('Selfless Spirit:'));
          const solitudeOption = decision.options.find(
            (option) => option.text.startsWith('Solitude:') && /Evoke/u.test(option.text),
          );
          move =
            (outcomeObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && !spiritCast && opponentPlains >= 2 ? spiritOption?.id : undefined) ??
            (decision.seat === 0 && spirit !== undefined && !solitudeCast ? solitudeOption?.id : undefined);
          spiritCast ||= move !== undefined && move === spiritOption?.id;
          solitudeCast ||= move !== undefined && move === solitudeOption?.id;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Solitude move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(spiritCast, evidence).toBe(true);
      expect(solitudeCast, evidence).toBe(true);
      expect(paymentOid, evidence).toMatch(/^forge-card-/u);
      expect(targetOid, evidence).toMatch(/^forge-card-/u);
      expect(targetAnswered, evidence).toBe(true);
      expect(outcomeObserved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

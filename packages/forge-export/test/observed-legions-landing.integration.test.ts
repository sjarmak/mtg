/** Installed-Forge board proof for Legion's Landing and Adanto. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Landing pilot',
      controller: 'local',
      deck: {
        name: 'z5q4-legions-landing-outcome',
        cards: [
          { name: 'Plains', count: 34 },
          { name: "Legion's Landing", count: 13 },
          { name: 'Usher of the Fallen', count: 13 },
        ],
      },
    },
    {
      name: 'Landing opponent',
      controller: 'local',
      deck: { name: 'z5q4-legions-landing-opponent', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-legions-landing-installed-forge',
  maximumTurns: 24,
};

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

forgeIt(
  "keeps the front at two attackers, transforms at three, and reaches Adanto's mana and Vampire routes",
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(TABLE)).toEqual([]);
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    let landingCast = false;
    let landingOid: string | undefined;
    let entryVampireOid: string | undefined;
    let twoAttackCommitted = false;
    let twoAttackStayedFront = false;
    let threeAttackCommitted = false;
    let transformed = false;
    let adantoManaCastStarted = false;
    let adantoManaPaid = false;
    let tokenActivationStarted = false;
    let inventedRejected = false;
    let staleRejected = false;
    let completed = false;
    const selectedAttackers = new Set<string>();
    const trace: string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Legion's Landing decision");
        const pilot = session.view.seats[0];
        landingOid ??= pilot.battlefield.find((card) => card.name === "Legion's Landing")?.oid;
        entryVampireOid ??= pilot.battlefield.find(
          (card) => card.name.includes('Vampire') && card.typeLine.includes('Creature'),
        )?.oid;
        const landing =
          landingOid === undefined ? undefined : pilot.battlefield.find((card) => card.oid === landingOid);
        transformed ||= landing?.name === 'Adanto, the First Fort';
        if (twoAttackCommitted && !threeAttackCommitted && session.view.turn.step === 'MAIN1') {
          twoAttackStayedFront ||= landing?.name === "Legion's Landing";
        }
        const vampires = pilot.battlefield.filter(
          (card) => card.name.includes('Vampire') && card.typeLine.includes('Creature'),
        );
        completed =
          transformed &&
          adantoManaPaid &&
          tokenActivationStarted &&
          vampires.length >= 2 &&
          entryVampireOid !== undefined &&
          pilot.life > 20 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move: string | undefined;
        if (decision.kind === 'combat-attackers' && decision.seat === 0) {
          const desired = twoAttackCommitted ? (threeAttackCommitted ? 0 : 3) : 2;
          const additions = decision.options.filter(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets[0]?.oid !== undefined &&
              !selectedAttackers.has(option.targets[0].oid),
          );
          const canReachDesired = selectedAttackers.size + additions.length >= desired;
          if (desired > 0 && canReachDesired && selectedAttackers.size < desired) {
            const add = additions[0];
            const oid = add?.targets[0]?.oid;
            if (add === undefined || oid === undefined) throw new Error('Forge offered no exact attacker');
            if (!inventedRejected) {
              await expect(session.submit('combat-attack-add-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            selectedAttackers.add(oid);
            move = add.id;
          } else {
            const commit = decision.options.find((option) => option.id === 'combat-attackers-commit');
            if (commit === undefined) throw new Error('Forge offered no attacker commit');
            if (desired > 0 && canReachDesired && selectedAttackers.size === desired) {
              const staleSession = session;
              const advanced = await session.submit(commit.id);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              if (!staleRejected) {
                const stale = await staleSession.submit(commit.id);
                expect(stale).toMatchObject({
                  ok: false,
                  error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
                });
                staleRejected = true;
              }
              if (desired === 2) twoAttackCommitted = true;
              if (desired === 3) threeAttackCommitted = true;
              selectedAttackers.clear();
              continue;
            }
            selectedAttackers.clear();
            move = commit.id;
          }
        } else if (decision.kind === 'mana-payment') {
          if (adantoManaCastStarted && !adantoManaPaid && landingOid !== undefined) {
            const source = decision.options.find(
              (option) => option.id.startsWith('mana-source-') && option.targets[0]?.oid === landingOid,
            );
            expect(source, trace.at(-1)).toBeDefined();
            move = source?.id;
            adantoManaPaid = move !== undefined;
          }
        } else if (decision.kind === 'priority') {
          const ushers = pilot.battlefield.filter((card) => card.name === 'Usher of the Fallen').length;
          const untappedPlains = pilot.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const tokenAction = decision.options.find(
            (option) => option.text.startsWith('Adanto, the First Fort:') && option.text.includes('Vampire'),
          );
          move =
            (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Plains')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            (decision.seat === 0 && !landingCast && untappedPlains >= 1
              ? decision.options.find((option) => option.text.startsWith("Legion's Landing:"))?.id
              : undefined) ??
            (decision.seat === 0 && landingCast && !transformed && ushers < 2 && untappedPlains >= 1
              ? decision.options.find((option) => option.text.startsWith('Usher of the Fallen:'))?.id
              : undefined) ??
            (decision.seat === 0 && transformed && !adantoManaCastStarted
              ? decision.options.find((option) => option.text.startsWith('Usher of the Fallen:'))?.id
              : undefined) ??
            (decision.seat === 0 && adantoManaPaid && !tokenActivationStarted && untappedPlains >= 3
              ? tokenAction?.id
              : undefined);
          const chosenText = decision.options.find((option) => option.id === move)?.text;
          landingCast ||= chosenText?.startsWith("Legion's Landing:") === true;
          if (
            transformed &&
            !adantoManaCastStarted &&
            chosenText?.startsWith('Usher of the Fallen:') === true
          ) {
            adantoManaCastStarted = true;
          }
          tokenActivationStarted ||=
            move !== undefined && tokenAction !== undefined && move === tokenAction.id;
        }

        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error("Forge offered no Legion's Landing move");
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(landingCast, evidence).toBe(true);
      expect(entryVampireOid, evidence).toMatch(/^forge-card-/u);
      expect(twoAttackCommitted, evidence).toBe(true);
      expect(twoAttackStayedFront, evidence).toBe(true);
      expect(threeAttackCommitted, evidence).toBe(true);
      expect(transformed, evidence).toBe(true);
      expect(adantoManaPaid, evidence).toBe(true);
      expect(tokenActivationStarted, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(completed, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

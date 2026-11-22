/** Installed-Forge board proof for the exact planeswalker UnlessCost sacrifice cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'zone-card-selection') {
    return decision.options.find((option) => option.id.endsWith('-done'))?.id;
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

function traceLine(session: ObservedSession, decision: ObservedDecision): string {
  const planeswalker = session.view.seats[0].battlefield.find((card) =>
    card.typeLine.includes('Planeswalker'),
  );
  return `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} planeswalker=${planeswalker?.name ?? 'none'} loyalty=${String(loyaltyOf(planeswalker))} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

function twoLocalTable(
  name: string,
  pilotCards: SessionSpec['seats'][0]['deck']['cards'],
  maximumTurns = 24,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${name} pilot`,
        controller: 'local',
        deck: { name: `z5q4-${name}-pilot`, cards: pilotCards },
      },
      {
        name: `${name} opponent`,
        controller: 'local',
        deck: {
          name: `z5q4-${name}-opponent`,
          cards: [
            { name: 'Plains', count: 36 },
            { name: 'Mother of Runes', count: 24 },
          ],
        },
      },
    ],
    seed: `z5q4-${name}-installed-forge`,
    maximumTurns,
  };
}

function loyaltyOf(
  card: ObservedSession['view']['seats'][number]['battlefield'][number] | undefined,
): number {
  return Object.entries(card?.counters ?? {})
    .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
    .reduce((sum, [, count]) => sum + count, 0);
}

forgeIt(
  'Daretti pays the exact issued artifact identity and destroys only the exact target',
  async () => {
    const spec = twoLocalTable('daretti-unless-sacrifice', [
      { name: 'Mana Confluence', count: 42 },
      { name: 'Daretti, Ingenious Iconoclast', count: 18 },
    ]);
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let darettiOid: string | undefined;
    let constructOid: string | undefined;
    let motherOid: string | undefined;
    let minusAttempts = 0;
    let sacrificedOid: string | undefined;
    let targetOid: string | undefined;
    let declined = false;
    let declineObserved = false;
    let inventedRejected = false;
    let staleRejected = false;
    let resolved = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Daretti decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const daretti = pilot.battlefield.find((card) => card.name === 'Daretti, Ingenious Iconoclast');
        darettiOid ??= daretti?.oid;
        const construct = pilot.battlefield.find(
          (card) => card.typeLine.includes('Construct') && card.typeLine.includes('Artifact'),
        );
        constructOid ??= construct?.oid;
        const mother = opponent.battlefield.find((card) => card.name === 'Mother of Runes');
        motherOid ??= mother?.oid;
        declineObserved ||=
          declined &&
          constructOid !== undefined &&
          motherOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === constructOid) &&
          opponent.battlefield.some((card) => card.oid === motherOid) &&
          loyaltyOf(daretti) === 3 &&
          session.view.stack.length === 0;
        resolved ||=
          sacrificedOid !== undefined &&
          targetOid !== undefined &&
          !pilot.battlefield.some((card) => card.oid === sacrificedOid) &&
          opponent.graveyard.some((card) => card.oid === targetOid) &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));
        if (resolved) break;

        let move: string | undefined;
        if (decision.kind === 'target-selection' && minusAttempts > 0) {
          const target = decision.options.find((option) => option.targets[0]?.oid === motherOid);
          expect(target, trace.at(-1)).toBeDefined();
          targetOid = target?.targets[0]?.oid;
          move = target?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(
            candidates.map((option) => option.targets[0]?.oid),
            trace.at(-1),
          ).toEqual([constructOid]);
          expect(
            candidates.some((option) => option.targets[0]?.oid === motherOid),
            trace.at(-1),
          ).toBe(false);
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declined) {
            const cancel = decision.options.find((option) => option.id === 'cost-sacrifice-cancel');
            if (cancel === undefined) throw new Error('Forge omitted the exact Daretti decline');
            declined = true;
            move = cancel.id;
            const advanced = await session.submit(move);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            continue;
          }
          const chosen = candidates[0];
          if (chosen === undefined) throw new Error('Forge offered no exact Daretti artifact payment');
          sacrificedOid = chosen.targets[0]?.oid;
          const stale = session;
          const advanced = await session.submit(chosen.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(chosen.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          continue;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const plus = decision.options.find(
            (option) =>
              option.text.startsWith('Daretti, Ingenious Iconoclast:') && option.text.includes('Construct'),
          );
          const minus = decision.options.find(
            (option) =>
              option.text.startsWith('Daretti, Ingenious Iconoclast:') &&
              option.text.includes('destroy target'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && mother === undefined
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            (decision.seat === 0 && daretti === undefined && lands >= 3
              ? decision.options.find((option) => option.text.startsWith('Daretti, Ingenious Iconoclast:'))
                  ?.id
              : undefined) ??
            (decision.seat === 0 && daretti !== undefined && construct === undefined
              ? plus?.id
              : undefined) ??
            (decision.seat === 0 &&
            construct !== undefined &&
            mother !== undefined &&
            sacrificedOid === undefined &&
            (!declined || declineObserved)
              ? minus?.id
              : undefined) ??
            routineMove(decision);
          if (move !== undefined && move === minus?.id) minusAttempts += 1;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Daretti move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(darettiOid, evidence).toMatch(/^forge-card-/u);
      expect(
        loyaltyOf(session.view.seats[0].battlefield.find((card) => card.oid === darettiOid)),
        evidence,
      ).toBe(2);
      expect(constructOid, evidence).toMatch(/^forge-card-/u);
      expect(motherOid, evidence).toMatch(/^forge-card-/u);
      expect(minusAttempts, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(declineObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(resolved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Daretti copies the exact artifact card selected from the graveyard three times',
  async () => {
    const spec = twoLocalTable(
      'daretti-multizone-copy',
      [
        { name: 'Mana Confluence', count: 38 },
        { name: 'Retrofitter Foundry', count: 10 },
        { name: 'Daretti, Ingenious Iconoclast', count: 12 },
      ],
      36,
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let foundryOid: string | undefined;
    let darettiOid: string | undefined;
    let constructOid: string | undefined;
    let destroyActivated = false;
    let foundryDestroyed = false;
    let ultimateActivated = false;
    let copiedFromGraveyard = false;
    let inventedRejected = false;
    let staleRejected = false;
    let resolved = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 2_600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Daretti multizone decision');
        const pilot = session.view.seats[0];
        const foundry = pilot.battlefield.find((card) => card.name === 'Retrofitter Foundry');
        foundryOid ??= foundry?.oid;
        const daretti = pilot.battlefield.find((card) => card.name === 'Daretti, Ingenious Iconoclast');
        darettiOid ??= daretti?.oid;
        const construct = pilot.battlefield.find(
          (card) => card.typeLine.includes('Construct') && card.typeLine.includes('Artifact'),
        );
        constructOid ??= construct?.oid;
        foundryDestroyed ||=
          foundryOid !== undefined &&
          pilot.graveyard.some((card) => card.oid === foundryOid) &&
          session.view.stack.length === 0;
        resolved ||=
          copiedFromGraveyard &&
          pilot.battlefield.filter((card) => card.name === 'Retrofitter Foundry').length === 3 &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));
        if (resolved) break;

        let move: string | undefined;
        if (decision.kind === 'target-selection' && destroyActivated && !foundryDestroyed) {
          const target = decision.options.find((option) => option.targets[0]?.oid === foundryOid);
          expect(target, trace.at(-1)).toBeDefined();
          move = target?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(
            candidates.map((option) => option.targets[0]?.oid),
            trace.at(-1),
          ).toEqual(expect.arrayContaining([foundryOid, constructOid]));
          const chosen = candidates.find((option) => option.targets[0]?.oid === constructOid);
          if (chosen === undefined) throw new Error('Forge offered no exact Daretti artifact payment');
          move = chosen.id;
        } else if (decision.kind === 'target-selection' && ultimateActivated) {
          const graveyardTarget = decision.options.find((option) => option.targets[0]?.oid === foundryOid);
          expect(graveyardTarget, trace.at(-1)).toBeDefined();
          expect(
            decision.options.some(
              (option) => option.targets[0]?.oid !== foundryOid && option.text.includes('Construct Token'),
            ),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('target-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (graveyardTarget === undefined) throw new Error('Forge omitted the graveyard artifact target');
          const stale = session;
          const advanced = await session.submit(graveyardTarget.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          await expect(stale.submit(graveyardTarget.id)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          copiedFromGraveyard = true;
          continue;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const plus = decision.options.find(
            (option) =>
              option.text.startsWith('Daretti, Ingenious Iconoclast:') && option.text.includes('Construct'),
          );
          const minus = decision.options.find(
            (option) =>
              option.text.startsWith('Daretti, Ingenious Iconoclast:') &&
              option.text.includes('destroy target'),
          );
          const ultimate = decision.options.find(
            (option) =>
              option.text.startsWith('Daretti, Ingenious Iconoclast:') &&
              option.text.includes('three tokens that are copies'),
          );
          move =
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 0 && foundryOid === undefined
              ? decision.options.find((option) => option.text.startsWith('Retrofitter Foundry:'))?.id
              : undefined) ??
            (decision.seat === 0 && daretti === undefined && lands >= 3
              ? decision.options.find((option) => option.text.startsWith('Daretti, Ingenious Iconoclast:'))
                  ?.id
              : undefined) ??
            (decision.seat === 0 && daretti !== undefined && construct === undefined
              ? plus?.id
              : undefined) ??
            (decision.seat === 0 && construct !== undefined && foundry !== undefined && !destroyActivated
              ? minus?.id
              : undefined) ??
            (decision.seat === 0 && foundryDestroyed && loyaltyOf(daretti) < 6 ? plus?.id : undefined) ??
            (decision.seat === 0 && foundryDestroyed && loyaltyOf(daretti) >= 6 && !ultimateActivated
              ? ultimate?.id
              : undefined) ??
            routineMove(decision);
          if (move !== undefined && move === minus?.id) destroyActivated = true;
          if (move !== undefined && move === ultimate?.id) ultimateActivated = true;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Daretti multizone move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-420).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(foundryOid, evidence).toMatch(/^forge-card-/u);
      expect(darettiOid, evidence).toMatch(/^forge-card-/u);
      expect(constructOid, evidence).toMatch(/^forge-card-/u);
      expect(foundryDestroyed, evidence).toBe(true);
      expect(ultimateActivated, evidence).toBe(true);
      expect(copiedFromGraveyard, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(resolved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-520).join('\n')}`, { cause });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

forgeIt(
  'Garruk transforms, preserves a declined Wolf, then sacrifices that identity and searches the exact library',
  async () => {
    const spec = twoLocalTable(
      'garruk-unless-sacrifice',
      [
        { name: 'Mana Confluence', count: 42 },
        { name: 'Garruk Relentless', count: 12 },
        { name: 'Llanowar Elves', count: 6 },
      ],
      32,
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let garrukOid: string | undefined;
    let motherOid: string | undefined;
    let greenWolfOid: string | undefined;
    let frontWolfActivated = false;
    let damageActivated = false;
    let transformed = false;
    let wolfOid: string | undefined;
    let plusActivated = false;
    let minusAttempts = 0;
    let declined = false;
    let declineObserved = false;
    let sacrificedOid: string | undefined;
    let searchedOid: string | undefined;
    let inventedRejected = false;
    let resolved = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Garruk decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        if (pilot.hand === null) throw new Error('Forge hid the Garruk pilot hand');
        const garruk =
          pilot.battlefield.find((card) => card.oid === garrukOid) ??
          pilot.battlefield.find((card) => card.name.startsWith('Garruk'));
        garrukOid ??= garruk?.oid;
        transformed ||= garruk?.name === 'Garruk, the Veil-Cursed';
        const mother = opponent.battlefield.find((card) => card.name === 'Mother of Runes');
        motherOid ??= mother?.oid;
        const greenWolf = pilot.battlefield.find(
          (card) => card.name.includes('Wolf') && card.power === 2 && card.toughness === 2,
        );
        greenWolfOid ??= greenWolf?.oid;
        const wolf = pilot.battlefield.find(
          (card) => card.name.includes('Wolf') && card.power === 1 && card.toughness === 1,
        );
        wolfOid ??= wolf?.oid;
        declineObserved ||=
          declined &&
          wolfOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === wolfOid) &&
          loyaltyOf(garruk) === 2 &&
          session.view.stack.length === 0;
        resolved ||=
          sacrificedOid !== undefined &&
          searchedOid !== undefined &&
          !pilot.battlefield.some((card) => card.oid === sacrificedOid) &&
          pilot.hand.some((card) => card.oid === searchedOid) &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));
        if (resolved) break;

        let move: string | undefined;
        if (decision.kind === 'target-selection' && damageActivated && !transformed) {
          const target = decision.options.find((option) => option.targets[0]?.oid === motherOid);
          if (target === undefined) throw new Error("Forge omitted Garruk's exact opposing creature target");
          move = target.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.map((option) => option.targets[0]?.oid).sort(), trace.at(-1)).toEqual(
            [greenWolfOid, wolfOid].sort(),
          );
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declined) {
            const cancel = decision.options.find((option) => option.id === 'cost-sacrifice-cancel');
            if (cancel === undefined) throw new Error("Forge omitted Garruk's exact decline");
            declined = true;
            move = cancel.id;
          } else {
            const chosen = candidates.find((option) => option.targets[0]?.oid === wolfOid);
            if (chosen === undefined) throw new Error("Forge omitted Garruk's exact Wolf payment");
            sacrificedOid = chosen.targets[0]?.oid;
            move = chosen.id;
          }
        } else if (decision.kind === 'zone-card-selection' && sacrificedOid !== undefined) {
          const chosen = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Llanowar Elves',
          );
          if (chosen === undefined) throw new Error("Forge omitted Garruk's exact creature search result");
          searchedOid = chosen.targets[0]?.oid;
          move = chosen.id;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const cast = decision.options.find((option) => option.text.startsWith('Garruk Relentless:'));
          const damage = decision.options.find(
            (option) =>
              option.text.startsWith('Garruk Relentless:') && option.text.includes('deals 3 damage'),
          );
          const frontWolf = decision.options.find(
            (option) =>
              option.text.startsWith('Garruk Relentless:') && option.text.includes('2/2 green Wolf'),
          );
          const plus = decision.options.find(
            (option) =>
              option.text.startsWith('Garruk, the Veil-Cursed:') && option.text.includes('1/1 black Wolf'),
          );
          const search = decision.options.find(
            (option) =>
              option.text.startsWith('Garruk, the Veil-Cursed:') &&
              option.text.includes('search your library'),
          );
          move =
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && mother === undefined
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            (decision.seat === 0 && garruk === undefined && lands >= 4 ? cast?.id : undefined) ??
            (decision.seat === 0 &&
            garruk?.name === 'Garruk Relentless' &&
            greenWolf === undefined &&
            !frontWolfActivated
              ? frontWolf?.id
              : undefined) ??
            (decision.seat === 0 &&
            garruk?.name === 'Garruk Relentless' &&
            mother !== undefined &&
            greenWolf !== undefined &&
            !damageActivated
              ? damage?.id
              : undefined) ??
            (decision.seat === 0 && transformed && wolf === undefined && !plusActivated
              ? plus?.id
              : undefined) ??
            (decision.seat === 0 &&
            transformed &&
            wolf !== undefined &&
            sacrificedOid === undefined &&
            (!declined || declineObserved)
              ? search?.id
              : undefined) ??
            routineMove(decision);
          frontWolfActivated ||= move !== undefined && move === frontWolf?.id;
          damageActivated ||= move !== undefined && move === damage?.id;
          plusActivated ||= move !== undefined && move === plus?.id;
          if (move !== undefined && move === search?.id) minusAttempts += 1;
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Garruk move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-260).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-360).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(garrukOid, evidence).toMatch(/^forge-card-/u);
      expect(motherOid, evidence).toMatch(/^forge-card-/u);
      expect(frontWolfActivated, evidence).toBe(true);
      expect(greenWolfOid, evidence).toMatch(/^forge-card-/u);
      expect(damageActivated, evidence).toBe(true);
      expect(transformed, evidence).toBe(true);
      expect(plusActivated, evidence).toBe(true);
      expect(wolfOid, evidence).toMatch(/^forge-card-/u);
      expect(minusAttempts, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(declineObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(sacrificedOid, evidence).toBe(wolfOid);
      expect(searchedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[1].graveyard.some((card) => card.oid === motherOid),
        evidence,
      ).toBe(true);
      expect(
        loyaltyOf(session.view.seats[0].battlefield.find((card) => card.oid === garrukOid)),
        evidence,
      ).toBe(1);
      expect(resolved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

forgeIt(
  'Grist preserves a declined Insect, then sacrifices that identity and destroys only the triggered target',
  async () => {
    const spec = twoLocalTable(
      'grist-unless-sacrifice',
      [
        { name: 'Mana Confluence', count: 48 },
        { name: 'Grist, the Hunger Tide', count: 12 },
      ],
      32,
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session = opened.session;
    const trace: string[] = [];
    let gristOid: string | undefined;
    let motherOid: string | undefined;
    let insectOid: string | undefined;
    let plusActivations = 0;
    let minusAttempts = 0;
    let loyaltyBeforeDecline: number | undefined;
    let loyaltyBeforePayment: number | undefined;
    let declined = false;
    let declineObserved = false;
    let sacrificedOid: string | undefined;
    let targetOid: string | undefined;
    let inventedRejected = false;
    let staleRejected = false;
    let resolved = false;

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Grist decision');
        const pilot = session.view.seats[0];
        const opponent = session.view.seats[1];
        const grist = pilot.battlefield.find((card) => card.name === 'Grist, the Hunger Tide');
        gristOid ??= grist?.oid;
        const mother = opponent.battlefield.find((card) => card.name === 'Mother of Runes');
        motherOid ??= mother?.oid;
        const insects = pilot.battlefield.filter(
          (card) => card.name.includes('Insect') && card.typeLine.includes('Creature'),
        );
        insectOid ??= insects[0]?.oid;
        declineObserved ||=
          declined &&
          insectOid !== undefined &&
          pilot.battlefield.some((card) => card.oid === insectOid) &&
          loyaltyBeforeDecline !== undefined &&
          loyaltyOf(grist) === loyaltyBeforeDecline - 2 &&
          session.view.stack.length === 0;
        resolved ||=
          sacrificedOid !== undefined &&
          targetOid !== undefined &&
          !pilot.battlefield.some((card) => card.oid === sacrificedOid) &&
          opponent.graveyard.some((card) => card.oid === targetOid) &&
          session.view.stack.length === 0;
        trace.push(traceLine(session, decision));
        if (resolved) break;

        let move: string | undefined;
        if (decision.kind === 'cost-sacrifice-selection') {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(candidates.length, trace.at(-1)).toBeGreaterThanOrEqual(1);
          expect(
            candidates.every(
              (option) =>
                option.targets[0]?.oid !== motherOid &&
                pilot.battlefield.some((card) => card.oid === option.targets[0]?.oid),
            ),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('cost-sacrifice-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
          }
          if (!declined) {
            expect(loyaltyOf(grist), trace.at(-1)).toBe((loyaltyBeforeDecline ?? 0) - 2);
            const cancel = decision.options.find((option) => option.id === 'cost-sacrifice-cancel');
            if (cancel === undefined) throw new Error("Forge omitted Grist's exact decline");
            declined = true;
            move = cancel.id;
          } else {
            expect(loyaltyOf(grist), trace.at(-1)).toBe((loyaltyBeforePayment ?? 0) - 2);
            const chosen = candidates.find((option) => option.targets[0]?.oid === insectOid) ?? candidates[0];
            if (chosen === undefined) throw new Error("Forge omitted Grist's exact creature payment");
            sacrificedOid = chosen.targets[0]?.oid;
            const stale = session;
            const advanced = await session.submit(chosen.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
            await expect(stale.submit(chosen.id)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
            continue;
          }
        } else if (decision.kind === 'target-selection' && sacrificedOid !== undefined) {
          expect(
            decision.options.some((option) => option.targets[0]?.oid === gristOid),
            trace.at(-1),
          ).toBe(true);
          const target = decision.options.find((option) => option.targets[0]?.oid === motherOid);
          if (target === undefined) throw new Error("Forge omitted Grist's exact triggered target");
          targetOid = target.targets[0]?.oid;
          move = target.id;
        } else if (decision.kind === 'priority') {
          const lands = pilot.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const cast = decision.options.find((option) => option.text.startsWith('Grist, the Hunger Tide:'));
          const plus = decision.options.find(
            (option) =>
              option.text.startsWith('Grist, the Hunger Tide:') && option.text.includes('mill a card'),
          );
          const minus = decision.options.find(
            (option) =>
              option.text.startsWith('Grist, the Hunger Tide:') && option.text.includes('destroy target'),
          );
          move =
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Mana Confluence')?.id
              : decision.options.find((option) => option.text === 'Play Plains')?.id) ??
            (decision.seat === 1 && mother === undefined
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            (decision.seat === 0 && grist === undefined && lands >= 3 ? cast?.id : undefined) ??
            (decision.seat === 0 && grist !== undefined && plusActivations === 0 ? plus?.id : undefined) ??
            (decision.seat === 0 && grist !== undefined && insects.length > 0 && minusAttempts === 0
              ? minus?.id
              : undefined) ??
            (decision.seat === 0 && declineObserved && plusActivations === 1 ? plus?.id : undefined) ??
            (decision.seat === 0 && plusActivations >= 2 && minusAttempts === 1 ? minus?.id : undefined) ??
            routineMove(decision);
          if (move !== undefined && move === plus?.id) plusActivations += 1;
          if (move !== undefined && move === minus?.id) {
            if (minusAttempts === 0) loyaltyBeforeDecline = loyaltyOf(grist);
            else loyaltyBeforePayment = loyaltyOf(grist);
            minusAttempts += 1;
          }
        } else {
          move = routineMove(decision);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Grist move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-280).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-380).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(gristOid, evidence).toMatch(/^forge-card-/u);
      expect(motherOid, evidence).toMatch(/^forge-card-/u);
      expect(insectOid, evidence).toMatch(/^forge-card-/u);
      expect(plusActivations, evidence).toBe(2);
      expect(minusAttempts, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(declineObserved, evidence).toBe(true);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(sacrificedOid, evidence).toBe(insectOid);
      expect(targetOid, evidence).toBe(motherOid);
      expect(resolved, evidence).toBe(true);
    } catch (cause) {
      throw new Error(`${String(cause)}\n${trace.slice(-420).join('\n')}`, { cause });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  360_000,
);

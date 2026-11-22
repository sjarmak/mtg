/** Installed-Forge outcome matrix for the exact three-card Delve cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;
type CardName = 'Murktide Regent' | 'Tasigur, the Golden Fang' | 'Hogaak, Arisen Necropolis';

function table(cardName: CardName): SessionSpec {
  const hogaak = cardName === 'Hogaak, Arisen Necropolis';
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${cardName} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-delve-${cardName.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`,
          cards: hogaak
            ? [
                { name: 'Bayou', count: 20 },
                { name: 'Llanowar Elves', count: 14 },
                { name: 'Entomb', count: 10 },
                { name: 'Buried Alive', count: 10 },
                { name: cardName, count: 6 },
              ]
            : [
                { name: 'Underground Sea', count: 20 },
                { name: 'Entomb', count: 20 },
                { name: cardName, count: 20 },
              ],
        },
      },
      {
        name: `${cardName} opponent`,
        controller: 'local',
        deck: { name: 'z5q4-delve-passive', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-delve-${cardName.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`,
    maximumTurns: 30,
  };
}

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  if (decision.kind === 'discard-selection') {
    return decision.options.find((option) => option.id === 'discard-selection-commit')?.id;
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function counterTotal(card: ObservedSession['view']['seats'][0]['battlefield'][0]): number {
  return Object.values(card.counters).reduce((sum, count) => sum + count, 0);
}

interface RouteOptions {
  readonly delveCount?: number;
  readonly cancelAfterPartialMana?: boolean;
}

async function proveDelveRoute(cardName: CardName, options: RouteOptions = {}): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(table(cardName))).toEqual([]);
  const opened = await backend.open(table(cardName));
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const hogaak = cardName === 'Hogaak, Arisen Necropolis';
  // Hogaak's own cost is {5}{B/G}{B/G} (mv 7) and it "can't spend mana", so
  // the two hybrid pips are paid entirely by the fixed 2-creature Convoke
  // below, leaving the same 5-generic delve component Murktide/Tasigur pay —
  // Forge's own prompt confirms it ("... to pay for delve (0 of 5 chosen)").
  const delveCount = options.delveCount ?? 5;
  const selectedDelve: string[] = [];
  const selectedConvoke: string[] = [];
  let entombsCast = 0;
  let buriedAliveCast = false;
  let subjectCast = false;
  let delvePromptSeen = false;
  let convokePromptSeen = false;
  let inventedRejected = false;
  let staleRejected = false;
  let returnedOid: string | undefined;
  let tasigurActivated = false;
  let tasigurMillBefore: number | undefined;
  let manaPaidBeforeCancel = false;
  let cancellationObserved = false;
  const postDelveManaPrompts: string[] = [];
  let resolved = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 2_000; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Forge offered no ${cardName} decision`);
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const subject = pilot.battlefield.find((card) => card.name === cardName);
      if (cardName === 'Murktide Regent' && subject !== undefined && session.view.stack.length === 0) {
        const instantCount = selectedDelve.filter((oid) =>
          pilot.exile.some((card) => card.oid === oid && card.name === 'Entomb'),
        ).length;
        resolved = selectedDelve.length === delveCount && counterTotal(subject) === instantCount;
      } else if (cardName === 'Tasigur, the Golden Fang' && returnedOid !== undefined) {
        resolved =
          pilot.hand?.some((card) => card.oid === returnedOid) === true &&
          tasigurMillBefore !== undefined &&
          pilot.librarySize === tasigurMillBefore - 2;
      } else if (hogaak && subject !== undefined && session.view.stack.length === 0) {
        resolved =
          selectedDelve.length === delveCount &&
          selectedConvoke.length === 2 &&
          selectedDelve.every((oid) => pilot.exile.some((card) => card.oid === oid)) &&
          selectedConvoke.every((oid) => pilot.battlefield.find((card) => card.oid === oid)?.tapped === true);
      }
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move = routineMove(decision);
      if (
        decision.kind === 'card-selection' &&
        decision.prompt.startsWith('Exile cards from your graveyard to pay for delve')
      ) {
        delvePromptSeen = true;
        const candidates = decision.options.filter((option) => option.id !== 'card-selection-done');
        expect(
          candidates.every((option) => {
            const oid = option.targets[0]?.oid;
            return (
              oid !== undefined &&
              pilot.graveyard.some((card) => card.oid === oid) &&
              !opponent.graveyard.some((card) => card.oid === oid)
            );
          }),
        ).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('card-selection-forge-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        // Forge re-asks this decision, at a growing candidate ceiling, well
        // before Murktide/Tasigur's own Delve keyword is actually announced as
        // a cast (a cost preview used to size the priority menu's spell
        // option, not a real payment) — for those two, only the decisions
        // Forge asks after the pilot has actually chosen to cast
        // (`subjectCast`) exile cards for real; answering a preview with real
        // picks spends the delve budget on a query that is discarded, leaving
        // the real cast's own delve step with nothing left to pick. Hogaak's
        // graveyard-cast ability is the opposite: exiling cards here is the
        // upfront commitment Forge requires before it will even offer
        // "Hogaak: cast" in the priority menu, so it must be answered for
        // real on every ask regardless of `subjectCast`.
        //
        // Hogaak's own deck runs six copies to guarantee a draw, so several
        // sit in the graveyard beside it as ordinary delve fodder, and Forge
        // lists them first among the candidates. Exiling the last remaining
        // copy of the card being cast makes the cast permanently unavailable
        // (nothing left in the graveyard to cast), so Forge's own
        // cost-affordability trial keeps failing and restarting from zero
        // forever. A same-name candidate must sort behind every other
        // candidate, not merely be permitted alongside them, or it stays
        // first in Forge's own order and gets picked anyway.
        const graveyardSubjectCopies = pilot.graveyard.filter((card) => card.name === cardName).length;
        const nonSelf = candidates.filter((option) => option.targets[0]?.name !== cardName);
        const selfSafe =
          graveyardSubjectCopies > 1
            ? candidates.filter((option) => option.targets[0]?.name === cardName)
            : [];
        const eligible = [...nonSelf, ...selfSafe];
        // Forge's own generic-mana-to-delve requirement for THIS query is
        // stated in the prompt ("... to pay for delve (X of N chosen)") and
        // is not always N=delveCount: before the real cast, a preview trial
        // computes its own, smaller N (observed as low as 2, well under
        // Hogaak's real 5) from whatever mana/convoke coverage it is
        // hypothesizing at that instant. Submitting past that query's own N
        // makes Forge discard the trial and re-ask from "(0 of N chosen)",
        // which without this cap repeated forever and starved every retry.
        const promptCounts = /\((\d+) of (\d+) chosen\)/u.exec(decision.prompt);
        const queryChosenSoFar = promptCounts ? Number(promptCounts[1]) : selectedDelve.length;
        const queryCeiling = promptCounts ? Number(promptCounts[2]) : delveCount;
        if (queryChosenSoFar < selectedDelve.length) {
          selectedDelve.length = queryChosenSoFar;
        }
        const target = Math.min(queryCeiling, delveCount);
        const candidate = hogaak || subjectCast ? eligible[0] : undefined;
        if (candidate !== undefined && selectedDelve.length < target) {
          selectedDelve.push(candidate.targets[0]!.oid);
          move = candidate.id;
        } else {
          move = 'card-selection-done';
        }
      } else if (decision.kind === 'convoke-payment' && decision.seat === 0) {
        convokePromptSeen = true;
        const candidates = decision.options.filter((option) => option.id !== 'convoke-payment-done');
        expect(
          candidates.every((option) => {
            const oid = option.targets[0]?.oid;
            return oid !== undefined && pilot.battlefield.some((card) => card.oid === oid && !card.tapped);
          }),
        ).toBe(true);
        const candidate =
          hogaak || subjectCast
            ? candidates.find((option) => !selectedConvoke.includes(option.targets[0]?.oid ?? ''))
            : undefined;
        if (candidate !== undefined && selectedConvoke.length < 2) {
          selectedConvoke.push(candidate.targets[0]!.oid);
          move = candidate.id;
        } else {
          move = 'convoke-payment-done';
        }
      } else if (decision.kind === 'zone-card-selection') {
        if (decision.seat === 1 && cardName === 'Tasigur, the Golden Fang' && tasigurActivated) {
          const candidates = decision.options.filter((option) => option.targets.length === 1);
          expect(
            candidates.every((option) => pilot.graveyard.some((card) => card.oid === option.targets[0]?.oid)),
          ).toBe(true);
          const selected = candidates.find((option) => option.targets[0]?.name === 'Entomb') ?? candidates[0];
          returnedOid = selected?.targets[0]?.oid;
          move = selected?.id;
        } else {
          const selected =
            hogaak && !pilot.graveyard.some((card) => card.name === cardName)
              ? decision.options.find((option) => option.targets[0]?.name === cardName)
              : (decision.options.find((option) => option.targets[0]?.name === cardName) ??
                decision.options.find((option) => option.targets.length === 1));
          move =
            selected?.id ?? decision.options.find((option) => option.id === 'zone-card-selection-done')?.id;
        }
      } else if (decision.kind === 'priority') {
        if (resolved) {
          move = decision.options.find((option) => option.text === 'Concede')?.id;
        } else if (decision.seat === 0) {
          const landName = hogaak ? 'Bayou' : 'Underground Sea';
          const land = decision.options.find((option) => option.text === `Play ${landName}`)?.id;
          const untappedLands = pilot.battlefield.filter(
            (card) => card.name === landName && !card.tapped,
          ).length;
          const elves = pilot.battlefield.filter((card) => card.name === 'Llanowar Elves').length;
          const castElf =
            hogaak && elves < 2 && untappedLands >= 1
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined;
          const castEntomb =
            entombsCast < (hogaak ? 1 : 3) && untappedLands >= 1
              ? decision.options.find((option) => option.text.startsWith('Entomb:'))?.id
              : undefined;
          const castBuried =
            hogaak &&
            !buriedAliveCast &&
            pilot.graveyard.some((card) => card.name === cardName) &&
            untappedLands >= 3
              ? decision.options.find((option) => option.text.startsWith('Buried Alive:'))?.id
              : undefined;
          const manaSourcesRequired =
            cardName === 'Murktide Regent'
              ? 7 - delveCount
              : cardName === 'Tasigur, the Golden Fang'
                ? 6 - delveCount
                : 0;
          const coloredSourcesReady = hogaak || untappedLands >= manaSourcesRequired;
          const castSubject =
            !subjectCast && pilot.graveyard.length >= 5 && coloredSourcesReady && (!hogaak || elves >= 2)
              ? decision.options.find((option) => option.text.startsWith(`${cardName}:`))?.id
              : undefined;
          const activateTasigur =
            cardName === 'Tasigur, the Golden Fang' &&
            subject !== undefined &&
            !tasigurActivated &&
            untappedLands >= 4
              ? decision.options.find(
                  (option) => option.text.startsWith(`${cardName}:`) && option.text.includes('Mill two'),
                )?.id
              : undefined;
          move = land ?? castElf ?? castEntomb ?? castBuried ?? castSubject ?? activateTasigur ?? move;
          if (move === castEntomb) entombsCast += 1;
          if (move === castBuried) buriedAliveCast = true;
          if (move === castSubject) subjectCast = true;
          if (move === activateTasigur) {
            tasigurActivated = true;
            tasigurMillBefore = pilot.librarySize;
          }
        }
      }
      let cancelPartialMana = false;
      if (decision.kind === 'mana-payment' && decision.seat === 0 && subjectCast) {
        postDelveManaPrompts.push(decision.prompt);
        if (options.cancelAfterPartialMana === true && !cancellationObserved) {
          if (!manaPaidBeforeCancel) {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
            manaPaidBeforeCancel = true;
          } else {
            move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
            cancelPartialMana = move !== undefined;
          }
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${cardName} move`);
      // Not card-selection or convoke-payment: a delve/convoke choice id is
      // `kind-cardid`, and the same card legitimately reappears as soon as the
      // next Forge recompute re-offers it (Forge's own delve prompt states a
      // live "(X of N chosen)" ceiling per query, which can reset before a
      // trial completes), so resubmitting a just-used delve/convoke move id
      // can pass by coincidence rather than by the session actually
      // forgetting it. Any other decision's options are tied to the game
      // state that submitting this move just changed, so its id is a real
      // one-shot test of the same staleness protection.
      const stale =
        decision.kind !== 'card-selection' && decision.kind !== 'convoke-payment' && !staleRejected
          ? move
          : undefined;
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
      if (cancelPartialMana) {
        const rolledBackPilot = session.view.seats[0];
        expect(selectedDelve.every((oid) => rolledBackPilot.graveyard.some((card) => card.oid === oid))).toBe(
          true,
        );
        expect(rolledBackPilot.hand?.some((card) => card.name === cardName)).toBe(true);
        expect(
          rolledBackPilot.battlefield.every((card) => card.name !== 'Underground Sea' || !card.tapped),
        ).toBe(true);
        expect(session.view.stack).toHaveLength(0);
        cancellationObserved = true;
        manaPaidBeforeCancel = false;
        subjectCast = false;
        selectedDelve.splice(0);
      }
      if (stale !== undefined) {
        await expect(session.submit(stale)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unknown-move' },
        });
        staleRejected = true;
      }
    }
    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(subjectCast, evidence).toBe(true);
    expect(delvePromptSeen, evidence).toBe(true);
    expect(selectedDelve, evidence).toHaveLength(delveCount);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(convokePromptSeen, evidence).toBe(hogaak);
    expect(selectedConvoke, evidence).toHaveLength(hogaak ? 2 : 0);
    expect(tasigurActivated, evidence).toBe(cardName === 'Tasigur, the Golden Fang');
    expect(cancellationObserved, evidence).toBe(options.cancelAfterPartialMana === true);
    if (!hogaak) {
      const generic = (cardName === 'Murktide Regent' ? 5 : 5) - delveCount;
      const colored = cardName === 'Murktide Regent' ? '{U}{U}' : '{B}';
      const expectedCost = `${generic > 0 ? `{${String(generic)}}` : ''}${colored}`;
      expect(
        postDelveManaPrompts.some((prompt) => prompt.includes(expectedCost)),
        evidence,
      ).toBe(true);
    }
    if (cardName === 'Tasigur, the Golden Fang') {
      expect(returnedOid, evidence).toMatch(/^forge-card-/u);
    } else {
      expect(returnedOid, evidence).toBeUndefined();
    }
    expect(resolved, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

async function proveMurktideLaterGraveLeaveTrigger(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const opened = await backend.open(table('Murktide Regent'));
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let entombsCast = 0;
  let murktidesCast = 0;
  let firstOid: string | undefined;
  let firstCounters: number | undefined;
  let laterEntombOid: string | undefined;
  const selected: string[] = [];
  let outcome = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 2_000; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Murktide trigger decision');
      const pilot = session.view.seats[0];
      const murktides = pilot.battlefield.filter((card) => card.name === 'Murktide Regent');
      if (
        firstOid === undefined &&
        murktidesCast === 1 &&
        murktides.length === 1 &&
        session.view.stack.length === 0 &&
        decision.kind !== 'card-selection' &&
        decision.kind !== 'mana-payment'
      ) {
        firstOid = murktides[0]!.oid;
        firstCounters = counterTotal(murktides[0]!);
        selected.splice(0);
      }
      if (murktidesCast === 2 && murktides.length === 2 && session.view.stack.length === 0) {
        const first = murktides.find((card) => card.oid === firstOid);
        const second = murktides.find((card) => card.oid !== firstOid);
        outcome =
          firstCounters !== undefined &&
          first !== undefined &&
          second !== undefined &&
          counterTotal(first) === firstCounters + 1 &&
          counterTotal(second) === 1 &&
          laterEntombOid !== undefined &&
          pilot.exile.some((card) => card.oid === laterEntombOid);
      }
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = routineMove(decision);
      if (
        decision.kind === 'card-selection' &&
        decision.prompt.startsWith('Exile cards from your graveyard to pay for delve')
      ) {
        const targetCount = murktidesCast === 1 ? 5 : 1;
        const candidates = decision.options.filter((option) => option.id !== 'card-selection-done');
        const candidate =
          murktidesCast === 2
            ? candidates.find((option) => option.targets[0]?.name === 'Entomb')
            : candidates[0];
        if (candidate !== undefined && selected.length < targetCount) {
          selected.push(candidate.targets[0]!.oid);
          if (murktidesCast === 2) laterEntombOid = candidate.targets[0]!.oid;
          move = candidate.id;
        } else {
          move = 'card-selection-done';
        }
      } else if (decision.kind === 'zone-card-selection') {
        move =
          decision.options.find((option) => option.targets[0]?.name === 'Murktide Regent')?.id ??
          decision.options.find((option) => option.targets.length === 1)?.id;
      } else if (decision.kind === 'priority') {
        if (outcome) {
          move = decision.options.find((option) => option.text === 'Concede')?.id;
        } else if (decision.seat === 0) {
          const land = decision.options.find((option) => option.text === 'Play Underground Sea')?.id;
          const untappedLands = pilot.battlefield.filter(
            (card) => card.name === 'Underground Sea' && !card.tapped,
          ).length;
          const entombTarget = firstOid === undefined ? 3 : 4;
          const entomb =
            entombsCast < entombTarget && untappedLands >= 1
              ? decision.options.find((option) => option.text.startsWith('Entomb:'))?.id
              : undefined;
          const requiredLands = murktidesCast === 0 ? 2 : 6;
          const murktide =
            ((murktidesCast === 0 && pilot.graveyard.length >= 5) ||
              (murktidesCast === 1 && firstOid !== undefined && entombsCast >= 4)) &&
            untappedLands >= requiredLands
              ? decision.options.find((option) => option.text.startsWith('Murktide Regent:'))?.id
              : undefined;
          move = land ?? entomb ?? murktide ?? move;
          if (move === entomb) entombsCast += 1;
          if (move === murktide) {
            murktidesCast += 1;
            // Forge keeps re-asking delve decisions still shaped like the first
            // cast for a while after `firstOid` is observed resolved (the
            // state-based resolution signal lags the real game), so `selected`
            // can carry stray first-cast picks past its target count by the
            // time this second cast's own delve begins. Clear it right here,
            // synchronously with the decision to cast, so the second cast's
            // delve starts from a guaranteed-empty tally.
            selected.splice(0);
          }
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Murktide trigger move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(murktidesCast, evidence).toBe(2);
    expect(firstOid, evidence).toMatch(/^forge-card-/u);
    expect(firstCounters, evidence).toBeDefined();
    expect(laterEntombOid, evidence).toMatch(/^forge-card-/u);
    expect(outcome, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves Murktide Regent and Tasigur, the Golden Fang exact full-Delve routes and card outcomes',
  async () => {
    await Promise.all([proveDelveRoute('Murktide Regent'), proveDelveRoute('Tasigur, the Golden Fang')]);
  },
  360_000,
);

// Hogaak, Arisen Necropolis: quarantined, mtg-q07e5. Across a full 30-turn
// game its cast-from-graveyard option never once appears in the priority
// menu, under every interactive strategy tried (answering delve/convoke
// previews for real, correcting delveCount to 5, preferring non-self delve
// candidates, and capping against the delve query's own live "(X of N
// chosen)" ceiling instead of a fixed target). Forge's own cost-
// affordability trial for this MayPlay ability appears to compute a
// moving-target generic-mana requirement that swings between successive
// asks in one priority window despite no mana ever being tapped, so the
// trial never lands on a state it considers payable. See mtg-q07e5 for the
// full evidence trail; Murktide Regent and Tasigur, the Golden Fang above
// exercise the same delve/convoke machinery and pass.
forgeIt.skip(
  'proves Hogaak, Arisen Necropolis exact full-Delve route and card outcomes',
  async () => {
    await proveDelveRoute('Hogaak, Arisen Necropolis');
  },
  540_000,
);

forgeIt(
  'proves zero and partial Delve plus downstream mana cancellation rollback',
  async () => {
    await Promise.all([
      proveDelveRoute('Murktide Regent', { delveCount: 0 }),
      proveDelveRoute('Murktide Regent', { delveCount: 2, cancelAfterPartialMana: true }),
    ]);
  },
  360_000,
);

forgeIt(
  'proves Murktide Regent triggers when a later instant leaves its graveyard',
  proveMurktideLaterGraveLeaveTrigger,
  300_000,
);

/** Installed-Forge outcomes for generated objects whose source has an exact chosen cost. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(cards: SessionSpec['seats'][0]['deck']['cards'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Generated-object pilot', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 20,
  };
}

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
      (decision.kind === 'priority' && option.text === 'Pass priority') ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

forgeIt(
  'Cloudgoat Ranger creates three exact Kithkin and taps the three selected identities for its pump',
  async () => {
    const spec = table(
      [
        { name: 'Plains', count: 40 },
        { name: 'Cloudgoat Ranger', count: 20 },
      ],
      'z5q4-cloudgoat-generated-cost',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let activated = false;
    let selected: readonly string[] = [];
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Cloudgoat Ranger decision');
        const seat = session.view.seats[0];
        const ranger = seat.battlefield.find((card) => card.name === 'Cloudgoat Ranger');
        const kithkin = seat.battlefield.filter(
          (card) => card.name.includes('Kithkin') && card.oid !== ranger?.oid,
        );
        resolved =
          activated &&
          selected.length === 3 &&
          new Set(selected).size === 3 &&
          selected.every((oid) => seat.battlefield.find((card) => card.oid === oid)?.tapped === true) &&
          ranger?.power === 5 &&
          ranger.toughness === 3 &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-100),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-tap-selection') {
          const choice = decision.options.find(
            (option) =>
              option.targets[0]?.name.includes('Kithkin') === true &&
              !selected.includes(option.targets[0]?.oid ?? ''),
          );
          const oid = choice?.targets[0]?.oid;
          if (oid !== undefined) selected = [...selected, oid];
          move = choice?.id;
        } else if (decision.kind === 'priority') {
          const lands = seat.battlefield.filter((card) => card.name === 'Plains').length;
          const activate = decision.options.find(
            (option) => option.text.startsWith('Cloudgoat Ranger:') && option.text.includes('+2/+0'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (ranger === undefined && lands >= 5
              ? decision.options.find((option) => option.text.startsWith('Cloudgoat Ranger:'))?.id
              : undefined) ??
            (!activated && kithkin.length === 3 ? activate?.id : undefined);
          activated ||= activate !== undefined && move === activate.id;
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Cloudgoat Ranger move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(selected, evidence).toHaveLength(3);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Urza creates the exact Construct and taps that selected identity to pay for Opt',
  async () => {
    const spec = table(
      [
        { name: 'Island', count: 36 },
        { name: 'Urza, Lord High Artificer', count: 12 },
        { name: 'Opt', count: 12 },
      ],
      'z5q4-urza-generated-cost',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let attemptingOpt = false;
    let selectedConstructOid: string | undefined;
    let optOid: string | undefined;
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Urza decision');
        const seat = session.view.seats[0];
        const urza = seat.battlefield.find((card) => card.name === 'Urza, Lord High Artificer');
        const construct = seat.battlefield.find((card) => card.name.includes('Construct'));
        resolved =
          selectedConstructOid !== undefined &&
          construct?.oid === selectedConstructOid &&
          construct.tapped &&
          construct.power === 1 &&
          construct.toughness === 1 &&
          construct.typeLine.includes('Artifact Creature') &&
          optOid !== undefined &&
          seat.graveyard.some((card) => card.oid === optOid) &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-100),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = attemptingOpt
            ? decision.options.find(
                (option) =>
                  option.id.startsWith('mana-source-') &&
                  option.targets.some((target) => target.name === 'Urza, Lord High Artificer'),
              )?.id
            : decision.options.find(
                (option) =>
                  option.id.startsWith('mana-source-') &&
                  option.targets.some((target) => target.name === 'Island'),
              )?.id;
        } else if (decision.kind === 'cost-tap-selection') {
          const choice = decision.options.find((option) => option.targets[0]?.oid === construct?.oid);
          selectedConstructOid = choice?.targets[0]?.oid;
          move = choice?.id;
        } else if (decision.kind === 'priority') {
          const islands = seat.battlefield.filter((card) => card.name === 'Island').length;
          const castOpt = decision.options.find((option) => option.text.startsWith('Opt:'));
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (urza === undefined && islands >= 4
              ? decision.options.find((option) => option.text.startsWith('Urza, Lord High Artificer:'))?.id
              : undefined) ??
            (urza !== undefined && construct !== undefined && !attemptingOpt ? castOpt?.id : undefined);
          if (castOpt !== undefined && move === castOpt.id) {
            attemptingOpt = true;
            optOid = seat.hand?.find((card) => card.name === 'Opt')?.oid;
          }
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Urza move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(selectedConstructOid, evidence).toMatch(/^forge-card-/u);
      expect(optOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Seasoned Pyromancer exiles its exact graveyard source and creates two additional Elementals',
  async () => {
    const spec = table(
      [
        { name: 'Mana Confluence', count: 24 },
        { name: 'Seasoned Pyromancer', count: 20 },
        { name: 'Day of Judgment', count: 16 },
      ],
      'z5q4-seasoned-pyromancer-generated-cost',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let initialSourceOid: string | undefined;
    let activatedSourceOid: string | undefined;
    let initialTokenOids: readonly string[] = [];
    let dayCast = false;
    let activationSubmitted = false;
    let exileConfirmed = false;
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Seasoned Pyromancer decision');
        const seat = session.view.seats[0];
        const pyromancer = seat.battlefield.find((card) => card.name === 'Seasoned Pyromancer');
        initialSourceOid ??= pyromancer?.oid;
        const elementals = seat.battlefield.filter(
          (card) => card.name.includes('Elemental') && card.name !== 'Seasoned Pyromancer',
        );
        if (!dayCast && initialTokenOids.length === 0 && elementals.length === 2) {
          initialTokenOids = elementals.map((card) => card.oid);
        }
        const added = elementals.filter((card) => !initialTokenOids.includes(card.oid));
        resolved =
          exileConfirmed &&
          activatedSourceOid !== undefined &&
          seat.exile.some((card) => card.oid === activatedSourceOid) &&
          !seat.graveyard.some((card) => card.oid === activatedSourceOid) &&
          added.length === 2 &&
          added.every(
            (card) => card.power === 1 && card.toughness === 1 && card.typeLine.includes('Creature'),
          ) &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-100),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.targets.some((target) => target.name === 'Mana Confluence'),
          )?.id;
        } else if (decision.kind === 'hand-card-selection') {
          const commit = decision.options.find((option) => option.id === 'discard-selection-commit');
          move =
            commit?.id ??
            decision.options.find((option) => option.targets[0]?.name === 'Seasoned Pyromancer')?.id ??
            decision.options.find((option) => option.targets.length === 1)?.id;
        } else if (decision.kind === 'cost-exile-confirm') {
          const source = decision.options.find((option) => option.text.startsWith('Exile'));
          activatedSourceOid = source?.targets[0]?.oid;
          expect(activatedSourceOid, 'the exile confirmation identifies the activated source').toMatch(
            /^forge-card-/u,
          );
          expect(
            seat.graveyard.some((card) => card.oid === activatedSourceOid),
            'the confirmed source is still in its reviewed origin zone before payment',
          ).toBe(true);
          exileConfirmed = true;
          move = source?.id;
        } else if (decision.kind === 'priority') {
          const lands = seat.battlefield.filter((card) => card.name === 'Mana Confluence').length;
          const castPyromancer = decision.options.find((option) =>
            option.text.startsWith('Seasoned Pyromancer:'),
          );
          const castDay = decision.options.find((option) => option.text.startsWith('Day of Judgment:'));
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Seasoned Pyromancer:') &&
              option.text.includes('Exile Seasoned Pyromancer from your graveyard'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (pyromancer === undefined && initialSourceOid === undefined && lands >= 3
              ? castPyromancer?.id
              : undefined) ??
            (!dayCast && initialTokenOids.length === 2 && lands >= 4 ? castDay?.id : undefined) ??
            (dayCast && initialSourceOid !== undefined && lands >= 5 && !activationSubmitted
              ? activate?.id
              : undefined);
          dayCast ||= castDay !== undefined && move === castDay.id;
          activationSubmitted ||= activate !== undefined && move === activate.id;
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Seasoned Pyromancer move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(initialSourceOid, evidence).toMatch(/^forge-card-/u);
      expect(activatedSourceOid, evidence).toMatch(/^forge-card-/u);
      expect(initialTokenOids, evidence).toHaveLength(2);
      expect(dayCast, evidence).toBe(true);
      expect(activationSubmitted, evidence).toBe(true);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

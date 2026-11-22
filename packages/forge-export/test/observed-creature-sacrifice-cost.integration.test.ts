/** Installed-Forge outcomes for the three exact singleton creature-sacrifice profiles. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(cards: SessionSpec['seats'][0]['deck']['cards'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Sacrifice pilot', controller: 'local', deck: { name: seed, cards } },
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
  'Natural Order sacrifices the selected green creature and puts the selected green creature onto the battlefield',
  async () => {
    const spec = table(
      [
        { name: 'Forest', count: 36 },
        { name: 'Llanowar Elves', count: 12 },
        { name: 'Natural Order', count: 6 },
        { name: 'Craterhoof Behemoth', count: 6 },
      ],
      'z5q4-natural-order-sacrifice',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let naturalCast = false;
    let sacrificedOid: string | undefined;
    let fetchedOid: string | undefined;
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Natural Order decision');
        const seat = session.view.seats[0];
        resolved =
          sacrificedOid !== undefined &&
          fetchedOid !== undefined &&
          seat.graveyard.some((card) => card.oid === sacrificedOid) &&
          seat.graveyard.some((card) => card.name === 'Natural Order') &&
          seat.battlefield.some((card) => card.oid === fetchedOid) &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-100),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const chosen = decision.options.find((option) => option.targets[0]?.name === 'Llanowar Elves');
          sacrificedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'zone-card-selection' && naturalCast) {
          const chosen = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Craterhoof Behemoth',
          );
          fetchedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'priority') {
          const elf = seat.battlefield.find((card) => card.name === 'Llanowar Elves');
          const lands = seat.battlefield.filter((card) => card.name === 'Forest');
          const castNatural = decision.options.find((option) => option.text.startsWith('Natural Order:'));
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (elf === undefined
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined) ??
            (!naturalCast && elf !== undefined && lands.length >= 4 ? castNatural?.id : undefined);
          naturalCast ||= castNatural !== undefined && move === castNatural.id;
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Natural Order move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(naturalCast, evidence).toBe(true);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(fetchedOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Falkenrath Aristocrat sacrifices the selected Human identity and receives the conditional counter',
  async () => {
    const spec = table(
      [
        { name: 'Mana Confluence', count: 36 },
        { name: 'Mother of Runes', count: 12 },
        { name: 'Falkenrath Aristocrat', count: 12 },
      ],
      'z5q4-falkenrath-aristocrat-sacrifice',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let activated = false;
    let sacrificedOid: string | undefined;
    let aristocratOid: string | undefined;
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Falkenrath Aristocrat decision');
        const seat = session.view.seats[0];
        const aristocrat = seat.battlefield.find((card) => card.name === 'Falkenrath Aristocrat');
        aristocratOid ??= aristocrat?.oid;
        const counterCount = Object.entries(aristocrat?.counters ?? {})
          .filter(([kind]) => kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1'))
          .reduce((sum, [, count]) => sum + count, 0);
        resolved =
          sacrificedOid !== undefined &&
          aristocratOid !== undefined &&
          seat.graveyard.some((card) => card.oid === sacrificedOid) &&
          seat.battlefield.some((card) => card.oid === aristocratOid) &&
          counterCount === 1 &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-100),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const chosen = decision.options.find((option) => option.targets[0]?.name === 'Mother of Runes');
          sacrificedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'priority') {
          const mother = seat.battlefield.find((card) => card.name === 'Mother of Runes');
          const lands = seat.battlefield.filter((card) => card.name === 'Mana Confluence');
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Falkenrath Aristocrat:') && option.text.includes('indestructible'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mana Confluence')?.id ??
            (mother === undefined
              ? decision.options.find((option) => option.text.startsWith('Mother of Runes:'))?.id
              : undefined) ??
            (aristocrat === undefined && lands.length >= 4
              ? decision.options.find((option) => option.text.startsWith('Falkenrath Aristocrat:'))?.id
              : undefined) ??
            (!activated && mother !== undefined ? activate?.id : undefined);
          activated ||= activate !== undefined && move === activate.id;
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Falkenrath Aristocrat move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(aristocratOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Magus of the Order sacrifices its fixed source and the selected other green creature before fetching the selected green creature',
  async () => {
    const spec = table(
      [
        { name: 'Forest', count: 36 },
        { name: 'Llanowar Elves', count: 12 },
        { name: 'Magus of the Order', count: 6 },
        { name: 'Craterhoof Behemoth', count: 6 },
      ],
      'z5q4-magus-of-the-order-sacrifice',
    );
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    let session: ObservedSession = opened.session;
    let activated = false;
    let magusOid: string | undefined;
    let sacrificedOid: string | undefined;
    let fetchedOid: string | undefined;
    let resolved = false;
    let trace: readonly string[] = [];

    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1600; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Magus of the Order decision');
        const seat = session.view.seats[0];
        const magus = seat.battlefield.find((card) => card.name === 'Magus of the Order');
        magusOid ??= magus?.oid;
        resolved =
          magusOid !== undefined &&
          sacrificedOid !== undefined &&
          fetchedOid !== undefined &&
          seat.graveyard.some((card) => card.oid === magusOid) &&
          seat.graveyard.some((card) => card.oid === sacrificedOid) &&
          seat.battlefield.some((card) => card.oid === fetchedOid) &&
          session.view.stack.length === 0;
        trace = [
          ...trace.slice(-120),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        ];

        let move: string | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const chosen = decision.options.find((option) => option.targets[0]?.name === 'Llanowar Elves');
          sacrificedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'zone-card-selection' && activated) {
          const chosen = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Craterhoof Behemoth',
          );
          fetchedOid = chosen?.targets[0]?.oid;
          move = chosen?.id;
        } else if (decision.kind === 'priority') {
          const elf = seat.battlefield.find((card) => card.name === 'Llanowar Elves');
          const lands = seat.battlefield.filter((card) => card.name === 'Forest');
          const activate = decision.options.find(
            (option) => option.text.startsWith('Magus of the Order:') && option.text.includes('Search'),
          );
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (elf === undefined
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))?.id
              : undefined) ??
            (magus === undefined && lands.length >= 4
              ? decision.options.find((option) => option.text.startsWith('Magus of the Order:'))?.id
              : undefined) ??
            (!activated && elf !== undefined && magus !== undefined ? activate?.id : undefined);
          activated ||= activate !== undefined && move === activate.id;
        }
        move ??= routineMove(session) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Magus of the Order move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = `${trace.join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(magusOid, evidence).toMatch(/^forge-card-/u);
      expect(sacrificedOid, evidence).toMatch(/^forge-card-/u);
      expect(fetchedOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  },
  300_000,
);

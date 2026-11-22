/** Installed-Forge outcomes for the exact reviewed optional library-search cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function table(
  cards: SessionSpec['seats'][0]['deck']['cards'],
  opponentCards: SessionSpec['seats'][0]['deck']['cards'],
  seed: string,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Search pilot', controller: 'local', deck: { name: seed, cards } },
      {
        name: 'Opposing pilot',
        controller: 'local',
        deck: { name: `${seed}-opponent`, cards: opponentCards },
      },
    ],
    seed,
    maximumTurns: 30,
  };
}

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
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

async function open(spec: SessionSpec): Promise<{
  backend: NonNullable<ReturnType<typeof installedForgeBackend>>;
  session: ObservedSession;
}> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  return { backend, session: opened.session };
}

interface SearchProof {
  readonly subject: 'Stoneforge Mystic' | 'Primeval Titan' | 'Golos, Tireless Pilgrim';
  readonly basic: 'Plains' | 'Forest';
  readonly mana: number;
  readonly target: 'Lightning Greaves' | 'Forest' | 'Wasteland';
  readonly count: 1 | 2;
  readonly destination: 'hand' | 'battlefield';
  readonly tapped: boolean;
}

async function proveOptionalSearch(proof: SearchProof): Promise<void> {
  const running = await open(
    table(
      [
        { name: proof.basic, count: 30 },
        { name: proof.subject, count: 15 },
        { name: proof.target, count: 15 },
      ],
      [{ name: 'Mountain', count: 60 }],
      `z5q4-${proof.subject.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-search`,
    ),
  );
  let session = running.session;
  let cast = false;
  let confirmed = false;
  const selected: string[] = [];
  let resolved = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Missing ${proof.subject} decision`);
      const seat = session.view.seats[0];
      const destination = proof.destination === 'hand' ? seat.hand : seat.battlefield;
      resolved =
        selected.length === proof.count &&
        selected.every((oid) => destination?.some((card) => card.oid === oid)) &&
        (!proof.tapped ||
          selected.every((oid) => seat.battlefield.some((card) => card.oid === oid && card.tapped))) &&
        session.view.stack.length === 0;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      const confirmKind =
        proof.subject === 'Golos, Tireless Pilgrim' ? 'confirm-beneficial-trigger' : 'confirm-trigger';
      if (decision.kind === confirmKind && decision.prompt.startsWith(`${proof.subject}:`)) {
        move = decision.options.find((option) => option.id === `${confirmKind}-yes`)?.id;
        confirmed = move !== undefined;
      } else if (decision.kind === 'zone-card-selection' && confirmed && selected.length < proof.count) {
        const choice = decision.options.find(
          (option) =>
            option.targets[0]?.name === proof.target && !selected.includes(option.targets[0]?.oid ?? ''),
        );
        const oid = choice?.targets[0]?.oid;
        if (choice === undefined || oid === undefined) throw new Error(`Forge offered no ${proof.target}`);
        selected.push(oid);
        move = choice.id;
      } else if (decision.kind === 'priority' && decision.seat === 0) {
        const sources = seat.battlefield.filter((card) => card.name === proof.basic && !card.tapped).length;
        move =
          (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          decision.options.find((option) => option.text === `Play ${proof.basic}`)?.id ??
          (!cast && sources >= proof.mana
            ? decision.options.find((option) => option.text.startsWith(`${proof.subject}:`))?.id
            : undefined);
        cast ||=
          decision.options.find((option) => option.id === move)?.text.startsWith(proof.subject) === true;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${proof.subject} move`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(confirmed, evidence).toBe(true);
    expect(selected, evidence).toHaveLength(proof.count);
    expect(resolved, evidence).toBe(true);
  } finally {
    await session.close();
    await running.backend.shutdown?.();
  }
}

forgeIt(
  'Stoneforge Mystic moves the exact selected Equipment identity to hand',
  () =>
    proveOptionalSearch({
      subject: 'Stoneforge Mystic',
      basic: 'Plains',
      mana: 2,
      target: 'Lightning Greaves',
      count: 1,
      destination: 'hand',
      tapped: false,
    }),
  240_000,
);

forgeIt(
  'Primeval Titan moves two exact selected land identities to the battlefield tapped',
  () =>
    proveOptionalSearch({
      subject: 'Primeval Titan',
      basic: 'Forest',
      mana: 6,
      target: 'Forest',
      count: 2,
      destination: 'battlefield',
      tapped: true,
    }),
  240_000,
);

forgeIt(
  'Golos moves the exact selected land identity to the battlefield tapped',
  () =>
    proveOptionalSearch({
      subject: 'Golos, Tireless Pilgrim',
      basic: 'Forest',
      mana: 5,
      target: 'Wasteland',
      count: 1,
      destination: 'battlefield',
      tapped: true,
    }),
  240_000,
);

forgeIt(
  'Land Tax moves three exact selected basic-land identities to hand',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Plains', count: 44 },
          { name: 'Land Tax', count: 16 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-land-tax-search',
      ),
    );
    let session = running.session;
    let cast = false;
    let confirmed = false;
    const selected: string[] = [];
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Land Tax decision');
        const seat = session.view.seats[0];
        resolved =
          selected.length === 3 &&
          selected.every((oid) => seat.hand?.some((card) => card.oid === oid)) &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Land Tax:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'zone-card-selection' && confirmed && selected.length < 3) {
          const choice = decision.options.find(
            (option) =>
              option.targets[0]?.name === 'Plains' && !selected.includes(option.targets[0]?.oid ?? ''),
          );
          const oid = choice?.targets[0]?.oid;
          if (choice === undefined || oid === undefined) throw new Error('Forge offered no basic land');
          selected.push(oid);
          move = choice.id;
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const hasPlains = seat.battlefield.some((card) => card.name === 'Plains');
            move =
              (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              (!hasPlains
                ? decision.options.find((option) => option.text === 'Play Plains')?.id
                : undefined) ??
              (!cast && hasPlains
                ? decision.options.find((option) => option.text.startsWith('Land Tax:'))?.id
                : undefined);
            cast ||=
              decision.options.find((option) => option.id === move)?.text.startsWith('Land Tax:') === true;
          } else {
            move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Land Tax move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(confirmed, evidence).toBe(true);
      expect(selected, evidence).toHaveLength(3);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Solemn Simulacrum searches the exact basic land and accepts its controller-decided death draw',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Plains', count: 42 },
          { name: 'Solemn Simulacrum', count: 18 },
        ],
        [
          { name: 'Swamp', count: 42 },
          { name: 'Doom Blade', count: 18 },
        ],
        'z5q4-solemn-search-and-death-draw',
      ),
    );
    let session = running.session;
    let cast = false;
    let searchConfirmed = false;
    let deathConfirmed = false;
    let selectedLandOid: string | undefined;
    let searched = false;
    let doomCast = false;
    let handBeforeDeath: ReadonlySet<string> | undefined;
    let drawnOid: string | undefined;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_200; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Solemn Simulacrum decision');
        const seat = session.view.seats[0];
        searched =
          selectedLandOid !== undefined &&
          seat.battlefield.some((card) => card.oid === selectedLandOid && card.tapped) &&
          session.view.stack.length === 0;
        if (searched && handBeforeDeath === undefined) {
          handBeforeDeath = new Set(seat.hand?.map((card) => card.oid) ?? []);
        }
        if (deathConfirmed && handBeforeDeath !== undefined) {
          drawnOid = seat.hand?.find((card) => !handBeforeDeath?.has(card.oid))?.oid;
        }
        const resolved =
          selectedLandOid !== undefined &&
          seat.graveyard.some((card) => card.name === 'Solemn Simulacrum') &&
          drawnOid !== undefined &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Solemn Simulacrum:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          if (searched || doomCast) deathConfirmed = move !== undefined;
          else searchConfirmed = move !== undefined;
        } else if (decision.kind === 'zone-card-selection' && selectedLandOid === undefined) {
          const choice = decision.options.find((option) => option.targets[0]?.name === 'Plains');
          selectedLandOid = choice?.targets[0]?.oid;
          move = choice?.id;
        } else if (decision.kind === 'target-selection' && doomCast) {
          move = decision.options.find((option) => option.text.includes('Solemn Simulacrum'))?.id;
        } else if (decision.kind === 'priority') {
          if (decision.seat === 0) {
            const sources = seat.battlefield.filter((card) => card.name === 'Plains' && !card.tapped).length;
            move =
              (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === 'Play Plains')?.id ??
              (!cast && sources >= 4
                ? decision.options.find((option) => option.text.startsWith('Solemn Simulacrum:'))?.id
                : undefined);
            cast ||=
              decision.options.find((option) => option.id === move)?.text.startsWith('Solemn Simulacrum:') ===
              true;
          } else {
            const opponent = session.view.seats[1];
            const sources = opponent.battlefield.filter(
              (card) => card.name === 'Swamp' && !card.tapped,
            ).length;
            move =
              decision.options.find((option) => option.text === 'Play Swamp')?.id ??
              (searched && !doomCast && sources >= 2
                ? decision.options.find((option) => option.text.startsWith('Doom Blade:'))?.id
                : undefined);
            doomCast ||=
              decision.options.find((option) => option.id === move)?.text.startsWith('Doom Blade:') === true;
          }
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Solemn Simulacrum move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-140).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(searchConfirmed, evidence).toBe(true);
      expect(selectedLandOid, evidence).toMatch(/^forge-card-/u);
      expect(searched, evidence).toBe(true);
      expect(doomCast, evidence).toBe(true);
      expect(deathConfirmed, evidence).toBe(true);
      expect(drawnOid, evidence).toMatch(/^forge-card-/u);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);

/** Installed-Forge outcomes for exact OptionalDecider$ You singleton-target triggers. */
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
      { name: 'Optional trigger pilot', controller: 'local', deck: { name: seed, cards } },
      { name: 'Target pilot', controller: 'local', deck: { name: `${seed}-target`, cards: opponentCards } },
    ],
    seed,
    maximumTurns: 24,
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

forgeIt(
  'Restoration Angel accepts its trigger, blinks the selected Blade Splicer, and creates a second Golem',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Plains', count: 30 },
          { name: 'Blade Splicer', count: 15 },
          { name: 'Restoration Angel', count: 15 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-restoration-optional-target',
      ),
    );
    let session = running.session;
    let confirmed = false;
    let selectedOid: string | undefined;
    let splicerCast = false;
    let angelCast = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Restoration Angel decision');
        const seat = session.view.seats[0];
        const splicer = seat.battlefield.find((card) => card.name === 'Blade Splicer');
        resolved =
          selectedOid !== undefined &&
          seat.battlefield.some((card) => card.oid === selectedOid) &&
          seat.battlefield.filter((card) => card.name.includes('Golem')).length === 2 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Restoration Angel:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'target-selection') {
          const target = decision.options.find((option) => option.text.includes('Blade Splicer'));
          selectedOid = target === undefined ? undefined : splicer?.oid;
          move = target?.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const plains = seat.battlefield.filter((card) => card.name === 'Plains').length;
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!splicerCast && splicer === undefined && plains >= 3
              ? decision.options.find((option) => option.text.startsWith('Blade Splicer:'))?.id
              : undefined) ??
            (!angelCast && splicer !== undefined && plains >= 4
              ? decision.options.find((option) => option.text.startsWith('Restoration Angel:'))?.id
              : undefined);
          const chosenText = decision.options.find((option) => option.id === move)?.text;
          splicerCast ||= chosenText?.startsWith('Blade Splicer:') === true;
          angelCast ||= chosenText?.startsWith('Restoration Angel:') === true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Restoration Angel move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-100).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(confirmed, evidence).toBe(true);
      expect(selectedOid, evidence).toBeDefined();
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  240_000,
);

forgeIt(
  'Reclamation Sage accepts its trigger and destroys the selected Chromatic Lantern identity',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Forest', count: 30 },
          { name: 'Chromatic Lantern', count: 15 },
          { name: 'Reclamation Sage', count: 15 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-reclamation-optional-target',
      ),
    );
    let session = running.session;
    let confirmed = false;
    let selectedOid: string | undefined;
    let lanternCast = false;
    let sageCast = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_000; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Reclamation Sage decision');
        const seat = session.view.seats[0];
        const lantern = seat.battlefield.find((card) => card.name === 'Chromatic Lantern');
        resolved =
          selectedOid !== undefined &&
          seat.graveyard.some((card) => card.oid === selectedOid) &&
          seat.battlefield.some((card) => card.name === 'Reclamation Sage') &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Reclamation Sage:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'target-selection') {
          const target = decision.options.find((option) => option.text.includes('Chromatic Lantern'));
          selectedOid = target === undefined ? undefined : lantern?.oid;
          move = target?.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const untappedForests = seat.battlefield.filter(
            (card) => card.name === 'Forest' && !card.tapped,
          ).length;
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (!lanternCast && lantern === undefined && untappedForests >= 3
              ? decision.options.find((option) => option.text.startsWith('Chromatic Lantern:'))?.id
              : undefined) ??
            (!sageCast && lantern !== undefined && untappedForests >= 3
              ? decision.options.find((option) => option.text.startsWith('Reclamation Sage:'))?.id
              : undefined);
          const chosenText = decision.options.find((option) => option.id === move)?.text;
          lanternCast ||= chosenText?.startsWith('Chromatic Lantern:') === true;
          sageCast ||= chosenText?.startsWith('Reclamation Sage:') === true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Reclamation Sage move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-100).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(confirmed, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  240_000,
);

async function proveGraveyardReturn(subject: 'Eternal Witness' | 'Sun Titan'): Promise<void> {
  const basic = subject === 'Eternal Witness' ? 'Forest' : 'Plains';
  const running = await open(
    table(
      [
        { name: basic, count: 24 },
        { name: 'Wasteland', count: 18 },
        { name: subject, count: 18 },
      ],
      [{ name: 'Taiga', count: 60 }],
      `z5q4-${subject.toLowerCase().replaceAll(' ', '-')}-optional-target`,
    ),
  );
  let session = running.session;
  let wastelandOid: string | undefined;
  let taigaOid: string | undefined;
  let confirmed = false;
  let selected = false;
  let wastelandActivated = false;
  let subjectCast = false;
  let resolved = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Missing ${subject} decision`);
      const seat = session.view.seats[0];
      const opponent = session.view.seats[1];
      wastelandOid ??= seat.battlefield.find((card) => card.name === 'Wasteland')?.oid;
      taigaOid ??= opponent.battlefield.find((card) => card.name === 'Taiga')?.oid;
      const destination = subject === 'Eternal Witness' ? seat.hand : seat.battlefield;
      resolved =
        selected &&
        wastelandOid !== undefined &&
        (destination?.some((card) => card.oid === wastelandOid) ?? false) &&
        session.view.stack.length === 0;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt}`,
      );
      let move: string | undefined;
      if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith(`${subject}:`)) {
        move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
        confirmed = move !== undefined;
      } else if (decision.kind === 'target-selection') {
        const choosingWasteland = decision.options.some((option) => option.text.includes('Wasteland'));
        const targetOid = choosingWasteland ? wastelandOid : taigaOid;
        const targetName = choosingWasteland ? 'Wasteland' : 'Taiga';
        const target = decision.options.find((option) => option.text.includes(targetName));
        selected ||= choosingWasteland && target !== undefined && targetOid === wastelandOid;
        move = target?.id;
      } else if (decision.kind === 'priority') {
        const basics = seat.battlefield.filter((card) => card.name === basic).length;
        const wasteland = seat.battlefield.find((card) => card.oid === wastelandOid);
        const activate = decision.options.find(
          (option) => option.text.startsWith('Wasteland:') && option.text.includes('Destroy'),
        );
        move =
          (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Taiga')?.id
            : undefined) ??
          (decision.seat === 0 && wasteland === undefined && wastelandOid === undefined
            ? decision.options.find((option) => option.text === 'Play Wasteland')?.id
            : undefined) ??
          (decision.seat === 0 && !wastelandActivated && wasteland !== undefined && taigaOid !== undefined
            ? activate?.id
            : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === `Play ${basic}`)?.id
            : undefined) ??
          (decision.seat === 0 &&
          !subjectCast &&
          basics >= (subject === 'Sun Titan' ? 6 : 3) &&
          wastelandOid !== undefined &&
          seat.graveyard.some((card) => card.oid === wastelandOid)
            ? decision.options.find((option) => option.text.startsWith(`${subject}:`))?.id
            : undefined);
        wastelandActivated ||= activate !== undefined && move === activate.id;
        subjectCast ||=
          decision.options.find((option) => option.id === move)?.text.startsWith(`${subject}:`) === true;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${subject} move`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(wastelandOid, evidence).toMatch(/^forge-card-/u);
    expect(taigaOid, evidence).toMatch(/^forge-card-/u);
    expect(confirmed, evidence).toBe(true);
    expect(selected, evidence).toBe(true);
    expect(resolved, evidence).toBe(true);
  } finally {
    await session.close();
    await running.backend.shutdown?.();
  }
}

forgeIt(
  'Eternal Witness returns the selected Wasteland identity from graveyard to hand',
  async () => {
    await proveGraveyardReturn('Eternal Witness');
  },
  300_000,
);

forgeIt(
  'Sun Titan returns the selected Wasteland identity from graveyard to battlefield',
  async () => {
    await proveGraveyardReturn('Sun Titan');
  },
  300_000,
);

forgeIt(
  'Duplicant accepts its trigger, exiles the selected Blade Splicer, and copies its characteristics',
  async () => {
    const running = await open(
      table(
        [
          { name: 'Plains', count: 40 },
          { name: 'Blade Splicer', count: 10 },
          { name: 'Duplicant', count: 10 },
        ],
        [{ name: 'Mountain', count: 60 }],
        'z5q4-duplicant-optional-target',
      ),
    );
    let session = running.session;
    let confirmed = false;
    let selectedOid: string | undefined;
    let splicerCast = false;
    let duplicantCast = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Duplicant decision');
        const seat = session.view.seats[0];
        const splicer = seat.battlefield.find((card) => card.name === 'Blade Splicer');
        const duplicant = seat.battlefield.find((card) => card.name === 'Duplicant');
        resolved =
          selectedOid !== undefined &&
          !seat.battlefield.some((card) => card.oid === selectedOid) &&
          duplicant?.power === 1 &&
          duplicant.toughness === 1 &&
          session.view.stack.length === 0;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt}`,
        );
        let move: string | undefined;
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Duplicant:')) {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'target-selection') {
          const target = decision.options.find((option) => option.text.includes('Blade Splicer'));
          selectedOid = target === undefined ? undefined : splicer?.oid;
          move = target?.id;
        } else if (decision.kind === 'priority' && decision.seat === 0) {
          const untappedPlains = seat.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!splicerCast && splicer === undefined && untappedPlains >= 3
              ? decision.options.find((option) => option.text.startsWith('Blade Splicer:'))?.id
              : undefined) ??
            (!duplicantCast && splicer !== undefined && untappedPlains >= 6
              ? decision.options.find((option) => option.text.startsWith('Duplicant:'))?.id
              : undefined);
          const chosenText = decision.options.find((option) => option.id === move)?.text;
          splicerCast ||= chosenText?.startsWith('Blade Splicer:') === true;
          duplicantCast ||= chosenText?.startsWith('Duplicant:') === true;
        }
        move ??= routineMove(decision) ?? decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Duplicant move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(confirmed, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(resolved, evidence).toBe(true);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  },
  300_000,
);

/** Installed-Forge outcomes for the exact direct ETB trigger-target cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
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

type DirectEtbCase = {
  subject:
    | 'Cast Out'
    | 'Pestermite'
    | 'Riftwing Cloudskate'
    | 'Bone Shredder'
    | 'Shriekmaw'
    | 'Avalanche Riders'
    | 'Frost Titan'
    | 'Flametongue Yearling';
  basic: 'Plains' | 'Island' | 'Swamp' | 'Mountain';
  target: 'Blade Splicer' | 'Plains';
  destination: 'exile' | 'hand' | 'graveyard' | 'tapped';
  mana: 3 | 4 | 5 | 6;
  multikicker?: 1;
};

async function proveDirectEtb(input: DirectEtbCase): Promise<void> {
  const spec: SessionSpec = {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${input.subject} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-${input.subject.toLowerCase().replaceAll(' ', '-')}`,
          cards: [
            { name: input.basic, count: 30 },
            { name: input.subject, count: 30 },
          ],
        },
      },
      {
        name: 'ETB target pilot',
        controller: 'local',
        deck: {
          name: `z5q4-${input.subject.toLowerCase().replaceAll(' ', '-')}-target`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Blade Splicer', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-${input.subject.toLowerCase().replaceAll(' ', '-')}-direct-etb`,
    maximumTurns: 24,
  };
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let targetOid: string | undefined;
  let subjectCast = false;
  let triggerAccepted = input.subject !== 'Pestermite';
  let choseMultikicker = input.multikicker === undefined;
  let observed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Missing ${input.subject} decision`);
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      observed =
        targetOid !== undefined &&
        session.view.stack.length === 0 &&
        (input.destination === 'tapped'
          ? opponent.battlefield.some((card) => card.oid === targetOid && card.tapped)
          : (opponent[input.destination]?.some((card) => card.oid === targetOid) ?? false));
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith(`${input.subject}:`)) {
        move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
        triggerAccepted = move !== undefined;
      } else if (decision.kind === 'target-selection' && subjectCast) {
        const target = decision.options.find((option) => option.text.includes(input.target));
        targetOid = target?.targets[0]?.oid;
        move = target?.id;
      } else if (decision.kind === 'mode-selection' && input.subject === 'Pestermite') {
        move = decision.options.find((option) => option.text.toLowerCase().includes('tap'))?.id;
      } else if (decision.kind === 'number' && input.multikicker !== undefined) {
        move = decision.options.find((option) => option.id === `number-${input.multikicker}`)?.id;
        choseMultikicker ||= move !== undefined;
      } else if (decision.kind === 'priority') {
        const pilotLands = pilot.battlefield.filter(
          (card) => card.name === input.basic && !card.tapped,
        ).length;
        const opponentLands = opponent.battlefield.filter(
          (card) => card.name === 'Plains' && !card.tapped,
        ).length;
        const targetReady = opponent.battlefield.some((card) => card.name === input.target);
        move =
          (observed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === `Play ${input.basic}`)?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 1 && !targetReady && opponentLands >= 3
            ? decision.options.find((option) => option.text.startsWith('Blade Splicer:'))?.id
            : undefined) ??
          (decision.seat === 0 && targetReady && pilotLands >= input.mana
            ? decision.options.find(
                (option) =>
                  option.text.startsWith(`${input.subject}:`) && !/Cycling|Evoke|Suspend/u.test(option.text),
              )?.id
            : undefined);
        const chosenText = decision.options.find((option) => option.id === move)?.text;
        subjectCast ||= chosenText?.startsWith(`${input.subject}:`) === true;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${input.subject} move`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-120).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(subjectCast, evidence).toBe(true);
    expect(triggerAccepted, evidence).toBe(true);
    expect(choseMultikicker, evidence).toBe(true);
    expect(targetOid, evidence).toEqual(expect.stringMatching(/^forge-card-/u));
    expect(observed, evidence).toBe(true);
    if (input.multikicker !== undefined) {
      const subject = session.view.seats[0].battlefield.find((card) => card.name === input.subject);
      expect(Object.values(subject?.counters ?? {}), evidence).toContain(input.multikicker);
    }
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt.each([
  { subject: 'Cast Out', basic: 'Plains', target: 'Blade Splicer', destination: 'exile', mana: 4 },
  { subject: 'Pestermite', basic: 'Island', target: 'Plains', destination: 'tapped', mana: 3 },
  { subject: 'Riftwing Cloudskate', basic: 'Island', target: 'Blade Splicer', destination: 'hand', mana: 5 },
  { subject: 'Bone Shredder', basic: 'Swamp', target: 'Blade Splicer', destination: 'graveyard', mana: 3 },
  { subject: 'Shriekmaw', basic: 'Swamp', target: 'Blade Splicer', destination: 'graveyard', mana: 5 },
  { subject: 'Avalanche Riders', basic: 'Mountain', target: 'Plains', destination: 'graveyard', mana: 4 },
  { subject: 'Frost Titan', basic: 'Island', target: 'Plains', destination: 'tapped', mana: 6 },
  {
    subject: 'Flametongue Yearling',
    basic: 'Mountain',
    target: 'Blade Splicer',
    destination: 'graveyard',
    mana: 4,
    multikicker: 1,
  },
] as const)(
  '$subject applies its exact trigger to the selected $target board identity',
  async (input) => proveDirectEtb(input),
  240_000,
);

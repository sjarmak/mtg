/** Installed-Forge outcome matrix for the exact four-card Convoke cohort. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;
type CardName = 'Venerated Loxodon' | 'Conclave Tribunal' | 'Stoke the Flames' | 'Chord of Calling';

const setupFor = (cardName: CardName): { land: string; creature: string } => {
  if (cardName === 'Stoke the Flames') return { land: 'Mountain', creature: 'Monastery Swiftspear' };
  if (cardName === 'Chord of Calling') return { land: 'Forest', creature: 'Llanowar Elves' };
  return { land: 'Plains', creature: 'Mother of Runes' };
};

const payableResourceCountFor = (cardName: CardName): number => (cardName === 'Venerated Loxodon' ? 5 : 4);

function table(cardName: CardName): SessionSpec {
  const setup = setupFor(cardName);
  const casterCards =
    cardName === 'Chord of Calling'
      ? [
          { name: setup.land, count: 22 },
          { name: setup.creature, count: 22 },
          { name: cardName, count: 12 },
          { name: 'Acidic Slime', count: 4 },
        ]
      : [
          { name: setup.land, count: 24 },
          { name: setup.creature, count: 24 },
          { name: cardName, count: 12 },
        ];
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `${cardName} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-convoke-${cardName.toLowerCase().replaceAll(' ', '-')}`,
          cards: casterCards,
        },
      },
      {
        name: `${cardName} opponent`,
        controller: 'local',
        deck: {
          name: 'z5q4-convoke-target',
          cards:
            cardName === 'Conclave Tribunal'
              ? [
                  { name: 'Forest', count: 22 },
                  { name: 'Plains', count: 22 },
                  { name: 'Knight of Autumn', count: 16 },
                ]
              : [
                  { name: 'Plains', count: 30 },
                  { name: 'Mother of Runes', count: 30 },
                ],
        },
      },
    ],
    seed: `z5q4-convoke-${cardName.toLowerCase().replaceAll(' ', '-')}`,
    maximumTurns: 20,
  };
}

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
      option.id === 'combat-blockers-commit',
  )?.id;
}

interface RouteOptions {
  readonly useConvoke?: boolean;
  readonly cancelManaAfterConvoke?: boolean;
}

async function proveRoute(cardName: CardName, options: RouteOptions = {}): Promise<void> {
  const useConvoke = options.useConvoke !== false;
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const opened = await backend.open(table(cardName));
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const setup = setupFor(cardName);
  const convokers = new Set<string>();
  const desiredSetupCount = cardName === 'Venerated Loxodon' && useConvoke ? 3 : 2;
  let subjectCast = false;
  let paymentPromptSeen = false;
  let noConvokeChosen = false;
  let cancellationObserved = false;
  let inventedRejected = false;
  let staleRejected = false;
  let targetOid: string | undefined;
  let searchedOid: string | undefined;
  let announcedX = false;
  let tribunalExileObserved = false;
  let tribunalRemovalCast = false;
  let outcome = false;
  const convokePrompts: string[] = [];
  let postConvokeManaPrompt: string | undefined;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_600; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Forge offered no ${cardName} decision`);
      const caster = session.view.seats[0];
      const opponent = session.view.seats[1];
      const subjectOnBattlefield = caster.battlefield.some((card) => card.name === cardName);
      const subjectInGraveyard = caster.graveyard.some((card) => card.name === cardName);
      if (cardName === 'Venerated Loxodon' && subjectOnBattlefield) {
        const selectedCorrect = [...convokers].every((oid) => {
          const creature = caster.battlefield.find((card) => card.oid === oid);
          return creature?.tapped === true && creature.power === 2 && creature.toughness === 2;
        });
        const unselectedCorrect = caster.battlefield
          .filter((card) => card.name === setup.creature && !convokers.has(card.oid))
          .every((creature) => creature.tapped === false && creature.power === 1 && creature.toughness === 1);
        outcome = selectedCorrect && unselectedCorrect;
      } else if (cardName === 'Conclave Tribunal' && subjectOnBattlefield && targetOid !== undefined) {
        tribunalExileObserved ||= opponent.exile.some((card) => card.oid === targetOid);
      } else if (cardName === 'Conclave Tribunal' && tribunalExileObserved && targetOid !== undefined) {
        outcome =
          caster.graveyard.some((card) => card.name === cardName) &&
          opponent.battlefield.some((card) => card.oid === targetOid);
      } else if (cardName === 'Stoke the Flames' && subjectInGraveyard) {
        outcome = opponent.life === 16;
      } else if (cardName === 'Chord of Calling' && subjectInGraveyard && searchedOid !== undefined) {
        outcome = caster.battlefield.some((card) => card.oid === searchedOid);
      }
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = routineMove(decision);
      let cancelManaAfterConvoke = false;
      if (
        decision.kind === 'mana-payment' &&
        decision.seat === 0 &&
        subjectCast &&
        paymentPromptSeen &&
        postConvokeManaPrompt === undefined
      ) {
        postConvokeManaPrompt = decision.prompt;
      }
      if (decision.kind === 'mode-selection' && decision.seat === 1 && cardName === 'Conclave Tribunal') {
        move = decision.options.find((option) =>
          option.text.includes(
            tribunalExileObserved ? 'Destroy target artifact or enchantment' : 'You gain 4 life',
          ),
        )?.id;
      } else if (decision.kind === 'number' && decision.seat === 0 && cardName === 'Chord of Calling') {
        announcedX = true;
        move = decision.options.find((option) => option.id === 'number-1')?.id;
      } else if (decision.kind === 'convoke-payment' && decision.seat === 0) {
        paymentPromptSeen = true;
        convokePrompts.push(decision.prompt);
        const candidates = decision.options.filter((option) => option.id !== 'convoke-payment-done');
        if (
          candidates.some((option) => {
            const oid = option.targets[0]?.oid;
            return oid !== undefined && convokers.has(oid);
          })
        ) {
          convokers.clear();
        }
        expect(
          candidates.every((option) => {
            const oid = option.targets[0]?.oid;
            return (
              oid !== undefined &&
              caster.battlefield.some((card) => card.oid === oid && !card.tapped) &&
              !opponent.battlefield.some((card) => card.oid === oid)
            );
          }),
        ).toBe(true);
        const candidate = candidates[0];
        if (!inventedRejected) {
          await expect(session.submit('convoke-payment-forge-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        if (useConvoke && candidate !== undefined && convokers.size < 2) {
          const oid = candidate.targets[0]?.oid;
          expect(oid).toBeDefined();
          expect(caster.battlefield.some((card) => card.oid === oid && !card.tapped)).toBe(true);
          expect(opponent.battlefield.some((card) => card.oid === oid)).toBe(false);
          convokers.add(oid!);
          move = candidate.id;
        } else {
          move = 'convoke-payment-done';
          noConvokeChosen = convokers.size === 0;
        }
      } else if (
        decision.kind === 'target-selection' &&
        decision.seat === 1 &&
        cardName === 'Conclave Tribunal'
      ) {
        move = decision.options.find((option) =>
          option.targets.some((candidate) => candidate.name === 'Conclave Tribunal'),
        )?.id;
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        if (cardName === 'Conclave Tribunal') {
          const target = decision.options.find((option) =>
            option.targets.some((candidate) => candidate.name === 'Knight of Autumn'),
          );
          targetOid = target?.targets[0]?.oid;
          move = target?.id;
        } else if (cardName === 'Stoke the Flames') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        }
      } else if (
        decision.kind === 'zone-card-selection' &&
        decision.seat === 0 &&
        cardName === 'Chord of Calling'
      ) {
        expect(
          decision.options.every((option) =>
            option.targets.every((candidate) => candidate.name !== 'Acidic Slime'),
          ),
        ).toBe(true);
        expect(
          4 -
            [...(caster.hand ?? []), ...caster.battlefield, ...caster.graveyard, ...caster.exile].filter(
              (card) => card.name === 'Acidic Slime',
            ).length,
        ).toBeGreaterThan(0);
        const target = decision.options.find((option) =>
          option.targets.some((candidate) => candidate.name === 'Llanowar Elves'),
        );
        searchedOid = target?.targets[0]?.oid;
        move = target?.id;
      } else if (decision.kind === 'priority') {
        if (outcome) {
          move = decision.options.find((option) => option.text === 'Concede')?.id;
        } else if (decision.seat === 0) {
          const land = decision.options.find((option) => option.text === `Play ${setup.land}`)?.id;
          const setupCount = caster.battlefield.filter((card) => card.name === setup.creature).length;
          const availableMana = caster.battlefield.some((card) => card.name === setup.land && !card.tapped);
          const payableResources = caster.battlefield.filter(
            (card) => !card.tapped && (card.name === setup.land || card.name === setup.creature),
          ).length;
          const untappedLands = caster.battlefield.filter(
            (card) => card.name === setup.land && !card.tapped,
          ).length;
          const creature =
            setupCount < desiredSetupCount && availableMana
              ? decision.options.find((option) =>
                  option.text.startsWith(`${setup.creature}: ${setup.creature} - Creature`),
                )?.id
              : undefined;
          const subject =
            setupCount >= desiredSetupCount &&
            (useConvoke ? payableResources : untappedLands) >= payableResourceCountFor(cardName) &&
            (cardName !== 'Conclave Tribunal' ||
              opponent.battlefield.some((card) => card.name === 'Knight of Autumn')) &&
            !subjectCast
              ? decision.options.find((option) => option.text.startsWith(`${cardName}:`))?.id
              : undefined;
          move =
            land ??
            creature ??
            subject ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move !== undefined && move === subject) subjectCast = true;
        } else {
          const opponentCreature = cardName === 'Conclave Tribunal' ? 'Knight of Autumn' : 'Mother of Runes';
          const land = decision.options.find((option) =>
            cardName === 'Conclave Tribunal'
              ? option.text === 'Play Forest' || option.text === 'Play Plains'
              : option.text === 'Play Plains',
          )?.id;
          const availableMana = opponent.battlefield.some(
            (card) => (card.name === 'Forest' || card.name === 'Plains') && !card.tapped,
          );
          const untappedForests = opponent.battlefield.filter(
            (card) => card.name === 'Forest' && !card.tapped,
          ).length;
          const untappedPlains = opponent.battlefield.filter(
            (card) => card.name === 'Plains' && !card.tapped,
          ).length;
          const removalResources = untappedForests + untappedPlains;
          const canCastKnight = removalResources >= 3 && untappedForests >= 1 && untappedPlains >= 1;
          const creature =
            availableMana && (cardName !== 'Conclave Tribunal' || canCastKnight)
              ? decision.options.find((option) =>
                  option.text.startsWith(`${opponentCreature}: ${opponentCreature} - Creature`),
                )?.id
              : undefined;
          const removal =
            cardName === 'Conclave Tribunal' && tribunalExileObserved && !tribunalRemovalCast && canCastKnight
              ? decision.options.find((option) => option.text.startsWith('Knight of Autumn:'))?.id
              : undefined;
          move =
            land ??
            removal ??
            creature ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move !== undefined && move === removal) tribunalRemovalCast = true;
        }
      }
      if (
        decision.kind === 'mana-payment' &&
        decision.seat === 0 &&
        options.cancelManaAfterConvoke === true &&
        convokers.size === 2 &&
        !cancellationObserved
      ) {
        move = 'mana-payment-cancel';
        cancelManaAfterConvoke = true;
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error(`Forge offered no ${cardName} move`);
      const stale = decision.kind === 'convoke-payment' && !staleRejected ? move : undefined;
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
      session = advanced.session;
      if (cancelManaAfterConvoke) {
        const rolledBackCaster = session.view.seats[0];
        expect(rolledBackCaster.hand?.some((card) => card.name === cardName)).toBe(true);
        expect(
          [...convokers].every(
            (oid) => rolledBackCaster.battlefield.find((card) => card.oid === oid)?.tapped === false,
          ),
        ).toBe(true);
        cancellationObserved = true;
        subjectCast = false;
        convokers.clear();
      }
      if (stale !== undefined && !session.decision?.options.some((option) => option.id === stale)) {
        await expect(session.submit(stale)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unknown-move' },
        });
        staleRejected = true;
      }
    }
    const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(subjectCast, evidence).toBe(true);
    expect(paymentPromptSeen, evidence).toBe(true);
    const expectedConvokeCost =
      cardName === 'Venerated Loxodon'
        ? '{4}{W}'
        : cardName === 'Conclave Tribunal'
          ? '{3}{W}'
          : cardName === 'Stoke the Flames'
            ? '{2}{R}{R}'
            : '{1}{G}{G}{G}';
    expect(
      convokePrompts.some((prompt) => prompt.includes(expectedConvokeCost)),
      evidence,
    ).toBe(true);
    expect(postConvokeManaPrompt, evidence).toContain(
      !useConvoke
        ? '{4}{W}'
        : cardName === 'Venerated Loxodon'
          ? '{3}'
          : cardName === 'Conclave Tribunal'
            ? '{2}'
            : cardName === 'Stoke the Flames'
              ? '{2}'
              : '{1}{G}',
    );
    expect(convokers.size, evidence).toBe(useConvoke ? 2 : 0);
    expect(noConvokeChosen, evidence).toBe(!useConvoke);
    expect(cancellationObserved, evidence).toBe(options.cancelManaAfterConvoke === true);
    expect(tribunalExileObserved, evidence).toBe(cardName === 'Conclave Tribunal');
    expect(tribunalRemovalCast, evidence).toBe(cardName === 'Conclave Tribunal');
    expect(announcedX, evidence).toBe(cardName === 'Chord of Calling');
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(outcome, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'proves exact payment distribution and all four card outcomes',
  async () => {
    const cards: readonly CardName[] = [
      'Venerated Loxodon',
      'Conclave Tribunal',
      'Stoke the Flames',
      'Chord of Calling',
    ];
    for (let index = 0; index < cards.length; index += 2) {
      await Promise.all(
        cards
          .slice(index, index + 2)
          .map((card) => proveRoute(card, { cancelManaAfterConvoke: card === 'Conclave Tribunal' })),
      );
    }
    await proveRoute('Venerated Loxodon', { useConvoke: false });
  },
  480_000,
);

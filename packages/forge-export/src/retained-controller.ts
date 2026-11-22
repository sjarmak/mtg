/** Forge protocol for a later effect that reads a departed target's controller. */
import { referentSourceIndex, type Effect } from '@mtg/dsl';
import type { ForgeAbility, ForgeParam } from './script-text';

interface RetainedControllerChain {
  readonly abilities: readonly ForgeAbility[];
  readonly cleansRemembered: boolean;
}

function withParams(ability: ForgeAbility, additions: readonly ForgeParam[]): ForgeAbility {
  return { ...ability, params: [...ability.params, ...additions] };
}

function rememberedControllerSweep(ability: ForgeAbility, excludeReferent: boolean): ForgeAbility {
  return {
    ...ability,
    params: ability.params.flatMap(([name, value]): readonly ForgeParam[] => {
      if (name === 'Defined' && value === 'TargetedController') return [];
      if ((name === 'NumAtt' || name === 'NumDef') && value === '+0') return [];
      if (name === 'ValidCards' && value === 'Creature') {
        return [
          [
            'ValidCards',
            `Creature.ControlledBy RememberedController${excludeReferent ? '+!IsRemembered' : ''}`,
          ],
        ];
      }
      return [[name, value]];
    }),
  };
}

/**
 * Retains last-known controller data when an earlier effect removes the chosen
 * creature before a later scoped effect can read that relationship.
 *
 * Forge stores this relationship on the host card rather than on the departed
 * target. The chooser remembers LKI, the consumer selects the remembered
 * controller's other creatures, and cleanup makes the register resolution
 * local. The matcher is semantic and card-name independent.
 */
export function retainDepartedTargetController(
  effects: readonly Effect[],
  abilities: readonly ForgeAbility[],
  abilityIndexByEffect: readonly (number | null)[],
): RetainedControllerChain {
  const rewritten = [...abilities];
  let retained = false;

  for (const [effectIndex, effect] of effects.entries()) {
    if (
      effect.kind !== 'pumpUntilEndOfTurn' ||
      effect.scope !== 'creaturesThatPlayerControls' ||
      effect.target.kind !== 'thatCreaturesController'
    ) {
      continue;
    }
    const sourceIndex = referentSourceIndex(effects, effectIndex);
    if (sourceIndex === null || effects[sourceIndex]?.kind !== 'destroyPermanent') continue;
    const chooserIndex = abilityIndexByEffect[sourceIndex];
    const consumerIndex = abilityIndexByEffect[effectIndex];
    if (
      chooserIndex === null ||
      chooserIndex === undefined ||
      consumerIndex === null ||
      consumerIndex === undefined
    )
      continue;
    const chooser = rewritten[chooserIndex];
    const consumer = rewritten[consumerIndex];
    if (chooser === undefined || consumer === undefined) continue;

    rewritten[chooserIndex] = withParams(chooser, [
      ['RememberLKI', 'True'],
      ['AlwaysRemember', 'True'],
    ]);
    rewritten[consumerIndex] = rememberedControllerSweep(consumer, effect.excludeReferent === true);
    retained = true;
  }

  if (!retained) return { abilities, cleansRemembered: false };
  return {
    abilities: [...rewritten, { api: 'Cleanup', params: [['ClearRemembered', 'True']] }],
    cleansRemembered: true,
  };
}

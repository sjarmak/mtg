import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge priority boundary exposes only exact payable mana routes', () => {
  it('offers each playable battlefield mana output as its own source action', () => {
    expect(bridge).toContain('private List<Choice> proactiveManaChoices(Player player)');
    expect(bridge).toContain('choices.addAll(proactiveManaChoices(player));');
    expect(bridge).toContain('for (SpellAbility ability : card.getManaAbilities())');
    expect(bridge).toContain('if (!ability.canPlay(true))');
    expect(bridge).toContain('if (!canProduceManaColor(ability, color, symbol)) continue;');
    expect(bridge).toContain(
      'if (ability.getApi() != ApiType.ManaReflected) return ability.canProduce(symbol);',
    );
    expect(bridge).toContain('CardUtil.getReflectableManaColors(ability)');
    expect(bridge).toContain('"mana-source-" + card.getId() + "-" + abilityIndex + "-" + symbol');
    expect(bridge).toContain('new ManaPaymentSelection(ability, color)');
  });

  it('accepts a selected output without parsing its label and delegates payability to Forge', () => {
    expect(bridge).toContain('if (choice.value instanceof ManaPaymentSelection selection)');
    expect(bridge).toContain('|| !canProduceManaColor(selection.ability, selection.color, symbol))');
    expect(bridge).toContain('if (!canProduceManaColor(ability, color, symbol)');
    expect(bridge).toContain('selection.ability.setManaExpressChoice(ColorSet.fromMask(selection.color));');
    expect(bridge).toContain('ComputerUtilMana.canPayManaCost(ability, player, 0, false)');
  });

  it('offers a Forge-native take-back only for successfully played priority mana', () => {
    expect(bridge).toContain('recordPriorityMana(ability, played)');
    expect(bridge).toContain('new Choice("undo-mana", "Take back mana", UndoMana.INSTANCE)');
    expect(bridge).toContain('selection.ability.isUndoable()');
    expect(bridge).toContain('selection.ability.undo()');
    expect(bridge).toContain('priorityManaHistory.clear()');
  });
});

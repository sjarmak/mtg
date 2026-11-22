/**
 * A real printed-card match through the neutral EngineSession contract.
 *
 * Forge owns the rules state and opponent AI while the local seat submits only
 * complete backend-issued moves. The focused tables below exercise each
 * bounded decision profile against the installed GPL subprocess. The test is
 * optional on ordinary checkouts because that artifact is intentionally
 * untracked; release verification sets MTG_REQUIRE_FORGE_BRIDGE=1.
 */
import { describe, expect, it, onTestFinished } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { ObservedSession, SessionSpec, TextDecisionInput } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import {
  AUDITED_FORGE_CARD_NAMES,
  installedForgeBackend as createInstalledForgeBackend,
  installedForgeDiagnosticBackend as createInstalledForgeDiagnosticBackend,
} from '@mtg/forge-export';

function installedForgeBackend(options: Parameters<typeof createInstalledForgeBackend>[0]) {
  const backend = createInstalledForgeBackend(options);
  if (backend === null) return null;
  let sessions: readonly ObservedSession[] = [];
  onTestFinished(async () => {
    const closed = await Promise.allSettled(sessions.map((session) => session.close()));
    const shutdown = await Promise.allSettled([Promise.resolve().then(() => backend.shutdown?.())]);
    const errors: unknown[] = [...closed, ...shutdown].flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, 'Installed Forge test cleanup failed');
  });
  return {
    ...backend,
    open: async (spec: SessionSpec) => {
      const result = await backend.open(spec);
      if (result.ok) sessions = [...sessions, result.session];
      return result;
    },
  };
}

/**
 * Diagnostic-only counterpart to `installedForgeBackend`: not gated on
 * `AUDITED_FORGE_CARD_NAMES`, so a printed-mana structural-rule witness can
 * cast a card no format has admitted yet without widening that whole-format
 * allow-list (mtg-t5ma0). Never a source of format admission evidence.
 */
function installedDiagnosticForgeBackend(
  diagnosticCardNames: ReadonlySet<string>,
  options: Parameters<typeof createInstalledForgeDiagnosticBackend>[1],
) {
  const backend = createInstalledForgeDiagnosticBackend(diagnosticCardNames, options);
  if (backend === null) return null;
  let sessions: readonly ObservedSession[] = [];
  onTestFinished(async () => {
    const closed = await Promise.allSettled(sessions.map((session) => session.close()));
    const shutdown = await Promise.allSettled([Promise.resolve().then(() => backend.shutdown?.())]);
    const errors: unknown[] = [...closed, ...shutdown].flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, 'Installed Forge diagnostic cleanup failed');
  });
  return {
    ...backend,
    open: async (spec: SessionSpec) => {
      const result = await backend.open(spec);
      if (result.ok) sessions = [...sessions, result.session];
      return result;
    },
  };
}

function pregameOrManaPayment(decision: NonNullable<ObservedSession['decision']>): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
  }
  return decision.options.find((option) => option.text === 'Play first' || option.text === 'Keep this hand')
    ?.id;
}

function untappedSources(session: ObservedSession, name: string): number {
  return session.view.seats[0].battlefield.filter((card) => card.name === name && !card.tapped).length;
}

function levelCounters(card: ObservedSession['view']['seats'][number]['battlefield'][number]): number {
  return Object.entries(card.counters)
    .filter(([kind]) => kind.toUpperCase().includes('LEVEL'))
    .reduce((sum, [, count]) => sum + count, 0);
}

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'human-rift',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Flame Rift', count: 36 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: {
        name: 'ai-rift',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Flame Rift', count: 36 },
        ],
      },
    },
  ],
  seed: '1514',
  maximumTurns: 30,
};

const SHARED_SPARK = parseCard({
  kind: 'sorcery',
  id: 'cstm-shared-spark',
  name: 'Shared Spark',
  rarity: 'common',
  set: { code: 'CSTM', collectorNumber: 1 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  effects: [{ kind: 'loseLife', amount: 1, players: 'eachOpponent', target: { kind: 'noTarget' } }],
});

const MIXED_TABLE: SessionSpec = {
  ...TABLE,
  content: { kind: 'mixed', format: 'legacy-cube-2021-08', customSetCodes: ['CSTM'] },
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-mixed',
        cards: [
          { name: 'Mountain', count: 24, origin: { kind: 'printed' } },
          {
            name: 'Shared Spark',
            count: 36,
            origin: { kind: 'custom', setCode: 'CSTM', cardId: SHARED_SPARK.id },
          },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        ...TABLE.seats[1].deck,
        cards: TABLE.seats[1].deck.cards.map((slot) => ({
          ...slot,
          origin: { kind: 'printed' as const },
        })),
      },
    },
  ],
  seed: '1518',
};

const REVIEWED_OFFICIAL_NAMES = AUDITED_FORGE_CARD_NAMES.filter(
  (name) => !['Flame Rift', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(name),
);

const REVIEWED_OFFICIAL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'all-reviewed-official-cards',
        cards: [
          ...REVIEWED_OFFICIAL_NAMES.map((name) => ({ name, count: 1 })),
          { name: 'Mountain', count: 2 },
        ],
      },
    },
    TABLE.seats[1],
  ],
  seed: '1544-reviewed-official',
};

const SINGLE_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-vindicate',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Vindicate', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-mandatory-single-target',
  maximumTurns: 8,
};

const ENTOMB_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-entomb',
        cards: [
          { name: 'Badlands', count: 24 },
          { name: 'Entomb', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-single-library-entomb',
  maximumTurns: 5,
};

const FARSEEK_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-farseek',
        cards: [
          { name: 'Bayou', count: 24 },
          { name: 'Farseek', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-single-library-farseek',
  maximumTurns: 8,
};

const STACK_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-counterspell',
        cards: [
          { name: 'Tundra', count: 24 },
          { name: 'Counterspell', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-explore',
        cards: [
          { name: 'Bayou', count: 24 },
          { name: 'Explore', count: 36 },
        ],
      },
    },
  ],
  seed: '1544-single-stack-target',
  maximumTurns: 10,
};

const ATTACKER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-swiftspears',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Monastery Swiftspear', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-combat-attackers',
  maximumTurns: 8,
};

const COMPOSITE_TARGET_COMBAT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-arbor-elves',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Arbor Elf', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-composite-target-combat',
  maximumTurns: 12,
};

const MANA_PAYMENT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-copperline-payment',
        cards: [
          { name: 'Copperline Gorge', count: 24 },
          { name: 'Flame Rift', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-mana-payment',
  maximumTurns: 8,
};

const VRASKA_GENERATED_TOKEN_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-vraska-generated-token',
        cards: [
          { name: 'Bayou', count: 30 },
          { name: 'Vraska, Relic Seeker', count: 15 },
          { name: 'Flame Rift', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-vraska-generated-token',
  maximumTurns: 22,
};

const ELDER_GARGAROTH_GENERATED_OBJECT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-elder-gargaroth-generated-object',
        cards: [
          { name: 'Forest', count: 40 },
          { name: 'Elder Gargaroth', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'z5q4-elder-gargaroth-generated-object',
  maximumTurns: 20,
};

const KARN_GENERATED_OBJECT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-karn-generated-object',
        cards: [
          { name: 'Plains', count: 40 },
          { name: 'Karn, Scion of Urza', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'z5q4-karn-generated-object',
  maximumTurns: 16,
};

const HANGARBACK_GENERATED_OBJECT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-hangarback-generated-object',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: 'Hangarback Walker', count: 15 },
          { name: 'Damnation', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'z5q4-hangarback-generated-object',
  maximumTurns: 18,
};

const URZAS_SAGA_GENERATED_OBJECT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-urzas-saga-generated-object',
        cards: [
          { name: 'Plains', count: 30 },
          { name: "Urza's Saga", count: 15 },
          { name: 'Bomat Courier', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'z5q4-urzas-saga-generated-object',
  maximumTurns: 16,
};

const TRIGGER_TARGET_BATTLEFIELD_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-luminarch-trigger-targets',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Luminarch Aspirant', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-trigger-target-battlefield',
  maximumTurns: 12,
};

const TRIGGER_TARGET_GRAVEYARD_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-snapcaster-trigger-targets',
        cards: [
          { name: 'Volcanic Island', count: 30 },
          { name: 'Flame Rift', count: 20 },
          { name: 'Snapcaster Mage', count: 10 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-trigger-target-graveyard',
  maximumTurns: 14,
};

const TRIGGER_TARGET_PLAYER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-messenger-trigger-targets',
        cards: [
          { name: 'Swamp', count: 30 },
          { name: "Geralf's Messenger", count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-trigger-target-player',
  maximumTurns: 10,
};

const TRIGGER_TARGET_ENCHANTMENT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-journey-trigger-targets',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Journey to Nowhere', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-firedrinkers',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Firedrinker Satyr', count: 30 },
        ],
      },
    },
  ],
  seed: '1544-trigger-target-enchantment',
  maximumTurns: 12,
};

const ARCHON_TRIGGER_COMPOSITION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-archon-trigger-composition',
        cards: [
          { name: 'Swamp', count: 48 },
          { name: 'Archon of Cruelty', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-archon-victim',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-archon-trigger-composition',
  maximumTurns: 60,
};

const ELITE_SPELLBINDER_TRIGGER_COMPOSITION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-elite-spellbinder-trigger-composition',
        cards: [
          { name: 'Plains', count: 42 },
          { name: 'Elite Spellbinder', count: 18 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-elite-spellbinder-victim',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Flame Rift', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-elite-spellbinder-trigger-composition',
  maximumTurns: 24,
};

const KITESAIL_FREEBOOTER_TRIGGER_COMPOSITION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-kitesail-freebooter-trigger-composition',
        cards: [
          { name: 'Swamp', count: 42 },
          { name: 'Kitesail Freebooter', count: 18 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-kitesail-freebooter-victim',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Flame Rift', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-kitesail-freebooter-trigger-composition',
  maximumTurns: 24,
};

const SHEOLDRED_TRIGGER_COMPOSITION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-sheoldred-trigger-composition',
        cards: [
          { name: 'Swamp', count: 36 },
          { name: 'Entomb', count: 8 },
          { name: 'Griselbrand', count: 8 },
          { name: 'Sheoldred, Whispering One', count: 8 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'z5q4-sheoldred-trigger-composition',
  maximumTurns: 60,
};

const ULAMOG_TRIGGER_COMPOSITION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-ulamog-trigger-composition',
        cards: [
          { name: 'Forest', count: 48 },
          { name: 'Ulamog, the Infinite Gyre', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-ulamog-victim',
        cards: [{ name: 'Mountain', count: 60 }],
      },
    },
  ],
  seed: 'z5q4-ulamog-trigger-composition',
  maximumTurns: 80,
};

const PALADIN_CLASS_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-paladin-class',
        cards: [
          { name: 'Plains', count: 28 },
          { name: 'Figure of Destiny', count: 16 },
          { name: 'Paladin Class', count: 16 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: '1544-paladin-class',
  maximumTurns: 24,
};

const SHOCKLAND_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: { name: 'human-shocklands', cards: [{ name: 'Stomping Ground', count: 60 }] },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-shockland-pay-life',
  maximumTurns: 8,
};

const EQUIP_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-zero-cost-equipment',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Firedrinker Satyr', count: 20 },
          { name: 'Grafted Wargear', count: 8 },
          { name: 'Lightning Greaves', count: 8 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-zero-cost-equip-target',
  maximumTurns: 24,
};

const AURA_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-control-magic',
        cards: [
          { name: 'Tundra', count: 14 },
          { name: 'Underground Sea', count: 14 },
          { name: 'Control Magic', count: 16 },
          { name: 'Vindicate', count: 16 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-duplicate-creatures',
        cards: [
          { name: 'Plains', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
  ],
  seed: '1544-control-magic-aura-target',
  maximumTurns: 24,
};

const FETTERS_AURA_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-faiths-fetters',
        cards: [
          { name: 'Plateau', count: 10 },
          { name: 'Scrubland', count: 10 },
          { name: 'Figure of Destiny', count: 8 },
          { name: 'Wall of Omens', count: 4 },
          { name: 'Firedrinker Satyr', count: 4 },
          { name: 'Worn Powerstone', count: 8 },
          { name: "Faith's Fetters", count: 8 },
          { name: 'Vindicate', count: 8 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-forced-goblin-attacks',
        cards: [
          { name: 'Mountain', count: 48 },
          { name: 'Goblin Rabblemaster', count: 12 },
        ],
      },
    },
  ],
  seed: '1544-faiths-fetters-aura-target',
  maximumTurns: 30,
};

const FETTERS_ARTIFACT_TARGET_TABLE: SessionSpec = {
  ...FETTERS_AURA_TARGET_TABLE,
  seats: [
    FETTERS_AURA_TARGET_TABLE.seats[0],
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-passive-fetters-artifact',
        cards: [{ name: 'Mountain', count: 60 }],
      },
    },
  ],
  seed: '1544-faiths-fetters-artifact-target',
  // Observe the next local combat after the second Aura is removed in postcombat main.
  maximumTurns: 32,
};

const FALL_AURA_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-fall-from-favor',
        cards: [
          { name: 'Island', count: 36 },
          { name: 'Fall from Favor', count: 24 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-duplicate-walls-and-attacker',
        cards: [
          { name: 'Plateau', count: 30 },
          { name: 'Wall of Omens', count: 20 },
          { name: 'Hellrider', count: 10 },
        ],
      },
    },
  ],
  seed: '1544-fall-from-favor-aura-target',
  maximumTurns: 18,
};

const BANESLAYER_COMBAT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-baneslayer-angel',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Baneslayer Angel', count: 24 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-ground-blockers',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Wall of Omens', count: 24 },
        ],
      },
    },
  ],
  seed: '1544-baneslayer-combat',
  maximumTurns: 14,
};

const baneslayerProtectionTable = (
  sourceName: 'Dragonlord Silumgar' | 'Griselbrand' | 'Massacre Wurm',
  landName: 'Underground Sea' | 'Swamp',
): SessionSpec => ({
  ...BANESLAYER_COMBAT_TABLE,
  seats: [
    BANESLAYER_COMBAT_TABLE.seats[0],
    {
      ...TABLE.seats[1],
      deck: {
        name: `ai-${sourceName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`,
        cards: [
          { name: landName, count: 36 },
          { name: sourceName, count: 24 },
        ],
      },
    },
  ],
  seed: `1544-baneslayer-${sourceName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`,
  maximumTurns: 22,
});

const BANESLAYER_DRAGON_PROTECTION_TABLE = baneslayerProtectionTable(
  'Dragonlord Silumgar',
  'Underground Sea',
);
const BANESLAYER_DEMON_PROTECTION_TABLE = baneslayerProtectionTable('Griselbrand', 'Swamp');
const BANESLAYER_NONPROTECTED_TABLE = baneslayerProtectionTable('Massacre Wurm', 'Swamp');

const CHART_A_COURSE_NO_ATTACK_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-chart-a-course-no-attack',
        cards: [
          { name: 'Island', count: 36 },
          { name: 'Chart a Course', count: 24 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-chart-a-course-no-attack',
  maximumTurns: 6,
};

const CHART_A_COURSE_ATTACK_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-chart-a-course-after-attack',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Pteramander', count: 15 },
          { name: 'Chart a Course', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-chart-a-course-after-attack',
  maximumTurns: 8,
};

const ROTTING_REGISAUR_DISCARD_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-rotting-regisaur-discard',
        cards: [
          { name: 'Swamp', count: 36 },
          { name: 'Rotting Regisaur', count: 24 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: '1544-rotting-regisaur-discard',
  maximumTurns: 8,
};

const STUDENT_OF_WARFARE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-student-of-warfare',
        cards: [
          { name: 'Plains', count: 42 },
          { name: 'Student of Warfare', count: 18 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: '1544-student-of-warfare-level-up',
  maximumTurns: 10,
};

const JORAGA_TREESPEAKER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-joraga-treespeaker',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Joraga Treespeaker', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-forests', cards: [{ name: 'Forest', count: 60 }] },
    },
  ],
  seed: 'z5q4-15-joraga-treespeaker-level-up',
  maximumTurns: 8,
};

const HEXDRINKER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-hexdrinker',
        cards: [
          { name: 'Forest', count: 42 },
          { name: 'Hexdrinker', count: 18 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-forests', cards: [{ name: 'Forest', count: 60 }] },
    },
  ],
  seed: 'z5q4-15-hexdrinker-level-up',
  maximumTurns: 8,
};

const SELFLESS_SPIRIT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-selfless-spirit',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Selfless Spirit', count: 15 },
          { name: 'Day of Judgment', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-ground-walls',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: '1544-selfless-spirit-indestructible',
  maximumTurns: 14,
};

const REMORSEFUL_CLERIC_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-remorseful-cleric',
        cards: [
          { name: 'Scrubland', count: 30 },
          { name: 'Remorseful Cleric', count: 15 },
          { name: 'Doom Blade', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-graveyard-and-wall',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: '1544-remorseful-cleric-target-graveyard-exile',
  maximumTurns: 12,
};

const COLDSTEEL_HEART_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-coldsteel-heart',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Coldsteel Heart', count: 15 },
          { name: 'Flame Rift', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: '1544-coldsteel-heart-entry-color-chosen-mana',
  maximumTurns: 10,
};

const EXTINCTION_EVENT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-extinction-event',
        cards: [
          { name: 'Underground Sea', count: 30 },
          { name: 'Hard Evidence', count: 15 },
          { name: 'Extinction Event', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-swiftspear',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Monastery Swiftspear', count: 30 },
        ],
      },
    },
  ],
  seed: '1544-extinction-event-odd-even-exile',
  maximumTurns: 14,
};

const BASIC_MANA_CASES = [
  { land: 'Plains', spell: 'Honor of the Pure', symbol: '{W}' },
  { land: 'Island', spell: 'Fblthp, the Lost', symbol: '{U}' },
  { land: 'Swamp', spell: "Night's Whisper", symbol: '{B}' },
  { land: 'Mountain', spell: 'Flame Rift', symbol: '{R}' },
  { land: 'Forest', spell: 'Explore', symbol: '{G}' },
] as const;

const OPTIONAL_TRIGGER_CONFIRM_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-consecrated-sphinx',
        cards: [
          { name: 'Island', count: 45 },
          { name: 'Consecrated Sphinx', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: '1544-optional-trigger-confirm',
  maximumTurns: 40,
};

const OPTIONAL_DECIDER_YOU_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-recruiter-search',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Recruiter of the Guard', count: 12 },
          { name: 'Bomat Courier', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-optional-decider-you',
  maximumTurns: 30,
};

const ALTERNATE_MODE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-bonecrusher-adventure',
        cards: [
          { name: 'Mountain', count: 40 },
          { name: 'Bonecrusher Giant', count: 20 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-reviewed-alternate-mode',
  maximumTurns: 30,
};

const MODAL_DOUBLE_FACE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-tangled-florahedron',
        cards: [
          { name: 'Forest', count: 40 },
          { name: 'Tangled Florahedron', count: 20 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-reviewed-modal-double-face',
  maximumTurns: 10,
};

const TRANSFORM_FACE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-avacyn-transform',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Selfless Spirit', count: 12 },
          { name: 'Archangel Avacyn', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'z5q4-reviewed-transform-face',
  maximumTurns: 30,
};

const BLOCKER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-walls',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-firedrinkers',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Firedrinker Satyr', count: 36 },
        ],
      },
    },
  ],
  seed: '1544-combat-blockers',
  maximumTurns: 10,
};

const COMBAT_DAMAGE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-craterhoof',
        cards: [
          { name: 'Ancient Tomb', count: 18 },
          { name: 'Bayou', count: 30 },
          { name: 'Craterhoof Behemoth', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-walls',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
  ],
  seed: '1544-c',
  maximumTurns: 16,
};

const requireForge = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
const forgeIt = requireForge ? it : it.skip;

/**
 * Repeated bounded selection, in the two shapes the phase turns on.
 *
 * Thirst for Knowledge draws three and then asks for two cards out of the hand,
 * or one artifact -- Forge's only stopping rule in this family that is not a
 * count. The seat holds Coldsteel Hearts it never casts precisely so both
 * branches are reachable in one game.
 */
const BOUNDED_DISCARD_SELECTION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-thirst',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Thirst for Knowledge', count: 15 },
          { name: 'Coldsteel Heart', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'fp4l-2-bounded-discard-selection',
  maximumTurns: 40,
};

/** Knight of Autumn: one mode out of three, with a consequence on the life total. */
const BOUNDED_MODE_SELECTION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-knight',
        cards: [
          { name: 'Forest', count: 22 },
          { name: 'Plains', count: 22 },
          { name: 'Knight of Autumn', count: 16 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'fp4l-2-bounded-mode-selection',
  maximumTurns: 40,
};

/**
 * `mtg-fp4l` phase 3, the cheap half: a protection quality and a mode, each
 * chosen out of a list the card's own script wrote down.
 *
 * Mother of Runes asks which color to be protected from, which is the whole of
 * `chooseProtectionType`, and Brightling's `{1}` asks which of its two pump
 * modes to take, which is Forge's `ChooseGenericEffect` reaching
 * `chooseSingleSpellForEffect`. The second answer moves a power and a
 * toughness, so what the seat said is readable off the board rather than only
 * off the prompt.
 */
const BOUNDED_PROTECTION_AND_MODE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-runes',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Mother of Runes', count: 15 },
          { name: 'Brightling', count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-plains', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'fp4l-3-protection-and-mode',
  maximumTurns: 40,
};

/**
 * The expensive half: a color and a card type, each named as a permanent enters.
 *
 * Iona names a color its opponents then cannot cast, and the opponent's deck is
 * mono-white on purpose, so the consequence of the seat's own answer is
 * countable on the other side of the table -- the walls stop arriving while the
 * hand holding them keeps growing. Serra's Emissary names a card type, and the
 * projection carries no keyword to read protection off, so what is measured
 * there is the question rather than its effect: the types Forge enumerated,
 * offered to the seat rather than answered for it.
 */
const BOUNDED_COLOR_AND_TYPE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-angels',
        cards: [
          { name: 'Plains', count: 36 },
          { name: 'Iona, Shield of Emeria', count: 12 },
          { name: "Serra's Emissary", count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-white-walls',
        cards: [
          { name: 'Scrubland', count: 20 },
          { name: 'Wall of Omens', count: 40 },
        ],
      },
    },
  ],
  seed: 'fp4l-3-bounded-color-and-type',
  maximumTurns: 60,
};

/**
 * Both halves of `vote`, which is the callback `piles-votes` reaches.
 *
 * Coercive Portal votes on two of its own modes, which Forge routes to
 * `chooseSpellAbilitiesForEffect`; Council's Judgment votes on a permanent,
 * which it routes to `chooseSingleEntityForEffect`. The second is the one with
 * a consequence a board can be read for: with two voters, everything tied for
 * most votes is exiled, so the permanent this seat voted for leaves while the
 * ones it did not vote for stay -- which is only true if the seat cast its own
 * vote.
 */
const BOUNDED_VOTE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-council',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Coercive Portal', count: 15 },
          { name: "Council's Judgment", count: 15 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-white-walls',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-3-bounded-vote',
  maximumTurns: 40,
};

/**
 * `mtg-fp4l` phase 4: the number the caster states rather than picks off a list.
 *
 * Both arms of `announceRequirements` are in one table. Stonecoil Serpent
 * announces the X in a mana cost and then enters with that many +1/+1 counters,
 * so the number the seat stated is the power and toughness on the board. Toxic
 * Deluge announces an X that is paid in life rather than mana, which is the arm
 * bounded by `getMaxForNonManaX`, and it spends that number through the cost
 * seam `getCostDecisionMaker` now owns; the life it costs and the walls it
 * leaves standing are both the stated number read back off the table.
 *
 * The opponent is the same mono-white wall deck the phase-3 tables use, for the
 * same reason: 0/4 is a toughness a small announcement does not reach, so a
 * deluge cast for two is legible as two rather than as any number at all.
 */
const ANNOUNCED_NUMBER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-announced-x',
        cards: [
          { name: 'Swamp', count: 34 },
          { name: 'Stonecoil Serpent', count: 13 },
          { name: 'Toxic Deluge', count: 13 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-white-walls',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-4-announced-number',
  maximumTurns: 60,
};

/**
 * One table for all three ordering shapes `mtg-fp4l` phase 5 wired.
 *
 * Preordain scries two, so the seat says which of the two leaves the top and
 * then which of the ones that stayed is on top. Brainstorm puts two cards from
 * hand back on the library in a stated order, which is the same question asked
 * through a different callback. And the channeler surveils whenever a
 * noncreature spell is cast, which is the scry question with a graveyard on the
 * other side of it; casting either spell in front of it fires the trigger. The
 * dual land is what lets one deck cast a red one-drop and two blue ones.
 */
const STATED_ORDERING_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-stated-ordering',
        cards: [
          { name: 'Volcanic Island', count: 26 },
          { name: "Dragon's Rage Channeler", count: 10 },
          { name: 'Preordain', count: 12 },
          { name: 'Brainstorm', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-white-walls',
        cards: [
          { name: 'Scrubland', count: 24 },
          { name: 'Wall of Omens', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-5-stated-ordering',
  maximumTurns: 60,
};

/**
 * `mtg-fp4l` phase 6: the amount the seat divides rather than has divided for it.
 *
 * Electrolyze is the smallest statement of the question in the cube. It deals
 * two damage divided as the caster chooses among one or two targets, so the
 * seat says both how many targets there are and how much each one takes, and
 * the two answers are the same sequence of assignments.
 *
 * The opposing board is one-toughness creatures, which is what makes the
 * division readable off the table rather than out of the transcript: one point
 * is lethal to each, so a two-and-nothing kills one creature and a one-and-one
 * kills two. The deck runs thirty-six of them so that a third is still standing
 * when the other two die, and every claim below is made against an object id,
 * because a name here names thirty-six objects.
 */
const STATED_DISTRIBUTION_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-stated-distribution',
        cards: [
          { name: 'Volcanic Island', count: 26 },
          { name: 'Electrolyze', count: 34 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-green-dorks',
        cards: [
          { name: 'Forest', count: 24 },
          { name: 'Llanowar Elves', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-6-stated-distribution',
  maximumTurns: 60,
};

/**
 * The table phase 7 states a retarget on.
 *
 * `mtg-fp4l`. Spellskite is the whole subject and one seat has to own both ends
 * of the question, so the local seat runs the Bolt as well: it burns the AI
 * player, holds priority with its own spell on the stack, and takes that spell's
 * target away with `{U/P}`. Nothing here is answered by the AI, which is the
 * point -- a retarget the opponent chose would prove the callback fires and
 * nothing about who answered it.
 *
 * The board reads the outcome back rather than the transcript. Lightning Bolt
 * deals exactly three and Spellskite is a 0/4, so a Bolt that moved leaves a
 * creature standing with three damage on it and a player still on twenty, and a
 * Bolt that did not moves the player to seventeen. The two cannot both be true,
 * so no assertion here can pass on a retarget that silently did nothing.
 *
 * The opposing deck is the phase 6 green dorks for the same reason it was used
 * there: it is audited, it casts nothing that targets, and it never puts a
 * second object on the stack for the redirection to find.
 */
const STATED_RETARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-stated-retarget',
        cards: [
          { name: 'Volcanic Island', count: 26 },
          { name: 'Spellskite', count: 17 },
          { name: 'Lightning Bolt', count: 17 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-green-dorks',
        cards: [
          { name: 'Forest', count: 24 },
          { name: 'Llanowar Elves', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-7-stated-retarget',
  maximumTurns: 60,
};

/**
 * Forge names an option after its host, so a card in hand and an ability that
 * card has both open with the same words.
 *
 * `Student of Warfare: Student of Warfare - Creature 1 / 1` casts it and
 * `Student of Warfare: Level up {W} (...)` levels it up, and a prefix match on
 * the card name alone takes whichever Forge happened to list first.
 */
const LEVEL_UP =
  'Student of Warfare: Level up {W} ({W}: Put a level counter on this. Level up only as a sorcery.)';

function isLevelUp(text: string): boolean {
  return text === LEVEL_UP;
}

function isCast(text: string, name: string): boolean {
  return text.startsWith(`${name}: ${name} - `);
}

/**
 * The table phase 8 names a card on.
 *
 * `mtg-fp4l`. Phyrexian Revoker is the whole subject, and the question it asks
 * is the open one: not a list Forge enumerated but every card ever printed,
 * narrowed only by `ValidCards$ Card.nonLand`. So the seat needs something whose
 * activated ability it can watch stop working, and Student of Warfare is the
 * cheapest one in this cube -- a one-mana creature whose whole added surface is
 * `Level up:W`, an activated ability that needs no target and no second
 * permanent to be offered.
 *
 * The board reads the naming back rather than the transcript. Level up is
 * offered at the seat's own main phase with an untapped Plains standing, and
 * `CantBeActivated` takes it away the moment a Revoker naming that card is on
 * the battlefield. Both samples are taken at the same phase and step with the
 * Student still standing and mana still untapped, so what changed between them
 * is the name and nothing else.
 *
 * The opposing deck is the phase 6 green dorks: audited, targeting nothing, and
 * putting nothing on the stack for the naming to collide with.
 */
const OPEN_CARD_NAMING_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-open-card-naming',
        cards: [
          { name: 'Plains', count: 24 },
          { name: 'Student of Warfare', count: 20 },
          { name: 'Phyrexian Revoker', count: 16 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-green-dorks',
        cards: [
          { name: 'Forest', count: 24 },
          { name: 'Llanowar Elves', count: 36 },
        ],
      },
    },
  ],
  seed: 'fp4l-8-open-card-naming',
  maximumTurns: 60,
};

const DISCARD_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-thrill-cost',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Thrill of Possibility', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-discard-cost',
  maximumTurns: 12,
};

const FETCHLAND_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-fetch-cost',
        cards: [
          { name: 'Polluted Delta', count: 30 },
          { name: 'Island', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-source-sacrifice-cost',
  maximumTurns: 8,
};

const WHOLE_HAND_DISCARD_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-bomat-cost',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Bomat Courier', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-whole-hand-discard-cost',
  maximumTurns: 12,
};

const FIEND_ARTISAN_SACRIFICE_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-fiend-artisan-cost',
        cards: [
          { name: 'Bayou', count: 30 },
          { name: 'Fiend Artisan', count: 10 },
          { name: 'Elvish Mystic', count: 10 },
          { name: 'Llanowar Elves', count: 10 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-fiend-artisan-sacrifice-cost',
  maximumTurns: 16,
};

const OUTPOST_SIEGE_TRIGGER_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-outpost-siege-trigger-target',
        cards: [
          { name: 'Plateau', count: 36 },
          { name: 'Selfless Spirit', count: 8 },
          { name: 'Outpost Siege', count: 8 },
          { name: 'Lightning Bolt', count: 8 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-outpost-siege-trigger-target',
  maximumTurns: 22,
};

const KLOTHYS_TRIGGER_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-klothys-trigger-target',
        cards: [
          { name: 'Taiga', count: 30 },
          { name: 'Flame Rift', count: 15 },
          { name: 'Klothys, God of Destiny', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-klothys-trigger-target',
  maximumTurns: 18,
};

const TIDEHOLLOW_SCULLER_TRIGGER_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-tidehollow-trigger-target',
        cards: [
          { name: 'Scrubland', count: 36 },
          { name: 'Tidehollow Sculler', count: 12 },
          { name: 'Vindicate', count: 12 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-tidehollow-victim',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Flame Rift', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-tidehollow-trigger-target',
  maximumTurns: 20,
};

const SHOWDOWN_TRIGGER_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-showdown-trigger-target',
        cards: [
          { name: 'Plateau', count: 32 },
          { name: 'Monastery Swiftspear', count: 10 },
          { name: 'Showdown of the Skalds', count: 9 },
          { name: 'Flame Rift', count: 9 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-showdown-trigger-target',
  maximumTurns: 22,
};

const ELSPETH_CONQUERS_DEATH_COUNTER_TYPE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-elspeth-conquers-death-counter-type',
        cards: [
          { name: 'Plateau', count: 32 },
          { name: 'Selfless Spirit', count: 10 },
          { name: 'Elspeth Conquers Death', count: 10 },
          { name: 'Lightning Bolt', count: 8 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-elspeth-conquers-death-targets',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Worn Powerstone', count: 24 },
        ],
      },
    },
  ],
  seed: 'z5q4-elspeth-conquers-death-counter-type',
  maximumTurns: 28,
};

const TEFERI_OPTIONAL_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-teferi-optional-target',
        cards: [
          { name: 'Tundra', count: 30 },
          { name: 'Wall of Omens', count: 15 },
          { name: 'Teferi, Time Raveler', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-teferi-optional-target',
  maximumTurns: 16,
};

const NISSA_OPTIONAL_TARGET_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-nissa-optional-target',
        cards: [
          { name: 'Forest', count: 45 },
          { name: 'Nissa, Who Shakes the World', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-nissa-optional-target',
  maximumTurns: 18,
};

const DISMEMBER_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-dismember-phyrexian-spell',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 15 },
          { name: 'Dismember', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-dismember-phyrexian-spell',
  maximumTurns: 16,
};

const LEGIONNAIRE_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-legionnaire-phyrexian-spell',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Porcelain Legionnaire', count: 24 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-legionnaire-phyrexian-spell',
  maximumTurns: 12,
};

const GUT_SHOT_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-gut-shot-phyrexian-spell',
        cards: [
          { name: 'Plains', count: 18 },
          { name: 'Mountain', count: 12 },
          { name: 'Wall of Omens', count: 15 },
          { name: 'Gut Shot', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-gut-shot-phyrexian-spell',
  maximumTurns: 20,
};

const GITAXIAN_PROBE_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-gitaxian-probe-phyrexian-spell',
        cards: [
          { name: 'Island', count: 20 },
          { name: 'Gitaxian Probe', count: 40 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-islands', cards: [{ name: 'Island', count: 60 }] } },
  ],
  seed: 'z5q4-gitaxian-probe-phyrexian-spell',
  maximumTurns: 10,
};

const NORNS_ANNEX_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-norns-annex-phyrexian-spell',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: "Norn's Annex", count: 24 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-norns-annex-phyrexian-spell',
  maximumTurns: 16,
};

const CORROSIVE_GALE_PHYREXIAN_SPELL_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-corrosive-gale-phyrexian-spell',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Corrosive Gale', count: 24 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-corrosive-gale-phyrexian-spell',
  maximumTurns: 16,
};

const BLOODBRAID_CASCADE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-bloodbraid-cascade',
        cards: [
          { name: 'Taiga', count: 40 },
          { name: 'Bloodbraid Elf', count: 10 },
          { name: 'Wall of Omens', count: 10 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-bloodbraid-cascade',
  maximumTurns: 14,
};

const SHARDLESS_CASCADE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-shardless-cascade',
        cards: [
          { name: 'Tropical Island', count: 40 },
          { name: 'Shardless Agent', count: 10 },
          { name: 'Wall of Omens', count: 10 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-shardless-cascade',
  maximumTurns: 14,
};

const WRETCHED_CONFLUENCE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-wretched-confluence',
        cards: [
          { name: 'Swamp', count: 40 },
          { name: 'Wretched Confluence', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-wretched-confluence',
  maximumTurns: 16,
};

const FIERY_CONFLUENCE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-fiery-confluence',
        cards: [
          { name: 'Mountain', count: 40 },
          { name: 'Fiery Confluence', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-fiery-confluence',
  maximumTurns: 14,
};

const PLOW_UNDER_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-plow-under',
        cards: [
          { name: 'Forest', count: 40 },
          { name: 'Plow Under', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-plow-under',
  maximumTurns: 20,
};

const COALITION_RELIC_MANA_COMBO_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-coalition-relic-mana-combo',
        cards: [
          { name: 'Ancient Tomb', count: 30 },
          { name: 'Coalition Relic', count: 15 },
          { name: 'Lightning Bolt', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-coalition-relic-mana-combo',
  maximumTurns: 12,
};

const MARKET_FESTIVAL_MANA_COMBO_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-market-festival-mana-combo',
        cards: [
          { name: 'Forest', count: 40 },
          { name: 'Market Festival', count: 20 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-market-festival-mana-combo',
  maximumTurns: 16,
};

const TERRARION_MANA_COMBO_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-terrarion-mana-combo',
        cards: [
          { name: 'Forest', count: 45 },
          { name: 'Terrarion', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-forests', cards: [{ name: 'Forest', count: 60 }] } },
  ],
  seed: 'rav-terrarion-mana-combo',
  maximumTurns: 16,
};

const CRYPTIC_COMMAND_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-cryptic-command',
        cards: [
          { name: 'Tundra', count: 40 },
          { name: 'Cryptic Command', count: 20 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-explore',
        cards: [
          { name: 'Bayou', count: 24 },
          { name: 'Explore', count: 36 },
        ],
      },
    },
  ],
  seed: '1544-single-stack-target',
  maximumTurns: 12,
};

const PHANTASMAL_IMAGE_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-phantasmal-image',
        cards: [
          { name: 'Tundra', count: 30 },
          { name: 'Wall of Omens', count: 15 },
          { name: 'Phantasmal Image', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-phantasmal-image',
  maximumTurns: 14,
};

const KARN_LIBERATED_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-karn-liberated',
        cards: [
          { name: 'Ancient Tomb', count: 40 },
          { name: 'Karn Liberated', count: 20 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-karn-restart-permanents',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-karn-liberated-restart',
  maximumTurns: 24,
};

const RATTLECLAW_MYSTIC_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-rattleclaw-mystic',
        cards: [
          { name: 'Ancient Tomb', count: 30 },
          { name: 'Rattleclaw Mystic', count: 15 },
          { name: 'Lightning Bolt', count: 15 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-rattleclaw-mystic-morph',
  maximumTurns: 16,
};

const LIGHTNING_PHOENIX_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-lightning-phoenix',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Lightning Phoenix', count: 10 },
          { name: 'Thrill of Possibility', count: 10 },
          { name: 'Flame Rift', count: 10 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-lightning-phoenix-triggered-payment',
  maximumTurns: 20,
};

const GLORYBRINGER_EXERT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-glorybringer-exert',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Glorybringer', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-glorybringer-targets',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Wall of Omens', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-glorybringer-exert',
  maximumTurns: 20,
};

const BARAL_TRIGGERED_LOOT_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-baral-triggered-loot',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Baral, Chief of Compliance', count: 10 },
          { name: 'Counterspell', count: 20 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-baral-counter-targets',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Lightning Bolt', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-baral-triggered-loot',
  maximumTurns: 20,
};

const NAHIRI_UNLESS_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-nahiri-unless-cost',
        cards: [
          { name: 'Plateau', count: 36 },
          { name: 'Nahiri, the Harbinger', count: 12 },
          { name: 'Wall of Omens', count: 12 },
        ],
      },
    },
    { ...TABLE.seats[1], deck: { name: 'ai-mountains', cards: [{ name: 'Mountain', count: 60 }] } },
  ],
  seed: 'z5q4-nahiri-unless-cost',
  maximumTurns: 20,
};

const ESPER_SENTINEL_UNLESS_COST_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-esper-sentinel-payer',
        cards: [
          { name: 'Mountain', count: 36 },
          { name: 'Everflowing Chalice', count: 24 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: {
        name: 'ai-esper-sentinel',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Esper Sentinel', count: 30 },
        ],
      },
    },
  ],
  seed: 'z5q4-esper-sentinel-unless-cost',
  maximumTurns: 8,
};

const KICKER_OUTCOME_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-burst-kicker',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Burst Lightning', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-kicker-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-kicker-outcome',
  maximumTurns: 16,
};

const MULTIKICKER_OUTCOME_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-chalice-multikicker',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Everflowing Chalice', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-multikicker-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-multikicker-outcome',
  maximumTurns: 14,
};

const SUSPEND_OUTCOME_TABLE: SessionSpec = {
  ...TABLE,
  seats: [
    {
      ...TABLE.seats[0],
      deck: {
        name: 'human-rift-bolt-suspend',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Rift Bolt', count: 30 },
        ],
      },
    },
    {
      ...TABLE.seats[1],
      deck: { name: 'ai-suspend-mountains', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'z5q4-suspend-outcome',
  maximumTurns: 12,
};

/** What an option says with the id the bridge appends to it taken back off. */
function optionLabel(text: string): string {
  return text.replace(/ \[[^\]]*\]$/u, '');
}

describe('installed Forge observed backend', () => {
  forgeIt(
    'offers the local seat every universal pregame choice and honors keep',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open({ ...TABLE, maximumTurns: 1 });
      if (!opened.ok) throw new Error(opened.error.message);
      expect(opened.ok).toBe(true);

      let session = opened.session;
      expect(session.decision).toMatchObject({
        seat: 0,
        kind: 'starting-player',
        complete: true,
      });
      const playFirst = session.decision?.options.find((option) => option.text === 'Play first');
      expect(playFirst).toBeDefined();
      const started = await session.submit(playFirst!.id);
      expect(started.ok).toBe(true);
      if (!started.ok) throw new Error(started.error.message);
      session = started.session;

      expect(session.decision).toMatchObject({ seat: 0, kind: 'mulligan', complete: true });
      expect(session.decision?.options.map((option) => option.text)).toEqual([
        'Keep this hand',
        'Take a mulligan',
      ]);
      const keep = session.decision!.options.find((option) => option.text === 'Keep this hand')!;
      const kept = await session.submit(keep.id);
      expect(kept.ok).toBe(true);
      if (!kept.ok) throw new Error(kept.error.message);
      session = kept.session;

      expect(session.decision?.kind).toBe('priority');
      expect(session.view.turn.active).toBe(0);
      expect(session.transcript.map((frame) => frame.move)).toEqual([null, playFirst!.id, keep.id]);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'proves optional, repeated, and suspend alternate costs through installed Forge outcomes',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;

      expect(await backend.supports(KICKER_OUTCOME_TABLE)).toEqual([]);
      const kickerOpened = await backend.open(KICKER_OUTCOME_TABLE);
      if (!kickerOpened.ok) throw new Error(kickerOpened.error.message);
      let kicker = kickerOpened.session;
      let choseKicker = false;
      let submittedBurst = false;
      const kickerTrace: string[] = [];
      for (let submitted = 0; kicker.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = kicker.decision;
        if (decision === null) throw new Error('Forge offered no kicker decision');
        kickerTrace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'optional-cost-choice') {
          const cost = decision.options.find((option) => !option.id.endsWith('-done'));
          move = choseKicker ? decision.options.find((option) => option.id.endsWith('-done'))?.id : cost?.id;
          choseKicker ||= move === cost?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find(
            (option) =>
              option.text.includes('Forge AI') || option.targets.some((target) => target.name === 'Forge AI'),
          )?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const mountains = kicker.view.seats[0].battlefield.filter(
            (card) => card.name === 'Mountain',
          ).length;
          const burst = decision.options.find((option) => option.text.startsWith('Burst Lightning:'));
          move =
            (kicker.view.seats[1].life === 16
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (!submittedBurst && mountains >= 5 ? burst?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          submittedBurst ||= move === burst?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no kicker move');
        const advanced = await kicker.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${kickerTrace.slice(-80).join('\n')}`);
        kicker = advanced.session;
      }
      expect(choseKicker, kickerTrace.slice(-100).join('\n')).toBe(true);
      expect(submittedBurst, kickerTrace.slice(-100).join('\n')).toBe(true);
      expect(kicker.view.seats[1].life, kickerTrace.slice(-100).join('\n')).toBe(16);
      await kicker.close();

      expect(await backend.supports(MULTIKICKER_OUTCOME_TABLE)).toEqual([]);
      const multikickerOpened = await backend.open(MULTIKICKER_OUTCOME_TABLE);
      if (!multikickerOpened.ok) throw new Error(multikickerOpened.error.message);
      let multikicker = multikickerOpened.session;
      let choseTwo = false;
      const multikickerTrace: string[] = [];
      for (let submitted = 0; multikicker.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = multikicker.decision;
        if (decision === null) throw new Error('Forge offered no multikicker decision');
        multikickerTrace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'number' && decision.prompt.includes('Everflowing Chalice')) {
          move = decision.options.find((option) => option.id === 'number-2')?.id;
          choseTwo ||= move !== undefined;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = multikicker.view.seats[0];
          const chalice = local.battlefield.find((card) => card.name === 'Everflowing Chalice');
          const hasTwoCounters = chalice !== undefined && Object.values(chalice.counters).includes(2);
          const mountains = local.battlefield.filter((card) => card.name === 'Mountain').length;
          move =
            (hasTwoCounters ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (chalice === undefined && mountains >= 4
              ? decision.options.find((option) => option.text.startsWith('Everflowing Chalice:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no multikicker move');
        const advanced = await multikicker.submit(move);
        if (!advanced.ok)
          throw new Error(`${advanced.error.message}\n${multikickerTrace.slice(-80).join('\n')}`);
        multikicker = advanced.session;
      }
      const chalice = multikicker.view.seats[0].battlefield.find(
        (card) => card.name === 'Everflowing Chalice',
      );
      expect(choseTwo, multikickerTrace.slice(-100).join('\n')).toBe(true);
      expect(chalice, multikickerTrace.slice(-100).join('\n')).toBeDefined();
      expect(Object.values(chalice?.counters ?? {}), multikickerTrace.slice(-100).join('\n')).toContain(2);
      await multikicker.close();

      expect(await backend.supports(SUSPEND_OUTCOME_TABLE)).toEqual([]);
      const suspendOpened = await backend.open(SUSPEND_OUTCOME_TABLE);
      if (!suspendOpened.ok) throw new Error(suspendOpened.error.message);
      let suspend = suspendOpened.session;
      let submittedSuspend = false;
      let observedExile = false;
      const suspendTrace: string[] = [];
      for (let submitted = 0; suspend.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = suspend.decision;
        if (decision === null) throw new Error('Forge offered no suspend decision');
        suspendTrace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        observedExile ||= suspend.view.seats[0].exile.some((card) => card.name === 'Rift Bolt');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          move = decision.options.find(
            (option) =>
              option.text.includes('Forge AI') || option.targets.some((target) => target.name === 'Forge AI'),
          )?.id;
        } else if (decision.kind === 'confirm-action') {
          move = decision.options.find((option) => !/decline|no|cancel/iu.test(option.text))?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const suspendMove = decision.options.find(
            (option) => option.text.includes('Rift Bolt') && option.text.includes('Suspend'),
          );
          move =
            (suspend.view.seats[1].life === 17
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (!submittedSuspend ? suspendMove?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          submittedSuspend ||= move === suspendMove?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no suspend move');
        const advanced = await suspend.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${suspendTrace.slice(-80).join('\n')}`);
        suspend = advanced.session;
      }
      expect(submittedSuspend, suspendTrace.slice(-100).join('\n')).toBe(true);
      expect(observedExile, suspendTrace.slice(-100).join('\n')).toBe(true);
      expect(suspend.view.seats[1].life, suspendTrace.slice(-100).join('\n')).toBe(17);
      await suspend.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'honors local London mulligans and makes the local seat choose the bottom cards',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open({ ...TABLE, maximumTurns: 1 });
      if (!opened.ok) throw new Error(opened.error.message);

      let session = opened.session;
      const playFirst = session.decision!.options.find((option) => option.text === 'Play first')!;
      const started = await session.submit(playFirst.id);
      if (!started.ok) throw new Error(started.error.message);
      session = started.session;

      const initialHand = session.view.seats[0].hand!.map((card) => card.oid);
      const mulligan = session.decision!.options.find((option) => option.text === 'Take a mulligan')!;
      const redrawn = await session.submit(mulligan.id);
      if (!redrawn.ok) throw new Error(redrawn.error.message);
      session = redrawn.session;

      expect(session.decision).toMatchObject({
        seat: 0,
        kind: 'mulligan-bottom',
        complete: true,
      });
      expect(session.decision?.options).toHaveLength(7);
      expect(new Set(session.decision?.options.map((option) => option.id)).size).toBe(7);
      expect(session.decision?.options.every((option) => option.targets.length === 1)).toBe(true);
      expect(
        session.decision?.options.every((option) =>
          option.targets.every((target) =>
            session.view.seats[0].hand?.some((card) => card.oid === target.oid),
          ),
        ),
      ).toBe(true);
      expect(session.view.seats[0].hand).toHaveLength(7);
      expect(session.view.seats[0].hand!.map((card) => card.oid)).not.toEqual(initialHand);
      const bottom = session.decision!.options[0]!;
      const tucked = await session.submit(bottom.id);
      if (!tucked.ok) throw new Error(tucked.error.message);
      session = tucked.session;

      expect(session.decision).toMatchObject({ seat: 0, kind: 'mulligan', complete: true });
      expect(session.view.seats[0].hand).toHaveLength(6);
      const secondMulligan = session.decision!.options.find((option) => option.text === 'Take a mulligan')!;
      const redrawnAgain = await session.submit(secondMulligan.id);
      if (!redrawnAgain.ok) throw new Error(redrawnAgain.error.message);
      session = redrawnAgain.session;

      expect(session.decision).toMatchObject({ seat: 0, kind: 'mulligan-bottom', complete: true });
      expect(session.decision?.options).toHaveLength(21);
      expect(new Set(session.decision?.options.map((option) => option.id)).size).toBe(21);
      expect(session.decision?.options.every((option) => option.targets.length === 2)).toBe(true);
      const bottomTwo = session.decision!.options.at(-1)!;
      const tuckedAgain = await session.submit(bottomTwo.id);
      if (!tuckedAgain.ok) throw new Error(tuckedAgain.error.message);
      session = tuckedAgain.session;

      expect(session.decision).toMatchObject({ seat: 0, kind: 'mulligan', complete: true });
      expect(session.view.seats[0].hand).toHaveLength(5);
      const keep = session.decision!.options.find((option) => option.text === 'Keep this hand')!;
      const kept = await session.submit(keep.id);
      if (!kept.ok) throw new Error(kept.error.message);
      session = kept.session;

      expect(session.decision?.kind).toBe('priority');
      expect(session.transcript.map((frame) => frame.move)).toEqual([
        null,
        playFirst.id,
        mulligan.id,
        bottom.id,
        secondMulligan.id,
        bottomTwo.id,
        keep.id,
      ]);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'plays a human-versus-Forge-AI match to an authoritative terminal result',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(TABLE);
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(opened.error.message);
      expect(opened.session.backend).toBe('forge-2.0.14');

      let session: ObservedSession = opened.session;
      let sawLand = false;
      let sawStackOrLifeChange = false;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
        const decision = session.decision;
        expect(decision?.complete).toBe(true);
        const untappedMountains = session.view.seats[0].battlefield.filter(
          (card) => card.name === 'Mountain' && !card.tapped,
        ).length;
        const proactive =
          decision?.options.find((option) => option.text === 'Play Mountain') ??
          (decision?.kind === 'priority' && untappedMountains >= 2
            ? decision.options.find((option) => option.text.startsWith('Flame Rift:'))
            : undefined) ??
          (decision?.kind === 'mana-payment'
            ? decision.options.find((option) => option.id.startsWith('mana-source-'))
            : undefined);
        const pregame = decision?.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        );
        const move = proactive?.id ?? pregame?.id ?? decision?.options[0]?.id;
        expect(move).toBeDefined();
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        expect(advanced.ok).toBe(true);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        sawLand ||= session.view.seats.some((seat) =>
          seat.battlefield.some((card) => card.name === 'Mountain'),
        );
        sawStackOrLifeChange ||=
          session.view.stack.length > 0 || session.view.seats.some((seat) => seat.life < 20);
      }

      expect(sawLand).toBe(true);
      expect(sawStackOrLifeChange).toBe(true);
      expect(session.status).toBe('finished');
      expect(session.result).not.toBeNull();
      expect(session.events.length).toBeGreaterThan(0);
      expect(session.transcript).toHaveLength(session.submitted + 1);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'loads every reviewed official card and completes the observed match',
    async () => {
      expect(REVIEWED_OFFICIAL_NAMES).toHaveLength(600);
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      // Familiar decision vocabulary does not admit an unreviewed whole script.
      // Keep controls outside the audited roster as that roster expands.
      const uncovered: SessionSpec = {
        ...TABLE,
        seats: [
          {
            ...TABLE.seats[0],
            deck: { name: 'uncovered-two-piles', cards: [{ name: 'Sphinx of Uthuun', count: 60 }] },
          },
          TABLE.seats[1],
        ],
      };
      expect(await backend.supports(uncovered)).toEqual([
        'printed card "Sphinx of Uthuun" is outside the audited Forge decision-family slice',
      ]);
      await expect(backend.open(uncovered)).resolves.toMatchObject({
        ok: false,
        error: { kind: 'unsupported' },
      });
      for (const name of ["Ludevic's Test Subject", "Mirri's Guile", 'Sorin Markov']) {
        const hostile: SessionSpec = {
          ...TABLE,
          seats: [
            {
              ...TABLE.seats[0],
              deck: { name: `unsupported-${name}`, cards: [{ name, count: 60 }] },
            },
            TABLE.seats[1],
          ],
        };
        expect(await backend.supports(hostile)).toEqual([
          `printed card ${JSON.stringify(name)} is outside the audited Forge decision-family slice`,
        ]);
        await expect(backend.open(hostile)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unsupported' },
        });
      }
      expect(await backend.supports(REVIEWED_OFFICIAL_TABLE)).toEqual([]);
      const opened = await backend.open(REVIEWED_OFFICIAL_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 400; submitted += 1) {
        const decision = session.decision;
        expect(decision?.complete).toBe(true);
        const pregame = decision?.options.find(
          (option) => option.text === 'Play first' || option.text === 'Keep this hand',
        );
        const pass = decision?.options.find((option) => option.text === 'Pass priority');
        const move = pregame?.id ?? pass?.id ?? decision?.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(session.status).toBe('finished');
      expect(session.result).not.toBeNull();
      expect(session.transcript).toHaveLength(session.submitted + 1);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'owns exact discard costs and restores the game when that payment is canceled',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(DISCARD_COST_TABLE)).toEqual([]);
      const opened = await backend.open(DISCARD_COST_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let canceled = false;
      let rollbackObserved = false;
      let selectedOid: string | null = null;
      let resolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'cost-discard-selection') {
          const candidates = decision.options.filter((option) => option.targets[0]?.name !== undefined);
          expect(candidates.length).toBeGreaterThan(0);
          const handOids = new Set(session.view.seats[0].hand?.map((card) => card.oid));
          expect(candidates.every((option) => handOids.has(option.targets[0]!.oid))).toBe(true);
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-discard-cancel')?.id;
            canceled = true;
          } else {
            const selected = candidates.at(-1)!;
            selectedOid = selected.targets[0]!.oid;
            move = selected.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          if (canceled && selectedOid === null) {
            rollbackObserved =
              session.view.seats[0].graveyard.every((card) => card.name !== 'Thrill of Possibility') &&
              untappedSources(session, 'Mountain') >= 2;
          }
          resolved =
            selectedOid !== null &&
            session.view.stack.length === 0 &&
            session.view.seats[0].graveyard.some((card) => card.oid === selectedOid) &&
            session.view.seats[0].graveyard.filter((card) => card.name === 'Thrill of Possibility').length >=
              2;
          const cast =
            untappedSources(session, 'Mountain') >= 2 && !resolved
              ? decision.options.find((option) => option.text.startsWith('Thrill of Possibility:'))
              : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            cast?.id ??
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-50).join('\n')}`);
        session = advanced.session;
      }
      if (!resolved) throw new Error(`discard cost never resolved\n${trace.slice(-80).join('\n')}`);
      expect(canceled).toBe(true);
      expect(rollbackObserved).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'pays a fetchland source sacrifice and reads the fetched land and life loss from the board',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FETCHLAND_COST_TABLE)).toEqual([]);
      const opened = await backend.open(FETCHLAND_COST_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let activated = false;
      let choseIsland = false;
      let resolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'zone-card-selection') {
          const islands = decision.options.filter((option) => option.targets[0]?.name === 'Island');
          expect(islands.length).toBeGreaterThan(1);
          move = islands.at(-1)?.id;
          choseIsland = true;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          resolved =
            choseIsland &&
            session.view.stack.length === 0 &&
            session.view.seats[0].life === 19 &&
            session.view.seats[0].graveyard.some((card) => card.name === 'Polluted Delta') &&
            session.view.seats[0].battlefield.some((card) => card.name === 'Island');
          const activateId: string | undefined = !activated
            ? decision.options.find((option) => option.text.startsWith('Polluted Delta:'))?.id
            : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Polluted Delta')?.id ??
            activateId ??
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= activateId !== undefined;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-50).join('\n')}`);
        session = advanced.session;
      }
      if (!resolved) throw new Error(`fetchland cost never resolved\n${trace.slice(-80).join('\n')}`);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'discards the whole hand for Bomat Courier and restores every zone when canceled',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(WHOLE_HAND_DISCARD_COST_TABLE)).toEqual([]);
      const opened = await backend.open(WHOLE_HAND_DISCARD_COST_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let attacked = false;
      let canceled = false;
      let rollbackObserved = false;
      let handBeforePayment: readonly string[] = [];
      let accepted = false;
      let resolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'cost-discard-hand-confirm') {
          const [pay, decline] = decision.options;
          expect(pay?.targets[0]?.name).toBe('Bomat Courier');
          expect(
            pay?.targets.slice(1).every((target) => target.name === '' && target.object === undefined),
          ).toBe(true);
          expect(pay?.targets.map((target) => target.oid)).toEqual(
            decline?.targets.map((target) => target.oid),
          );
          expect(pay?.targets.length).toBeGreaterThan(1);
          handBeforePayment = session.view.seats[0].hand?.map((card) => card.oid) ?? [];
          expect(handBeforePayment.length).toBeGreaterThan(0);
          if (!canceled) {
            move = decision.options.find((option) => option.text === 'Cancel cost payment')?.id;
            canceled = true;
          } else {
            move = decision.options.find((option) => option.text === 'Discard your hand')?.id;
            accepted = true;
          }
        } else if (decision.kind === 'combat-attackers') {
          const bomat = decision.options.find((option) => option.text.includes('with Bomat Courier'));
          move =
            (!attacked ? bomat?.id : undefined) ??
            decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          attacked ||= bomat !== undefined && move === bomat.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          if (canceled && !accepted) {
            rollbackObserved =
              local.battlefield.some((card) => card.name === 'Bomat Courier') &&
              local.exile.length > 0 &&
              untappedSources(session, 'Mountain') >= 1;
          }
          const discarded = new Set(local.graveyard.map((card) => card.oid));
          resolved =
            accepted &&
            session.view.stack.length === 0 &&
            local.battlefield.every((card) => card.name !== 'Bomat Courier') &&
            local.graveyard.some((card) => card.name === 'Bomat Courier') &&
            handBeforePayment.every((oid) => discarded.has(oid)) &&
            local.exile.length === 0 &&
            local.handSize > 0;
          const bomatInPlay = local.battlefield.some((card) => card.name === 'Bomat Courier');
          const activate =
            attacked && bomatInPlay && untappedSources(session, 'Mountain') >= 1 && !resolved
              ? decision.options.find((option) => option.text.includes('Discard your hand'))
              : undefined;
          if (activate !== undefined) {
            expect(activate.targets[0]?.name).toBe('Bomat Courier');
            expect(activate.targets[0]?.object?.controller).toBe(0);
            expect(
              activate.targets.slice(1).every((target) => target.name === '' && target.object === undefined),
            ).toBe(true);
            expect(activate.targets.length).toBeGreaterThan(1);
          }
          const cast = decision.options.find((option) =>
            option.text.startsWith('Bomat Courier: Bomat Courier -'),
          );
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (!bomatInPlay ? cast?.id : undefined) ??
            activate?.id ??
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-60).join('\n')}`);
        session = advanced.session;
      }
      if (!resolved) {
        throw new Error(
          `whole-hand cost never resolved ${JSON.stringify({
            attacked,
            canceled,
            rollbackObserved,
            accepted,
            handBeforePayment,
            local: session.view.seats[0],
          })}\n${trace.slice(-100).join('\n')}`,
        );
      }
      expect(attacked).toBe(true);
      expect(canceled).toBe(true);
      expect(rollbackObserved).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'sacrifices the exact selected other creature to Fiend Artisan and restores cancellation',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FIEND_ARTISAN_SACRIFICE_COST_TABLE)).toEqual([]);
      const opened = await backend.open(FIEND_ARTISAN_SACRIFICE_COST_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let canceled = false;
      let rollbackObserved = false;
      let sacrificedOid: string | null = null;
      let retainedOid: string | null = null;
      let fetchedOid: string | null = null;
      let resolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'number') {
          move = decision.options.find((option) => option.id === 'number-1')?.id;
        } else if (decision.kind === 'cost-sacrifice-selection') {
          const creatures = decision.options.filter(
            (option) => option.id.startsWith('cost-sacrifice-') && option.id !== 'cost-sacrifice-cancel',
          );
          expect(creatures.length).toBeGreaterThanOrEqual(2);
          expect(creatures.every((option) => option.targets[0]?.name !== 'Fiend Artisan')).toBe(true);
          if (!canceled) {
            move = decision.options.find((option) => option.id === 'cost-sacrifice-cancel')?.id;
            canceled = true;
          } else {
            const selected = creatures.at(-1);
            const retained = creatures.find((option) => option.id !== selected?.id);
            sacrificedOid = selected?.targets[0]?.oid ?? null;
            retainedOid = retained?.targets[0]?.oid ?? null;
            move = selected?.id;
          }
        } else if (decision.kind === 'zone-card-selection') {
          const creature = decision.options.find(
            (option) =>
              option.targets[0]?.name === 'Elvish Mystic' || option.targets[0]?.name === 'Llanowar Elves',
          );
          fetchedOid = creature?.targets[0]?.oid ?? null;
          move = creature?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          const fiend = local.battlefield.find((card) => card.name === 'Fiend Artisan');
          const otherCreatures = local.battlefield.filter(
            (card) => card.name === 'Elvish Mystic' || card.name === 'Llanowar Elves',
          );
          const availableMana = untappedSources(session, 'Bayou');
          const activate = decision.options.find(
            (option) =>
              option.text.startsWith('Fiend Artisan:') && option.text.includes('Search your library'),
          );
          if (canceled && sacrificedOid === null && activate !== undefined && fiend?.tapped === false) {
            rollbackObserved = true;
          }
          resolved =
            sacrificedOid !== null &&
            retainedOid !== null &&
            fetchedOid !== null &&
            session.view.stack.length === 0 &&
            local.graveyard.some((card) => card.oid === sacrificedOid) &&
            local.battlefield.some((card) => card.oid === retainedOid) &&
            local.battlefield.some((card) => card.oid === fetchedOid) &&
            local.battlefield.some((card) => card.name === 'Fiend Artisan');
          const castFiend = decision.options.find((option) =>
            option.text.startsWith('Fiend Artisan: Fiend Artisan -'),
          );
          const castOther = decision.options.find(
            (option) =>
              option.text.startsWith('Elvish Mystic: Elvish Mystic -') ||
              option.text.startsWith('Llanowar Elves: Llanowar Elves -'),
          );
          move =
            decision.options.find((option) => option.text === 'Play Bayou')?.id ??
            (fiend === undefined && availableMana >= 2 ? castFiend?.id : undefined) ??
            (otherCreatures.length < 2 && availableMana >= 1 ? castOther?.id : undefined) ??
            (availableMana >= 2 ? activate?.id : undefined) ??
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      if (!resolved) {
        throw new Error(
          `Fiend Artisan cost never resolved ${JSON.stringify({
            canceled,
            rollbackObserved,
            sacrificedOid,
            retainedOid,
            fetchedOid,
            local: session.view.seats[0],
          })}\n${trace.slice(-140).join('\n')}`,
        );
      }
      expect(canceled).toBe(true);
      expect(rollbackObserved).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'makes the local seat choose exact mana-source identity and produced color',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(MANA_PAYMENT_TABLE)).toEqual([]);
      const opened = await backend.open(MANA_PAYMENT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let firstSourceOid: string | null = null;
      let secondSourceOid: string | null = null;
      let choseGreen = false;
      let choseRed = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        expect(decision.complete).toBe(true);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          const sources = decision.options.filter((option) => option.targets[0]?.name === 'Copperline Gorge');
          expect(sources.every((option) => option.targets.length === 1)).toBe(true);
          if (!choseGreen) {
            expect(sources.length).toBeGreaterThanOrEqual(4);
            expect(new Set(sources.map((option) => option.targets[0]!.oid)).size).toBeGreaterThanOrEqual(2);
            await expect(session.submit('mana-source-forge-card-invented-R')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            const green = sources.find((option) => option.text.includes('{G}'));
            expect(green).toBeDefined();
            firstSourceOid = green!.targets[0]!.oid;
            choseGreen = true;
            move = green!.id;
            staleSnapshot = session;
            staleMove = move;
          } else {
            expect(sources.length).toBeGreaterThanOrEqual(1);
            expect(sources.every((option) => option.targets[0]!.oid !== firstSourceOid)).toBe(true);
            expect(sources.every((option) => option.text.includes('{R}'))).toBe(true);
            const red = sources.find(
              (option) => option.text.includes('{R}') && option.targets[0]!.oid !== firstSourceOid,
            );
            expect(red).toBeDefined();
            secondSourceOid = red!.targets[0]!.oid;
            choseRed = true;
            move = red!.id;
          }
        } else if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter(
            (card) => card.name === 'Copperline Gorge',
          ).length;
          move =
            decision.options.find((option) => option.text === 'Play Copperline Gorge')?.id ??
            (lands >= 2 && !choseGreen
              ? (() => {
                  expect(
                    session.view.seats[0].battlefield
                      .filter((card) => card.name === 'Copperline Gorge')
                      .every((card) => !card.tapped),
                  ).toBe(true);
                  return decision.options.find((option) => option.text.startsWith('Flame Rift:'))?.id;
                })()
              : undefined) ??
            (choseRed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null && session.decision?.kind === 'mana-payment') {
          expect(await staleSnapshot.submit(staleMove)).toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      expect(choseGreen).toBe(true);
      expect(choseRed).toBe(true);
      expect(firstSourceOid).not.toBe(secondSourceOid);
      expect(
        session.view.seats[0].battlefield
          .filter((card) => card.oid === firstSourceOid || card.oid === secondSourceOid)
          .every((card) => card.tapped),
      ).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'owns Chart a Course exact discard identity and omits that choice after an attack',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(CHART_A_COURSE_NO_ATTACK_TABLE)).toEqual([]);
      expect(await backend.supports(CHART_A_COURSE_ATTACK_TABLE)).toEqual([]);

      const noAttackOpened = await backend.open(CHART_A_COURSE_NO_ATTACK_TABLE);
      if (!noAttackOpened.ok) throw new Error(noAttackOpened.error.message);
      let noAttack: ObservedSession = noAttackOpened.session;
      let selectedDiscardOid: string | null = null;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      let noAttackResolved = false;
      const noAttackTrace: string[] = [];
      for (let submitted = 0; noAttack.status === 'awaiting' && submitted < 350; submitted += 1) {
        const decision = noAttack.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        noAttackTrace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'hand-card-selection') {
          expect(noAttack.view.seats[1].hand).toBeNull();
          const localHand = noAttack.view.seats[0].hand;
          expect(localHand).not.toBeNull();
          const handOids = new Set(localHand?.map((card) => card.oid));
          const islands = decision.options.filter((option) => option.targets[0]?.name === 'Island');
          expect(islands.length).toBeGreaterThanOrEqual(2);
          expect(new Set(islands.map((option) => option.id)).size).toBe(islands.length);
          expect(new Set(islands.map((option) => option.targets[0]!.oid)).size).toBe(islands.length);
          expect(decision.options.every((option) => handOids.has(option.targets[0]?.oid ?? ''))).toBe(true);
          await expect(noAttack.submit('discard-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const battlefieldIsland = noAttack.view.seats[0].battlefield.find((card) => card.name === 'Island');
          expect(battlefieldIsland).toBeDefined();
          await expect(
            noAttack.submit(`discard-card-${battlefieldIsland!.oid.replace('forge-card-', '')}`),
          ).resolves.toMatchObject({ ok: false, error: { kind: 'unknown-move' } });
          const selected = islands.at(-1)!;
          selectedDiscardOid = selected.targets[0]!.oid;
          staleSnapshot = noAttack;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          noAttackResolved =
            selectedDiscardOid !== null &&
            noAttack.view.seats[0].graveyard.some((card) => card.oid === selectedDiscardOid) &&
            noAttack.view.seats[0].graveyard.some((card) => card.name === 'Chart a Course');
          const lands = untappedSources(noAttack, 'Island');
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (lands >= 2 && selectedDiscardOid === null
              ? decision.options.find((option) => option.text.startsWith('Chart a Course:'))?.id
              : undefined) ??
            (noAttackResolved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await noAttack.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${noAttackTrace.join('\n')}`);
        noAttack = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }
      expect(selectedDiscardOid, noAttackTrace.join('\n')).toMatch(/^forge-card-/u);
      expect(noAttackResolved, noAttackTrace.join('\n')).toBe(true);
      expect(noAttack.status).toBe('finished');
      await noAttack.close();

      const attackOpened = await backend.open(CHART_A_COURSE_ATTACK_TABLE);
      if (!attackOpened.ok) throw new Error(attackOpened.error.message);
      let attacked: ObservedSession = attackOpened.session;
      let attackerAdded = false;
      let attackedThisTurn = false;
      let libraryBeforeChart: number | null = null;
      let sawDiscardAfterAttack = false;
      let attackedBranchResolved = false;
      const attackTrace: string[] = [];
      for (let submitted = 0; attacked.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = attacked.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        attackTrace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'hand-card-selection') {
          sawDiscardAfterAttack = true;
          move = decision.options[0]?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const pteramander = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') && option.targets[0]?.name === 'Pteramander',
          );
          if (!attackedThisTurn && !attackerAdded && pteramander !== undefined) {
            attackerAdded = true;
            move = pteramander.id;
          } else {
            if (attackerAdded) attackedThisTurn = true;
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          attackedBranchResolved =
            libraryBeforeChart !== null &&
            attacked.view.seats[0].librarySize === libraryBeforeChart - 2 &&
            attacked.view.seats[0].graveyard.some((card) => card.name === 'Chart a Course') &&
            !attacked.view.stack.some((card) => card.name === 'Chart a Course');
          const battlefield = attacked.view.seats[0].battlefield;
          const lands = untappedSources(attacked, 'Island');
          const hasPteramander = battlefield.some((card) => card.name === 'Pteramander');
          const chart = decision.options.find((option) => option.text.startsWith('Chart a Course:'));
          if (attackedThisTurn && lands >= 2 && libraryBeforeChart === null && chart !== undefined) {
            libraryBeforeChart = attacked.view.seats[0].librarySize;
          }
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (!hasPteramander && lands >= 1
              ? decision.options.find((option) => option.text.startsWith('Pteramander:'))?.id
              : undefined) ??
            (attackedThisTurn && lands >= 2 && libraryBeforeChart !== null && !attackedBranchResolved
              ? chart?.id
              : undefined) ??
            (attackedBranchResolved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await attacked.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${attackTrace.join('\n')}`);
        attacked = advanced.session;
      }
      expect(attackedThisTurn, attackTrace.join('\n')).toBe(true);
      expect(libraryBeforeChart, attackTrace.join('\n')).not.toBeNull();
      expect(sawDiscardAfterAttack, attackTrace.join('\n')).toBe(false);
      expect(attackedBranchResolved, attackTrace.join('\n')).toBe(true);
      expect(attacked.status).toBe('finished');
      await attacked.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'owns Rotting Regisaur recurring upkeep discard as an exact current-hand choice',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ROTTING_REGISAUR_DISCARD_TABLE)).toEqual([]);

      const opened = await backend.open(ROTTING_REGISAUR_DISCARD_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session = opened.session;
      let selectedDiscardOid: string | null = null;
      let handSizeBeforeDiscard: number | null = null;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      let resolved = false;
      const trace: string[] = [];

      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'hand-card-selection') {
          expect(session.view.seats[0].battlefield.some((card) => card.name === 'Rotting Regisaur')).toBe(
            true,
          );
          const hand = session.view.seats[0].hand;
          expect(hand).not.toBeNull();
          const handOids = new Set(hand?.map((card) => card.oid));
          expect(decision.options).toHaveLength(hand?.length ?? 0);
          expect(decision.options.every((option) => handOids.has(option.targets[0]?.oid ?? ''))).toBe(true);
          await expect(session.submit('discard-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const battlefieldSwamp = session.view.seats[0].battlefield.find((card) => card.name === 'Swamp');
          expect(battlefieldSwamp).toBeDefined();
          await expect(
            session.submit(`discard-card-${battlefieldSwamp!.oid.replace('forge-card-', '')}`),
          ).resolves.toMatchObject({ ok: false, error: { kind: 'unknown-move' } });
          const selected = decision.options.at(-1);
          if (selected === undefined) throw new Error('Forge offered no discard card');
          selectedDiscardOid = selected.targets[0]?.oid ?? null;
          handSizeBeforeDiscard = hand?.length ?? null;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const hand = session.view.seats[0].hand;
          resolved =
            selectedDiscardOid !== null &&
            handSizeBeforeDiscard !== null &&
            hand?.length === handSizeBeforeDiscard - 1 &&
            session.view.seats[0].graveyard.filter((card) => card.oid === selectedDiscardOid).length === 1;
          const lands = untappedSources(session, 'Swamp');
          move =
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (lands >= 3 && !session.view.seats[0].battlefield.some((card) => card.name === 'Rotting Regisaur')
              ? decision.options.find((option) => option.text.startsWith('Rotting Regisaur:'))?.id
              : undefined) ??
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      expect(selectedDiscardOid, trace.join('\n')).toMatch(/^forge-card-/u);
      expect(resolved, trace.join('\n')).toBe(true);
      expect(session.status).toBe('finished');
    },
    180_000,
  );

  forgeIt(
    'creates Vraska Treasure and spends that exact generated source for red mana',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(VRASKA_GENERATED_TOKEN_TABLE)).toEqual([]);
      const opened = await backend.open(VRASKA_GENERATED_TOKEN_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let madePirate = false;
      let choseDestroy = false;
      let destroyedPirateOid: string | null = null;
      let treasureOid: string | null = null;
      let spentTreasureForRed = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const pirate = decision.options.find((option) => option.targets[0]?.name.includes('Pirate'));
          if (choseDestroy && pirate !== undefined) {
            destroyedPirateOid = pirate.targets[0]!.oid;
            move = pirate.id;
          }
        } else if (decision.kind === 'mana-payment') {
          const redTreasure = decision.options.find(
            (option) => option.targets[0]?.name.includes('Treasure') === true && option.text.includes('{R}'),
          );
          if (redTreasure !== undefined) {
            expect(treasureOid).toMatch(/^forge-card-/u);
            expect(redTreasure.targets[0]!.oid).toBe(treasureOid);
            spentTreasureForRed = true;
            move = redTreasure.id;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const lands = battlefield.filter((card) => card.name === 'Bayou').length;
          const hasVraska = battlefield.some((card) => card.name === 'Vraska, Relic Seeker');
          const hasTreasure = battlefield.some((card) => card.name.includes('Treasure'));
          const createPirate = decision.options.find(
            (option) =>
              option.text.startsWith('Vraska, Relic Seeker:') &&
              option.text.includes('Create a 2/2 black Pirate'),
          );
          const destroy = decision.options.find(
            (option) =>
              option.text.startsWith('Vraska, Relic Seeker:') &&
              option.text.includes('Destroy target artifact, creature, or enchantment'),
          );
          if (hasTreasure) {
            treasureOid ??= battlefield.find((card) => card.name.includes('Treasure'))?.oid ?? null;
          }
          move =
            decision.options.find((option) => option.text === 'Play Bayou')?.id ??
            (!hasVraska && lands >= 6
              ? decision.options.find((option) => option.text.startsWith('Vraska, Relic Seeker:'))?.id
              : undefined) ??
            (hasVraska && !madePirate && createPirate !== undefined
              ? (() => {
                  madePirate = true;
                  return createPirate.id;
                })()
              : undefined) ??
            (madePirate && !choseDestroy && destroy !== undefined
              ? (() => {
                  choseDestroy = true;
                  return destroy.id;
                })()
              : undefined) ??
            (treasureOid !== null && !spentTreasureForRed
              ? decision.options.find((option) => option.text.startsWith('Flame Rift:'))?.id
              : undefined) ??
            (spentTreasureForRed
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      const evidence = trace.join('\n');
      expect(
        { madePirate, choseDestroy, destroyedPirateOid, treasureOid, spentTreasureForRed },
        evidence,
      ).toMatchObject({
        madePirate: true,
        choseDestroy: true,
        destroyedPirateOid: expect.stringMatching(/^forge-card-/u),
        treasureOid: expect.stringMatching(/^forge-card-/u),
        spentTreasureForRed: true,
      });
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'proves the Elder Gargaroth generated-object board outcome in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ELDER_GARGAROTH_GENERATED_OBJECT_TABLE)).toEqual([]);
      const opened = await backend.open(ELDER_GARGAROTH_GENERATED_OBJECT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let attacked = false;
      let choseBeast = false;
      let beast: (typeof session.view.seats)[number]['battlefield'][number] | undefined;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        beast = session.view.seats[0].battlefield.find(
          (card) => card.name.includes('Beast') && card.name !== 'Elder Gargaroth',
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mode-selection') {
          const choice = decision.options.find((option) => option.text.includes('Create a 3/3 green Beast'));
          if (choice !== undefined) {
            choseBeast = true;
            move = choice.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          const addId: string | undefined = !attacked
            ? decision.options.find(
                (option) =>
                  option.id.startsWith('combat-attack-add-') && option.targets[0]?.name === 'Elder Gargaroth',
              )?.id
            : undefined;
          move = addId ?? decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          attacked ||= addId !== undefined;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const forests = session.view.seats[0].battlefield.filter((card) => card.name === 'Forest').length;
          const hasGargaroth = session.view.seats[0].battlefield.some(
            (card) => card.name === 'Elder Gargaroth',
          );
          move =
            (beast !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (!hasGargaroth && forests >= 5
              ? decision.options.find((option) => option.text.startsWith('Elder Gargaroth:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-100).join('\n');
      expect({ attacked, choseBeast }, evidence).toEqual({ attacked: true, choseBeast: true });
      expect(beast, evidence).toMatchObject({ power: 3, toughness: 3 });
      expect(beast?.typeLine, evidence).toContain('Creature');
    },
    180_000,
  );

  forgeIt(
    'proves the Karn generated-object board outcome in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(KARN_GENERATED_OBJECT_TABLE)).toEqual([]);
      const opened = await backend.open(KARN_GENERATED_OBJECT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let activated = false;
      let construct: (typeof session.view.seats)[number]['battlefield'][number] | undefined;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        construct = session.view.seats[0].battlefield.find((card) => card.name.includes('Construct'));
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter((card) => card.name === 'Plains').length;
          const hasKarn = session.view.seats[0].battlefield.some(
            (card) => card.name === 'Karn, Scion of Urza',
          );
          const create = decision.options.find(
            (option) =>
              option.text.startsWith('Karn, Scion of Urza:') && option.text.includes('Create a 0/0'),
          );
          move =
            (construct !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!hasKarn && lands >= 4
              ? decision.options.find((option) => option.text.startsWith('Karn, Scion of Urza:'))?.id
              : undefined) ??
            (hasKarn && !activated && create !== undefined ? create.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= hasKarn && create !== undefined && move === create.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-100).join('\n');
      expect(activated, evidence).toBe(true);
      expect(construct, evidence).toMatchObject({ power: 1, toughness: 1 });
      expect(construct?.typeLine, evidence).toContain('Artifact Creature');
    },
    180_000,
  );

  forgeIt(
    'proves the Hangarback generated-object board outcome in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(HANGARBACK_GENERATED_OBJECT_TABLE)).toEqual([]);
      const opened = await backend.open(HANGARBACK_GENERATED_OBJECT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let announcedOne = false;
      let castDamnation = false;
      let thopters: readonly (typeof session.view.seats)[number]['battlefield'][number][] = [];
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        thopters = session.view.seats[0].battlefield.filter((card) => card.name.includes('Thopter'));
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'number' && decision.prompt.startsWith('Hangarback Walker')) {
          move = decision.options.find((option) => option.id === 'number-1')?.id;
          announcedOne = move !== undefined;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter((card) => card.name === 'Swamp').length;
          const walker = session.view.seats[0].battlefield.find((card) => card.name === 'Hangarback Walker');
          const castWalker = decision.options.find((option) => option.text.startsWith('Hangarback Walker:'));
          const damnation = decision.options.find((option) => option.text.startsWith('Damnation:'));
          move =
            (thopters.length > 0
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (walker === undefined && lands >= 2 ? castWalker?.id : undefined) ??
            (walker !== undefined && lands >= 4 ? damnation?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castDamnation ||= walker !== undefined && damnation !== undefined && move === damnation.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-100).join('\n');
      expect({ announcedOne, castDamnation }, evidence).toEqual({ announcedOne: true, castDamnation: true });
      expect(thopters, evidence).toHaveLength(1);
      expect(thopters[0], evidence).toMatchObject({ power: 1, toughness: 1 });
      expect(thopters[0]?.typeLine, evidence).toContain('Artifact Creature');
    },
    180_000,
  );

  forgeIt(
    "proves the Urza's Saga generated-object board outcome in installed Forge",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(URZAS_SAGA_GENERATED_OBJECT_TABLE)).toEqual([]);
      const opened = await backend.open(URZAS_SAGA_GENERATED_OBJECT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let activated = false;
      let construct: (typeof session.view.seats)[number]['battlefield'][number] | undefined;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        construct = session.view.seats[0].battlefield.find((card) => card.name.includes('Construct'));
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'zone-card-selection') {
          move =
            decision.options.find((option) => option.targets[0]?.name === 'Bomat Courier')?.id ??
            decision.options.find((option) => option.id.endsWith('-done'))?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const plains = battlefield.filter((card) => card.name === 'Plains').length;
          const saga = battlefield.find((card) => card.name === "Urza's Saga");
          const create = decision.options.find(
            (option) => option.text.startsWith("Urza's Saga:") && option.text.includes('Create a 0/0'),
          );
          move =
            (construct !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (plains < 2 ? decision.options.find((option) => option.text === 'Play Plains')?.id : undefined) ??
            (plains >= 2 && saga === undefined
              ? decision.options.find((option) => option.text === "Play Urza's Saga")?.id
              : undefined) ??
            (!activated ? create?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= create !== undefined && move === create.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-100).join('\n');
      expect(activated, evidence).toBe(true);
      expect(construct, evidence).toMatchObject({ power: expect.any(Number), toughness: expect.any(Number) });
      expect(construct?.power, evidence).toBeGreaterThanOrEqual(1);
      expect(construct?.power, evidence).toBe(construct?.toughness);
      expect(construct?.typeLine, evidence).toContain('Artifact Creature');
    },
    180_000,
  );

  forgeIt(
    'proves Elite Spellbinder exiles the exact optional hidden-hand card selected',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ELITE_SPELLBINDER_TRIGGER_COMPOSITION_TABLE)).toEqual([]);
      const opened = await backend.open(ELITE_SPELLBINDER_TRIGGER_COMPOSITION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        const exiled =
          selectedOid !== null && session.view.seats[1].exile.some((card) => card.oid === selectedOid);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'card-selection') {
          const rift = decision.options.find((option) => option.targets[0]?.name === 'Flame Rift');
          expect(rift).toBeDefined();
          selectedOid = rift!.targets[0]!.oid;
          move = rift!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          move =
            (exiled ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (untappedSources(session, 'Plains') >= 3
              ? decision.options.find((option) => option.text.startsWith('Elite Spellbinder:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-120).join('\n');
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[1].exile.map((card) => card.oid),
        evidence,
      ).toContain(selectedOid);
    },
    240_000,
  );

  forgeIt(
    'proves Kitesail Freebooter exiles the exact mandatory hidden-hand card selected',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(KITESAIL_FREEBOOTER_TRIGGER_COMPOSITION_TABLE)).toEqual([]);
      const opened = await backend.open(KITESAIL_FREEBOOTER_TRIGGER_COMPOSITION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        const exiled =
          selectedOid !== null && session.view.seats[1].exile.some((card) => card.oid === selectedOid);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'zone-card-selection') {
          const rift = decision.options.find((option) => option.targets[0]?.name === 'Flame Rift');
          expect(rift).toBeDefined();
          selectedOid = rift!.targets[0]!.oid;
          move = rift!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          move =
            (exiled ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (untappedSources(session, 'Swamp') >= 2
              ? decision.options.find((option) => option.text.startsWith('Kitesail Freebooter:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-120).join('\n');
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[1].exile.map((card) => card.oid),
        evidence,
      ).toContain(selectedOid);
    },
    240_000,
  );

  forgeIt(
    'proves Outpost Siege damages the selected player when the controlled creature leaves',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(OUTPOST_SIEGE_TRIGGER_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(OUTPOST_SIEGE_TRIGGER_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let choseDragons = false;
      let targetedSpirit = false;
      let targetedOpponent = false;
      let spiritOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const outcome: boolean =
          targetedOpponent &&
          targetedSpirit &&
          opponent.life === 19 &&
          local.graveyard.some((card) => card.name === 'Selfless Spirit');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'ability-selection') {
          const dragons = decision.options.find((option) => option.text.includes('Dragons'));
          expect(dragons).toBeDefined();
          move = dragons!.id;
          choseDragons = true;
        } else if (decision.kind === 'target-selection') {
          const spiritTarget = decision.options.find((option) => option.targets[0]?.oid === spiritOid);
          if (spiritTarget !== undefined) {
            move = spiritTarget.id;
            targetedSpirit = true;
          } else {
            const opponentTarget = decision.options.find((option) => option.id === 'target-player-1');
            expect(opponentTarget).toBeDefined();
            move = opponentTarget!.id;
            targetedOpponent = true;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const spirit = local.battlefield.find((card) => card.name === 'Selfless Spirit');
          spiritOid ??= spirit?.oid ?? null;
          const outpost = local.battlefield.find((card) => card.name === 'Outpost Siege');
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plateau')?.id ??
            (spirit === undefined && untappedSources(session, 'Plateau') >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Selfless Spirit:') &&
                    !option.text.includes('gain indestructible until end of turn'),
                )?.id
              : undefined) ??
            (outpost === undefined && spirit !== undefined && untappedSources(session, 'Plateau') >= 4
              ? decision.options.find((option) => option.text.startsWith('Outpost Siege:'))?.id
              : undefined) ??
            (outpost !== undefined && spirit !== undefined && untappedSources(session, 'Plateau') >= 1
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Outpost Siege move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-160).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(choseDragons, evidence).toBe(true);
      expect(targetedSpirit, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === spiritOid),
        evidence,
      ).toBe(true);
      expect(session.view.seats[1].life, evidence).toBe(19);
    },
    240_000,
  );

  forgeIt(
    'proves Klothys exiles the selected nonland card and applies both life outcomes',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(KLOTHYS_TRIGGER_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(KLOTHYS_TRIGGER_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let castRift = false;
      let castKlothys = false;
      let selectedOid: string | null = null;
      let lifeBefore: readonly [number, number] | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const outcome: boolean =
          selectedOid !== null &&
          local.exile.some((card) => card.oid === selectedOid) &&
          lifeBefore !== null &&
          local.life === lifeBefore[0] + 2 &&
          opponent.life === lifeBefore[1] - 2;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const rift = decision.options.find(
            (option) =>
              option.targets[0]?.name === 'Flame Rift' &&
              local.graveyard.some((card) => card.oid === option.targets[0]?.oid),
          );
          expect(rift).toBeDefined();
          selectedOid = rift!.targets[0]!.oid;
          lifeBefore = [local.life, opponent.life];
          move = rift!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const rift = decision.options.find((option) => option.text.startsWith('Flame Rift:'));
          const klothys = decision.options.find((option) =>
            option.text.startsWith('Klothys, God of Destiny:'),
          );
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Taiga')?.id ??
            (!castRift && untappedSources(session, 'Taiga') >= 2 ? rift?.id : undefined) ??
            (castRift && !castKlothys && untappedSources(session, 'Taiga') >= 3 ? klothys?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castRift ||= move === rift?.id;
          castKlothys ||= move === klothys?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Klothys move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-140).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect({ castRift, castKlothys }, evidence).toEqual({ castRift: true, castKlothys: true });
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].exile.some((card) => card.oid === selectedOid),
        evidence,
      ).toBe(true);
      expect(lifeBefore, evidence).not.toBeNull();
      expect(session.view.seats[0].life, evidence).toBe(lifeBefore![0] + 2);
      expect(session.view.seats[1].life, evidence).toBe(lifeBefore![1] - 2);
    },
    240_000,
  );

  forgeIt(
    'proves Tidehollow Sculler returns the exact hidden-hand object after leaving',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TIDEHOLLOW_SCULLER_TRIGGER_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(TIDEHOLLOW_SCULLER_TRIGGER_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let scullerOid: string | null = null;
      let selectedOid: string | null = null;
      let targetedSculler = false;
      let castSecondSculler = false;
      let selectedReturnedObject = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        scullerOid ??= local.battlefield.find((card) => card.name === 'Tidehollow Sculler')?.oid ?? null;
        const firstScullerLeft =
          scullerOid !== null &&
          targetedSculler &&
          local.graveyard.some((card) => card.oid === scullerOid) &&
          selectedOid !== null &&
          !opponent.exile.some((card) => card.oid === selectedOid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          if (selectedOid === null) {
            move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          } else if (!targetedSculler) {
            const sculler = decision.options.find((option) => option.targets[0]?.oid === scullerOid);
            expect(sculler).toBeDefined();
            move = sculler!.id;
            targetedSculler = true;
          } else {
            move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          }
        } else if (decision.kind === 'zone-card-selection') {
          if (selectedOid === null) {
            const rift = decision.options.find((option) => option.targets[0]?.name === 'Flame Rift');
            expect(rift).toBeDefined();
            selectedOid = rift!.targets[0]!.oid;
            move = rift!.id;
          } else {
            const returnedObject = decision.options.find((option) => option.targets[0]?.oid === selectedOid);
            expect(returnedObject).toBeDefined();
            selectedReturnedObject = true;
            move = returnedObject!.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const exiled = selectedOid !== null && opponent.exile.some((card) => card.oid === selectedOid);
          const outcome =
            castSecondSculler &&
            selectedReturnedObject &&
            selectedOid !== null &&
            opponent.exile.some((card) => card.oid === selectedOid);
          const secondSculler = decision.options.find((option) =>
            option.text.startsWith('Tidehollow Sculler:'),
          );
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Scrubland')?.id ??
            (scullerOid === null && untappedSources(session, 'Scrubland') >= 2
              ? secondSculler?.id
              : undefined) ??
            (exiled && !targetedSculler && untappedSources(session, 'Scrubland') >= 3
              ? decision.options.find((option) => option.text.startsWith('Vindicate:'))?.id
              : undefined) ??
            (firstScullerLeft && !castSecondSculler && untappedSources(session, 'Scrubland') >= 2
              ? secondSculler?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (firstScullerLeft && secondSculler !== undefined && move === secondSculler.id) {
            castSecondSculler = true;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Tidehollow Sculler move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-160).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(scullerOid, evidence).toMatch(/^forge-card-/u);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(targetedSculler, evidence).toBe(true);
      expect(castSecondSculler, evidence).toBe(true);
      expect(selectedReturnedObject, evidence).toBe(true);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === scullerOid),
        evidence,
      ).toBe(true);
      expect(
        session.view.seats[1].exile.some((card) => card.oid === selectedOid),
        evidence,
      ).toBe(true);
    },
    300_000,
  );

  forgeIt(
    'proves Showdown of the Skalds puts a counter on the selected creature after a cast',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(SHOWDOWN_TRIGGER_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(SHOWDOWN_TRIGGER_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let swiftspearOid: string | null = null;
      let showdownOid: string | null = null;
      let castAfterChapter = false;
      let targetedSwiftspear = false;
      const trace: string[] = [];
      const plusOneCounters = (card: (typeof session.view.seats)[number]['battlefield'][number]): number =>
        Object.entries(card.counters)
          .filter(([kind]) => kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1'))
          .reduce((sum, [, count]) => sum + count, 0);
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_100; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const swiftspear = local.battlefield.find((card) => card.name === 'Monastery Swiftspear');
        const showdown = local.battlefield.find((card) => card.name === 'Showdown of the Skalds');
        swiftspearOid ??= swiftspear?.oid ?? null;
        showdownOid ??= showdown?.oid ?? null;
        const chapter = showdown === undefined ? 0 : Math.max(0, ...Object.values(showdown.counters));
        const outcome: boolean = swiftspear !== undefined && plusOneCounters(swiftspear) === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const exact = decision.options.find((option) => option.targets[0]?.oid === swiftspearOid);
          expect(exact).toBeDefined();
          move = exact!.id;
          targetedSwiftspear = true;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castRift = decision.options.find((option) => option.text.startsWith('Flame Rift:'));
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plateau')?.id ??
            (swiftspearOid === null && untappedSources(session, 'Plateau') >= 1
              ? decision.options.find((option) => option.text.startsWith('Monastery Swiftspear:'))?.id
              : undefined) ??
            (showdownOid === null && swiftspearOid !== null && untappedSources(session, 'Plateau') >= 4
              ? decision.options.find((option) => option.text.startsWith('Showdown of the Skalds:'))?.id
              : undefined) ??
            (showdownOid !== null && chapter >= 2 && !castAfterChapter ? castRift?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castAfterChapter ||= chapter >= 2 && move === castRift?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Showdown move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const swiftspear = session.view.seats[0].battlefield.find((card) => card.oid === swiftspearOid);
      expect(showdownOid, evidence).toMatch(/^forge-card-/u);
      expect(castAfterChapter, evidence).toBe(true);
      expect(targetedSwiftspear, evidence).toBe(true);
      expect(swiftspear, evidence).toBeDefined();
      expect(plusOneCounters(swiftspear!), evidence).toBe(1);
    },
    300_000,
  );

  forgeIt(
    'proves Elspeth Conquers Death returns the selected creature with the chosen counter type',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ELSPETH_CONQUERS_DEATH_COUNTER_TYPE_TABLE)).toEqual([]);
      const opened = await backend.open(ELSPETH_CONQUERS_DEATH_COUNTER_TYPE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let spiritOid: string | null = null;
      let wornOid: string | null = null;
      let castElspeth = false;
      let targetedSpiritWithBolt = false;
      let targetedWorn = false;
      let targetedSpirit = false;
      let chosePlusOne = false;
      const trace: string[] = [];
      const plusOneCounters = (card: (typeof session.view.seats)[number]['battlefield'][number]): number =>
        Object.entries(card.counters)
          .filter(([kind]) => kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1'))
          .reduce((sum, [, count]) => sum + count, 0);
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_300; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        spiritOid ??= local.battlefield.find((card) => card.name === 'Selfless Spirit')?.oid ?? null;
        wornOid ??= opponent.battlefield.find((card) => card.name === 'Worn Powerstone')?.oid ?? null;
        const returnedSpirit =
          spiritOid === null ? undefined : local.battlefield.find((card) => card.oid === spiritOid);
        const outcome: boolean =
          chosePlusOne &&
          targetedSpirit &&
          returnedSpirit !== undefined &&
          plusOneCounters(returnedSpirit) === 1;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const exactWorn = decision.options.find((option) => option.targets[0]?.oid === wornOid);
          const exactSpirit = decision.options.find((option) => option.targets[0]?.oid === spiritOid);
          const spiritOnBattlefield =
            spiritOid !== null && local.battlefield.some((card) => card.oid === spiritOid);
          if (!castElspeth && spiritOnBattlefield) {
            expect(exactSpirit).toBeDefined();
            move = exactSpirit!.id;
            targetedSpiritWithBolt = true;
          } else if (!targetedWorn && exactWorn !== undefined) {
            move = exactWorn.id;
            targetedWorn = true;
          } else {
            expect(exactSpirit).toBeDefined();
            move = exactSpirit!.id;
            targetedSpirit = true;
          }
        } else if (decision.kind === 'counter-type-choice') {
          const plusOne = decision.options.find(
            (option) => option.text.includes('+1/+1') || option.text.toUpperCase().includes('P1P1'),
          );
          expect(plusOne).toBeDefined();
          move = plusOne!.id;
          chosePlusOne = true;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const spirit = local.battlefield.find((card) => card.name === 'Selfless Spirit');
          const spiritInGraveyard =
            spiritOid !== null && local.graveyard.some((card) => card.oid === spiritOid);
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plateau')?.id ??
            (spiritOid === null && untappedSources(session, 'Plateau') >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Selfless Spirit:') &&
                    !option.text.includes('gain indestructible until end of turn'),
                )?.id
              : undefined) ??
            (spirit !== undefined && !targetedSpiritWithBolt && untappedSources(session, 'Plateau') >= 1
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))?.id
              : undefined) ??
            (spiritInGraveyard && wornOid !== null && !castElspeth && untappedSources(session, 'Plateau') >= 5
              ? decision.options.find((option) => option.text.startsWith('Elspeth Conquers Death:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castElspeth ||=
            move !== undefined &&
            decision.options
              .find((option) => option.id === move)
              ?.text.startsWith('Elspeth Conquers Death:') === true;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Elspeth Conquers Death move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const returnedSpirit = session.view.seats[0].battlefield.find((card) => card.oid === spiritOid);
      expect(spiritOid, evidence).toMatch(/^forge-card-/u);
      expect(wornOid, evidence).toMatch(/^forge-card-/u);
      expect(targetedSpiritWithBolt, evidence).toBe(true);
      expect(castElspeth, evidence).toBe(true);
      expect(targetedWorn, evidence).toBe(true);
      expect(targetedSpirit, evidence).toBe(true);
      expect(chosePlusOne, evidence).toBe(true);
      expect(returnedSpirit, evidence).toBeDefined();
      expect(plusOneCounters(returnedSpirit!), evidence).toBe(1);
    },
    360_000,
  );

  forgeIt(
    'proves Teferi optional-target cancellation, no-target draw, and exact-target return outcomes',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TEFERI_OPTIONAL_TARGET_TABLE)).toEqual([]);

      const runRoute = async (route: 'none' | 'exact') => {
        const opened = await backend.open(TEFERI_OPTIONAL_TARGET_TABLE);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let wallOid: string | null = null;
        let teferiOid: string | null = null;
        let canceled = false;
        let selected = false;
        let drawBefore: number | null = null;
        let loyaltyBeforeCancel: number | null = null;
        const trace: string[] = [];
        const loyaltyOf = (oid: string | null): number | null => {
          const card = session.view.seats[0].battlefield.find((candidate) => candidate.oid === oid);
          if (card === undefined) return null;
          return Object.entries(card.counters)
            .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
            .reduce((sum, [, count]) => sum + count, 0);
        };

        for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no Teferi decision');
          const local = session.view.seats[0];
          wallOid ??= local.battlefield.find((card) => card.name === 'Wall of Omens')?.oid ?? null;
          teferiOid ??= local.battlefield.find((card) => card.name === 'Teferi, Time Raveler')?.oid ?? null;
          const wallOnBattlefield = local.battlefield.some((card) => card.oid === wallOid);
          const wallInHand = local.hand?.some((card) => card.oid === wallOid) === true;
          const drew = drawBefore !== null && local.librarySize === drawBefore - 1;
          const outcome =
            selected &&
            drew &&
            (route === 'none' ? wallOnBattlefield : wallInHand) &&
            session.view.stack.length === 0;
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move = pregameOrManaPayment(decision);
          if (decision.kind === 'target-selection') {
            const none = decision.options.find((option) => option.id === 'target-none');
            const cancel = decision.options.find((option) => option.id === 'target-cancel');
            const exactWall = decision.options.find((option) => option.targets[0]?.oid === wallOid);
            expect(none, trace.at(-1)).toBeDefined();
            expect(cancel, trace.at(-1)).toBeDefined();
            expect(exactWall, trace.at(-1)).toBeDefined();
            if (!canceled) {
              loyaltyBeforeCancel = loyaltyOf(teferiOid);
              move = cancel!.id;
              canceled = true;
            } else {
              drawBefore = local.librarySize;
              move = route === 'none' ? none!.id : exactWall!.id;
              selected = true;
            }
          } else if (decision.kind === 'combat-attackers') {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const teferiAbility = decision.options.find(
              (option) =>
                option.text.startsWith('Teferi, Time Raveler:') && option.text.includes('Return up to'),
            );
            move =
              (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              (teferiOid !== null && !selected ? teferiAbility?.id : undefined) ??
              decision.options.find((option) => option.text === 'Play Tundra')?.id ??
              (wallOid === null && untappedSources(session, 'Tundra') >= 2
                ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
                : undefined) ??
              (wallOid !== null && teferiOid === null && untappedSources(session, 'Tundra') >= 3
                ? decision.options.find((option) => option.text.startsWith('Teferi, Time Raveler:'))?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no Teferi move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
          session = advanced.session;
          if (move === 'target-cancel') {
            expect(loyaltyOf(teferiOid), trace.at(-1)).toBe(loyaltyBeforeCancel);
          }
        }

        const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
        const local = session.view.seats[0];
        expect(wallOid, evidence).toMatch(/^forge-card-/u);
        expect(typeof teferiOid, evidence).toBe('string');
        expect(teferiOid, evidence).toMatch(/^forge-card-/u);
        expect(canceled, evidence).toBe(true);
        expect(selected, evidence).toBe(true);
        expect(drawBefore, evidence).not.toBeNull();
        expect(local.librarySize, evidence).toBe(drawBefore! - 1);
        if (route === 'none') {
          expect(
            local.battlefield.some((card) => card.oid === wallOid),
            evidence,
          ).toBe(true);
        } else {
          expect(
            local.hand?.some((card) => card.oid === wallOid),
            evidence,
          ).toBe(true);
        }
        await session.close();
      };

      await runRoute('none');
      await runRoute('exact');
    },
    360_000,
  );

  forgeIt(
    'proves Nissa optional-target cancellation, no-target resolution, and exact animated-land outcome',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(NISSA_OPTIONAL_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(NISSA_OPTIONAL_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let nissaOid: string | null = null;
      let canceled = false;
      let selectedNone = false;
      let noTargetResolved = false;
      let selectedForestOid: string | null = null;
      let loyaltyBeforeCancel: number | null = null;
      const trace: string[] = [];
      const loyaltyOf = (): number | null => {
        const nissa = session.view.seats[0].battlefield.find((card) => card.oid === nissaOid);
        if (nissa === undefined) return null;
        return Object.entries(nissa.counters)
          .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
          .reduce((sum, [, count]) => sum + count, 0);
      };
      const plusOneCounters = (oid: string): number => {
        const card = session.view.seats[0].battlefield.find((candidate) => candidate.oid === oid);
        if (card === undefined) return 0;
        return Object.entries(card.counters)
          .filter(([kind]) => kind.toUpperCase().includes('P1P1') || kind.includes('+1/+1'))
          .reduce((sum, [, count]) => sum + count, 0);
      };

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Nissa decision');
        const local = session.view.seats[0];
        nissaOid ??=
          local.battlefield.find((card) => card.name === 'Nissa, Who Shakes the World')?.oid ?? null;
        if (selectedNone && !noTargetResolved && session.view.stack.length === 0 && (loyaltyOf() ?? 0) >= 6) {
          expect(local.battlefield.every((card) => !card.typeLine.includes('Creature'))).toBe(true);
          noTargetResolved = true;
        }
        const animated = local.battlefield.find((card) => card.oid === selectedForestOid);
        const outcome =
          animated !== undefined &&
          animated.typeLine.includes('Creature') &&
          plusOneCounters(animated.oid) === 3;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const none = decision.options.find((option) => option.id === 'target-none');
          const cancel = decision.options.find((option) => option.id === 'target-cancel');
          const forests = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Forest',
          );
          expect(none, trace.at(-1)).toBeDefined();
          expect(cancel, trace.at(-1)).toBeDefined();
          expect(forests.length, trace.at(-1)).toBeGreaterThan(0);
          if (!canceled) {
            loyaltyBeforeCancel = loyaltyOf();
            move = cancel!.id;
            canceled = true;
          } else if (!selectedNone) {
            move = none!.id;
            selectedNone = true;
          } else {
            selectedForestOid = forests[0]!.targets[0]!.oid;
            move = forests[0]!.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const nissaAbility = decision.options.find(
            (option) =>
              option.text.startsWith('Nissa, Who Shakes the World:') && option.text.includes('Put three'),
          );
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (nissaOid !== null && selectedForestOid === null ? nissaAbility?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (nissaOid === null && untappedSources(session, 'Forest') >= 5
              ? decision.options.find((option) => option.text.startsWith('Nissa, Who Shakes the World:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Nissa move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
        if (move === 'target-cancel') {
          expect(loyaltyOf(), trace.at(-1)).toBe(loyaltyBeforeCancel);
        }
      }

      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const animated = session.view.seats[0].battlefield.find((card) => card.oid === selectedForestOid);
      expect(nissaOid, evidence).toMatch(/^forge-card-/u);
      expect(canceled, evidence).toBe(true);
      expect(selectedNone, evidence).toBe(true);
      expect(noTargetResolved, evidence).toBe(true);
      expect(selectedForestOid, evidence).toMatch(/^forge-card-/u);
      expect(animated?.typeLine, evidence).toContain('Creature');
      expect(plusOneCounters(selectedForestOid!), evidence).toBe(3);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves printed Phyrexian spell costs cancel cleanly and produce their exact board outcomes',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(DISMEMBER_PHYREXIAN_SPELL_TABLE)).toEqual([]);
      expect(await backend.supports(LEGIONNAIRE_PHYREXIAN_SPELL_TABLE)).toEqual([]);

      const openedDismember = await backend.open(DISMEMBER_PHYREXIAN_SPELL_TABLE);
      if (!openedDismember.ok) throw new Error(openedDismember.error.message);
      let session: ObservedSession = openedDismember.session;
      let wallOid: string | null = null;
      let canceled = false;
      let cancelLife: number | null = null;
      let paidLifeSymbols = 0;
      let castAttempt = 0;
      const dismemberTrace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Dismember decision');
        const local = session.view.seats[0];
        wallOid ??= local.battlefield.find((card) => card.name === 'Wall of Omens')?.oid ?? null;
        const wallDied = wallOid !== null && local.graveyard.some((card) => card.oid === wallOid);
        dismemberTrace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const wall = decision.options.find((option) => option.targets[0]?.oid === wallOid);
          expect(wall, dismemberTrace.at(-1)).toBeDefined();
          move = wall!.id;
        } else if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (castAttempt === 1 && !canceled && paidLifeSymbols === 0 && payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols = 1;
          } else if (castAttempt === 1 && !canceled) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, dismemberTrace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
            paidLifeSymbols = 0;
          } else if (payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols += 1;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castDismember =
            wallOid !== null &&
            !wallDied &&
            castAttempt < 2 &&
            (castAttempt === 0 || untappedSources(session, 'Plains') >= 1)
              ? decision.options.find((option) => option.text.startsWith('Dismember:'))?.id
              : undefined;
          const castWall =
            wallOid === null && untappedSources(session, 'Plains') >= 2
              ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
              : undefined;
          move =
            (wallDied ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            castWall ??
            castDismember ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castDismember !== undefined && move === castDismember) castAttempt += 1;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Dismember move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${dismemberTrace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, dismemberTrace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === 'Dismember'),
            dismemberTrace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === 'Dismember')).toBe(false);
        }
      }
      const dismemberEvidence = `${dismemberTrace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(canceled, dismemberEvidence).toBe(true);
      expect(castAttempt, dismemberEvidence).toBe(2);
      expect(paidLifeSymbols, dismemberEvidence).toBe(2);
      expect(session.view.seats[0].life, dismemberEvidence).toBe(16);
      expect(wallOid, dismemberEvidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[0].graveyard.some((card) => card.oid === wallOid),
        dismemberEvidence,
      ).toBe(true);
      await session.close();

      const openedLegionnaire = await backend.open(LEGIONNAIRE_PHYREXIAN_SPELL_TABLE);
      if (!openedLegionnaire.ok) throw new Error(openedLegionnaire.error.message);
      session = openedLegionnaire.session;
      canceled = false;
      cancelLife = null;
      paidLifeSymbols = 0;
      castAttempt = 0;
      const legionnaireTrace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Legionnaire decision');
        const local = session.view.seats[0];
        const legionnaire = local.battlefield.find((card) => card.name === 'Porcelain Legionnaire');
        legionnaireTrace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (castAttempt === 1 && !canceled && paidLifeSymbols === 0 && payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols = 1;
          } else if (castAttempt === 1 && !canceled) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, legionnaireTrace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
            paidLifeSymbols = 0;
          } else if (payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols += 1;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castLegionnaire =
            legionnaire === undefined && castAttempt < 2 && untappedSources(session, 'Mountain') >= 2
              ? decision.options.find((option) => option.text.startsWith('Porcelain Legionnaire:'))?.id
              : undefined;
          move =
            (legionnaire !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            castLegionnaire ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castLegionnaire !== undefined && move === castLegionnaire) castAttempt += 1;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Legionnaire move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${legionnaireTrace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, legionnaireTrace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === 'Porcelain Legionnaire'),
            legionnaireTrace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === 'Porcelain Legionnaire')).toBe(false);
        }
      }
      const legionnaireEvidence = `${legionnaireTrace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const legionnaire = session.view.seats[0].battlefield.find(
        (card) => card.name === 'Porcelain Legionnaire',
      );
      expect(canceled, legionnaireEvidence).toBe(true);
      expect(castAttempt, legionnaireEvidence).toBe(2);
      expect(paidLifeSymbols, legionnaireEvidence).toBe(1);
      expect(session.view.seats[0].life, legionnaireEvidence).toBe(18);
      expect(legionnaire?.power, legionnaireEvidence).toBe(3);
      expect(legionnaire?.toughness, legionnaireEvidence).toBe(1);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'admits Gut Shot by the mono-color Phyrexian structural rule, both payment arms and a clean cancel (mtg-t5ma0)',
    async () => {
      const backend = installedDiagnosticForgeBackend(
        new Set(['Plains', 'Wall of Omens', 'Gut Shot', 'Mountain']),
        { timeoutMs: 120_000 },
      );
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(GUT_SHOT_PHYREXIAN_SPELL_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let wallOid: string | null = null;
      let canceled = false;
      let cancelLife: number | null = null;
      let paidLifeSymbols = 0;
      let paidManaSymbols = 0;
      let castAttempt = 0;
      let payingForGutShot = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Gut Shot decision');
        const local = session.view.seats[0];
        wallOid ??= local.battlefield.find((card) => card.name === 'Wall of Omens')?.oid ?? null;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const wall = decision.options.find((option) => option.targets[0]?.oid === wallOid);
          expect(wall, trace.at(-1)).toBeDefined();
          move = wall!.id;
        } else if (decision.kind === 'mana-payment' && !payingForGutShot) {
          // A payment decision can belong to Wall of Omens (cast ahead of Gut Shot
          // whenever it wins the priority pick below) rather than to Gut Shot; only
          // a payment started from the castGutShot branch exercises the arms below.
          move =
            decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id ??
            decision.options[0]?.id;
        } else if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          const payMana = decision.options.find((option) => option.text.startsWith('Activate Mountain'));
          if (castAttempt === 1) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
          } else if (castAttempt === 2) {
            expect(payLife, trace.at(-1)).toBeDefined();
            move = payLife!.id;
            paidLifeSymbols += 1;
          } else {
            expect(payMana, trace.at(-1)).toBeDefined();
            move = payMana!.id;
            paidManaSymbols += 1;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castWall =
            wallOid === null && untappedSources(session, 'Plains') >= 2
              ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
              : undefined;
          const castGutShot =
            wallOid !== null && castAttempt < 3
              ? decision.options.find((option) => option.text.startsWith('Gut Shot:'))?.id
              : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            castWall ??
            castGutShot ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castGutShot !== undefined && move === castGutShot) {
            castAttempt += 1;
            payingForGutShot = true;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gut Shot move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (
          payingForGutShot &&
          decision.kind === 'mana-payment' &&
          (move === 'mana-payment-cancel' || session.decision?.kind !== 'mana-payment')
        ) {
          payingForGutShot = false;
        }
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, trace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === 'Gut Shot'),
            trace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === 'Gut Shot')).toBe(false);
        }
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(canceled, evidence).toBe(true);
      expect(castAttempt, evidence).toBe(3);
      expect(paidLifeSymbols, evidence).toBe(1);
      expect(paidManaSymbols, evidence).toBe(1);
      expect(wallOid, evidence).toMatch(/^forge-card-/u);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'admits Gitaxian Probe by the mono-color Phyrexian structural rule, both payment arms and a clean cancel (mtg-t5ma0)',
    async () => {
      const backend = installedDiagnosticForgeBackend(new Set(['Island', 'Gitaxian Probe']), {
        timeoutMs: 120_000,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(GITAXIAN_PROBE_PHYREXIAN_SPELL_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let canceled = false;
      let cancelLife: number | null = null;
      let paidLifeSymbols = 0;
      let paidManaSymbols = 0;
      let castAttempt = 0;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Gitaxian Probe decision');
        const local = session.view.seats[0];
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const opponent = decision.options.find(
            (option) => option.text === 'Target Forge AI [target-player-1]',
          );
          expect(opponent, trace.at(-1)).toBeDefined();
          move = opponent!.id;
        } else if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          const payMana = decision.options.find((option) => option.text.startsWith('Activate Island'));
          if (castAttempt === 1) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
          } else if (castAttempt === 2) {
            expect(payLife, trace.at(-1)).toBeDefined();
            move = payLife!.id;
            paidLifeSymbols += 1;
          } else {
            expect(payMana, trace.at(-1)).toBeDefined();
            move = payMana!.id;
            paidManaSymbols += 1;
          }
        } else if (decision.kind === 'priority') {
          const castProbe =
            castAttempt < 3
              ? decision.options.find((option) => option.text.startsWith('Gitaxian Probe:'))?.id
              : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            castProbe ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castProbe !== undefined && move === castProbe) castAttempt += 1;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Gitaxian Probe move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, trace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === 'Gitaxian Probe'),
            trace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === 'Gitaxian Probe')).toBe(false);
        }
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(canceled, evidence).toBe(true);
      expect(castAttempt, evidence).toBe(3);
      expect(paidLifeSymbols, evidence).toBe(1);
      expect(paidManaSymbols, evidence).toBe(1);
      const handLook = session.events.find((event) => event.type === 'Private reveal');
      expect(handLook, evidence).toBeDefined();
      expect(handLook!.text).toContain('Island');
      expect(handLook!.reveals.length).toBeGreaterThan(0);
      expect(handLook!.reveals.every((reveal) => reveal.seats.length === 1 && reveal.seats[0] === 0)).toBe(
        true,
      );
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    "admits Norn's Annex by the mono-color Phyrexian structural rule across two stacked shards, both life payments and a clean cancel (mtg-t5ma0)",
    async () => {
      const backend = installedDiagnosticForgeBackend(new Set(['Mountain', "Norn's Annex"]), {
        timeoutMs: 120_000,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(NORNS_ANNEX_PHYREXIAN_SPELL_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let canceled = false;
      let cancelLife: number | null = null;
      let paidLifeSymbols = 0;
      let castAttempt = 0;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Norn's Annex decision");
        const local = session.view.seats[0];
        const annex = local.battlefield.find((card) => card.name === "Norn's Annex");
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (castAttempt === 1 && !canceled && paidLifeSymbols === 0 && payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols = 1;
          } else if (castAttempt === 1 && !canceled) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
            paidLifeSymbols = 0;
          } else if (payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols += 1;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castAnnex =
            annex === undefined && castAttempt < 2 && untappedSources(session, 'Mountain') >= 3
              ? decision.options.find((option) => option.text.startsWith("Norn's Annex:"))?.id
              : undefined;
          move =
            (annex !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            castAnnex ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castAnnex !== undefined && move === castAnnex) castAttempt += 1;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error("Forge offered no Norn's Annex move");
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, trace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === "Norn's Annex"),
            trace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === "Norn's Annex")).toBe(false);
        }
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      const resolvedAnnex = session.view.seats[0].battlefield.find((card) => card.name === "Norn's Annex");
      expect(canceled, evidence).toBe(true);
      expect(castAttempt, evidence).toBe(2);
      expect(paidLifeSymbols, evidence).toBe(2);
      expect(session.view.seats[0].life, evidence).toBe(16);
      expect(resolvedAnnex, evidence).toBeDefined();
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'admits Corrosive Gale by the mono-color Phyrexian structural rule with an announced X and a clean cancel (mtg-t5ma0)',
    async () => {
      const backend = installedDiagnosticForgeBackend(new Set(['Mountain', 'Corrosive Gale']), {
        timeoutMs: 120_000,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(CORROSIVE_GALE_PHYREXIAN_SPELL_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      const ANNOUNCED = 2;
      let session: ObservedSession = opened.session;
      let canceled = false;
      let cancelLife: number | null = null;
      let paidLifeSymbols = 0;
      let castAttempt = 0;
      let announcedStops: readonly number[] | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Corrosive Gale decision');
        const local = session.view.seats[0];
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = decision.kind === 'mana-payment' ? undefined : pregameOrManaPayment(decision);
        if (decision.kind === 'number' && decision.prompt.startsWith('Corrosive Gale')) {
          const stops = decision.options
            .filter((option) => /^number-\d+$/u.test(option.id))
            .map((option) => Number(option.id.slice('number-'.length)));
          announcedStops = stops;
          move = decision.options.find((option) => option.id === `number-${String(ANNOUNCED)}`)?.id;
        } else if (decision.kind === 'mana-payment') {
          const payLife = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (castAttempt === 1 && !canceled && payLife !== undefined) {
            const cancel = decision.options.find((option) => option.id === 'mana-payment-cancel');
            expect(cancel, trace.at(-1)).toBeDefined();
            cancelLife = local.life;
            move = cancel!.id;
            canceled = true;
          } else if (payLife !== undefined) {
            move = payLife.id;
            paidLifeSymbols += 1;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castGale =
            castAttempt < 2 && untappedSources(session, 'Mountain') >= ANNOUNCED + 1
              ? decision.options.find((option) => option.text.startsWith('Corrosive Gale:'))?.id
              : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            castGale ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castGale !== undefined && move === castGale) castAttempt += 1;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Corrosive Gale move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        }
        session = advanced.session;
        if (move === 'mana-payment-cancel') {
          const restored = session.view.seats[0];
          expect(restored.life, trace.at(-1)).toBe(cancelLife);
          expect(
            restored.hand?.some((card) => card.name === 'Corrosive Gale'),
            trace.at(-1),
          ).toBe(true);
          expect(session.view.stack.some((card) => card.name === 'Corrosive Gale')).toBe(false);
        }
      }
      const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(canceled, evidence).toBe(true);
      expect(castAttempt, evidence).toBe(2);
      expect(announcedStops, evidence).not.toBeNull();
      expect(paidLifeSymbols, evidence).toBe(1);
      expect(session.view.seats[0].life, evidence).toBe(18);
      expect(
        session.view.seats[0].graveyard.some((card) => card.name === 'Corrosive Gale'),
        evidence,
      ).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves both exact Cascade spells route the free-cast choice and honor its board outcome',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;

      const runCascade = async (
        spec: SessionSpec,
        sourceName: 'Bloodbraid Elf' | 'Shardless Agent',
        landName: 'Taiga' | 'Tropical Island',
        manaValue: number,
        accept: boolean,
      ): Promise<void> => {
        expect(await backend.supports(spec)).toEqual([]);
        const opened = await backend.open(spec);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let cast = false;
        let confirmed = false;
        let offeredLabels: readonly string[] | null = null;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error(`Forge offered no ${sourceName} decision`);
          const local = session.view.seats[0];
          const sourceResolved = local.battlefield.some((card) => card.name === sourceName);
          const wallResolved = local.battlefield.some((card) => card.name === 'Wall of Omens');
          const outcome =
            confirmed && sourceResolved && session.view.stack.length === 0 && wallResolved === accept;
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move = pregameOrManaPayment(decision);
          if (decision.kind === 'confirm-action' && cast && !confirmed) {
            offeredLabels = decision.options.map((option) => option.text);
            expect(decision.prompt, trace.at(-1)).toContain('Wall of Omens');
            move = decision.options.find(
              (option) => option.id === `confirm-action-${accept ? 'yes' : 'no'}`,
            )?.id;
            confirmed = true;
          } else if (decision.kind === 'combat-attackers') {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const castSource: string | undefined =
              !cast && untappedSources(session, landName) >= manaValue
                ? decision.options.find((option) => option.text.startsWith(`${sourceName}:`))?.id
                : undefined;
            move =
              (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === `Play ${landName}`)?.id ??
              castSource ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            cast ||= castSource !== undefined && move === castSource;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error(`Forge offered no ${sourceName} move`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-140).join('\n')}`);
          session = advanced.session;
        }
        const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(cast, evidence).toBe(true);
        expect(confirmed, evidence).toBe(true);
        expect(offeredLabels, evidence).toEqual(['Yes', 'No']);
        expect(
          session.view.seats[0].battlefield.some((card) => card.name === sourceName),
          evidence,
        ).toBe(true);
        expect(
          session.view.seats[0].battlefield.some((card) => card.name === 'Wall of Omens'),
          evidence,
        ).toBe(accept);
        await session.close();
      };

      await runCascade(BLOODBRAID_CASCADE_TABLE, 'Bloodbraid Elf', 'Taiga', 4, false);
      await runCascade(SHARDLESS_CASCADE_TABLE, 'Shardless Agent', 'Tropical Island', 3, true);
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves both exact Confluences repeat a human-selected mode three times',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;

      const runConfluence = async (
        spec: SessionSpec,
        sourceName: 'Wretched Confluence' | 'Fiery Confluence',
        landName: 'Swamp' | 'Mountain',
        modeText: string,
      ): Promise<void> => {
        expect(await backend.supports(spec)).toEqual([]);
        const opened = await backend.open(spec);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let cast = false;
        let modePicks = 0;
        let targetPicks = 0;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error(`Forge offered no ${sourceName} decision`);
          const resolved: boolean =
            cast &&
            modePicks === 3 &&
            session.view.stack.length === 0 &&
            session.view.seats[0].graveyard.some((card) => card.name === sourceName);
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move = pregameOrManaPayment(decision);
          if (decision.kind === 'mode-selection' && cast && modePicks < 3) {
            expect(decision.options.length, trace.at(-1)).toBeGreaterThanOrEqual(1);
            expect(decision.options.length, trace.at(-1)).toBeLessThanOrEqual(3);
            move = decision.options.find((option) => option.text.includes(modeText))?.id;
            modePicks += 1;
          } else if (
            decision.kind === 'repeatable-target-selection' &&
            sourceName === 'Wretched Confluence'
          ) {
            move = decision.options.find((option) => option.id === 'target-player-0')?.id;
            targetPicks += 1;
          } else if (decision.kind === 'combat-attackers') {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const castSource: string | undefined =
              !cast && untappedSources(session, landName) >= (sourceName === 'Wretched Confluence' ? 5 : 4)
                ? decision.options.find((option) => option.text.startsWith(`${sourceName}:`))?.id
                : undefined;
            move =
              (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === `Play ${landName}`)?.id ??
              castSource ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            cast ||= castSource !== undefined && move === castSource;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error(`Forge offered no ${sourceName} move`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
          session = advanced.session;
        }
        const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(cast, evidence).toBe(true);
        expect(modePicks, evidence).toBe(3);
        if (sourceName === 'Wretched Confluence') {
          expect(targetPicks, evidence).toBe(3);
          expect(session.view.seats[0].life, evidence).toBe(17);
        } else {
          expect(targetPicks, evidence).toBe(0);
          expect(session.view.seats[1].life, evidence).toBe(14);
        }
        await session.close();
      };

      await runConfluence(
        WRETCHED_CONFLUENCE_TABLE,
        'Wretched Confluence',
        'Swamp',
        'draws a card and loses 1 life',
      );
      await runConfluence(
        FIERY_CONFLUENCE_TABLE,
        'Fiery Confluence',
        'Mountain',
        '2 damage to each opponent',
      );
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves Plow Under routes two distinct lands and returns those exact objects on subsequent draws',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(PLOW_UNDER_TABLE)).toEqual([]);
      const opened = await backend.open(PLOW_UNDER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let cast = false;
      const targets: string[] = [];
      let firstOfferedCancel = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Plow Under decision');
        const bothDrawn =
          targets.length === 2 &&
          targets.every((oid) => session.view.seats[0].hand?.some((card) => card.oid === oid));
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection' && cast && targets.length < 2) {
          if (targets.length === 0) {
            firstOfferedCancel = decision.options.some((option) => option.id === 'target-cancel');
          }
          const forest = decision.options.find(
            (option) =>
              option.targets[0]?.name === 'Forest' && !targets.includes(option.targets[0]?.oid ?? ''),
          );
          expect(forest, trace.at(-1)).toBeDefined();
          targets.push(forest!.targets[0]!.oid);
          move = forest!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castSource: string | undefined =
            !cast && untappedSources(session, 'Forest') >= 5
              ? decision.options.find((option) => option.text.startsWith('Plow Under:'))?.id
              : undefined;
          move =
            (bothDrawn ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (!cast ? decision.options.find((option) => option.text === 'Play Forest')?.id : undefined) ??
            castSource ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= castSource !== undefined && move === castSource;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Plow Under move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(firstOfferedCancel, evidence).toBe(true);
      expect(targets, evidence).toHaveLength(2);
      expect(new Set(targets).size, evidence).toBe(2);
      expect(
        targets.every((oid) => !session.view.seats[0].battlefield.some((card) => card.oid === oid)),
        evidence,
      ).toBe(true);
      expect(
        targets.every((oid) => session.view.seats[0].hand?.some((card) => card.oid === oid)),
        evidence,
      ).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'lets reviewed Market Festival split its triggered mana across colors (mtg-uz0mz.1.1)',
    async () => {
      const backend = installedDiagnosticForgeBackend(new Set(['Forest', 'Mountain', 'Market Festival']), {
        timeoutMs: 120_000,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(MARKET_FESTIVAL_MANA_COMBO_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let enchantedForestOid: string | null = null;
      let castFestival = false;
      let activated = false;
      const chosenColors: string[] = [];
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Market Festival decision');
        const local = session.view.seats[0];
        const festival = local.battlefield.find((card) => card.name === 'Market Festival');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'color-choice') {
          const wanted =
            chosenColors.length === 0 ? { name: 'green', symbol: 'G' } : { name: 'blue', symbol: 'U' };
          const color = decision.options.find((option) => option.id.endsWith(`-${wanted.symbol}`));
          expect(color, trace.at(-1)).toBeDefined();
          move = color!.id;
          chosenColors.push(wanted.name);
        } else if (decision.kind === 'target-selection' && !castFestival) {
          const localForests = new Set(
            local.battlefield.filter((card) => card.name === 'Forest').map((card) => card.oid),
          );
          const target = decision.options.find((option) => {
            const oid = option.targets[0]?.oid;
            return oid !== undefined && localForests.has(oid);
          });
          expect(target, trace.at(-1)).toBeDefined();
          enchantedForestOid = target!.targets[0]!.oid;
          move = target!.id;
          castFestival = true;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const cast =
            festival === undefined && untappedSources(session, 'Forest') >= 4
              ? decision.options.find((option) => option.text.startsWith('Market Festival:'))?.id
              : undefined;
          const enchantedNumber = enchantedForestOid?.replace('forge-card-', '');
          const addMana: string | undefined =
            festival !== undefined && enchantedNumber !== undefined && !activated
              ? decision.options.find((option) => option.id.startsWith(`mana-source-${enchantedNumber}-`))?.id
              : undefined;
          move =
            (chosenColors.length === 2
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            cast ??
            addMana ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= move === addMana;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Market Festival move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castFestival, evidence).toBe(true);
      expect(activated, evidence).toBe(true);
      expect(chosenColors, evidence).toEqual(['green', 'blue']);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves Coalition Relic routes its triggered mana color into an actual colored spell',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(COALITION_RELIC_MANA_COMBO_TABLE)).toEqual([]);
      const opened = await backend.open(COALITION_RELIC_MANA_COMBO_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let castRelic = false;
      let charged = false;
      let sawChargeCounter = false;
      let choseRed = false;
      let castBolt = false;
      let targetedOpponent = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Coalition Relic decision');
        const relic = session.view.seats[0].battlefield.find((card) => card.name === 'Coalition Relic');
        sawChargeCounter ||=
          relic !== undefined &&
          Object.entries(relic.counters).some(
            ([kind, amount]) => kind.toUpperCase().includes('CHARGE') && amount === 1,
          );
        const outcome: boolean =
          castBolt &&
          targetedOpponent &&
          session.view.stack.length === 0 &&
          session.view.seats[1].life === 17;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'color-choice') {
          const red = decision.options.find(
            (option) => option.id.endsWith('-R') || option.text.toLowerCase() === 'red',
          );
          expect(red, trace.at(-1)).toBeDefined();
          move = red!.id;
          choseRed = true;
        } else if (decision.kind === 'target-selection' && castBolt) {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
          targetedOpponent = move !== undefined;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castRelicOption: (typeof decision.options)[number] | undefined =
            !castRelic && untappedSources(session, 'Ancient Tomb') >= 2
              ? decision.options.find((option) => option.text.startsWith('Coalition Relic:'))
              : undefined;
          const chargeOption: (typeof decision.options)[number] | undefined =
            relic !== undefined && !charged
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Coalition Relic:') && option.text.includes('charge counter'),
                )
              : undefined;
          const boltOption: (typeof decision.options)[number] | undefined =
            choseRed && !castBolt
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
              : undefined;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (!castRelic
              ? decision.options.find((option) => option.text === 'Play Ancient Tomb')?.id
              : undefined) ??
            castRelicOption?.id ??
            chargeOption?.id ??
            boltOption?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castRelic ||= move === castRelicOption?.id;
          charged ||= move === chargeOption?.id;
          castBolt ||= move === boltOption?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Coalition Relic move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castRelic, evidence).toBe(true);
      expect(charged, evidence).toBe(true);
      expect(sawChargeCounter, evidence).toBe(true);
      expect(choseRed, evidence).toBe(true);
      expect(castBolt, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(session.view.seats[1].life, evidence).toBe(17);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'activates reviewed Terrarion through its split-mana source',
    async () => {
      const backend = installedDiagnosticForgeBackend(new Set(['Forest', 'Terrarion']), {
        timeoutMs: 120_000,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(TERRARION_MANA_COMBO_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let castTerrarion = false;
      let activated = false;
      let handSizeBeforeActivation: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Terrarion decision');
        const local = session.view.seats[0];
        const terrarion = local.battlefield.find((card) => card.name === 'Terrarion');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const cast =
            terrarion === undefined && untappedSources(session, 'Forest') >= 1
              ? decision.options.find((option) => option.text.startsWith('Terrarion:'))?.id
              : undefined;
          const activate =
            terrarion !== undefined &&
            !terrarion.tapped &&
            !activated &&
            untappedSources(session, 'Forest') >= 2
              ? decision.options.find(
                  (option) => option.text === 'Activate Terrarion for {G}' && option.id.endsWith('-G'),
                )?.id
              : undefined;
          const drewCard =
            activated &&
            handSizeBeforeActivation !== null &&
            local.graveyard.some((card) => card.name === 'Terrarion') &&
            local.handSize > handSizeBeforeActivation;
          move =
            (drewCard ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            cast ??
            activate ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castTerrarion ||= move === cast;
          if (move === activate) {
            activated = true;
            handSizeBeforeActivation = local.handSize;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Terrarion move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(castTerrarion, evidence).toBe(true);
      expect(activated, evidence).toBe(true);
      expect(
        session.view.seats[0].graveyard.some((card) => card.name === 'Terrarion'),
        evidence,
      ).toBe(true);
      expect(session.view.seats[0].handSize, evidence).toBeGreaterThan(handSizeBeforeActivation ?? Infinity);
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves Cryptic Command counters the exact stack object and draws a card',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(CRYPTIC_COMMAND_TABLE)).toEqual([]);
      const opened = await backend.open(CRYPTIC_COMMAND_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let cast = false;
      let selectedOid: string | null = null;
      let handAfterCast: number | null = null;
      let lifeBeforeResolution: readonly [number, number] | null = null;
      const chosenModes: string[] = [];
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Cryptic Command decision');
        const countered =
          selectedOid !== null && session.view.seats[1].graveyard.some((card) => card.oid === selectedOid);
        const drew = handAfterCast !== null && session.view.seats[0].hand?.length === handAfterCast + 1;
        const outcome =
          countered &&
          drew &&
          session.view.stack.length === 0 &&
          lifeBeforeResolution !== null &&
          session.view.seats[0].life === lifeBeforeResolution[0] &&
          session.view.seats[1].life === lifeBeforeResolution[1];
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mode-selection' && cast && chosenModes.length < 2) {
          handAfterCast ??= session.view.seats[0].hand?.length ?? null;
          const wanted = chosenModes.length === 0 ? 'Counter target spell' : 'Draw a card';
          const mode = decision.options.find((option) => option.text.includes(wanted));
          expect(mode, trace.at(-1)).toBeDefined();
          chosenModes.push(mode!.text);
          move = mode!.id;
        } else if (decision.kind === 'target-selection' && cast) {
          const target = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.oid === selectedOid,
          );
          expect(target, trace.at(-1)).toBeDefined();
          move = target!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const explore = session.view.stack.find((card) => card.name === 'Explore');
          const castCryptic =
            !cast && explore !== undefined && untappedSources(session, 'Tundra') >= 4
              ? decision.options.find((option) => option.text.startsWith('Cryptic Command:'))
              : undefined;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (!cast ? decision.options.find((option) => option.text === 'Play Tundra')?.id : undefined) ??
            castCryptic?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castCryptic !== undefined && move === castCryptic.id) {
            cast = true;
            selectedOid = explore!.oid;
            lifeBeforeResolution = [session.view.seats[0].life, session.view.seats[1].life];
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Cryptic Command move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(chosenModes, evidence).toHaveLength(2);
      expect(chosenModes[0], evidence).toContain('Counter target spell');
      expect(chosenModes[1], evidence).toContain('Draw a card');
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[1].graveyard.map((card) => card.oid),
        evidence,
      ).toContain(selectedOid);
      expect(session.view.seats[0].hand?.length, evidence).toBe((handAfterCast ?? -1) + 1);
      expect([session.view.seats[0].life, session.view.seats[1].life], evidence).toEqual(
        lifeBeforeResolution,
      );
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    "proves both outcomes of Phantasmal Image's optional copy replacement",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;

      const run = async (accept: boolean): Promise<void> => {
        expect(await backend.supports(PHANTASMAL_IMAGE_TABLE)).toEqual([]);
        const opened = await backend.open(PHANTASMAL_IMAGE_TABLE);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let imageOid: string | null = null;
        let wallOid: string | null = null;
        let answeredReplacement = false;
        let selectedCopy = false;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no Phantasmal Image decision');
          const imageOnBattlefield =
            imageOid === null
              ? undefined
              : session.view.seats[0].battlefield.find((card) => card.oid === imageOid);
          const declinedIntoGraveyard =
            imageOid !== null && session.view.seats[0].graveyard.some((card) => card.oid === imageOid);
          const outcome = accept ? imageOnBattlefield !== undefined : declinedIntoGraveyard;
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move = pregameOrManaPayment(decision);
          if (decision.kind === 'confirm-replacement' && imageOid !== null) {
            move = decision.options.find((option) =>
              accept ? option.text === 'Apply the replacement' : option.text === 'Decline the replacement',
            )?.id;
            answeredReplacement = move !== undefined;
          } else if (decision.kind === 'entity-selection' && accept && imageOid !== null) {
            const wall = decision.options.find((option) => option.targets[0]?.oid === wallOid);
            expect(wall, trace.at(-1)).toBeDefined();
            move = wall!.id;
            selectedCopy = true;
          } else if (decision.kind === 'combat-attackers') {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const walls = session.view.seats[0].battlefield.filter((card) => card.name === 'Wall of Omens');
            const castWall =
              walls.length < 2 && untappedSources(session, 'Tundra') >= 2
                ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))
                : undefined;
            const imageInHand = session.view.seats[0].hand?.find((card) => card.name === 'Phantasmal Image');
            const castImage =
              walls.length >= 2 && imageOid === null && untappedSources(session, 'Tundra') >= 2
                ? decision.options.find((option) => option.text.startsWith('Phantasmal Image:'))
                : undefined;
            move =
              (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === 'Play Tundra')?.id ??
              castWall?.id ??
              castImage?.id ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
            if (castImage !== undefined && move === castImage.id) {
              expect(imageInHand, trace.at(-1)).toBeDefined();
              imageOid = imageInHand!.oid;
              wallOid = walls[1]!.oid;
            }
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no Phantasmal Image move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
          session = advanced.session;
        }
        const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(imageOid, evidence).toMatch(/^forge-card-/u);
        expect(answeredReplacement, evidence).toBe(true);
        if (accept) {
          expect(selectedCopy, evidence).toBe(true);
          expect(
            session.view.seats[0].battlefield.find((card) => card.oid === imageOid),
            evidence,
          ).toMatchObject({
            name: 'Wall of Omens',
            power: 0,
            toughness: 4,
          });
        } else {
          expect(selectedCopy, evidence).toBe(false);
          expect(
            session.view.seats[0].graveyard.map((card) => card.oid),
            evidence,
          ).toContain(imageOid);
        }
        await session.close();
      };

      await run(false);
      await run(true);
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'proves Karn Liberated restarts the game and returns an exact exiled permanent under local control',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(KARN_LIBERATED_TABLE)).toEqual([]);
      const opened = await backend.open(KARN_LIBERATED_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let karnOid: string | null = null;
      let exiledOid: string | null = null;
      let exiledName: string | null = null;
      let activatedUltimate = false;
      let restarted = false;
      let highestTurn = 0;
      const trace: string[] = [];
      const loyalty = (): number => {
        const karn = session.view.seats[0].battlefield.find((card) => card.oid === karnOid);
        return Object.entries(karn?.counters ?? {})
          .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
          .reduce((sum, [, count]) => sum + count, 0);
      };

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Karn Liberated decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        karnOid ??= local.battlefield.find((card) => card.name === 'Karn Liberated')?.oid ?? null;
        if (exiledOid === null && karnOid !== null) {
          const exiled = opponent.exile[0];
          if (exiled !== undefined) {
            exiledOid = exiled.oid;
            exiledName = exiled.name;
          }
        }
        restarted ||=
          activatedUltimate &&
          exiledOid !== null &&
          local.battlefield.some((card) => card.oid === exiledOid && card.name === exiledName);
        highestTurn = Math.max(highestTurn, session.view.turn.number);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const plusFour = decision.options.find(
            (option) =>
              option.text.startsWith('Karn Liberated:') &&
              option.text.includes('exiles a card from their hand'),
          );
          const ultimate = decision.options.find(
            (option) => option.text.startsWith('Karn Liberated:') && option.text.includes('Restart the game'),
          );
          move =
            (restarted ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (karnOid !== null && exiledOid !== null && loyalty() >= 14 ? ultimate?.id : undefined) ??
            (karnOid !== null && loyalty() < 14 ? plusFour?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Ancient Tomb')?.id ??
            (karnOid === null && untappedSources(session, 'Ancient Tomb') >= 4
              ? decision.options.find((option) => option.text.startsWith('Karn Liberated:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activatedUltimate ||= move !== undefined && move === ultimate?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Karn Liberated move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(karnOid, evidence).toMatch(/^forge-card-/u);
      expect(exiledOid, evidence).toMatch(/^forge-card-/u);
      expect(exiledName, evidence).toMatch(/^(?:Mountain|Wall of Omens)$/u);
      expect(highestTurn, evidence).toBeGreaterThanOrEqual(5);
      expect(activatedUltimate, evidence).toBe(true);
      expect(restarted, evidence).toBe(true);
    },
    360_000,
  );

  forgeIt(
    'proves Rattleclaw Mystic face-down cast, face-up special action, and three-color mana trigger',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(RATTLECLAW_MYSTIC_TABLE)).toEqual([]);
      const opened = await backend.open(RATTLECLAW_MYSTIC_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let mysticOid: string | null = null;
      let castFaceDown = false;
      let observedFaceDown = false;
      let turnedFaceUp = false;
      let boltCast = false;
      const opponentLifeBefore = session.view.seats[1].life;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Rattleclaw Mystic decision');
        const local = session.view.seats[0];
        mysticOid ??= local.hand?.find((card) => card.name === 'Rattleclaw Mystic')?.oid ?? null;
        const mystic = local.battlefield.find((card) => card.oid === mysticOid);
        observedFaceDown ||=
          castFaceDown &&
          mystic !== undefined &&
          (mystic.name !== 'Rattleclaw Mystic' || (mystic.power === 2 && mystic.toughness === 2));
        turnedFaceUp ||=
          observedFaceDown &&
          mystic?.name === 'Rattleclaw Mystic' &&
          mystic.power === 2 &&
          mystic.toughness === 1;
        const outcome: boolean = boltCast && session.view.seats[1].life === opponentLifeBefore - 3;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const faceDown = decision.options.find(
            (option) => option.text.includes('Rattleclaw Mystic') && /face down|morph/iu.test(option.text),
          );
          const faceUp = decision.options.find((option) => /turn.*face up/iu.test(option.text));
          const bolt = decision.options.find((option) => option.text.startsWith('Lightning Bolt:'));
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (turnedFaceUp && !boltCast ? bolt?.id : undefined) ??
            (observedFaceDown && !turnedFaceUp && untappedSources(session, 'Ancient Tomb') >= 1
              ? faceUp?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Ancient Tomb')?.id ??
            (!castFaceDown && untappedSources(session, 'Ancient Tomb') >= 2 ? faceDown?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          castFaceDown ||= move !== undefined && move === faceDown?.id;
          boltCast ||= move !== undefined && move === bolt?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Rattleclaw Mystic move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(mysticOid, evidence).toMatch(/^forge-card-/u);
      expect(castFaceDown, evidence).toBe(true);
      expect(observedFaceDown, evidence).toBe(true);
      expect(turnedFaceUp, evidence).toBe(true);
      expect(boltCast, evidence).toBe(true);
      expect(session.view.seats[1].life, evidence).toBe(opponentLifeBefore - 3);
    },
    360_000,
  );

  forgeIt(
    'proves Lightning Phoenix decline and paid return through exact graveyard and battlefield identity',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(LIGHTNING_PHOENIX_TABLE)).toEqual([]);
      const opened = await backend.open(LIGHTNING_PHOENIX_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let phoenixOid: string | null = null;
      let discarded = false;
      let declined = false;
      let observedDecline = false;
      let accepted = false;
      let returned = false;
      let riftsCast = 0;
      let lastRiftTurn = -1;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Lightning Phoenix decision');
        const local = session.view.seats[0];
        phoenixOid ??= local.hand?.find((card) => card.name === 'Lightning Phoenix')?.oid ?? null;
        const phoenixInGraveyard = local.graveyard.some((card) => card.oid === phoenixOid);
        observedDecline ||= declined && phoenixInGraveyard;
        returned ||=
          accepted &&
          local.battlefield.some(
            (card) =>
              card.oid === phoenixOid &&
              card.name === 'Lightning Phoenix' &&
              card.power === 2 &&
              card.toughness === 2,
          );
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'cost-discard-selection') {
          const phoenix = decision.options.find((option) => option.targets[0]?.oid === phoenixOid);
          if (phoenix !== undefined) {
            move = phoenix.id;
            discarded = true;
          }
        } else if (decision.kind === 'confirm-trigger') {
          if (!declined) {
            move = decision.options.find((option) => option.text === 'Decline the trigger')?.id;
            declined = true;
          } else {
            move = decision.options.find((option) => option.text === 'Use the trigger')?.id;
            accepted = move !== undefined;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const thrill = decision.options.find((option) => option.text.startsWith('Thrill of Possibility:'));
          const rift = decision.options.find((option) => option.text.startsWith('Flame Rift:'));
          move =
            (returned ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (!discarded && phoenixOid !== null && untappedSources(session, 'Mountain') >= 2
              ? thrill?.id
              : undefined) ??
            (discarded &&
            riftsCast < 2 &&
            lastRiftTurn !== session.view.turn.number &&
            untappedSources(session, 'Mountain') >= 3
              ? rift?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move !== undefined && move === rift?.id) {
            riftsCast += 1;
            lastRiftTurn = session.view.turn.number;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Lightning Phoenix move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-200).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(phoenixOid, evidence).toMatch(/^forge-card-/u);
      expect(discarded, evidence).toBe(true);
      expect(declined, evidence).toBe(true);
      expect(observedDecline, evidence).toBe(true);
      expect(accepted, evidence).toBe(true);
      expect(returned, evidence).toBe(true);
      expect(riftsCast, evidence).toBeGreaterThanOrEqual(2);
    },
    360_000,
  );

  forgeIt(
    'proves Glorybringer decline, exact exert identity, damage target, and skipped untap',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(GLORYBRINGER_EXERT_TABLE)).toEqual([]);
      const opened = await backend.open(GLORYBRINGER_EXERT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let glorybringerOid: string | null = null;
      let declined = false;
      let declineProvedBySecondAttack = false;
      let exerted = false;
      let exertTurn = -1;
      let targetOid: string | null = null;
      let damageObserved = false;
      let skippedUntap = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Glorybringer decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        glorybringerOid ??=
          local.hand?.find((card) => card.name === 'Glorybringer')?.oid ??
          local.battlefield.find((card) => card.name === 'Glorybringer')?.oid ??
          null;
        const glorybringer = local.battlefield.find((card) => card.oid === glorybringerOid);
        damageObserved ||= targetOid !== null && opponent.graveyard.some((card) => card.oid === targetOid);
        skippedUntap ||=
          exerted &&
          damageObserved &&
          session.view.turn.active === 0 &&
          session.view.turn.number > exertTurn &&
          glorybringer?.tapped === true;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-exert') {
          const exact = decision.options.find(
            (option) =>
              option.targets[0]?.oid === glorybringerOid && option.targets[0]?.name === 'Glorybringer',
          );
          expect(exact, trace.slice(-20).join('\n')).toBeDefined();
          if (!declined) {
            move = decision.options.find((option) => option.id === 'combat-exert-done')?.id;
            declined = move !== undefined;
          } else {
            declineProvedBySecondAttack = true;
            move = exact!.id;
            exerted = true;
            exertTurn = session.view.turn.number;
          }
        } else if (decision.kind === 'target-selection') {
          if (!exerted) throw new Error(`Glorybringer targeted before exert\n${trace.slice(-30).join('\n')}`);
          const target = decision.options.find((option) => option.targets[0]?.name === 'Wall of Omens');
          expect(target, trace.slice(-30).join('\n')).toBeDefined();
          targetOid = target!.targets[0]!.oid;
          move = target!.id;
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') && option.targets[0]?.oid === glorybringerOid,
          );
          move = add?.id ?? decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          move =
            (skippedUntap ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (glorybringer === undefined && untappedSources(session, 'Mountain') >= 5
              ? decision.options.find((option) => option.text.startsWith('Glorybringer:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Glorybringer move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(glorybringerOid, evidence).toMatch(/^forge-card-/u);
      expect(declined, evidence).toBe(true);
      expect(declineProvedBySecondAttack, evidence).toBe(true);
      expect(exerted, evidence).toBe(true);
      expect(targetOid, evidence).toMatch(/^forge-card-/u);
      expect(damageObserved, evidence).toBe(true);
      expect(skippedUntap, evidence).toBe(true);
    },
    360_000,
  );

  // Quarantined: mtg-0qgn7. This test needs Baral, Chief of Compliance to
  // survive to see two countered Lightning Bolts (one confirm-trigger
  // decline, one pay). A debug-instrumented solo run showed the real
  // sequence: Baral is cast turn 7, triggers once countering the AI's
  // first Bolt, then the AI's very next Bolt kills the now-tapped-out,
  // 1-toughness Baral outright (life total unchanged across the
  // transition -- a creature kill, not a face hit) instead of hitting the
  // player. Baral is never seen on the battlefield again for the rest of
  // the game. This is sound Forge AI play, not a pilot or bridge bug; see
  // mtg-0qgn7 for the full evidence trail and possible fixes.
  forgeIt.skip(
    'proves Baral declines or pays the exact draw before an exact hand discard',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BARAL_TRIGGERED_LOOT_TABLE)).toEqual([]);
      const opened = await backend.open(BARAL_TRIGGERED_LOOT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let baralOid: string | null = null;
      let counteredTriggers = 0;
      let declined = false;
      let declineObserved = false;
      let declineLibrary = -1;
      let paid = false;
      let paidLibrary = -1;
      let drewBeforeDiscard = false;
      let discardedOid: string | null = null;
      let discardObserved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Baral decision');
        const local = session.view.seats[0];
        baralOid ??=
          local.hand?.find((card) => card.name === 'Baral, Chief of Compliance')?.oid ??
          local.battlefield.find((card) => card.name === 'Baral, Chief of Compliance')?.oid ??
          null;
        declineObserved ||= declined && !paid && local.librarySize === declineLibrary;
        discardObserved ||=
          discardedOid !== null && local.graveyard.some((card) => card.oid === discardedOid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.active}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'confirm-trigger') {
          counteredTriggers += 1;
          if (!declined) {
            declineLibrary = local.librarySize;
            move = decision.options.find((option) => option.text === 'Decline the trigger')?.id;
            declined = move !== undefined;
          } else {
            paidLibrary = local.librarySize;
            move = decision.options.find((option) => option.text === 'Use the trigger')?.id;
            paid = move !== undefined;
          }
        } else if (decision.kind === 'hand-card-selection') {
          drewBeforeDiscard ||= paid && local.librarySize === paidLibrary - 1;
          const discard = decision.options.find(
            (option) => option.targets[0]?.oid !== baralOid && option.targets[0]?.name === 'Island',
          );
          expect(discard, trace.slice(-40).join('\n')).toBeDefined();
          discardedOid = discard!.targets[0]!.oid;
          move = discard!.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Lightning Bolt')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const baral = local.battlefield.find((card) => card.oid === baralOid);
          const counterspell = decision.options.find((option) => option.text.startsWith('Counterspell:'));
          const baralCast = decision.options.find((option) =>
            option.text.startsWith('Baral, Chief of Compliance:'),
          );
          const boltOnStack = session.view.stack.some((object) => object.name === 'Lightning Bolt');
          const counterOnStack = session.view.stack.some((object) => object.name === 'Counterspell');
          move =
            (discardObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (baral !== undefined && boltOnStack && !counterOnStack && counteredTriggers < 2
              ? counterspell?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (baral === undefined && untappedSources(session, 'Island') >= 4 ? baralCast?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Baral move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(baralOid, evidence).toMatch(/^forge-card-/u);
      expect(counteredTriggers, evidence).toBe(2);
      expect(declined, evidence).toBe(true);
      expect(declineObserved, evidence).toBe(true);
      expect(paid, evidence).toBe(true);
      expect(drewBeforeDiscard, evidence).toBe(true);
      expect(discardedOid, evidence).toMatch(/^forge-card-/u);
      expect(discardObserved, evidence).toBe(true);
    },
    360_000,
  );

  forgeIt(
    'proves Nahiri declines or pays the exact discard before drawing',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(NAHIRI_UNLESS_COST_TABLE)).toEqual([]);
      const opened = await backend.open(NAHIRI_UNLESS_COST_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let nahiriOid: string | null = null;
      let declined = false;
      let declineObserved = false;
      let declineTurn = -1;
      let declineLibrary = -1;
      let declineHand: readonly string[] = [];
      let selectedOid: string | null = null;
      let paid = false;
      let paidLibrary = -1;
      let paidOutcome = false;
      const trace: string[] = [];
      const loyalty = (): number => {
        const nahiri = session.view.seats[0].battlefield.find((card) => card.oid === nahiriOid);
        if (nahiri === undefined) return 0;
        return Object.entries(nahiri.counters)
          .filter(([kind]) => kind.toUpperCase().includes('LOYALTY'))
          .reduce((sum, [, count]) => sum + count, 0);
      };

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Nahiri decision');
        const local = session.view.seats[0];
        nahiriOid ??= local.battlefield.find((card) => card.name === 'Nahiri, the Harbinger')?.oid ?? null;
        if (
          declined &&
          !declineObserved &&
          session.view.turn.number === declineTurn &&
          session.view.stack.length === 0
        ) {
          const currentHand = local.hand?.map((card) => card.oid) ?? [];
          declineObserved =
            local.librarySize === declineLibrary &&
            currentHand.length === declineHand.length &&
            declineHand.every((oid) => currentHand.includes(oid)) &&
            loyalty() === 6;
        }
        if (
          paid &&
          selectedOid !== null &&
          local.graveyard.some((card) => card.oid === selectedOid) &&
          local.librarySize === paidLibrary - 1 &&
          loyalty() === 8
        ) {
          paidOutcome = true;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'cost-card-selection' && decision.prompt.startsWith('Nahiri')) {
          if (!declined) {
            declineTurn = session.view.turn.number;
            declineLibrary = local.librarySize;
            declineHand = local.hand?.map((card) => card.oid) ?? [];
            move = decision.options.find((option) => option.id === 'cost-card-selection-done')?.id;
            declined = move !== undefined;
          } else {
            const selected = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name !== 'Nahiri, the Harbinger',
            );
            selectedOid = selected?.targets[0]?.oid ?? null;
            paidLibrary = local.librarySize;
            move = selected?.id;
            paid = move !== undefined;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const plusTwo = decision.options.find(
            (option) =>
              option.text.startsWith('Nahiri, the Harbinger:') && option.text.includes('discard a card'),
          );
          move =
            (paidOutcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (nahiriOid !== null && (!declined || (declineObserved && !paid)) ? plusTwo?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plateau')?.id ??
            (nahiriOid === null && untappedSources(session, 'Plateau') >= 4
              ? decision.options.find((option) => option.text.startsWith('Nahiri, the Harbinger:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Nahiri move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-200).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-300).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(nahiriOid, evidence).toMatch(/^forge-card-/u);
      expect(declined, evidence).toBe(true);
      expect(declineObserved, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(paid, evidence).toBe(true);
      expect(paidOutcome, evidence).toBe(true);
    },
    360_000,
  );

  forgeIt(
    'proves Esper Sentinel draws only when its exact dynamic mana payment is declined',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ESPER_SENTINEL_UNLESS_COST_TABLE)).toEqual([]);

      const runRoute = async (route: 'decline' | 'pay') => {
        const opened = await backend.open(ESPER_SENTINEL_UNLESS_COST_TABLE);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let answered = false;
        let libraryBefore = -1;
        let outcome = false;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no Esper Sentinel decision');
          const local = session.view.seats[0];
          const opponent = session.view.seats[1];
          if (
            answered &&
            local.battlefield.some((card) => card.name === 'Everflowing Chalice') &&
            opponent.librarySize === libraryBefore - (route === 'decline' ? 1 : 0)
          ) {
            outcome = true;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );

          let move = pregameOrManaPayment(decision);
          if (decision.kind === 'mana-payment' && decision.prompt.startsWith('Esper Sentinel')) {
            libraryBefore = opponent.librarySize;
            move = decision.options.find((option) =>
              route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
            )?.id;
            answered = move !== undefined;
          } else if (decision.kind === 'combat-attackers') {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const sentinelPresent = opponent.battlefield.some((card) => card.name === 'Esper Sentinel');
            move =
              (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === 'Play Mountain')?.id ??
              (sentinelPresent && untappedSources(session, 'Mountain') >= 1
                ? decision.options.find((option) => option.text.startsWith('Everflowing Chalice:'))?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no Esper Sentinel move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-160).join('\n')}`);
          session = advanced.session;
        }
        const evidence = `${trace.slice(-220).join('\n')}\nview=${JSON.stringify(session.view)}`;
        expect(answered, evidence).toBe(true);
        expect(libraryBefore, evidence).toBeGreaterThan(0);
        expect(outcome, evidence).toBe(true);
        await session.close();
      };

      await runRoute('decline');
      await runRoute('pay');
    },
    360_000,
  );

  forgeIt(
    "proves Archon of Cruelty's triggered player target from the resulting zones and life totals",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ARCHON_TRIGGER_COMPOSITION_TABLE)).toEqual([]);
      const opened = await backend.open(ARCHON_TRIGGER_COMPOSITION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let before: { localLife: number; opponentLife: number; opposingCreatures: number } | null = null;
      let resolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        if (before !== null) {
          const opposingCreatures = session.view.seats[1].battlefield.filter((card) =>
            card.typeLine.includes('Creature'),
          ).length;
          resolved =
            session.view.seats[0].life === before.localLife + 3 &&
            session.view.seats[1].life === before.opponentLife - 3 &&
            opposingCreatures === before.opposingCreatures - 1;
        }
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const opponent = decision.options.find((option) => option.id === 'target-player-1');
          expect(opponent).toBeDefined();
          before = {
            localLife: session.view.seats[0].life,
            opponentLife: session.view.seats[1].life,
            opposingCreatures: session.view.seats[1].battlefield.filter((card) =>
              card.typeLine.includes('Creature'),
            ).length,
          };
          expect(before.opposingCreatures).toBeGreaterThan(0);
          move = opponent!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const swamps = untappedSources(session, 'Swamp');
          move =
            (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (swamps >= 8
              ? decision.options.find((option) => option.text.startsWith('Archon of Cruelty:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      expect({ before, resolved }, trace.slice(-120).join('\n')).toMatchObject({
        before: expect.any(Object),
        resolved: true,
      });
    },
    240_000,
  );

  forgeIt(
    "proves Sheoldred's graveyard trigger returns the exact selected creature",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(SHEOLDRED_TRIGGER_COMPOSITION_TABLE)).toEqual([]);
      const opened = await backend.open(SHEOLDRED_TRIGGER_COMPOSITION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let entombedOid: string | null = null;
      let targetedOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'zone-card-selection') {
          const griselbrand = decision.options.find((option) => option.targets[0]?.name === 'Griselbrand');
          expect(griselbrand).toBeDefined();
          entombedOid = griselbrand!.targets[0]!.oid;
          move = griselbrand!.id;
        } else if (decision.kind === 'target-selection') {
          const griselbrand = decision.options.find(
            (option) => option.targets[0]?.oid === entombedOid && option.targets[0]?.name === 'Griselbrand',
          );
          expect(griselbrand).toBeDefined();
          targetedOid = griselbrand!.targets[0]!.oid;
          move = griselbrand!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const swamps = untappedSources(session, 'Swamp');
          const returned =
            targetedOid !== null &&
            session.view.seats[0].battlefield.some((card) => card.oid === targetedOid);
          move =
            (returned ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (entombedOid === null && swamps >= 1
              ? decision.options.find((option) => option.text.startsWith('Entomb:'))?.id
              : undefined) ??
            (entombedOid !== null && swamps >= 7
              ? decision.options.find((option) => option.text.startsWith('Sheoldred, Whispering One:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-120).join('\n');
      expect({ entombedOid, targetedOid }, evidence).toMatchObject({
        entombedOid: expect.stringMatching(/^forge-card-/u),
        targetedOid: expect.stringMatching(/^forge-card-/u),
      });
      expect(targetedOid, evidence).toBe(entombedOid);
      expect(
        session.view.seats[0].battlefield.map((card) => card.oid),
        evidence,
      ).toContain(targetedOid);
    },
    240_000,
  );

  forgeIt(
    "proves Ulamog's cast trigger destroys the exact selected permanent",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ULAMOG_TRIGGER_COMPOSITION_TABLE)).toEqual([]);
      const opened = await backend.open(ULAMOG_TRIGGER_COMPOSITION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let targetOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const mountain = decision.options.find((option) => option.targets[0]?.name === 'Mountain');
          expect(mountain).toBeDefined();
          targetOid = mountain!.targets[0]!.oid;
          move = mountain!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const forests = untappedSources(session, 'Forest');
          const destroyed =
            targetOid !== null && !session.view.seats[1].battlefield.some((card) => card.oid === targetOid);
          move =
            (destroyed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (forests >= 11
              ? decision.options.find((option) => option.text.startsWith('Ulamog, the Infinite Gyre:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-120).join('\n');
      expect(targetOid, evidence).toEqual(expect.stringMatching(/^forge-card-/u));
      expect(
        session.view.seats[1].battlefield.map((card) => card.oid),
        evidence,
      ).not.toContain(targetOid);
      expect(
        session.view.seats[1].graveyard.map((card) => card.oid),
        evidence,
      ).toContain(targetOid);
    },
    300_000,
  );

  forgeIt(
    'cancels partial ordinary mana payment through Forge rollback semantics',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      const opened = await backend.open(MANA_PAYMENT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let activated = false;
      let canceled = false;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter(
            (card) => card.name === 'Copperline Gorge',
          ).length;
          if (canceled) {
            expect(
              session.view.seats[0].battlefield
                .filter((card) => card.name === 'Copperline Gorge')
                .every((card) => !card.tapped),
            ).toBe(true);
            expect(session.view.seats[0].hand?.some((card) => card.name === 'Flame Rift')).toBe(true);
            break;
          }
          move =
            decision.options.find((option) => option.text === 'Play Copperline Gorge')?.id ??
            (lands >= 2
              ? decision.options.find((option) => option.text.startsWith('Flame Rift:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          if (!activated) {
            move = decision.options.find(
              (option) => option.targets[0]?.name === 'Copperline Gorge' && option.text.includes('{G}'),
            )?.id;
            activated = true;
          } else {
            move = decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
            canceled = true;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(activated).toBe(true);
      expect(canceled).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'pays from every pinned intrinsic basic-land source',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      for (const testCase of BASIC_MANA_CASES) {
        const table: SessionSpec = {
          ...TABLE,
          seats: [
            {
              ...TABLE.seats[0],
              deck: {
                name: `human-${testCase.land.toLowerCase()}-payment`,
                cards: [
                  { name: testCase.land, count: 24 },
                  { name: testCase.spell, count: 36 },
                ],
              },
            },
            TABLE.seats[1],
          ],
          seed: `1544-basic-payment-${testCase.land.toLowerCase()}`,
          maximumTurns: 8,
        };
        expect(await backend.supports(table)).toEqual([]);
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        let session: ObservedSession = opened.session;
        let paidFromBasic = false;
        for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no decision');
          let move = decision.options.find(
            (option) => option.text === 'Play first' || option.text === 'Keep this hand',
          )?.id;
          if (decision.kind === 'priority') {
            const lands = session.view.seats[0].battlefield.filter(
              (card) => card.name === testCase.land,
            ).length;
            move =
              decision.options.find((option) => option.text === `Play ${testCase.land}`)?.id ??
              (lands >= 2 && !paidFromBasic
                ? decision.options.find((option) => option.text.startsWith(`${testCase.spell}:`))?.id
                : undefined) ??
              (paidFromBasic
                ? decision.options.find((option) => option.text === 'Concede')?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          } else if (decision.kind === 'mana-payment') {
            const source = decision.options.find(
              (option) => option.targets[0]?.name === testCase.land && option.text.includes(testCase.symbol),
            );
            expect(source, `${testCase.land} did not offer ${testCase.symbol}`).toBeDefined();
            expect(source!.targets[0]!.oid).toMatch(/^forge-card-/u);
            paidFromBasic = true;
            move = source!.id;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
        }
        expect(paidFromBasic, testCase.land).toBe(true);
        expect(session.status).toBe('finished');
        await session.close();
      }
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'commits no attack, then one exact attacker from a larger legal subset',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ATTACKER_TABLE)).toEqual([]);
      const opened = await backend.open(ATTACKER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let refusedTruncated = false;
      let sawNoAttack = false;
      let selectedAttackerOid: string | null = null;
      let staleSnapshot: ObservedSession | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        expect(decision.complete).toBe(true);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          const additions = decision.options.filter((option) => option.id.startsWith('combat-attack-add-'));
          const commit = decision.options.find((option) => option.id === 'combat-attackers-commit');
          if (!refusedTruncated && additions.length > 0) {
            expect(await session.submit('combat-attack-add-truncated')).toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            refusedTruncated = true;
          }
          if (!sawNoAttack) {
            expect(commit?.text).toBe('Attack with no creatures');
            move = commit?.id;
            sawNoAttack = true;
          } else if (selectedAttackerOid === null && additions.length >= 2) {
            expect(additions.every((option) => option.targets.length === 1)).toBe(true);
            expect(new Set(additions.map((option) => option.targets[0]!.oid)).size).toBe(additions.length);
            const selected = additions.at(-1)!;
            selectedAttackerOid = selected.targets[0]!.oid;
            staleSnapshot = session;
            move = selected.id;
          } else if (selectedAttackerOid !== null) {
            const remove = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-remove-') &&
                option.targets[0]?.oid === selectedAttackerOid,
            );
            if (remove !== undefined) {
              expect(commit?.text).toBe('Finish declaring attackers');
              move = commit?.id;
            } else {
              move = commit?.id;
            }
          } else {
            move = commit?.id;
          }
        } else if (decision.kind === 'priority') {
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (untappedSources(session, 'Mountain') >= 1
              ? decision.options.find((option) => option.text.startsWith('Monastery Swiftspear:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (
          staleSnapshot !== null &&
          selectedAttackerOid !== null &&
          session.decision?.kind === 'combat-attackers'
        ) {
          expect(await staleSnapshot.submit(move)).toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
        }
      }

      expect(refusedTruncated).toBe(true);
      expect(sawNoAttack).toBe(true);
      expect(selectedAttackerOid).not.toBeNull();
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'composes exact direct targeting and combat in one observed session',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(COMPOSITE_TARGET_COMBAT_TABLE)).toEqual([]);
      const opened = await backend.open(COMPOSITE_TARGET_COMBAT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let targetedForestOid: string | null = null;
      let attackedWithArborElf = false;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const forests = decision.options.filter((option) => option.targets[0]?.name === 'Forest');
          expect(forests.length).toBeGreaterThanOrEqual(2);
          expect(new Set(forests.map((option) => option.targets[0]!.oid)).size).toBe(forests.length);
          const selected = forests.at(-1)!;
          targetedForestOid = selected.targets[0]!.oid;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          const commit = decision.options.find((option) => option.id === 'combat-attackers-commit');
          if (!attackedWithArborElf) {
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') && option.targets[0]?.name === 'Arbor Elf',
            );
            if (add !== undefined) {
              attackedWithArborElf = true;
              move = add.id;
            } else {
              move = commit?.id;
            }
          } else {
            move = commit?.id;
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Forest')?.id;
        } else if (decision.kind === 'priority') {
          const forests = session.view.seats[0].battlefield.filter((card) => card.name === 'Forest').length;
          const arborElves = session.view.seats[0].battlefield.filter(
            (card) => card.name === 'Arbor Elf',
          ).length;
          const activation = decision.options.find(
            (option) => option.text.startsWith('Arbor Elf:') && option.text.includes('Untap target Forest'),
          );
          move =
            (targetedForestOid !== null && attackedWithArborElf
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (forests >= 2 && arborElves >= 2 && targetedForestOid === null ? activation?.id : undefined) ??
            (untappedSources(session, 'Forest') >= 1
              ? decision.options.find((option) => isCast(option.text, 'Arbor Elf'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(targetedForestOid).toMatch(/^forge-card-/u);
      expect(attackedWithArborElf).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'orders exact blockers and assigns legal non-default trample damage',
    async () => {
      const backend = installedForgeBackend({
        timeoutMs: 120_000,
        forceLegacyCombatOrderingForTest: true,
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(COMBAT_DAMAGE_TABLE)).toEqual([]);
      const opened = await backend.open(COMBAT_DAMAGE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let attackedWithCraterhoof = false;
      let sawOrdering = false;
      let extraDamageToFirstRecipient = false;
      let sawDefenderDamage = false;
      let refusedIllegalDamage = false;
      let refusedOverflowDamage = false;
      let paidWithColorless = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        expect(decision.complete).toBe(true);
        if (trace.length < 120) {
          trace.push(
            `${String(session.view.turn.number)} ${session.view.turn.phase}/${session.view.turn.step} ${decision.kind}` +
              ` [${session.view.seats[0].battlefield.map((card) => card.name).join(',')}]` +
              ` vs [${session.view.seats[1].battlefield.map((card) => card.name).join(',')}]: ` +
              decision.options.map((option) => option.text).join(' / '),
          );
        }
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') && option.targets[0]?.name === 'Craterhoof Behemoth',
          );
          const commit = decision.options.find((option) => option.id === 'combat-attackers-commit');
          if (add !== undefined) {
            attackedWithCraterhoof = true;
            move = add.id;
          } else {
            move = commit?.id;
          }
        } else if (
          decision.kind === 'combat-order-blockers' ||
          decision.kind === 'combat-order-attackers' ||
          decision.kind === 'combat-order-insert'
        ) {
          expect(decision.options.every((option) => option.targets.length === 1)).toBe(true);
          sawOrdering ||= decision.options.length >= 2;
          move = decision.options.at(-1)?.id;
        } else if (decision.kind === 'combat-damage') {
          const input = decision.input;
          const suggestion = input?.suggestions?.[0];
          if (input?.kind !== 'text' || suggestion === undefined) {
            throw new Error('trample assignment did not expose one complete split');
          }
          const document = JSON.parse(suggestion) as {
            readonly total: number;
            readonly recipients: readonly {
              readonly kind: 'blocker' | 'defender';
              readonly lethal: number;
            }[];
            readonly amounts: readonly number[];
          };
          let expectedRemaining = document.total;
          const expectedDefault = document.recipients.map((recipient) => {
            if (recipient.kind === 'defender') return 0;
            const amount = Math.min(recipient.lethal, expectedRemaining);
            expectedRemaining -= amount;
            return amount;
          });
          expectedDefault[expectedDefault.length - 1] = (expectedDefault.at(-1) ?? 0) + expectedRemaining;
          expect(document.amounts).toEqual(expectedDefault);
          const first = document.recipients.findIndex((recipient) => recipient.kind === 'blocker');
          const defender = document.recipients.findIndex((recipient) => recipient.kind === 'defender');
          if (first < 0 || defender < 0 || (document.amounts[defender] ?? 0) < 1) {
            throw new Error('trample assignment did not leave damage for a blocker and defender');
          }
          if (!refusedIllegalDamage) {
            const malformed = await session.submit(
              textSubmission(input, JSON.stringify({ ...document, total: 'five' })),
            );
            expect(malformed).toMatchObject({ ok: false, error: { kind: 'illegal-move' } });
            const inventedRecipient = {
              ...document,
              recipients: document.recipients.map((recipient, index) =>
                index === first ? { ...recipient, oid: 'forge-card-invented' } : recipient,
              ),
            };
            const refusedRecipient = await session.submit(
              textSubmission(input, JSON.stringify(inventedRecipient)),
            );
            expect(refusedRecipient).toMatchObject({ ok: false, error: { kind: 'illegal-move' } });
            const firstAmount = document.amounts[first] ?? 0;
            const illegal = {
              ...document,
              amounts: document.amounts.map((amount, index) =>
                index === first ? 0 : index === defender ? amount + firstAmount : amount,
              ),
            };
            const refused = await session.submit(textSubmission(input, JSON.stringify(illegal)));
            expect(refused).toMatchObject({ ok: false, error: { kind: 'illegal-move' } });
            const overflow = {
              ...document,
              amounts: document.amounts.map((_, index) =>
                index === 0 || index === 1 ? 2_147_483_647 : index === defender ? document.total + 2 : 0,
              ),
            };
            const overflowRefusal = await session.submit(textSubmission(input, JSON.stringify(overflow)));
            expect(overflowRefusal).toMatchObject({ ok: false, error: { kind: 'illegal-move' } });
            refusedOverflowDamage = true;
            refusedIllegalDamage = true;
          }
          const amounts = document.amounts.map((amount, index) =>
            index === first ? amount + 1 : index === defender ? amount - 1 : amount,
          );
          extraDamageToFirstRecipient = true;
          sawDefenderDamage = (amounts[defender] ?? 0) > 0;
          move = textSubmission(input, JSON.stringify({ ...document, amounts }));
        } else if (decision.kind === 'mana-payment') {
          const green = decision.options.find(
            (option) => option.targets[0]?.name === 'Bayou' && option.text.includes('{G}'),
          );
          const colorless = decision.options.find(
            (option) => option.targets[0]?.name === 'Ancient Tomb' && option.text.includes('{C}'),
          );
          if (green !== undefined) {
            move = green.id;
          } else if (colorless !== undefined) {
            paidWithColorless = true;
            move = colorless.id;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'priority') {
          const completeEvidence =
            attackedWithCraterhoof && sawOrdering && extraDamageToFirstRecipient && sawDefenderDamage;
          move = completeEvidence
            ? decision.options.find((option) => option.text === 'Concede')?.id
            : (decision.options.find((option) => option.text === 'Play Ancient Tomb')?.id ??
              decision.options.find((option) => option.text === 'Play Bayou')?.id ??
              (untappedSources(session, 'Bayou') >= 3 &&
              untappedSources(session, 'Bayou') + 2 * untappedSources(session, 'Ancient Tomb') >= 8
                ? decision.options.find((option) => option.text.startsWith('Craterhoof Behemoth:'))?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id);
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      const evidence = trace.join('\n');
      expect(
        {
          attackedWithCraterhoof,
          sawOrdering,
          extraDamageToFirstRecipient,
          sawDefenderDamage,
          refusedIllegalDamage,
          refusedOverflowDamage,
        },
        evidence,
      ).toEqual({
        attackedWithCraterhoof: true,
        sawOrdering: true,
        extraDamageToFirstRecipient: true,
        sawDefenderDamage: true,
        refusedIllegalDamage: true,
        refusedOverflowDamage: true,
      });
      expect(paidWithColorless).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  // Quarantined: mtg-exj2w. Same root cause as the Journey-to-Nowhere
  // quarantine above: BLOCKER_TABLE's AI opponent (24 Mountain / 36
  // Firedrinker Satyr) needs to attack with two Firedrinker Satyr so the
  // pilot can pick a duplicate-name blocker assignment. A debug-instrumented
  // solo run showed the 'combat-blockers' decision kind never fires even
  // once across the full 10-turn game -- the AI never declares an attacker
  // because it never casts a single Firedrinker Satyr, the same Forge AI
  // behavior already confirmed and filed against mtg-exj2w.
  forgeIt.skip(
    'commits one exact blocker-to-attacker assignment among duplicate names',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BLOCKER_TABLE)).toEqual([]);
      const opened = await backend.open(BLOCKER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let blockerOid: string | null = null;
      let attackerOid: string | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        expect(decision.complete).toBe(true);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-blockers') {
          const additions = decision.options.filter((option) => option.id.startsWith('combat-block-add-'));
          const commit = decision.options.find((option) => option.id === 'combat-blockers-commit');
          if (blockerOid === null && additions.length >= 2) {
            expect(additions.every((option) => option.targets.length === 2)).toBe(true);
            const selected = additions.at(-1)!;
            blockerOid = selected.targets[0]!.oid;
            attackerOid = selected.targets[1]!.oid;
            move = selected.id;
          } else if (blockerOid !== null) {
            const remove = decision.options.find(
              (option) =>
                option.id.startsWith('combat-block-remove-') &&
                option.targets[0]?.oid === blockerOid &&
                option.targets[1]?.oid === attackerOid,
            );
            if (remove !== undefined) {
              expect(commit?.text).toBe('Finish declaring blockers');
              move = commit?.id;
            } else {
              move = commit?.id;
            }
          } else {
            move = commit?.id;
          }
        } else if (decision.kind === 'priority') {
          move =
            decision.options.find((option) => option.text === 'Play Scrubland')?.id ??
            (untappedSources(session, 'Scrubland') >= 2
              ? decision.options.find((option) => option.text.startsWith('Wall of Omens:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(blockerOid).not.toBeNull();
      expect(attackerOid).not.toBeNull();
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'lets the local seat target one exact permanent among duplicate-name candidates',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(SINGLE_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(SINGLE_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      let canceledOnce = false;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const cancel = decision.options.filter((option) => option.id === 'target-cancel');
          expect(cancel).toHaveLength(1);
          expect(cancel[0]!.targets).toEqual([]);
          const mountains = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Mountain',
          );
          expect(mountains.length).toBeGreaterThanOrEqual(2);
          expect(new Set(mountains.map((option) => option.id)).size).toBe(mountains.length);
          expect(new Set(mountains.map((option) => option.targets[0]!.oid)).size).toBe(mountains.length);
          if (!canceledOnce) {
            canceledOnce = true;
            move = cancel[0]!.id;
          } else {
            selectedOid = mountains[0]!.targets[0]!.oid;
            move = mountains[0]!.id;
          }
        } else if (decision.kind === 'priority') {
          const opponentMountains = session.view.seats[1].battlefield.filter(
            (card) => card.name === 'Mountain',
          ).length;
          move =
            decision.options.find((option) => option.text === 'Play Scrubland')?.id ??
            (opponentMountains >= 2 && untappedSources(session, 'Scrubland') >= 3
              ? decision.options.find((option) => option.text.includes('Vindicate'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (move === 'target-cancel') {
          expect(session.view.stack.every((card) => card.name !== 'Vindicate')).toBe(true);
          expect(session.view.seats[0].hand?.some((card) => card.name === 'Vindicate')).toBe(true);
        }
      }

      expect(canceledOnce).toBe(true);
      expect(selectedOid).not.toBeNull();
      expect(session.view.seats[1].graveyard.map((card) => card.oid)).toContain(selectedOid);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'lets mandatory Entomb choose one exact duplicate-name library card',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ENTOMB_TABLE)).toEqual([]);
      const opened = await backend.open(ENTOMB_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 250; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'zone-card-selection') {
          expect(decision.options.some((option) => option.id === 'zone-decline')).toBe(false);
          const entombs = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Entomb',
          );
          expect(entombs.length).toBeGreaterThanOrEqual(2);
          expect(new Set(entombs.map((option) => option.id)).size).toBe(entombs.length);
          expect(new Set(entombs.map((option) => option.targets[0]!.oid)).size).toBe(entombs.length);
          selectedOid = entombs[0]!.targets[0]!.oid;
          move = entombs[0]!.id;
        } else if (decision.kind === 'priority') {
          const hasLand = untappedSources(session, 'Badlands') >= 1;
          move =
            decision.options.find((option) => option.text === 'Play Badlands')?.id ??
            (hasLand && selectedOid === null
              ? decision.options.find((option) => option.text.includes('Entomb'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(selectedOid).not.toBeNull();
      expect(session.view.seats[0].graveyard.map((card) => card.oid)).toContain(selectedOid);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'lets a restricted Farseek decline once and then choose one exact land',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FARSEEK_TABLE)).toEqual([]);
      const opened = await backend.open(FARSEEK_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let declined = false;
      let selectedOid: string | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 350; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'zone-card-selection') {
          const decline = decision.options.filter((option) => option.id === 'zone-decline');
          expect(decline).toHaveLength(1);
          expect(decline[0]!.targets).toEqual([]);
          const bayous = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Bayou',
          );
          expect(bayous.length).toBeGreaterThanOrEqual(2);
          expect(new Set(bayous.map((option) => option.targets[0]!.oid)).size).toBe(bayous.length);
          if (!declined) {
            declined = true;
            move = decline[0]!.id;
          } else {
            selectedOid = bayous[0]!.targets[0]!.oid;
            move = bayous[0]!.id;
          }
        } else if (decision.kind === 'priority') {
          const lands = untappedSources(session, 'Bayou');
          move =
            decision.options.find((option) => option.text === 'Play Bayou')?.id ??
            (lands >= 2 && selectedOid === null
              ? decision.options.find((option) => option.text.includes('Farseek'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      expect(declined).toBe(true);
      expect(selectedOid).not.toBeNull();
      expect(session.view.seats[0].battlefield.map((card) => card.oid)).toContain(selectedOid);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'cancels and recasts Counterspell before selecting the exact stack object',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(STACK_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(STACK_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let canceled = false;
      let selectedOid: string | null = null;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          const cancel = decision.options.filter((option) => option.id === 'target-cancel');
          expect(cancel).toHaveLength(1);
          const explores = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Explore',
          );
          expect(explores).toHaveLength(1);
          expect(session.view.stack.map((card) => card.oid)).toContain(explores[0]!.targets[0]!.oid);
          if (!canceled) {
            canceled = true;
            move = cancel[0]!.id;
          } else {
            selectedOid = explores[0]!.targets[0]!.oid;
            move = explores[0]!.id;
          }
        } else if (decision.kind === 'priority') {
          move =
            decision.options.find((option) => option.text === 'Play Tundra')?.id ??
            (session.view.stack.some((card) => card.name === 'Explore') &&
            selectedOid === null &&
            untappedSources(session, 'Tundra') >= 2
              ? decision.options.find((option) => option.text.includes('Counterspell'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (move === 'target-cancel') {
          expect(session.view.stack.some((card) => card.name === 'Explore')).toBe(true);
          expect(session.view.seats[0].hand?.some((card) => card.name === 'Counterspell')).toBe(true);
        }
      }

      expect(canceled).toBe(true);
      expect(selectedOid).not.toBeNull();
      expect(session.view.seats[1].graveyard.map((card) => card.oid)).toContain(selectedOid);

      // The graveyard alone proves nothing: a countered Explore and a resolved
      // Explore both end there. What separates them is whether the spell this
      // seat named ever resolved, and the game log answers that per card
      // instance -- the chosen Explore's oid belongs to that one object and to
      // no later copy of the card.
      //
      // Before `collectStackTargets`, the bridge offered the Card on the stack
      // rather than the SpellAbility, every reader of a stack target went
      // through `TargetChoices#getTargetSpells()` and found nothing, and the
      // measured log was `Resolve Stack: Counterspell (52) - Counter.`
      // immediately followed by `Resolve Stack: Explore (109) - ... draws a
      // card.` The seat countered a spell and the spell resolved anyway.
      const resolved = session.events.filter((event) => event.type === 'Resolve Stack');
      const instance = `Explore (${selectedOid!.replace('forge-card-', '')})`;
      expect(
        resolved.map((event) => event.text).filter((text) => text.includes(`Counter ${instance}`)),
        'the Counterspell resolved without countering the spell this seat named',
      ).toHaveLength(1);
      expect(
        resolved.map((event) => event.text).filter((text) => text.startsWith(instance)),
        'the Explore this seat countered resolved anyway',
      ).toEqual([]);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'chooses one exact duplicate-name battlefield target for a mandatory trigger and then attacks',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TRIGGER_TARGET_BATTLEFIELD_TABLE)).toEqual([]);
      const opened = await backend.open(TRIGGER_TARGET_BATTLEFIELD_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      let attacked = false;
      let orderedTriggers = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 600; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(false);
          const aspirants = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Luminarch Aspirant',
          );
          expect(aspirants.length).toBeGreaterThanOrEqual(1);
          if (aspirants.length >= 2 && selectedOid === null) {
            expect(new Set(aspirants.map((option) => option.id)).size).toBe(aspirants.length);
            expect(new Set(aspirants.map((option) => option.targets[0]!.oid)).size).toBe(aspirants.length);
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            const selected = aspirants[0]!;
            selectedOid = selected.targets[0]!.oid;
            staleSnapshot = session;
            staleMove = selected.id;
            move = selected.id;
          } else {
            move = aspirants[0]!.id;
          }
        } else if (decision.kind === 'trigger-order') {
          expect(decision.options.length).toBeGreaterThanOrEqual(2);
          expect(new Set(decision.options.map((option) => option.id)).size).toBe(decision.options.length);
          expect(decision.options.every((option) => option.targets[0]?.name === 'Luminarch Aspirant')).toBe(
            true,
          );
          await expect(session.submit('trigger-order-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          orderedTriggers = true;
          move = decision.options[0]?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const attacker = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') && option.targets[0]?.name === 'Luminarch Aspirant',
          );
          if (selectedOid !== null && !attacked && attacker !== undefined) {
            attacked = true;
            move = attacker.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const lands = untappedSources(session, 'Plains');
          const aspirants = battlefield.filter((card) => card.name === 'Luminarch Aspirant').length;
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (lands >= 2 && aspirants < 2
              ? decision.options.find((option) => option.text.startsWith('Luminarch Aspirant:'))?.id
              : undefined) ??
            (selectedOid !== null && attacked
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (selectedOid === null)
        throw new Error(`never reached duplicate trigger targets\n${trace.join('\n')}`);
      expect(selectedOid).toMatch(/^forge-card-/u);
      expect(attacked).toBe(true);
      expect(orderedTriggers).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  // Quarantined: mtg-exj2w. This test needs the AI opponent (30 Mountain /
  // 30 Firedrinker Satyr) to have >=2 Firedrinker Satyr on its battlefield
  // so the pilot can cast Journey to Nowhere at a duplicate-name target.
  // Debug instrumentation logging opponent battlefield/hand/graveyard state
  // on every priority decision showed satyrs=0 across all 101+ priority
  // decisions for the full 12-turn, 800-submission-cap game. The opponent
  // is not inert -- its Mountain count climbs normally and hand size holds
  // steady around 7-8, consistent with normal draw and discard-to-hand-size
  // -- it simply never casts a Firedrinker Satyr. This is Forge's own
  // (vendored) AI decision-making, not a pilot or bridge bug; see mtg-exj2w
  // for the evidence trail and possible fixes.
  forgeIt.skip(
    'chooses one exact duplicate-name target for a top-level enchantment trigger',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TRIGGER_TARGET_ENCHANTMENT_TABLE)).toEqual([]);
      const opened = await backend.open(TRIGGER_TARGET_ENCHANTMENT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      let targetLeftBattlefield = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(false);
          const satyrs = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Firedrinker Satyr',
          );
          expect(satyrs.length).toBeGreaterThanOrEqual(2);
          expect(new Set(satyrs.map((option) => option.id)).size).toBe(satyrs.length);
          expect(new Set(satyrs.map((option) => option.targets[0]!.oid)).size).toBe(satyrs.length);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = satyrs.at(-1)!;
          selectedOid = selected.targets[0]!.oid;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const opponentSatyrs = session.view.seats[1].battlefield.filter(
            (card) => card.name === 'Firedrinker Satyr',
          );
          if (
            selectedOid !== null &&
            !session.view.stack.some((card) => card.name === 'Journey to Nowhere') &&
            !opponentSatyrs.some((card) => card.oid === selectedOid)
          ) {
            targetLeftBattlefield = true;
          }
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (selectedOid === null && opponentSatyrs.length >= 2
              ? decision.options.find((option) => option.text.startsWith('Journey to Nowhere:'))?.id
              : undefined) ??
            (targetLeftBattlefield
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (selectedOid === null) throw new Error(`never reached Journey trigger targets\n${trace.join('\n')}`);
      expect(selectedOid).toMatch(/^forge-card-/u);
      expect(targetLeftBattlefield).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'levels Paladin Class and resolves its installed trigger through one exact attacking target',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(PALADIN_CLASS_TABLE)).toEqual([]);
      const opened = await backend.open(PALADIN_CLASS_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let submittedLevelTwo = false;
      let submittedLevelThree = false;
      let levelThreeResolved = false;
      let selectedOid: string | null = null;
      let selectedBoostObserved = false;
      let lifeBeforeAttack: number | null = null;
      let doubleStrikeDamageObserved = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const attacking = new Set<string>();
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(submittedLevelThree).toBe(true);
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(false);
          const figures = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Figure of Destiny',
          );
          expect(figures).toHaveLength(2);
          expect(new Set(figures.map((option) => option.id)).size).toBe(2);
          expect(new Set(figures.map((option) => option.targets[0]!.oid)).size).toBe(2);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = figures[1]!;
          selectedOid = selected.targets[0]!.oid;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const figures = session.view.seats[0].battlefield.filter(
            (card) => card.name === 'Figure of Destiny',
          );
          if (levelThreeResolved && figures.length >= 2 && attacking.size < 2) {
            const next = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets[0]?.name === 'Figure of Destiny' &&
                !attacking.has(option.targets[0].oid),
            );
            if (next !== undefined) {
              attacking.add(next.targets[0]!.oid);
              move = next.id;
            }
          }
          if (move === undefined) {
            if (attacking.size === 2 && lifeBeforeAttack === null) {
              lifeBeforeAttack = session.view.seats[1].life;
            }
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const plains = untappedSources(session, 'Plains');
          const figures = battlefield.filter((card) => card.name === 'Figure of Destiny');
          const paladins = battlefield.filter((card) => card.name === 'Paladin Class');
          if (submittedLevelThree && !levelThreeResolved && session.view.stack.length === 0) {
            levelThreeResolved = true;
          }
          if (selectedOid !== null && session.view.stack.length === 0) {
            const selected = figures.find((card) => card.oid === selectedOid);
            selectedBoostObserved ||= selected?.power === 3 && selected.toughness === 3;
          }
          if (lifeBeforeAttack !== null && session.view.seats[1].life === lifeBeforeAttack - 8) {
            doubleStrikeDamageObserved = true;
          }
          const levelTwo = decision.options.find((option) => option.text.includes('Level 2'));
          const levelThree = decision.options.find((option) => option.text.includes('Level 3'));
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (paladins.length === 0 && plains >= 1
              ? decision.options.find((option) => option.text.startsWith('Paladin Class:'))?.id
              : undefined) ??
            (figures.length < 2 && plains >= 1
              ? decision.options.find((option) => isCast(option.text, 'Figure of Destiny'))?.id
              : undefined) ??
            (!submittedLevelTwo && plains >= 3 ? levelTwo?.id : undefined) ??
            (submittedLevelTwo && !submittedLevelThree && plains >= 5 ? levelThree?.id : undefined) ??
            (doubleStrikeDamageObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === levelTwo?.id) submittedLevelTwo = true;
          if (move === levelThree?.id) submittedLevelThree = true;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!doubleStrikeDamageObserved) {
        throw new Error(`never observed exact Paladin Class combat damage\n${trace.join('\n')}`);
      }
      expect(submittedLevelTwo).toBe(true);
      expect(submittedLevelThree).toBe(true);
      expect(levelThreeResolved).toBe(true);
      expect(selectedOid).toMatch(/^forge-card-/u);
      expect(selectedBoostObserved).toBe(true);
      expect(attacking.size).toBe(2);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'owns both exact shockland entry choices without inherited policy',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(SHOCKLAND_TABLE)).toEqual([]);
      const opened = await backend.open(SHOCKLAND_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let choices = 0;
      let paidUntapped = false;
      let declinedTapped = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'optional-cost') {
          expect(decision.options.map((option) => option.id)).toEqual([
            'optional-cost-pay-life-2',
            'optional-cost-decline',
          ]);
          expect(decision.options.every((option) => option.targets.length === 0)).toBe(true);
          await expect(session.submit('optional-cost-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          const selected = decision.options[choices === 0 ? 0 : 1]!;
          choices += 1;
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter((card) => card.name === 'Stomping Ground');
          if (choices >= 1 && lands.length >= 1 && session.view.seats[0].life === 18) {
            paidUntapped ||= lands.length === 1 && lands[0]?.tapped === false;
          }
          if (choices >= 2 && lands.length >= 2 && session.view.seats[0].life === 18) {
            declinedTapped ||= lands.filter((land) => land.tapped).length === 1;
          }
          move =
            (lands.length < 2
              ? decision.options.find((option) => option.text === 'Play Stomping Ground')?.id
              : undefined) ??
            (paidUntapped && declinedTapped
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!paidUntapped || !declinedTapped) {
        throw new Error(`never observed both exact shockland outcomes\n${trace.join('\n')}`);
      }
      expect(choices).toBe(2);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'owns exact zero-cost Equip targets, shroud legality, and Grafted Wargear unattachment',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(EQUIP_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(EQUIP_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let pendingEquipment: 'greaves' | 'wargear-first' | 'wargear-second' | null = null;
      let greavesTarget: string | null = null;
      let firstWargearTarget: string | null = null;
      let secondWargearTarget: string | null = null;
      let firstBoostObserved = false;
      let sacrificeObserved = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(pendingEquipment).not.toBeNull();
          const satyrs = decision.options.filter(
            (option) => option.targets.length === 1 && option.targets[0]?.name === 'Firedrinker Satyr',
          );
          expect(new Set(satyrs.map((option) => option.id)).size).toBe(satyrs.length);
          expect(new Set(satyrs.map((option) => option.targets[0]!.oid)).size).toBe(satyrs.length);
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(true);
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          let selected;
          if (pendingEquipment === 'greaves') {
            expect(satyrs.length).toBeGreaterThanOrEqual(3);
            selected = satyrs[0];
            greavesTarget = selected?.targets[0]?.oid ?? null;
          } else if (pendingEquipment === 'wargear-first') {
            expect(satyrs.every((option) => option.targets[0]?.oid !== greavesTarget)).toBe(true);
            selected = satyrs[0];
            firstWargearTarget = selected?.targets[0]?.oid ?? null;
          } else {
            expect(satyrs.every((option) => option.targets[0]?.oid !== greavesTarget)).toBe(true);
            selected = satyrs.find((option) => option.targets[0]?.oid !== firstWargearTarget);
            secondWargearTarget = selected?.targets[0]?.oid ?? null;
          }
          if (selected === undefined) throw new Error('Forge offered no required Equip target');
          staleSnapshot = session;
          staleMove = selected.id;
          move = selected.id;
          pendingEquipment = null;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const mountains = battlefield.filter((card) => card.name === 'Mountain').length;
          const satyrs = battlefield.filter((card) => card.name === 'Firedrinker Satyr');
          const hasGreaves = battlefield.some((card) => card.name === 'Lightning Greaves');
          const hasWargear = battlefield.some((card) => card.name === 'Grafted Wargear');
          if (firstWargearTarget !== null) {
            const first = satyrs.find((card) => card.oid === firstWargearTarget);
            firstBoostObserved ||= first?.power === 5 && first.toughness === 3;
            if (secondWargearTarget !== null) {
              const second = satyrs.find((card) => card.oid === secondWargearTarget);
              sacrificeObserved ||= first === undefined && second?.power === 5 && second.toughness === 3;
            }
          }
          const greavesEquip = decision.options.find(
            (option) => option.text.startsWith('Lightning Greaves:') && option.text.includes('Equip'),
          );
          const wargearEquip = decision.options.find(
            (option) => option.text.startsWith('Grafted Wargear:') && option.text.includes('Equip'),
          );
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (satyrs.length < 3 && untappedSources(session, 'Mountain') >= 1
              ? decision.options.find((option) => isCast(option.text, 'Firedrinker Satyr'))?.id
              : undefined) ??
            (!hasGreaves && untappedSources(session, 'Mountain') >= 2
              ? decision.options.find((option) => option.text.startsWith('Lightning Greaves:'))?.id
              : undefined) ??
            (!hasWargear && untappedSources(session, 'Mountain') >= 3
              ? decision.options.find((option) => option.text.startsWith('Grafted Wargear:'))?.id
              : undefined) ??
            (mountains >= 3 && greavesTarget === null ? greavesEquip?.id : undefined) ??
            (greavesTarget !== null && firstWargearTarget === null ? wargearEquip?.id : undefined) ??
            (firstBoostObserved && secondWargearTarget === null ? wargearEquip?.id : undefined) ??
            (sacrificeObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === greavesEquip?.id) pendingEquipment = 'greaves';
          if (move === wargearEquip?.id) {
            pendingEquipment = firstWargearTarget === null ? 'wargear-first' : 'wargear-second';
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!sacrificeObserved) throw new Error(`never observed exact Equip outcomes\n${trace.join('\n')}`);
      expect(greavesTarget).toMatch(/^forge-card-/u);
      expect(firstWargearTarget).toMatch(/^forge-card-/u);
      expect(secondWargearTarget).toMatch(/^forge-card-/u);
      expect(firstBoostObserved).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'owns the exact Control Magic Aura target and its continuous control effect',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(AURA_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(AURA_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let pending: 'control-cancel' | 'control-select' | 'destroy-aura' | null = null;
      let controlledOid: string | null = null;
      let canceled = false;
      let controlObserved = false;
      let restored = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(pending).not.toBeNull();
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (pending === 'control-cancel') {
            move = decision.options.find((option) => option.id === 'target-cancel')?.id;
            expect(move).toBe('target-cancel');
            canceled = true;
          } else if (pending === 'control-select') {
            const walls = decision.options.filter(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Wall of Omens',
            );
            expect(walls.length).toBeGreaterThanOrEqual(2);
            expect(new Set(walls.map((option) => option.id)).size).toBe(walls.length);
            expect(new Set(walls.map((option) => option.targets[0]!.oid)).size).toBe(walls.length);
            const selected = walls[1];
            if (selected === undefined) throw new Error('Forge offered no second exact Aura target');
            controlledOid = selected.targets[0]!.oid;
            staleSnapshot = session;
            staleMove = selected.id;
            move = selected.id;
          } else {
            const aura = decision.options.find(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Control Magic',
            );
            if (aura === undefined) throw new Error('Forge offered no Control Magic target to Vindicate');
            move = aura.id;
          }
          pending = null;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0].battlefield;
          const opponent = session.view.seats[1].battlefield;
          const enemyWalls = opponent.filter((card) => card.name === 'Wall of Omens');
          if (controlledOid !== null) {
            controlObserved ||= local.some((card) => card.oid === controlledOid);
            restored ||= controlObserved && opponent.some((card) => card.oid === controlledOid);
          }
          const mana = untappedSources(session, 'Tundra') + untappedSources(session, 'Underground Sea');
          const controlMagic =
            mana >= 4
              ? decision.options.find((option) => option.text.startsWith('Control Magic:'))
              : undefined;
          const vindicate =
            !restored &&
            mana >= 3 &&
            untappedSources(session, 'Tundra') >= 1 &&
            untappedSources(session, 'Underground Sea') >= 1
              ? decision.options.find((option) => option.text.startsWith('Vindicate:'))
              : undefined;
          move =
            decision.options.find(
              (option) => option.text === 'Play Tundra' || option.text === 'Play Underground Sea',
            )?.id ??
            (enemyWalls.length >= 2 && !canceled ? controlMagic?.id : undefined) ??
            (enemyWalls.length >= 2 && controlledOid === null ? controlMagic?.id : undefined) ??
            (controlObserved ? vindicate?.id : undefined) ??
            (restored ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === controlMagic?.id) pending = canceled ? 'control-select' : 'control-cancel';
          if (move === vindicate?.id) pending = 'destroy-aura';
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!restored) throw new Error(`never observed exact Aura outcomes\n${trace.join('\n')}`);
      expect(canceled).toBe(true);
      expect(controlledOid).toMatch(/^forge-card-/u);
      expect(controlObserved).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    "owns Faith's Fetters exact permanent target and attached rules",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FETTERS_ARTIFACT_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(FETTERS_ARTIFACT_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      type Pending = 'cancel-fetters' | 'fetter-worn' | 'destroy-first' | 'fetter-figure' | 'destroy-second';
      let session: ObservedSession = opened.session;
      let pending: Pending | null = null;
      let canceled = false;
      let wornOid: string | null = null;
      let figureOid: string | null = null;
      let firstAuraOid: string | null = null;
      let secondAuraOid: string | null = null;
      let firstTargeted = false;
      let firstDestroyCast = false;
      let firstDestroyed = false;
      let secondTargeted = false;
      let secondDestroyCast = false;
      let secondDestroyed = false;
      let lifeBeforeFirst: number | null = null;
      let lifeBeforeSecond: number | null = null;
      let firstLifeGainObserved = false;
      let secondLifeGainObserved = false;
      let figureActivationBefore = false;
      let wornManaAllowed = false;
      let figureActivationProhibited = false;
      let attackProhibited = false;
      let figureActivationRestored = false;
      let attackRestored = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const stagedBlockers = new Set<string>();
      const trace: string[] = [];

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`,
        );
        let move = pregameOrManaPayment(decision);

        if (decision.kind === 'target-selection') {
          if (pending === null) throw new Error('Forge reached an unplanned target selection');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (pending === 'cancel-fetters') {
            move = decision.options.find((option) => option.id === 'target-cancel')?.id;
            expect(move).toBe('target-cancel');
            canceled = true;
          } else if (pending === 'fetter-worn') {
            const plateaus = decision.options.filter(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Plateau',
            );
            expect(plateaus.length).toBeGreaterThanOrEqual(2);
            expect(new Set(plateaus.map((option) => option.id)).size).toBe(plateaus.length);
            expect(new Set(plateaus.map((option) => option.targets[0]!.oid)).size).toBe(plateaus.length);
            const target = decision.options.find((option) => option.targets[0]?.oid === wornOid);
            if (target === undefined) {
              throw new Error(
                `Forge offered no exact Worn Powerstone Aura target ${String(wornOid)} among ${decision.options
                  .map(
                    (option) => `${option.targets[0]?.name ?? option.text}:${option.targets[0]?.oid ?? '-'}`,
                  )
                  .join(', ')}`,
              );
            }
            staleSnapshot = session;
            staleMove = target.id;
            move = target.id;
            firstTargeted = true;
          } else if (pending === 'destroy-first') {
            const target = decision.options.find((option) => option.targets[0]?.oid === firstAuraOid);
            if (target === undefined)
              throw new Error("Forge offered no first Faith's Fetters target to Vindicate");
            move = target.id;
          } else if (pending === 'fetter-figure') {
            const target = decision.options.find((option) => option.targets[0]?.oid === figureOid);
            if (target === undefined) throw new Error('Forge offered no exact Figure of Destiny Aura target');
            move = target.id;
            secondTargeted = true;
          } else {
            const target = decision.options.find((option) => option.targets[0]?.oid === secondAuraOid);
            if (target === undefined)
              throw new Error("Forge offered no second Faith's Fetters target to Vindicate");
            move = target.id;
          }
          pending = null;
        } else if (decision.kind === 'mana-payment') {
          const wornMana = decision.options.find((option) =>
            option.text.startsWith('Activate Worn Powerstone for '),
          );
          if (firstAuraOid !== null && !firstDestroyed && !wornManaAllowed) {
            expect(wornMana).toBeDefined();
            wornManaAllowed = true;
          }
          const plateauWhite = decision.options.find(
            (option) => option.targets[0]?.name === 'Plateau' && option.text.includes('{W}'),
          );
          const black = decision.options.find(
            (option) => option.targets[0]?.name === 'Scrubland' && option.text.includes('{B}'),
          );
          move =
            wornMana?.id ??
            plateauWhite?.id ??
            black?.id ??
            decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const additions = decision.options.filter((option) => option.id.startsWith('combat-attack-add-'));
          if (secondTargeted && !secondDestroyed && figureOid !== null) {
            expect(additions.some((option) => option.targets[0]?.oid === figureOid)).toBe(false);
            attackProhibited ||= additions.length > 0;
          }
          if (secondDestroyed && figureOid !== null) {
            attackRestored ||= additions.some((option) => option.targets[0]?.oid === figureOid);
          }
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          const additions = decision.options.filter((option) => option.id.startsWith('combat-block-add-'));
          const wall = additions.find(
            (option) =>
              option.targets[0]?.name === 'Wall of Omens' && !stagedBlockers.has(option.targets[0].oid),
          );
          if (wall !== undefined) {
            stagedBlockers.add(wall.targets[0]!.oid);
            move = wall.id;
          } else {
            stagedBlockers.clear();
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          }
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const figures = battlefield.filter((card) => card.name === 'Figure of Destiny');
          const satyrs = battlefield.filter((card) => card.name === 'Firedrinker Satyr');
          const worn = battlefield.find((card) => card.name === 'Worn Powerstone');
          const auras = battlefield.filter((card) => card.name === "Faith's Fetters");
          wornOid ??= worn?.oid ?? null;
          if (figureOid === null && figures.length === 1) figureOid = figures[0]!.oid;
          firstAuraOid ??= firstTargeted && auras.length === 1 ? auras[0]!.oid : null;
          if (firstAuraOid !== null && firstDestroyCast && !auras.some((card) => card.oid === firstAuraOid)) {
            firstDestroyed = true;
          }
          if (firstDestroyed && secondTargeted && secondAuraOid === null && auras.length === 1) {
            secondAuraOid = auras[0]!.oid;
          }
          if (
            secondAuraOid !== null &&
            secondDestroyCast &&
            !auras.some((card) => card.oid === secondAuraOid)
          ) {
            secondDestroyed = true;
          }
          if (lifeBeforeFirst !== null && firstAuraOid !== null) {
            firstLifeGainObserved ||= session.view.seats[0].life === lifeBeforeFirst + 4;
          }
          if (lifeBeforeSecond !== null && secondAuraOid !== null) {
            secondLifeGainObserved ||= session.view.seats[0].life === lifeBeforeSecond + 4;
          }

          const figureActivation = decision.options.find((option) =>
            option.text.startsWith('Figure of Destiny: {R/W}:'),
          );
          if (!secondTargeted && figureOid !== null)
            figureActivationBefore ||= figureActivation !== undefined;
          if (secondAuraOid !== null && !secondDestroyed) {
            figureActivationProhibited ||= figureActivationBefore && figureActivation === undefined;
          }
          if (secondDestroyed) figureActivationRestored ||= figureActivation !== undefined;

          const plateau = untappedSources(session, 'Plateau');
          const scrubland = untappedSources(session, 'Scrubland');
          const mana = plateau + scrubland + 2 * untappedSources(session, 'Worn Powerstone');
          const fetters =
            plateau + scrubland >= 1 && mana >= 4
              ? decision.options.find((option) => option.text.startsWith("Faith's Fetters:"))
              : undefined;
          const vindicate =
            scrubland >= 1 && plateau + scrubland >= 2 && mana >= 3
              ? decision.options.find((option) => option.text.startsWith('Vindicate:'))
              : undefined;
          move =
            decision.options.find(
              (option) => option.text === 'Play Plateau' || option.text === 'Play Scrubland',
            )?.id ??
            (figures.length < 1 && plateau + scrubland >= 1
              ? decision.options.find(
                  (option) => option.text === 'Figure of Destiny: Figure of Destiny - Creature 1 / 1',
                )?.id
              : undefined) ??
            (satyrs.length < 1 && plateau >= 1
              ? decision.options.find(
                  (option) => option.text === 'Firedrinker Satyr: Firedrinker Satyr - Creature 2 / 1',
                )?.id
              : undefined) ??
            (worn === undefined && mana >= 3
              ? decision.options.find((option) => option.text === 'Worn Powerstone: Worn Powerstone')?.id
              : undefined) ??
            (figureActivationBefore && wornOid !== null && !canceled ? fetters?.id : undefined) ??
            (canceled && wornOid !== null && !firstTargeted ? fetters?.id : undefined) ??
            (firstLifeGainObserved && worn?.tapped === false && !firstDestroyCast
              ? vindicate?.id
              : undefined) ??
            (firstDestroyed && !secondTargeted ? fetters?.id : undefined) ??
            (secondLifeGainObserved && figureActivationProhibited && attackProhibited && !secondDestroyCast
              ? vindicate?.id
              : undefined) ??
            (secondDestroyed && figureActivationRestored && attackRestored
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === fetters?.id) {
            if (!canceled) {
              pending = 'cancel-fetters';
            } else if (!firstTargeted) {
              pending = 'fetter-worn';
              lifeBeforeFirst = session.view.seats[0].life;
            } else {
              pending = 'fetter-figure';
              lifeBeforeSecond = session.view.seats[0].life;
            }
          }
          if (move === vindicate?.id) {
            if (!firstDestroyed) {
              pending = 'destroy-first';
              firstDestroyCast = true;
            } else {
              pending = 'destroy-second';
              secondDestroyCast = true;
            }
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) {
          throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        }
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!secondDestroyed || !attackRestored) {
        throw new Error(
          `never observed exact Faith's Fetters outcomes ${JSON.stringify({
            canceled,
            firstTargeted,
            firstAuraOid,
            firstLifeGainObserved,
            wornManaAllowed,
            firstDestroyCast,
            firstDestroyed,
            secondTargeted,
            secondAuraOid,
            secondLifeGainObserved,
            figureActivationBefore,
            figureActivationProhibited,
            attackProhibited,
            secondDestroyCast,
            secondDestroyed,
            figureActivationRestored,
            attackRestored,
          })}\n${trace.slice(-80).join('\n')}`,
        );
      }
      expect(canceled).toBe(true);
      expect(firstLifeGainObserved).toBe(true);
      expect(secondLifeGainObserved).toBe(true);
      expect(wornManaAllowed).toBe(true);
      expect(figureActivationProhibited).toBe(true);
      expect(attackProhibited).toBe(true);
      expect(figureActivationRestored).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    "owns Faith's Fetters exact blocker prohibition",
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FETTERS_AURA_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(FETTERS_AURA_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let pendingTarget = false;
      let figureOid: string | null = null;
      let auraOid: string | null = null;
      let baselineBlock = false;
      let blockProhibited = false;
      const trace: string[] = [];

      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);

        if (decision.kind === 'target-selection') {
          if (!pendingTarget || figureOid === null) {
            throw new Error("Forge reached an unplanned Faith's Fetters blocker target");
          }
          const target = decision.options.find((option) => option.targets[0]?.oid === figureOid);
          if (target === undefined)
            throw new Error('Forge offered no exact Figure of Destiny blocker target');
          move = target.id;
          pendingTarget = false;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          const additions = decision.options.filter((option) => option.id.startsWith('combat-block-add-'));
          if (auraOid === null && figureOid !== null) {
            baselineBlock ||= additions.some((option) => option.targets[0]?.oid === figureOid);
          } else if (auraOid !== null && figureOid !== null) {
            expect(additions.some((option) => option.targets[0]?.oid === figureOid)).toBe(false);
            expect(additions.some((option) => option.targets[0]?.name === 'Firedrinker Satyr')).toBe(true);
            blockProhibited = true;
          }
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const battlefield = session.view.seats[0].battlefield;
          const figure = battlefield.find((card) => card.name === 'Figure of Destiny');
          const satyr = battlefield.find((card) => card.name === 'Firedrinker Satyr');
          const aura = battlefield.find((card) => card.name === "Faith's Fetters");
          figureOid ??= figure?.oid ?? null;
          auraOid ??= aura?.oid ?? null;
          const plateau = untappedSources(session, 'Plateau');
          const scrubland = untappedSources(session, 'Scrubland');
          const mana = plateau + scrubland + 2 * untappedSources(session, 'Worn Powerstone');
          const fetters =
            plateau + scrubland >= 1 && mana >= 4
              ? decision.options.find((option) => option.text.startsWith("Faith's Fetters:"))
              : undefined;
          move =
            decision.options.find(
              (option) => option.text === 'Play Plateau' || option.text === 'Play Scrubland',
            )?.id ??
            (figure === undefined && plateau + scrubland >= 1
              ? decision.options.find(
                  (option) => option.text === 'Figure of Destiny: Figure of Destiny - Creature 1 / 1',
                )?.id
              : undefined) ??
            (satyr === undefined && plateau >= 1
              ? decision.options.find(
                  (option) => option.text === 'Firedrinker Satyr: Firedrinker Satyr - Creature 2 / 1',
                )?.id
              : undefined) ??
            (baselineBlock && auraOid === null ? fetters?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === fetters?.id) pendingTarget = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
        if (blockProhibited) break;
      }

      if (!blockProhibited) {
        throw new Error(
          `never observed exact Faith's Fetters blocker prohibition ${JSON.stringify({
            figureOid,
            auraOid,
            baselineBlock,
          })}\n${trace.slice(-80).join('\n')}`,
        );
      }
      expect(baselineBlock).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'owns Fall from Favor exact Aura target and conditional monarch lock',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(FALL_AURA_TARGET_TABLE)).toEqual([]);
      const opened = await backend.open(FALL_AURA_TARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      type Pending = 'cancel-fall' | 'attach-wall';
      let session: ObservedSession = opened.session;
      let pending: Pending | null = null;
      let canceled = false;
      let targetOid: string | null = null;
      let auraOid: string | null = null;
      let resolvedTurn: number | null = null;
      let handAfterResolution: number | null = null;
      let lifeAfterResolution: number | null = null;
      let monarchDrawObserved = false;
      let lockedOpponentTurn: number | null = null;
      let opponentTookMonarch = false;
      let untapRestored = false;
      let staleSnapshot: ObservedSession | null = null;
      let staleMove: string | null = null;
      const trace: string[] = [];

      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        let move = pregameOrManaPayment(decision);

        if (decision.kind === 'target-selection') {
          if (pending === null) throw new Error('Forge reached an unplanned target selection');
          await expect(session.submit('target-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          if (pending === 'cancel-fall') {
            move = decision.options.find((option) => option.id === 'target-cancel')?.id;
            expect(move).toBe('target-cancel');
            canceled = true;
          } else {
            const walls = decision.options.filter(
              (option) => option.targets.length === 1 && option.targets[0]?.name === 'Wall of Omens',
            );
            expect(walls.length).toBeGreaterThanOrEqual(2);
            expect(new Set(walls.map((option) => option.id)).size).toBe(walls.length);
            expect(new Set(walls.map((option) => option.targets[0]!.oid)).size).toBe(walls.length);
            const target = walls[0];
            if (target === undefined) throw new Error('Forge offered no Wall of Omens Aura target');
            targetOid = target.targets[0]!.oid;
            staleSnapshot = session;
            staleMove = target.id;
            move = target.id;
          }
          pending = null;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          const opponent = session.view.seats[1];
          const target = opponent.battlefield.find((card) => card.oid === targetOid);
          const aura = local.battlefield.find((card) => card.name === 'Fall from Favor');
          auraOid ??= aura?.oid ?? null;
          if (auraOid !== null && target?.tapped === true && resolvedTurn === null) {
            resolvedTurn = session.view.turn.number;
            handAfterResolution = local.handSize;
            lifeAfterResolution = local.life;
          }
          if (
            resolvedTurn !== null &&
            session.view.turn.number === resolvedTurn &&
            handAfterResolution !== null &&
            local.handSize > handAfterResolution
          ) {
            monarchDrawObserved = true;
          }
          if (
            auraOid !== null &&
            target?.tapped === true &&
            session.view.turn.active === opponent.id &&
            resolvedTurn !== null &&
            session.view.turn.number > resolvedTurn
          ) {
            lockedOpponentTurn ??= session.view.turn.number;
          }
          if (lifeAfterResolution !== null && local.life < lifeAfterResolution) {
            opponentTookMonarch = true;
          }
          if (
            auraOid !== null &&
            target?.tapped === false &&
            opponentTookMonarch &&
            lockedOpponentTurn !== null &&
            session.view.turn.active === opponent.id &&
            session.view.turn.number > lockedOpponentTurn
          ) {
            untapRestored = true;
          }

          const enemyWalls = opponent.battlefield.filter((card) => card.name === 'Wall of Omens');
          const fall = decision.options.find((option) => option.text.startsWith('Fall from Favor:'));
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (enemyWalls.length >= 2 && !canceled ? fall?.id : undefined) ??
            (enemyWalls.length >= 2 && canceled && targetOid === null ? fall?.id : undefined) ??
            (monarchDrawObserved && untapRestored
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === fall?.id) pending = canceled ? 'attach-wall' : 'cancel-fall';
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
        if (staleSnapshot !== null && staleMove !== null) {
          await expect(staleSnapshot.submit(staleMove)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleSnapshot = null;
          staleMove = null;
        }
      }

      if (!monarchDrawObserved || !untapRestored) {
        throw new Error(
          `never observed exact Fall from Favor outcomes ${JSON.stringify({
            canceled,
            targetOid,
            auraOid,
            resolvedTurn,
            monarchDrawObserved,
            lockedOpponentTurn,
            opponentTookMonarch,
            untapRestored,
          })}\n${trace.slice(-100).join('\n')}`,
        );
      }
      expect(canceled).toBe(true);
      expect(targetOid).toMatch(/^forge-card-/u);
      expect(opponentTookMonarch).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'executes Student of Warfare fixed level-up bands and ordinary combat in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(STUDENT_OF_WARFARE_TABLE)).toEqual([]);
      const opened = await backend.open(STUDENT_OF_WARFARE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let levelActions = 0;
      let manaPayments = 0;
      let sawMiddleBand = false;
      let sawFinalBand = false;
      let middleAttackLife: number | null = null;
      let finalAttackLife: number | null = null;
      let middleDamage = false;
      let doubleStrikeDamage = false;
      let stagedAttack = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const student = session.view.seats[0].battlefield.find((card) => card.name === 'Student of Warfare');
        const level =
          student === undefined
            ? 0
            : Object.entries(student.counters)
                .filter(([kind]) => kind.toUpperCase().includes('LEVEL'))
                .reduce((sum, [, count]) => sum + count, 0);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} L${String(level)} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        if (
          student !== undefined &&
          decision.kind === 'priority' &&
          session.view.stack.length === 0 &&
          levelActions > level
        ) {
          throw new Error(
            `a submitted level action did not advance its exact counter\n${trace.slice(-80).join('\n')}`,
          );
        }
        if (level >= 2 && level <= 6 && student?.power === 3 && student.toughness === 3) {
          sawMiddleBand = true;
        }
        if (level >= 7 && student?.power === 4 && student.toughness === 4) sawFinalBand = true;
        if (middleAttackLife !== null && session.view.seats[1].life === middleAttackLife - 3) {
          middleDamage = true;
        }
        if (finalAttackLife !== null && session.view.seats[1].life === finalAttackLife - 8) {
          doubleStrikeDamage = true;
        }

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          manaPayments += 1;
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.length === 1 &&
              option.targets[0]?.name === 'Student of Warfare',
          );
          const shouldAttack =
            (level === 2 && middleAttackLife === null) || (level >= 7 && finalAttackLife === null);
          if (shouldAttack && !stagedAttack && add !== undefined) {
            stagedAttack = true;
            if (level === 2) middleAttackLife = session.view.seats[1].life;
            else finalAttackLife = session.view.seats[1].life;
            move = add.id;
          } else {
            stagedAttack = false;
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const levelUp = decision.options.find((option) => option.text.includes('Level up'));
          if (levelUp !== undefined && !session.view.turn.step.includes('MAIN')) {
            throw new Error(`Forge exposed level up outside sorcery timing\n${trace.slice(-80).join('\n')}`);
          }
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (student === undefined && untappedSources(session, 'Plains') >= 1
              ? decision.options.find((option) => option.text.startsWith('Student of Warfare:'))?.id
              : undefined) ??
            (student !== undefined &&
            level < 7 &&
            untappedSources(session, 'Plains') >= 1 &&
            session.view.turn.active === session.view.seats[0].id
              ? levelUp?.id
              : undefined) ??
            (middleDamage && doubleStrikeDamage
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === levelUp?.id) levelActions += 1;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      if (!middleDamage || !doubleStrikeDamage) {
        throw new Error(
          `never observed both exact Student combat bands ${JSON.stringify({
            levelActions,
            manaPayments,
            sawMiddleBand,
            sawFinalBand,
            middleAttackLife,
            finalAttackLife,
            middleDamage,
            doubleStrikeDamage,
          })}\n${trace.slice(-100).join('\n')}`,
        );
      }
      expect(levelActions).toBe(7);
      expect(manaPayments).toBeGreaterThanOrEqual(8);
      expect(sawMiddleBand).toBe(true);
      expect(sawFinalBand).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'executes Joraga Treespeaker level one and spends its granted two-green mana in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(JORAGA_TREESPEAKER_TABLE)).toEqual([]);
      const opened = await backend.open(JORAGA_TREESPEAKER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let levelActions = 0;
      let sawLevelOneTier = false;
      let castingSecond = false;
      let spentGrantedMana = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const treespeakers = session.view.seats[0].battlefield.filter(
          (card) => card.name === 'Joraga Treespeaker',
        );
        const first = treespeakers[0];
        const level = first === undefined ? 0 : levelCounters(first);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} L${String(level)} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        if (first !== undefined && level >= 1 && first.power === 1 && first.toughness === 2) {
          sawLevelOneTier = true;
        }

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          const grantedSource = decision.options.find(
            (option) =>
              option.id !== 'mana-payment-cancel' && option.targets[0]?.name === 'Joraga Treespeaker',
          );
          if (castingSecond && grantedSource !== undefined) {
            spentGrantedMana = true;
            move = grantedSource.id;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const levelUp = decision.options.find((option) => option.text.includes('Level up'));
          const secondCast = decision.options.find((option) => isCast(option.text, 'Joraga Treespeaker'));
          move =
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (treespeakers.length === 0 && untappedSources(session, 'Forest') >= 1
              ? secondCast?.id
              : undefined) ??
            (treespeakers.length === 1 &&
            level === 0 &&
            untappedSources(session, 'Forest') >= 2 &&
            session.view.turn.active === session.view.seats[0].id
              ? levelUp?.id
              : undefined) ??
            (sawLevelOneTier && treespeakers.length === 1 && !castingSecond ? secondCast?.id : undefined) ??
            (spentGrantedMana && treespeakers.length >= 2
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === levelUp?.id) levelActions += 1;
          if (move === secondCast?.id && treespeakers.length === 1) castingSecond = true;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      if (!sawLevelOneTier || !spentGrantedMana) {
        throw new Error(
          `never observed exact Joraga level-one mana outcome ${JSON.stringify({
            levelActions,
            sawLevelOneTier,
            castingSecond,
            spentGrantedMana,
          })}\n${trace.slice(-100).join('\n')}`,
        );
      }
      expect(levelActions).toBe(1);
      expect(
        session.view.seats[0].battlefield.filter((card) => card.name === 'Joraga Treespeaker'),
      ).toHaveLength(2);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'executes both Hexdrinker level bands in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(HEXDRINKER_TABLE)).toEqual([]);
      const opened = await backend.open(HEXDRINKER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let levelActions = 0;
      let sawMiddleTier = false;
      let sawFinalTier = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const hexdrinker = session.view.seats[0].battlefield.find((card) => card.name === 'Hexdrinker');
        const level = hexdrinker === undefined ? 0 : levelCounters(hexdrinker);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} L${String(level)} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        if (level >= 3 && level < 8 && hexdrinker?.power === 4 && hexdrinker.toughness === 4) {
          sawMiddleTier = true;
        }
        if (level >= 8 && hexdrinker?.power === 6 && hexdrinker.toughness === 6) sawFinalTier = true;

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const levelUp = decision.options.find((option) => option.text.includes('Level up'));
          move =
            decision.options.find((option) => option.text === 'Play Forest')?.id ??
            (hexdrinker === undefined && untappedSources(session, 'Forest') >= 1
              ? decision.options.find((option) => isCast(option.text, 'Hexdrinker'))?.id
              : undefined) ??
            (hexdrinker !== undefined &&
            level < 8 &&
            untappedSources(session, 'Forest') >= 1 &&
            session.view.turn.active === session.view.seats[0].id
              ? levelUp?.id
              : undefined) ??
            (sawMiddleTier && sawFinalTier
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === levelUp?.id) levelActions += 1;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      if (!sawMiddleTier || !sawFinalTier) {
        throw new Error(
          `never observed both exact Hexdrinker tiers ${JSON.stringify({
            levelActions,
            sawMiddleTier,
            sawFinalTier,
          })}\n${trace.slice(-100).join('\n')}`,
        );
      }
      expect(levelActions).toBe(8);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'executes Selfless Spirit self-sacrifice, temporary indestructible, and flying combat in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(SELFLESS_SPIRIT_TABLE)).toEqual([]);
      const opened = await backend.open(SELFLESS_SPIRIT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let stagedAttack = false;
      let attackLife: number | null = null;
      let flyingDamageObserved = false;
      let activationSubmitted = false;
      let activationTurn: number | null = null;
      let sacrificedSourceObserved = false;
      let protectedOid: string | null = null;
      let firstDestroySubmitted = false;
      let protectedDestroySurvived = false;
      let secondDestroySubmitted = false;
      let expiredDestroyObserved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const spirits = local.battlefield.filter((card) => card.name === 'Selfless Spirit');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} spirits=${String(spirits.length)} stack=${String(session.view.stack.length)}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        if (attackLife !== null && opponent.life === attackLife - 2) flyingDamageObserved = true;
        if (activationSubmitted && !sacrificedSourceObserved && session.view.stack.length > 0) {
          const sacrificed = local.graveyard.some((card) => card.name === 'Selfless Spirit');
          if (sacrificed && spirits.length === 1) {
            sacrificedSourceObserved = true;
            protectedOid = spirits[0]?.oid ?? null;
          }
        }
        if (
          firstDestroySubmitted &&
          !protectedDestroySurvived &&
          session.view.stack.length === 0 &&
          protectedOid !== null &&
          spirits.some((card) => card.oid === protectedOid)
        ) {
          protectedDestroySurvived = true;
        }
        if (
          secondDestroySubmitted &&
          session.view.stack.length === 0 &&
          protectedOid !== null &&
          !spirits.some((card) => card.oid === protectedOid) &&
          local.graveyard.some((card) => card.oid === protectedOid)
        ) {
          expiredDestroyObserved = true;
        }

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const spiritAttack = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.length === 1 &&
              option.targets[0]?.name === 'Selfless Spirit',
          );
          const groundWallReady = opponent.battlefield.some((card) => card.name === 'Wall of Omens');
          if (!flyingDamageObserved && attackLife === null && groundWallReady && spiritAttack !== undefined) {
            stagedAttack = true;
            attackLife = opponent.life;
            move = spiritAttack.id;
          } else {
            stagedAttack = false;
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const hand = local.hand ?? [];
          const plains = untappedSources(session, 'Plains');
          const activation = decision.options.find(
            (option) =>
              option.text.startsWith('Selfless Spirit:') &&
              option.text.includes('gain indestructible until end of turn'),
          );
          const day =
            plains >= 4
              ? decision.options.find((option) => option.text.startsWith('Day of Judgment:'))
              : undefined;
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (!firstDestroySubmitted && spirits.length < 2 && plains >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Selfless Spirit:') &&
                    !option.text.includes('gain indestructible until end of turn'),
                )?.id
              : undefined) ??
            (!activationSubmitted && flyingDamageObserved && spirits.length >= 2 && plains >= 4
              ? activation?.id
              : undefined) ??
            (activationSubmitted &&
            sacrificedSourceObserved &&
            !firstDestroySubmitted &&
            session.view.stack.length === 0
              ? day?.id
              : undefined) ??
            (protectedDestroySurvived &&
            !secondDestroySubmitted &&
            activationTurn !== null &&
            session.view.turn.number > activationTurn &&
            hand.some((card) => card.name === 'Day of Judgment')
              ? day?.id
              : undefined) ??
            (expiredDestroyObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === activation?.id && !activationSubmitted) {
            activationSubmitted = true;
            activationTurn = session.view.turn.number;
          }
          if (move === day?.id) {
            if (!firstDestroySubmitted) firstDestroySubmitted = true;
            else secondDestroySubmitted = true;
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }

      if (!expiredDestroyObserved) {
        throw new Error(
          `never observed complete Selfless Spirit duration proof ${JSON.stringify({
            stagedAttack,
            flyingDamageObserved,
            activationSubmitted,
            activationTurn,
            sacrificedSourceObserved,
            protectedOid,
            firstDestroySubmitted,
            protectedDestroySurvived,
            secondDestroySubmitted,
            expiredDestroyObserved,
          })}\n${trace.slice(-120).join('\n')}`,
        );
      }
      expect(flyingDamageObserved).toBe(true);
      expect(sacrificedSourceObserved).toBe(true);
      expect(protectedOid).toMatch(/^forge-card-/u);
      expect(protectedDestroySurvived).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'executes Remorseful Cleric self-sacrifice, selected-player graveyard exile, and flying combat in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(REMORSEFUL_CLERIC_TABLE)).toEqual([]);
      const opened = await backend.open(REMORSEFUL_CLERIC_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let attackLife: number | null = null;
      let flyingDamageObserved = false;
      let removalsSubmitted = 0;
      let removalsTargeted = 0;
      let activationSubmitted = false;
      let targetSelected = false;
      let sacrificedSourceObserved = false;
      let activatingClericOid: string | null = null;
      let targetedGraveyardOids: readonly string[] = [];
      let opposingExileBefore: readonly string[] = [];
      let localExileBefore: readonly string[] = [];
      let untargetedGraveyardOid: string | null = null;
      let exactExileObserved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const clerics = local.battlefield.filter((card) => card.name === 'Remorseful Cleric');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} clerics=${String(clerics.length)} localGrave=${String(local.graveyard.length)} opposingGrave=${String(opponent.graveyard.length)} stack=${String(session.view.stack.length)}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        if (attackLife !== null && opponent.life === attackLife - 2) flyingDamageObserved = true;
        if (
          targetSelected &&
          !sacrificedSourceObserved &&
          session.view.stack.length > 0 &&
          activatingClericOid !== null &&
          local.graveyard.some((card) => card.oid === activatingClericOid)
        ) {
          sacrificedSourceObserved = true;
        }
        if (
          targetSelected &&
          !exactExileObserved &&
          session.view.stack.length === 0 &&
          targetedGraveyardOids.length >= 2 &&
          targetedGraveyardOids.every((oid) => !opponent.graveyard.some((card) => card.oid === oid)) &&
          opponent.exile
            .map((card) => card.oid)
            .filter((oid) => !opposingExileBefore.includes(oid))
            .sort()
            .join('\n') === [...targetedGraveyardOids].sort().join('\n') &&
          local.exile
            .map((card) => card.oid)
            .sort()
            .join('\n') === [...localExileBefore].sort().join('\n') &&
          untargetedGraveyardOid !== null &&
          local.graveyard.some((card) => card.oid === untargetedGraveyardOid) &&
          activatingClericOid !== null &&
          local.graveyard.some((card) => card.oid === activatingClericOid)
        ) {
          exactExileObserved = true;
        }

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection' && removalsSubmitted > removalsTargeted) {
          const wall = decision.options.find(
            (option) => option.id.startsWith('target-card-') && option.targets[0]?.name === 'Wall of Omens',
          );
          expect(wall).toBeDefined();
          removalsTargeted += 1;
          move = wall!.id;
        } else if (decision.kind === 'target-selection' && activationSubmitted && !targetSelected) {
          expect(decision.options.some((option) => option.id === 'target-player-0')).toBe(true);
          const opposingTarget = decision.options.find((option) => option.id === 'target-player-1');
          expect(opposingTarget).toBeDefined();
          targetedGraveyardOids = opponent.graveyard.map((card) => card.oid);
          expect(new Set(targetedGraveyardOids).size).toBeGreaterThanOrEqual(2);
          opposingExileBefore = opponent.exile.map((card) => card.oid);
          localExileBefore = local.exile.map((card) => card.oid);
          untargetedGraveyardOid = local.graveyard.find((card) => card.name === 'Doom Blade')?.oid ?? null;
          expect(untargetedGraveyardOid).toMatch(/^forge-card-/u);
          targetSelected = true;
          move = opposingTarget!.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const clericAttack = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.length === 1 &&
              option.targets[0]?.name === 'Remorseful Cleric',
          );
          const groundWallReady = opponent.battlefield.some((card) => card.name === 'Wall of Omens');
          if (!flyingDamageObserved && attackLife === null && groundWallReady && clericAttack !== undefined) {
            attackLife = opponent.life;
            move = clericAttack.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = untappedSources(session, 'Scrubland');
          const removal =
            lands >= 2 ? decision.options.find((option) => option.text.startsWith('Doom Blade:')) : undefined;
          const activation = decision.options.find(
            (option) =>
              option.text.startsWith('Remorseful Cleric:') &&
              option.text.includes("target player's graveyard"),
          );
          move =
            decision.options.find((option) => option.text === 'Play Scrubland')?.id ??
            (removalsSubmitted < 2 && opponent.battlefield.some((card) => card.name === 'Wall of Omens')
              ? removal?.id
              : undefined) ??
            (opponent.graveyard.length >= 2 && clerics.length === 0 && lands >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Remorseful Cleric:') &&
                    !option.text.includes("target player's graveyard"),
                )?.id
              : undefined) ??
            (!activationSubmitted &&
            flyingDamageObserved &&
            clerics.length === 1 &&
            opponent.graveyard.length >= 2
              ? activation?.id
              : undefined) ??
            (exactExileObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (move === removal?.id) removalsSubmitted += 1;
          if (move === activation?.id) {
            activationSubmitted = true;
            activatingClericOid = clerics[0]?.oid ?? null;
            expect(activatingClericOid).toMatch(/^forge-card-/u);
          }
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }

      if (!exactExileObserved) {
        throw new Error(
          `never observed complete Remorseful Cleric graveyard-exile proof ${JSON.stringify({
            flyingDamageObserved,
            removalsSubmitted,
            removalsTargeted,
            activationSubmitted,
            targetSelected,
            sacrificedSourceObserved,
            activatingClericOid,
            targetedGraveyardOids,
            untargetedGraveyardOid,
            exactExileObserved,
          })}\n${trace.slice(-120).join('\n')}`,
        );
      }
      expect(flyingDamageObserved).toBe(true);
      expect(sacrificedSourceObserved).toBe(true);
      expect(new Set(targetedGraveyardOids).size).toBeGreaterThanOrEqual(2);
      expect(untargetedGraveyardOid).toMatch(/^forge-card-/u);
      expect(activatingClericOid).toMatch(/^forge-card-/u);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    360_000,
  );

  forgeIt(
    'executes Coldsteel Heart exact entry color choice, tapped entry, untap, and chosen-mana payment in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(COLDSTEEL_HEART_TABLE)).toEqual([]);
      const opened = await backend.open(COLDSTEEL_HEART_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let choseRed = false;
      let entryTapped = false;
      let untappedLater = false;
      let heartOid: string | null = null;
      let entryTurn: number | null = null;
      let paidWithHeart = false;
      let riftSubmitted = false;
      let riftResolved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        const opponent = session.view.seats[1];
        const heart = local.battlefield.find((card) => card.name === 'Coldsteel Heart');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} heart=${heart?.oid ?? '-'}:${String(heart?.tapped ?? false)} life=${String(opponent.life)}: ${decision.options
            .map((option) => `${option.id}:${option.text}`)
            .join(' || ')}`,
        );
        if (heart !== undefined && heartOid === null) {
          heartOid = heart.oid;
          entryTurn = session.view.turn.number;
          entryTapped = heart.tapped;
        }
        if (
          heart !== undefined &&
          entryTurn !== null &&
          session.view.turn.number > entryTurn &&
          !heart.tapped
        ) {
          untappedLater = true;
        }
        if (riftSubmitted && opponent.life === 16) riftResolved = true;

        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'color-choice') {
          expect(decision.options.map((option) => option.id)).toEqual([
            'color-choice-W',
            'color-choice-U',
            'color-choice-B',
            'color-choice-R',
            'color-choice-G',
          ]);
          expect(decision.options.every((option) => option.targets[0]?.name === 'Coldsteel Heart')).toBe(
            true,
          );
          await expect(session.submit('color-choice-C')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          move = decision.options.find((option) => option.id === 'color-choice-R')?.id;
          choseRed = true;
        } else if (decision.kind === 'mana-payment') {
          const fromHeart = decision.options.find(
            (option) =>
              option.targets[0]?.oid === heartOid &&
              option.targets[0]?.name === 'Coldsteel Heart' &&
              option.text.includes('{R}'),
          );
          if (!paidWithHeart && fromHeart !== undefined) {
            move = fromHeart.id;
            paidWithHeart = true;
          } else {
            move = decision.options.find(
              (option) => option.id !== 'mana-payment-cancel' && option.targets[0]?.name === 'Island',
            )?.id;
          }
        } else if (decision.kind === 'priority') {
          const castHeart = decision.options.find((option) => option.text.startsWith('Coldsteel Heart:'));
          const castRift = decision.options.find((option) => option.text.startsWith('Flame Rift:'));
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (heartOid === null && untappedSources(session, 'Island') >= 2 ? castHeart?.id : undefined) ??
            (untappedLater &&
            untappedSources(session, 'Island') >= 1 &&
            untappedSources(session, 'Coldsteel Heart') >= 1 &&
            !riftSubmitted &&
            castRift !== undefined
              ? (() => {
                  riftSubmitted = true;
                  return castRift.id;
                })()
              : undefined) ??
            (riftResolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
        session = advanced.session;
      }

      if (!choseRed || !entryTapped || !untappedLater || !paidWithHeart || !riftResolved) {
        throw new Error(
          `never observed complete Coldsteel Heart proof ${JSON.stringify({
            choseRed,
            entryTapped,
            untappedLater,
            heartOid,
            paidWithHeart,
            riftSubmitted,
            riftResolved,
          })}\n${trace.slice(-120).join('\n')}`,
        );
      }
      expect(choseRed).toBe(true);
      expect(entryTapped).toBe(true);
      expect(untappedLater).toBe(true);
      expect(heartOid).toMatch(/^forge-card-/u);
      expect(paidWithHeart).toBe(true);
      expect(session.view.seats[0].battlefield.find((card) => card.oid === heartOid)?.tapped).toBe(true);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  for (const parity of ['odd', 'even'] as const) {
    forgeIt(
      `executes Extinction Event exact ${parity} branch over mana values zero and one in installed Forge`,
      async () => {
        const backend = installedForgeBackend({ timeoutMs: 120_000 });
        expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
        if (backend === null) return;
        expect(await backend.supports(EXTINCTION_EVENT_TABLE)).toEqual([]);
        const opened = await backend.open(EXTINCTION_EVENT_TABLE);
        if (!opened.ok) throw new Error(opened.error.message);

        let session: ObservedSession = opened.session;
        let crabObserved = false;
        let swiftspearObserved = false;
        let choiceSubmitted = false;
        let branchProved = false;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no decision');
          const local = session.view.seats[0];
          const opponent = session.view.seats[1];
          const crab = local.battlefield.find((card) => card.name === 'Crab Token');
          const swiftspear = opponent.battlefield.find((card) => card.name === 'Monastery Swiftspear');
          const exiledCrab = local.exile.find((card) => card.name === 'Crab Token');
          const exiledSwiftspear = opponent.exile.find((card) => card.name === 'Monastery Swiftspear');
          crabObserved ||= crab !== undefined;
          swiftspearObserved ||= swiftspear !== undefined;
          if (choiceSubmitted && session.view.stack.length === 0) {
            // The two branches are proved by different evidence, because the two
            // creatures are different kinds of object. Monastery Swiftspear is a
            // card and lands in exile, so the odd branch is read there. The Crab
            // is a token: exiling it removes it from the game, and a token in no
            // zone at all is what the rules say the even branch leaves behind, so
            // reading it out of exile would be waiting for a state Forge is right
            // never to show. What the even branch asserts instead is the whole of
            // what is observable -- the Crab is on no battlefield, in no
            // graveyard and in no exile, and the odd-valued creature is
            // untouched on the battlefield.
            branchProved ||=
              parity === 'odd'
                ? crab !== undefined &&
                  exiledCrab === undefined &&
                  swiftspear === undefined &&
                  exiledSwiftspear !== undefined
                : crab === undefined &&
                  exiledCrab === undefined &&
                  local.graveyard.every((card) => card.name !== 'Crab Token') &&
                  swiftspear !== undefined &&
                  exiledSwiftspear === undefined;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} crab=${String(crab !== undefined)} swiftspear=${String(swiftspear !== undefined)}: ${decision.options
              .map((option) => `${option.id}:${option.text}`)
              .join(' || ')}`,
          );

          let move = decision.options.find(
            (option) => option.text === 'Play first' || option.text === 'Keep this hand',
          )?.id;
          if (decision.kind === 'parity-choice') {
            expect(decision.options.map((option) => option.id)).toEqual([
              'parity-choice-odd',
              'parity-choice-even',
            ]);
            expect(decision.options.every((option) => option.targets[0]?.name === 'Extinction Event')).toBe(
              true,
            );
            await expect(session.submit('parity-choice-neither')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = `parity-choice-${parity}`;
            choiceSubmitted = true;
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          } else if (decision.kind === 'priority') {
            const castEvidence = decision.options.find((option) => option.text.startsWith('Hard Evidence:'));
            const castEvent = decision.options.find((option) => option.text.startsWith('Extinction Event:'));
            move =
              decision.options.find((option) => option.text === 'Play Underground Sea')?.id ??
              (!crabObserved && untappedSources(session, 'Underground Sea') >= 1
                ? castEvidence?.id
                : undefined) ??
              (crabObserved &&
              swiftspearObserved &&
              !choiceSubmitted &&
              untappedSources(session, 'Underground Sea') >= 4
                ? castEvent?.id
                : undefined) ??
              (branchProved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
          session = advanced.session;
        }

        if (!crabObserved || !swiftspearObserved || !choiceSubmitted || !branchProved) {
          throw new Error(
            `never observed complete Extinction Event ${parity} proof ${JSON.stringify({ crabObserved, swiftspearObserved, choiceSubmitted, branchProved })}\n${trace.slice(-120).join('\n')}`,
          );
        }
        expect(session.status).toBe('finished');
        await session.close();
        await backend.shutdown?.();
      },
      360_000,
    );
  }

  forgeIt(
    'executes Baneslayer Angel flying, first-strike combat, and lifelink in installed Forge',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BANESLAYER_COMBAT_TABLE)).toEqual([]);
      const opened = await backend.open(BANESLAYER_COMBAT_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let stagedAttacker = false;
      let damageStep: string | null = null;
      let localLifeAfterDamage: number | null = null;
      let opponentLifeAfterDamage: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 800; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        let move = pregameOrManaPayment(decision);

        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          const add = decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.length === 1 &&
              option.targets[0]?.name === 'Baneslayer Angel',
          );
          if (!stagedAttacker && add !== undefined) {
            stagedAttacker = true;
            move = add.id;
          } else {
            move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          }
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const local = session.view.seats[0];
          const opponent = session.view.seats[1];
          if (opponent.life < 20) {
            damageStep ??= session.view.turn.step;
            localLifeAfterDamage ??= local.life;
            opponentLifeAfterDamage ??= opponent.life;
          }
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (untappedSources(session, 'Plains') >= 5 &&
            !session.view.seats[0].battlefield.some((card) => card.name === 'Baneslayer Angel')
              ? decision.options.find((option) => option.text.startsWith('Baneslayer Angel:'))?.id
              : undefined) ??
            (damageStep !== null
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }

        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }

      if (damageStep === null) {
        throw new Error(`never observed Baneslayer combat damage\n${trace.slice(-80).join('\n')}`);
      }
      expect(damageStep).toContain('FIRST_STRIKE');
      expect(localLifeAfterDamage).toBe(25);
      expect(opponentLifeAfterDamage).toBe(15);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'keeps Baneslayer protection fixed to Demon and Dragon sources',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;

      for (const [spec, protectedName] of [
        [BANESLAYER_DRAGON_PROTECTION_TABLE, 'Dragonlord Silumgar'],
        [BANESLAYER_DEMON_PROTECTION_TABLE, 'Griselbrand'],
      ] as const) {
        expect(await backend.supports(spec)).toEqual([]);
        const opened = await backend.open(spec);
        if (!opened.ok) throw new Error(opened.error.message);

        let session: ObservedSession = opened.session;
        let stagedAttacker = false;
        let protectedSourceWasReady = false;
        let opponentLifeBeforeAttack: number | null = null;
        let protectionObserved = false;
        const trace: string[] = [];
        for (let submitted = 0; session.status === 'awaiting' && submitted < 1_200; submitted += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Forge offered no decision');
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}` +
              ` [${session.view.seats[0].battlefield.map((card) => card.name).join(',')}]` +
              ` vs [${session.view.seats[1].battlefield.map((card) => card.name).join(',')}]: ` +
              decision.options.map((option) => option.text).join(' || '),
          );
          let move = decision.options.find(
            (option) => option.text === 'Play first' || option.text === 'Keep this hand',
          )?.id;

          if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          } else if (decision.kind === 'combat-attackers') {
            const localBaneslayer = session.view.seats[0].battlefield.find(
              (card) => card.name === 'Baneslayer Angel',
            );
            const protectedSource = session.view.seats[1].battlefield.find(
              (card) => card.name === protectedName,
            );
            const add = decision.options.find(
              (option) =>
                option.id.startsWith('combat-attack-add-') &&
                option.targets.length === 1 &&
                option.targets[0]?.oid === localBaneslayer?.oid,
            );
            if (!stagedAttacker && protectedSource !== undefined && add !== undefined) {
              expect(protectedSource.tapped).toBe(false);
              protectedSourceWasReady = true;
              stagedAttacker = true;
              opponentLifeBeforeAttack = session.view.seats[1].life;
              move = add.id;
            } else {
              move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
            }
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            const localBaneslayer = session.view.seats[0].battlefield.find(
              (card) => card.name === 'Baneslayer Angel',
            );
            const protectedSource = session.view.seats[1].battlefield.find(
              (card) => card.name === protectedName,
            );
            if (
              stagedAttacker &&
              opponentLifeBeforeAttack !== null &&
              session.view.seats[1].life === opponentLifeBeforeAttack - 5 &&
              localBaneslayer !== undefined &&
              protectedSource !== undefined
            ) {
              protectionObserved = true;
            }
            move =
              decision.options.find((option) => option.text === 'Play Plains')?.id ??
              (untappedSources(session, 'Plains') >= 5 &&
              !session.view.seats[0].battlefield.some((card) => card.name === 'Baneslayer Angel')
                ? decision.options.find((option) => option.text.startsWith('Baneslayer Angel:'))?.id
                : undefined) ??
              (protectionObserved
                ? decision.options.find((option) => option.text === 'Concede')?.id
                : undefined) ??
              decision.options.find((option) => option.text === 'Pass priority')?.id;
          }

          move ??= decision.options[0]?.id;
          if (move === undefined) throw new Error('Forge offered no move');
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
          session = advanced.session;
        }

        if (!protectionObserved) {
          throw new Error(
            `never observed protection from ${protectedName} ${JSON.stringify({
              stagedAttacker,
              protectedSourceWasReady,
              opponentLifeBeforeAttack,
            })}\n${trace.slice(-100).join('\n')}`,
          );
        }
        expect(protectedSourceWasReady).toBe(true);
        expect(session.status).toBe('finished');
        await session.close();
      }

      expect(await backend.supports(BANESLAYER_NONPROTECTED_TABLE)).toEqual([]);
      const opened = await backend.open(BANESLAYER_NONPROTECTED_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      let session: ObservedSession = opened.session;
      let nonprotectedEffectObserved = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options
            .map((option) => option.text)
            .join(' || ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const baneslayer = session.view.seats[0].battlefield.find(
            (card) => card.name === 'Baneslayer Angel',
          );
          if (baneslayer?.power === 3 && baneslayer.toughness === 3) nonprotectedEffectObserved = true;
          move =
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (untappedSources(session, 'Plains') >= 5 &&
            !session.view.seats[0].battlefield.some((card) => card.name === 'Baneslayer Angel')
              ? decision.options.find((option) => option.text.startsWith('Baneslayer Angel:'))?.id
              : undefined) ??
            (nonprotectedEffectObserved
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }
      if (!nonprotectedEffectObserved) {
        throw new Error(`never observed Massacre Wurm affect Baneslayer\n${trace.slice(-80).join('\n')}`);
      }
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'chooses one exact graveyard card for Snapcaster Mage mandatory trigger',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TRIGGER_TARGET_GRAVEYARD_TABLE)).toEqual([]);
      const opened = await backend.open(TRIGGER_TARGET_GRAVEYARD_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(false);
          const graveyardOid = session.view.seats[0].graveyard.find(
            (card) => card.name === 'Flame Rift',
          )?.oid;
          const target = decision.options.find(
            (option) => option.targets[0]?.oid === graveyardOid && option.targets[0]?.name === 'Flame Rift',
          );
          expect(target).toBeDefined();
          selectedOid = target!.targets[0]!.oid;
          move = target!.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = untappedSources(session, 'Volcanic Island');
          const hasRift = session.view.seats[0].graveyard.some((card) => card.name === 'Flame Rift');
          move =
            (selectedOid !== null
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Volcanic Island')?.id ??
            (!hasRift && lands >= 2
              ? decision.options.find((option) => option.text.startsWith('Flame Rift:'))?.id
              : undefined) ??
            (hasRift && lands >= 2
              ? decision.options.find((option) => option.text.startsWith('Snapcaster Mage:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      if (selectedOid === null)
        throw new Error(`never reached Snapcaster graveyard target\n${trace.join('\n')}`);
      expect(selectedOid).toMatch(/^forge-card-/u);
      expect(session.view.seats[0].graveyard.map((card) => card.oid)).toContain(selectedOid);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'routes a mandatory triggered player target through its exact seat MoveId',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TRIGGER_TARGET_PLAYER_TABLE)).toEqual([]);
      const opened = await backend.open(TRIGGER_TARGET_PLAYER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedPlayer = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' || ')}`);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection') {
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(false);
          const opponent = decision.options.filter((option) => option.id === 'target-player-1');
          expect(opponent).toHaveLength(1);
          expect(opponent[0]!.targets).toEqual([]);
          selectedPlayer = true;
          move = opponent[0]!.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = session.view.seats[0].battlefield.filter((card) => card.name === 'Swamp').length;
          move =
            (selectedPlayer ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            (lands >= 3
              ? decision.options.find((option) => option.text.startsWith("Geralf's Messenger:"))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      if (!selectedPlayer) throw new Error(`never reached triggered player target\n${trace.join('\n')}`);
      expect(session.status).toBe('finished');
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'asks the seat whether to use an optional draw trigger instead of answering for it',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(OPTIONAL_TRIGGER_CONFIRM_TABLE)).toEqual([]);
      const opened = await backend.open(OPTIONAL_TRIGGER_CONFIRM_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      // The two halves of the claim: declining draws nothing, accepting draws
      // exactly two. Each is measured against the hand the seat held when the
      // question was asked, not against a count taken a turn earlier.
      let declinedFrom: number | null = null;
      let acceptedFrom: number | null = null;
      let declinedTo: number | null = null;
      let acceptedTo: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const hand = session.view.seats[0].handSize;
        if (declinedFrom !== null && declinedTo === null) declinedTo = hand;
        if (acceptedFrom !== null && acceptedTo === null) acceptedTo = hand;
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (
          decision.kind === 'confirm-optional-self-draw-2' &&
          decision.prompt.startsWith('Consecrated Sphinx:')
        ) {
          // The whole point of the wiring: the seat is asked, in two options,
          // about a draw the inherited AI would have answered silently.
          //
          // The question arrives through `confirmAction` rather than `confirmTrigger`:
          // the trigger itself is mandatory and the *draw* is the optional half,
          // so Forge's DrawEffect asks the controller directly. The bridge proves
          // this exact positive self-draw shape and carries its count in the
          // decision kind.
          expect(decision.options.map((option) => option.id)).toEqual([
            'confirm-optional-self-draw-2-yes',
            'confirm-optional-self-draw-2-no',
          ]);
          expect(decision.options.map((option) => option.text)).toEqual(['Yes', 'No']);
          expect(decision.options[0]!.targets.map((target) => target.name)).toEqual(['Consecrated Sphinx']);
          if (declinedFrom === null) {
            declinedFrom = hand;
            move = decision.options.find((option) => option.id === 'confirm-optional-self-draw-2-no')!.id;
          } else if (declinedTo !== null && acceptedFrom === null) {
            acceptedFrom = hand;
            move = decision.options.find((option) => option.id === 'confirm-optional-self-draw-2-yes')!.id;
          } else {
            move = decision.options.find((option) => option.id === 'confirm-optional-self-draw-2-no')!.id;
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const sphinxes = session.view.seats[0].battlefield.filter(
            (card) => card.name === 'Consecrated Sphinx',
          ).length;
          move =
            (acceptedTo !== null
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            (sphinxes === 0 && untappedSources(session, 'Island') >= 6
              ? decision.options.find((option) => option.text.startsWith('Consecrated Sphinx:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }

      if (declinedTo === null || acceptedTo === null) {
        throw new Error(`never resolved both answers to the Sphinx trigger\n${trace.slice(-80).join('\n')}`);
      }
      expect(declinedTo).toBe(declinedFrom);
      expect(acceptedTo).toBe(acceptedFrom! + 2);
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'proves an OptionalDecider$ You trigger changes the exact selected zone object',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(OPTIONAL_DECIDER_YOU_TABLE)).toEqual([]);
      const opened = await backend.open(OPTIONAL_DECIDER_YOU_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let confirmed = false;
      let selectedOid: string | null = null;
      let observedInHand = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        observedInHand ||=
          selectedOid !== null &&
          (session.view.seats[0].hand?.some((card) => card.oid === selectedOid) ?? false);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'confirm-trigger' && decision.prompt.startsWith('Recruiter of the Guard:')) {
          expect(decision.options.map((option) => option.id)).toEqual([
            'confirm-trigger-yes',
            'confirm-trigger-no',
          ]);
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = true;
        } else if (decision.kind === 'zone-card-selection' && confirmed && selectedOid === null) {
          const courier = decision.options.find((option) => option.targets[0]?.name === 'Bomat Courier');
          expect(courier, trace.slice(-20).join('\n')).toBeDefined();
          selectedOid = courier!.targets[0]!.oid;
          move = courier!.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          move =
            (observedInHand ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (untappedSources(session, 'Plains') >= 3 &&
            !session.view.seats[0].battlefield.some((card) => card.name === 'Recruiter of the Guard')
              ? decision.options.find((option) => option.text.startsWith('Recruiter of the Guard:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }

      const evidence = trace.slice(-80).join('\n');
      expect(confirmed, evidence).toBe(true);
      expect(selectedOid, evidence).not.toBeNull();
      expect(observedInHand, evidence).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'resolves an Adventure and then casts the same card as its creature face from exile',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ALTERNATE_MODE_TABLE)).toEqual([]);
      const opened = await backend.open(ALTERNATE_MODE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let choseAdventure = false;
      let targetedOpponent = false;
      let exiledOid: string | null = null;
      let castCreatureFromExile = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        exiledOid ??=
          session.view.seats[0].exile.find((card) => card.name === 'Bonecrusher Giant')?.oid ?? null;
        const resolvedCreature = session.view.seats[0].battlefield.find(
          (card) => card.name === 'Bonecrusher Giant',
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-selection' && choseAdventure && !targetedOpponent) {
          const opponent = decision.options.find(
            (option) =>
              option.text.includes('Forge AI') || option.targets.some((target) => target.name === 'Forge AI'),
          );
          expect(opponent, trace.slice(-30).join('\n')).toBeDefined();
          move = opponent!.id;
          targetedOpponent = true;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const exileHost = exiledOid?.replace('forge-card-', '');
          const adventure = decision.options.find(
            (option) =>
              option.text.startsWith('Bonecrusher Giant:') &&
              option.text.includes("Damage can't be prevented this turn"),
          );
          const creatureFromExile =
            exileHost === undefined
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.id.startsWith(`ability-${exileHost}-`) && option.text.includes('Creature 4 / 3'),
                );
          move =
            (resolvedCreature !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            (exiledOid !== null && untappedSources(session, 'Mountain') >= 3
              ? creatureFromExile?.id
              : undefined) ??
            (!choseAdventure && untappedSources(session, 'Mountain') >= 2 ? adventure?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          choseAdventure ||= move === adventure?.id;
          castCreatureFromExile ||= move === creatureFromExile?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no alternate-mode move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      const evidence = trace.slice(-120).join('\n');
      const creature = session.view.seats[0].battlefield.find((card) => card.name === 'Bonecrusher Giant');
      expect(choseAdventure, evidence).toBe(true);
      expect(targetedOpponent, evidence).toBe(true);
      expect(session.view.seats[1].life, evidence).toBe(18);
      expect(exiledOid, evidence).toMatch(/^forge-card-/u);
      expect(castCreatureFromExile, evidence).toBe(true);
      expect(creature?.oid, evidence).toBe(exiledOid);
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'plays the reviewed modal double-face card as its land face',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(MODAL_DOUBLE_FACE_TABLE)).toEqual([]);
      const opened = await backend.open(MODAL_DOUBLE_FACE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let selectedLandFace = false;
      let selectedOid: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 300; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        const landFace = session.view.seats[0].battlefield.find((card) => card.oid === selectedOid);
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const playBack = decision.options.find((option) => option.text === 'Play Tangled Florahedron');
          move =
            (landFace !== undefined
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            (!selectedLandFace ? playBack?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          selectedLandFace ||= move === playBack?.id;
          if (playBack !== undefined && move === playBack.id) {
            const host = playBack.id.match(/^ability-(\d+)-/u)?.[1];
            selectedOid = host === undefined ? null : `forge-card-${host}`;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no modal-face move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-80).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-100).join('\n')}\nbattlefield=${JSON.stringify(
        session.view.seats[0].battlefield,
      )}`;
      const landFace = session.view.seats[0].battlefield.find((card) => card.oid === selectedOid);
      expect(selectedLandFace, evidence).toBe(true);
      expect(selectedOid, evidence).toMatch(/^forge-card-/u);
      expect(landFace?.typeLine, evidence).toContain('Land');
      expect(
        session.view.seats[0].battlefield.some(
          (card) => card.name === 'Tangled Florahedron' && card.typeLine.includes('Creature'),
        ),
        evidence,
      ).toBe(false);
      await session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'transforms the reviewed double-face permanent after its installed trigger condition',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(TRANSFORM_FACE_TABLE)).toEqual([]);
      const opened = await backend.open(TRANSFORM_FACE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let avacynOid: string | null = null;
      let sacrificedSpirit = false;
      let transformed = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const local = session.view.seats[0];
        avacynOid ??= local.battlefield.find((card) => card.name === 'Archangel Avacyn')?.oid ?? null;
        transformed ||=
          avacynOid !== null &&
          local.battlefield.some((card) => card.oid === avacynOid && card.name === 'Avacyn, the Purifier');
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const plains = untappedSources(session, 'Plains');
          const spirit = local.battlefield.find((card) => card.name === 'Selfless Spirit');
          const activation = decision.options.find(
            (option) =>
              option.text.startsWith('Selfless Spirit:') &&
              option.text.includes('gain indestructible until end of turn'),
          );
          move =
            (transformed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (spirit === undefined && plains >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Selfless Spirit:') &&
                    !option.text.includes('gain indestructible until end of turn'),
                )?.id
              : undefined) ??
            (avacynOid === null && plains >= 5
              ? decision.options.find((option) => option.text.startsWith('Archangel Avacyn:'))?.id
              : undefined) ??
            (!sacrificedSpirit && avacynOid !== null ? activation?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          sacrificedSpirit ||= move === activation?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no transform-face move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-100).join('\n')}`);
        session = advanced.session;
      }

      const evidence = `${trace.slice(-120).join('\n')}\nbattlefield=${JSON.stringify(
        session.view.seats[0].battlefield,
      )}`;
      expect(avacynOid, evidence).toMatch(/^forge-card-/u);
      expect(sacrificedSpirit, evidence).toBe(true);
      expect(transformed, evidence).toBe(true);
      expect(
        session.view.seats[0].battlefield.some(
          (card) => card.oid === avacynOid && card.name === 'Avacyn, the Purifier',
        ),
        evidence,
      ).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    240_000,
  );

  forgeIt(
    'loads a fully transpiled custom script before opening a mixed match',
    async () => {
      const backend = installedForgeBackend({
        timeoutMs: 120_000,
        resolveCustomSet: async (setCode) => (setCode === 'CSTM' ? [SHARED_SPARK] : null),
      });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(MIXED_TABLE)).toEqual([]);
      const opened = await backend.open(MIXED_TABLE);
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(opened.error.message);
      expect(opened.session.table).toBe(MIXED_TABLE);
      let secondSettled = false;
      const secondPromise = backend.open(MIXED_TABLE).then((result) => {
        secondSettled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondSettled).toBe(false);
      await opened.session.close();
      const second = await secondPromise;
      expect(second.ok).toBe(true);
      if (second.ok) await second.session.close();
      await backend.shutdown?.();
    },
    180_000,
  );

  forgeIt(
    'asks the seat which cards to discard and stops early on the artifact it named',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BOUNDED_DISCARD_SELECTION_TABLE)).toEqual([]);
      const opened = await backend.open(BOUNDED_DISCARD_SELECTION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      // Both halves of the stopping rule, measured against the hand the seat
      // held when it was asked: naming the artifact ends the selection one card
      // in, and naming anything else runs to the count.
      const observed: { readonly branch: string; readonly before: number; readonly after: number }[] = [];
      let pending: { readonly branch: string; readonly before: number } | null = null;
      let casts = 0;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const hand = session.view.seats[0].handSize;
        const subject =
          decision.kind === 'discard-selection' && !decision.prompt.startsWith('Discard down to');
        if (pending !== null && !subject) {
          observed.push({ ...pending, after: hand });
          pending = null;
        }
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'discard-selection' && decision.prompt.startsWith('Discard down to')) {
          // Cleanup shares the kind and is not the subject: a seat that holds
          // its artifacts to keep both branches reachable also holds too many
          // cards, so this arrives and is answered without being counted.
          move = decision.options.find((option) => option.targets[0]?.name === 'Island')?.id;
        } else if (decision.kind === 'discard-selection') {
          expect(decision.prompt).toContain('Thirst for Knowledge: Discard 2 cards, or discard artifact');
          const chosen = Number(/\((\d+) of (\d+) chosen\)/u.exec(decision.prompt)?.[1] ?? '-1');
          const done = decision.options.find((option) => option.id === 'discard-selection-done');
          const heart = decision.options.find((option) => option.targets[0]?.name === 'Coldsteel Heart');
          const other = decision.options.find(
            (option) => option.targets[0] !== undefined && option.targets[0].name !== 'Coldsteel Heart',
          );
          // Every option is a card the seat is actually holding, named by the
          // identity Forge issued rather than by anything the caller invented.
          const handOids = new Set(session.view.seats[0].hand?.map((card) => card.oid));
          expect(
            decision.options.every(
              (option) =>
                option.id === 'discard-selection-done' || handOids.has(option.targets[0]?.oid ?? ''),
            ),
          ).toBe(true);
          if (chosen === 0) {
            expect(done, 'a two-card discard offered Done before anything was chosen').toBeUndefined();
            const artifactBranch = heart !== undefined && !observed.some((run) => run.branch === 'artifact');
            pending = { branch: artifactBranch ? 'artifact' : 'plain', before: hand };
            move = (artifactBranch ? heart : other)?.id;
          } else if (pending?.branch === 'artifact') {
            expect(chosen).toBe(1);
            expect(done, 'naming the artifact did not end the selection').toBeDefined();
            move = done?.id;
          } else {
            expect(chosen).toBe(1);
            expect(done, 'a plain discard offered Done one card short of the count').toBeUndefined();
            move = other?.id;
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const lands = untappedSources(session, 'Island');
          const enough = new Set(observed.map((run) => run.branch)).size === 2;
          const cast =
            lands >= 3 && !enough && casts < 8
              ? decision.options.find((option) => option.text.startsWith('Thirst for Knowledge:'))
              : undefined;
          if (cast !== undefined) casts += 1;
          move =
            decision.options.find((option) => option.text === 'Play Island')?.id ??
            cast?.id ??
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      const artifact = observed.find((run) => run.branch === 'artifact');
      const plain = observed.find((run) => run.branch === 'plain');
      if (artifact === undefined || plain === undefined) {
        throw new Error(`never reached both discard branches\n${trace.slice(-80).join('\n')}`);
      }
      expect(artifact.after).toBe(artifact.before - 1);
      expect(plain.after).toBe(plain.before - 2);
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'asks the seat which mode to take instead of letting the AI pick one',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BOUNDED_MODE_SELECTION_TABLE)).toEqual([]);
      const opened = await backend.open(BOUNDED_MODE_SELECTION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let modeAsked = false;
      let lifeBefore: number | null = null;
      let lifeAfter: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 900; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const life = session.view.seats[0].life;
        // The mode is chosen as the trigger goes on the stack, so the life total
        // it names has not moved yet at that decision or at the next one. What
        // proves the seat's own answer was taken is the first move afterwards.
        if (lifeBefore !== null && lifeAfter === null && life !== lifeBefore) lifeAfter = life;
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'mode-selection') {
          // The modes arrive as the card's own three lines, not as an answer
          // the inherited AI already gave. Only one of them is checkable
          // without a target, so that is the one this seat takes.
          expect(decision.prompt).toContain("Knight of Autumn: Choose Knight of Autumn's modes");
          expect(decision.options.some((option) => option.text.includes('You gain 4 life.'))).toBe(true);
          expect(decision.options.some((option) => option.text.includes('+1/+1 counters'))).toBe(true);
          expect(decision.options.every((option) => option.id.startsWith('mode-selection-'))).toBe(true);
          modeAsked = true;
          lifeBefore ??= life;
          move = decision.options.find((option) => option.text.includes('You gain 4 life.'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          move =
            (lifeAfter !== null
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Forest' || option.text === 'Play Plains')
              ?.id ??
            (untappedSources(session, 'Forest') >= 1 &&
            untappedSources(session, 'Plains') >= 1 &&
            untappedSources(session, 'Forest') + untappedSources(session, 'Plains') >= 3
              ? decision.options.find((option) => option.text.startsWith('Knight of Autumn:'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (!modeAsked || lifeBefore === null || lifeAfter === null) {
        throw new Error(`never resolved a chosen mode\n${trace.slice(-80).join('\n')}`);
      }
      expect(lifeAfter).toBe(lifeBefore + 4);
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'asks the seat which protection quality and which mode, out of the lists the cards wrote',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BOUNDED_PROTECTION_AND_MODE_TABLE)).toEqual([]);
      const opened = await backend.open(BOUNDED_PROTECTION_AND_MODE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let protectionOffered: readonly string[] | null = null;
      let modeOffered: readonly string[] | null = null;
      let brightlingBefore: string | null = null;
      let brightlingAfter: string | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1200; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const board = session.view.seats[0].battlefield;
        const brightling = board.find((card) => card.name === 'Brightling');
        const shape =
          brightling === undefined ? null : `${String(brightling.power)}/${String(brightling.toughness)}`;
        // The pump resolves after the mode is taken, so the board only says which
        // mode was taken at the first decision that follows it.
        if (
          brightlingBefore !== null &&
          brightlingAfter === null &&
          shape !== null &&
          shape !== brightlingBefore
        ) {
          brightlingAfter = shape;
        }
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'protection-choice') {
          // The five qualities Mother of Runes' own script lists, offered to the
          // seat rather than settled by the controller it inherits from.
          expect(decision.prompt).toContain('Mother of Runes');
          const qualities = decision.options.map((option) => optionLabel(option.text).toLowerCase());
          expect([...qualities].sort()).toEqual(['black', 'blue', 'green', 'red', 'white']);
          expect(decision.options.every((option) => option.id.startsWith('protection-choice-'))).toBe(true);
          protectionOffered = qualities;
          move = decision.options.find((option) => optionLabel(option.text).toLowerCase() === 'blue')?.id;
        } else if (decision.kind === 'ability-selection' && decision.prompt.startsWith('Brightling')) {
          const modes = decision.options.map((option) => option.text);
          expect(modes).toHaveLength(2);
          expect(modes.some((text) => text.includes('+1/-1'))).toBe(true);
          expect(modes.some((text) => text.includes('-1/+1'))).toBe(true);
          expect(decision.options.every((option) => option.id.startsWith('ability-selection-'))).toBe(true);
          modeOffered = modes;
          brightlingBefore ??= shape;
          move = decision.options.find((option) => option.text.includes('+1/-1'))?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id !== 'target-cancel')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const holds = (name: string): boolean => board.some((card) => card.name === name);
          const enough = protectionOffered !== null && brightlingAfter !== null;
          const activateMother =
            protectionOffered === null
              ? decision.options.find((option) => option.text.includes('protection from the color'))
              : undefined;
          const activateMode =
            modeOffered === null && untappedSources(session, 'Plains') >= 1
              ? decision.options.find((option) => option.text.includes('+1/-1 or -1/+1'))
              : undefined;
          move =
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            activateMother?.id ??
            activateMode?.id ??
            (holds('Mother of Runes') || untappedSources(session, 'Plains') < 1
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.text.startsWith('Mother of Runes') && !option.text.includes('protection'),
                )?.id) ??
            (holds('Brightling') || untappedSources(session, 'Plains') < 3
              ? undefined
              : decision.options.find(
                  (option) =>
                    option.text.startsWith('Brightling') && !option.text.includes('until end of turn'),
                )?.id) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (protectionOffered === null || modeOffered === null || brightlingAfter === null) {
        throw new Error(`never reached both bounded choices\n${trace.slice(-80).join('\n')}`);
      }
      // The mode the seat took is the mode that resolved: +1/-1 off a 3/3 is a
      // 4/2, and the other option would have made it a 2/4.
      expect(brightlingBefore).toBe('3/3');
      expect(brightlingAfter).toBe('4/2');
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'lets the seat name the color its opponent then cannot cast, and the type it is protected from',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BOUNDED_COLOR_AND_TYPE_TABLE)).toEqual([]);
      const opened = await backend.open(BOUNDED_COLOR_AND_TYPE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let colorOffered: readonly string[] | null = null;
      let typeOffered: readonly string[] | null = null;
      let wallsWhenNamed = 0;
      let handWhenNamed = 0;
      let namedTurn: number | null = null;
      let wallsSince = 0;
      let handSince = 0;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const opponent = session.view.seats[1];
        const walls = opponent.battlefield.filter((card) => card.name === 'Wall of Omens').length;
        if (colorOffered === null) {
          wallsWhenNamed = walls;
          handWhenNamed = opponent.handSize;
        } else {
          namedTurn ??= session.view.turn.number;
          wallsSince = Math.max(wallsSince, walls);
          handSince = Math.max(handSince, opponent.handSize);
        }
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((o) => o.text)
            .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'color-choice') {
          expect(decision.prompt).toContain('Iona, Shield of Emeria');
          const colors = decision.options.map((option) => optionLabel(option.text).toLowerCase());
          expect([...colors].sort()).toEqual([
            'choose black',
            'choose blue',
            'choose green',
            'choose red',
            'choose white',
          ]);
          expect([...decision.options].map((option) => option.id).sort()).toEqual([
            'color-choice-B',
            'color-choice-G',
            'color-choice-R',
            'color-choice-U',
            'color-choice-W',
          ]);
          colorOffered = colors;
          move = decision.options.find((option) => option.id === 'color-choice-W')?.id;
        } else if (decision.kind === 'type-choice') {
          expect(decision.prompt).toContain("Serra's Emissary");
          const types = decision.options.map((option) => optionLabel(option.text));
          // Forge's own card types. The keyword this answer grants is not in the
          // projection, so what is checkable here is the question rather than
          // its effect, and the question is the card's own list.
          expect(types).toContain('Creature');
          expect(types).toContain('Instant');
          expect(types).toContain('Land');
          expect(decision.options.every((option) => option.id.startsWith('type-choice-'))).toBe(true);
          expect(decision.options.some((option) => option.id === 'type-choice-Creature')).toBe(true);
          typeOffered = types;
          move =
            decision.options.find((option) => optionLabel(option.text) === 'Instant')?.id ??
            decision.options[0]?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id !== 'target-cancel')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          // Eight turns after the color is named is long enough for the opponent
          // to have drawn several more of the walls it can no longer cast.
          const enough =
            typeOffered !== null && namedTurn !== null && session.view.turn.number >= namedTurn + 8;
          move =
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (untappedSources(session, 'Plains') >= 7 && typeOffered === null
              ? decision.options.find((option) => option.text.startsWith("Serra's Emissary"))?.id
              : undefined) ??
            (untappedSources(session, 'Plains') >= 9 && colorOffered === null
              ? decision.options.find((option) => option.text.startsWith('Iona, Shield of Emeria'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (colorOffered === null || typeOffered === null) {
        throw new Error(`never named a color and a type\n${trace.slice(-80).join('\n')}`);
      }
      // Vacuous unless the opponent was casting those walls before the seat named
      // their color: what is measured is that naming white stopped it.
      expect(wallsWhenNamed).toBeGreaterThan(0);
      expect(wallsSince).toBe(wallsWhenNamed);
      expect(handSince).toBeGreaterThan(handWhenNamed);
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );

  forgeIt(
    'casts the seat its own vote rather than having the controller it inherits from cast one',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 120_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(BOUNDED_VOTE_TABLE)).toEqual([]);
      const opened = await backend.open(BOUNDED_VOTE_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let portalOffered: readonly string[] | null = null;
      let judgmentOffered: readonly string[] | null = null;
      let votedFor: { readonly oid: string; readonly walls: readonly string[] } | null = null;
      let survivors: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const opponent = session.view.seats[1];
        const wallOids = opponent.battlefield
          .filter((card) => card.name === 'Wall of Omens')
          .map((card) => card.oid);
        const standing = new Set(wallOids);
        if (votedFor !== null && survivors === null && !standing.has(votedFor.oid)) {
          survivors = votedFor.walls.filter((oid) => standing.has(oid)).length;
        }
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((o) => o.text).join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'ability-selection' && decision.prompt.startsWith('Coercive Portal')) {
          // The two the card's own script names, offered to the seat.
          const options = decision.options.map((option) => optionLabel(option.text));
          expect(options).toHaveLength(2);
          expect(options.some((text) => text.includes('Carnage'))).toBe(true);
          expect(options.some((text) => text.includes('Homage'))).toBe(true);
          portalOffered = options;
          move = decision.options.find((option) => option.text.includes('Homage'))?.id;
        } else if (decision.kind === 'entity-selection' && decision.prompt.startsWith("Council's Judgment")) {
          // Three or more so at least one permanent survives whichever way the
          // other voter votes: a tie exiles both, a shared vote exiles one.
          expect(decision.options.length).toBeGreaterThanOrEqual(3);
          expect(decision.options.every((option) => option.targets[0]?.name === 'Wall of Omens')).toBe(true);
          expect(decision.options.every((option) => standing.has(option.targets[0]?.oid ?? ''))).toBe(true);
          judgmentOffered = decision.options.map((option) => option.text);
          const chosen = decision.options[0];
          const target = chosen?.targets[0];
          if (chosen === undefined || target === undefined) {
            throw new Error('the vote offered no permanent');
          }
          votedFor = { oid: target.oid, walls: wallOids };
          move = chosen.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id !== 'target-cancel')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const holdsPortal = session.view.seats[0].battlefield.some(
            (card) => card.name === 'Coercive Portal',
          );
          const enough = portalOffered !== null && survivors !== null;
          move =
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            (holdsPortal || untappedSources(session, 'Plains') < 4
              ? undefined
              : decision.options.find((option) => option.text.startsWith('Coercive Portal'))?.id) ??
            (votedFor === null && wallOids.length >= 3 && untappedSources(session, 'Plains') >= 3
              ? decision.options.find((option) => option.text.startsWith("Council's Judgment"))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (portalOffered === null || judgmentOffered === null || survivors === null) {
        throw new Error(`never reached both votes\n${trace.slice(-80).join('\n')}`);
      }
      // The permanent this seat voted for is gone and permanents it did not vote
      // for are still standing, which is the vote having been the seat's own.
      expect(survivors).toBeGreaterThan(0);
      await session.close();
      await backend.shutdown?.();
    },
    300_000,
  );

  forgeIt(
    'states the X in a cost itself rather than letting the controller it inherits from state one',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(ANNOUNCED_NUMBER_TABLE)).toEqual([]);
      const opened = await backend.open(ANNOUNCED_NUMBER_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      // Two, off a spinner that reaches further. An announcement is only the
      // seat's own when a larger one was standing there unchosen: Forge's AI
      // spends the board on an X, so a serpent smaller than the mana in front of
      // it is the seat having answered.
      const ANNOUNCED = 2;
      let session: ObservedSession = opened.session;
      let serpentStops: readonly number[] | null = null;
      let serpentPt: string | null = null;
      let delugeStops: readonly number[] | null = null;
      let lifeAnnouncing: number | null = null;
      let wallsAnnouncing: number | null = null;
      let lifeAfter: number | null = null;
      let wallsAfter: number | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const seat = session.view.seats[0];
        const lands = seat.battlefield.filter((card) => card.name === 'Swamp').length;
        const walls = session.view.seats[1].battlefield.filter(
          (card) => card.name === 'Wall of Omens',
        ).length;
        const serpent = seat.battlefield.find((card) => card.name === 'Stonecoil Serpent');
        if (serpentPt === null && serpent !== undefined) {
          serpentPt = `${String(serpent.power)}/${String(serpent.toughness)}`;
        }
        if (
          delugeStops !== null &&
          lifeAfter === null &&
          seat.graveyard.some((card) => card.name === 'Toxic Deluge')
        ) {
          lifeAfter = seat.life;
          wallsAfter = walls;
        }
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((o) => o.text)
            .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'number') {
          // The stops the bridge's spinner drew, without the two moves that only
          // slide the window along the range.
          const stops = decision.options
            .filter((option) => /^number-\d+$/u.test(option.id))
            .map((option) => Number(option.id.slice('number-'.length)));
          const chosen = decision.options.find((option) => option.id === `number-${String(ANNOUNCED)}`)?.id;
          if (decision.prompt.startsWith('Stonecoil Serpent')) {
            serpentStops = stops;
            move = chosen;
          } else if (decision.prompt.startsWith('Toxic Deluge')) {
            delugeStops = stops;
            lifeAnnouncing = seat.life;
            wallsAnnouncing = walls;
            move = chosen;
          }
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id !== 'target-cancel')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const enough = serpentPt !== null && lifeAfter !== null;
          move =
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Swamp')?.id ??
            // Five lands before the serpent, so the spinner it announces off has
            // room above the two the seat asks for.
            (serpentStops === null && lands >= 5
              ? decision.options.find((option) => option.text.startsWith('Stonecoil Serpent'))?.id
              : undefined) ??
            (serpentPt !== null && delugeStops === null && lands >= 4
              ? decision.options.find((option) => option.text.startsWith('Toxic Deluge'))?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (
        serpentStops === null ||
        serpentPt === null ||
        delugeStops === null ||
        lifeAnnouncing === null ||
        wallsAnnouncing === null ||
        lifeAfter === null ||
        wallsAfter === null
      ) {
        throw new Error(`never announced both numbers\n${trace.slice(-80).join('\n')}`);
      }
      // A bigger serpent was on the spinner when the seat asked for a smaller
      // one, and the board carries the number it asked for.
      expect(serpentStops).toContain(0);
      expect(Math.max(...serpentStops)).toBeGreaterThan(ANNOUNCED);
      expect(serpentPt).toBe(`${String(ANNOUNCED)}/${String(ANNOUNCED)}`);
      // The life the deluge cost is that same stated number, spent through the
      // cost seam rather than by the inherited decision maker, and the walls it
      // did not reach are still standing: an announcement large enough to clear
      // a 0/4 board was offered and declined.
      expect(Math.max(...delugeStops)).toBeGreaterThan(ANNOUNCED + 1);
      expect(lifeAnnouncing - lifeAfter).toBe(ANNOUNCED);
      expect(wallsAnnouncing).toBeGreaterThan(0);
      expect(wallsAfter).toBe(wallsAnnouncing);
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );
  forgeIt(
    'puts the cards back in the order the seat stated rather than the one it inherits',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(STATED_ORDERING_TABLE)).toEqual([]);
      const opened = await backend.open(STATED_ORDERING_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      // Every claim below is about one named object rather than one card name,
      // because this deck runs twelve of each spell and a name would let a
      // second copy stand in for the answer the seat gave.
      let surveilOid: string | null = null;
      let surveilBinned = false;
      let scryMoveOptionIds: readonly string[] | null = null;
      let scryKeepOptionIds: readonly string[] | null = null;
      let scryTopOid: string | null = null;
      let scryTopDrawn = false;
      let zoneOrderOptionIds: readonly string[] | null = null;
      let zoneTopOid: string | null = null;
      let zoneSecondOid: string | null = null;
      let zoneTopBackFirst: boolean | null = null;
      let channelerCast = false;
      let preordainCast = false;
      let brainstormCast = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const seat = session.view.seats[0];
        const hand = seat.hand ?? [];
        const lands = seat.battlefield.filter((card) => card.name === 'Volcanic Island').length;
        const channelers = seat.battlefield.filter((card) => card.name === "Dragon's Rage Channeler").length;
        if (surveilOid !== null && !surveilBinned) {
          surveilBinned = seat.graveyard.some((card) => card.oid === surveilOid);
        }
        if (scryTopOid !== null && !scryTopDrawn) {
          scryTopDrawn = hand.some((card) => card.oid === scryTopOid);
        }
        if (zoneTopOid !== null && zoneSecondOid !== null && zoneTopBackFirst === null) {
          const topBack = hand.some((card) => card.oid === zoneTopOid);
          const secondBack = hand.some((card) => card.oid === zoneSecondOid);
          if (topBack || secondBack) zoneTopBackFirst = topBack && !secondBack;
        }
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((option) => `${option.text}#${option.targets.map((target) => target.oid).join(',')}`)
            .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        const oidOf = (id: string): string => {
          const found = decision.options.find((option) => option.id === id);
          const oid = found?.targets[0]?.oid;
          if (oid === undefined) throw new Error(`option ${id} named no object`);
          return oid;
        };
        if (decision.kind === 'surveil-move') {
          // Once. The graveyard is the observation, and a second trip through
          // this callback would be binning the card Brainstorm just stated was
          // on top.
          if (surveilOid === null) {
            const pick = decision.options.find((option) => option.id !== 'surveil-move-done');
            if (pick !== undefined) {
              surveilOid = oidOf(pick.id);
              move = pick.id;
            }
          } else {
            move = decision.options.find((option) => option.id === 'surveil-move-done')?.id;
          }
        } else if (decision.kind === 'scry-move') {
          // Declining is the half of the partition that makes the order below
          // it a real question: both cards stay on top, so the seat has to say
          // which of the two it is looking at goes first.
          scryMoveOptionIds ??= decision.options.map((option) => option.id);
          move = decision.options.find((option) => option.id === 'scry-move-done')?.id;
        } else if (decision.kind === 'scry-keep') {
          if (scryTopOid === null) {
            scryKeepOptionIds = decision.options.map((option) => option.id);
            const pick = decision.options[0];
            if (pick !== undefined) {
              scryTopOid = oidOf(pick.id);
              move = pick.id;
            }
          }
        } else if (decision.kind === 'zone-order' || decision.kind === 'zone-order-library-top-first') {
          if (zoneTopOid === null) {
            zoneOrderOptionIds = decision.options.map((option) => option.id);
            const first = decision.options[0];
            const second = decision.options[1];
            if (first !== undefined && second !== undefined) {
              zoneTopOid = oidOf(first.id);
              zoneSecondOid = oidOf(second.id);
              move = first.id;
            }
          }
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id !== 'target-cancel')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const enough = surveilBinned && scryTopDrawn && zoneTopBackFirst !== null;
          const castChanneler: string | undefined =
            !channelerCast && channelers === 0 && lands >= 1
              ? decision.options.find((option) => option.text.startsWith("Dragon's Rage Channeler"))?.id
              : undefined;
          const castPreordain: string | undefined =
            !preordainCast && channelers > 0 && lands >= 1
              ? decision.options.find((option) => option.text.startsWith('Preordain'))?.id
              : undefined;
          // Brainstorm goes last, so the card it states is on top is the next
          // one drawn rather than one more scry away.
          const castBrainstorm: string | undefined =
            preordainCast && scryTopDrawn && !brainstormCast && lands >= 1
              ? decision.options.find((option) => option.text.startsWith('Brainstorm'))?.id
              : undefined;
          move =
            (enough ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Volcanic Island')?.id ??
            castChanneler ??
            castPreordain ??
            castBrainstorm ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          channelerCast ||= move !== undefined && move === castChanneler;
          preordainCast ||= move !== undefined && move === castPreordain;
          brainstormCast ||= move !== undefined && move === castBrainstorm;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (
        surveilOid === null ||
        scryMoveOptionIds === null ||
        scryKeepOptionIds === null ||
        scryTopOid === null ||
        zoneOrderOptionIds === null ||
        zoneTopOid === null ||
        zoneSecondOid === null ||
        zoneTopBackFirst === null
      ) {
        throw new Error(`never reached all three orderings\n${trace.slice(-120).join('\n')}`);
      }
      // The partition offered a bottom for each of the two cards and a way to
      // send neither, and the order underneath it was asked over both.
      expect(scryMoveOptionIds).toHaveLength(3);
      expect(scryMoveOptionIds).toContain('scry-move-done');
      expect(scryKeepOptionIds).toHaveLength(2);
      expect(zoneOrderOptionIds).toHaveLength(2);
      // And the three answers were obeyed: the surveilled card is in the
      // graveyard the seat sent it to, the card it left on top is the card it
      // drew, and the card it put on top of its library came back before the
      // one it put underneath.
      expect(surveilBinned).toBe(true);
      expect(scryTopDrawn).toBe(true);
      expect(zoneTopBackFirst).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );
  forgeIt(
    'splits the damage where the seat put it rather than where the AI would have',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(STATED_DISTRIBUTION_TABLE)).toEqual([]);
      const opened = await backend.open(STATED_DISTRIBUTION_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let firstPointOids: readonly string[] | null = null;
      let secondPointOids: readonly string[] | null = null;
      let firstTaker: string | null = null;
      let secondTaker: string | null = null;
      let elvesWhenAssigned: readonly string[] | null = null;
      let survivorStanding = false;
      let takersGone = false;
      let electrolyzeCast = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const seat = session.view.seats[0];
        const opponent = session.view.seats[1];
        const lands = seat.battlefield.filter((card) => card.name === 'Volcanic Island').length;
        const elves = opponent.battlefield
          .filter((card) => card.name === 'Llanowar Elves')
          .map((card) => card.oid);
        if (firstTaker !== null && secondTaker !== null && !takersGone) {
          takersGone = !elves.includes(firstTaker) && !elves.includes(secondTaker);
          survivorStanding ||=
            takersGone &&
            (elvesWhenAssigned ?? []).some(
              (oid) => oid !== firstTaker && oid !== secondTaker && elves.includes(oid),
            );
        }
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((option) => `${option.text}#${option.targets.map((target) => target.oid).join(',')}`)
            .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'target-distribution') {
          // One point at a time, and each point goes to a creature this seat
          // names by id. The second point deliberately goes somewhere the first
          // did not, which is the whole choice: the same creature was offered
          // again and a two-and-nothing was there to be taken.
          const takers = decision.options.filter((option) => elves.includes(option.targets[0]?.oid ?? ''));
          const oids = decision.options.map((option) => option.targets[0]?.oid ?? '');
          if (firstTaker === null) {
            const pick = takers[0];
            if (pick !== undefined) {
              firstPointOids = oids;
              elvesWhenAssigned = elves;
              firstTaker = pick.targets[0]?.oid ?? null;
              move = pick.id;
            }
          } else if (secondTaker === null) {
            const pick = takers.find((option) => option.targets[0]?.oid !== firstTaker);
            if (pick !== undefined) {
              secondPointOids = oids;
              secondTaker = pick.targets[0]?.oid ?? null;
              move = pick.id;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          // Three elves is what makes a survivor mean something, so the spell
          // waits for a board it can leave one standing on.
          const castElectrolyze: string | undefined =
            !electrolyzeCast && lands >= 3 && elves.length >= 3
              ? decision.options.find((option) => option.text.startsWith('Electrolyze'))?.id
              : undefined;
          move =
            (survivorStanding
              ? decision.options.find((option) => option.text === 'Concede')?.id
              : undefined) ??
            decision.options.find((option) => option.text === 'Play Volcanic Island')?.id ??
            castElectrolyze ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          electrolyzeCast ||= move !== undefined && move === castElectrolyze;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (
        firstPointOids === null ||
        secondPointOids === null ||
        firstTaker === null ||
        secondTaker === null
      ) {
        throw new Error(`never divided the damage\n${trace.slice(-120).join('\n')}`);
      }
      // Two assignments for two points, over a board that could have taken both
      // on one creature: the creature the first point went to was offered again
      // for the second, and the seat sent it elsewhere.
      expect(firstTaker).not.toBe(secondTaker);
      expect(firstPointOids).toContain(secondTaker);
      expect(secondPointOids).toContain(firstTaker);
      // And the board reads back the division rather than the amount: both
      // creatures the seat named are dead, which one point each is lethal for
      // and two on either one is not, and a third is still standing.
      expect(takersGone).toBe(true);
      expect(survivorStanding).toBe(true);
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );
  forgeIt(
    'takes its own spell\u0027s target away and pays the Phyrexian half in life',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(STATED_RETARGET_TABLE)).toEqual([]);
      const opened = await backend.open(STATED_RETARGET_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let skiteOid: string | null = null;
      let boltTarget: string | null = null;
      let phyrexianLabel: string | null = null;
      let lifeBeforePhyrexian: number | null = null;
      let lifeAfterPhyrexian: number | null = null;
      let readLifeNext = false;
      let activated = false;
      let retargetPrompt: string | null = null;
      let retargetLabels: readonly string[] | null = null;
      let retargetTaken: string | null = null;
      let opponentLifeWhenBurned: number | null = null;
      let burned = false;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const seat = session.view.seats[0];
        const opponent = session.view.seats[1];
        const lands = seat.battlefield.filter((card) => card.name === 'Volcanic Island').length;
        const skites = seat.battlefield.filter((card) => card.name === 'Spellskite');
        const boltOnStack = session.view.stack.some((object) => object.name === 'Lightning Bolt');
        if (readLifeNext) {
          lifeAfterPhyrexian = seat.life;
          readLifeNext = false;
        }
        if (retargetTaken !== null && !burned) {
          const burnt = skites.find((card) => card.oid === skiteOid && card.damage === 3);
          if (burnt !== undefined) {
            opponentLifeWhenBurned = opponent.life;
            burned = true;
          }
        }
        trace.push(
          `t${String(session.view.turn.number)} ${decision.kind}: ${decision.prompt} || ${decision.options
            .map((option) => option.text)
            .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'retarget') {
          // The whole decision: one of these pairs is going to move, and the
          // seat says which. Only the Bolt is ever on this stack, so the pair
          // it names is the Bolt's own target being taken off the AI player.
          retargetPrompt = decision.prompt;
          retargetLabels = decision.options.map((option) => optionLabel(option.text));
          const pick = decision.options.find((option) => option.id.includes('-player-'));
          if (pick === undefined) throw new Error(`no player target to take\n${trace.slice(-6).join('\n')}`);
          retargetTaken = optionLabel(pick.text);
          move = pick.id;
        } else if (decision.kind === 'target-selection') {
          if (skiteOid !== null && boltOnStack && activated) {
            // Activating Spellskite: its own target is the spell whose targets
            // it will change, which is the Bolt this seat just cast.
            move = decision.options.find((option) => option.id.startsWith('target-stack-'))?.id;
          }
          move ??= decision.options.find((option) => option.id === 'target-player-1')?.id;
          boltTarget ??=
            move === undefined
              ? null
              : optionLabel(decision.options.find((option) => option.id === move)?.text ?? '');
        } else if (decision.kind === 'mana-payment') {
          // The Phyrexian arm is preferred wherever it is offered, and it is
          // offered nowhere but this cube position: the seat pays two life for
          // a mana it could also have tapped a dual land for.
          const phyrexian = decision.options.find((option) => option.id === 'mana-payment-phyrexian-life');
          if (phyrexian !== undefined) {
            phyrexianLabel = optionLabel(phyrexian.text);
            lifeBeforePhyrexian ??= seat.life;
            readLifeNext = true;
            move = phyrexian.id;
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castSkite: string | undefined =
            skites.length === 0 && lands >= 2
              ? decision.options.find(
                  (option) =>
                    option.text.startsWith('Spellskite') && !option.text.includes('Change a target'),
                )?.id
              : undefined;
          const castBolt: string | undefined =
            skiteOid !== null && lands >= 3 && !boltOnStack && retargetTaken === null
              ? decision.options.find((option) => option.text.startsWith('Lightning Bolt'))?.id
              : undefined;
          const activate: string | undefined =
            boltOnStack && !activated
              ? decision.options.find((option) => option.text.includes('Change a target'))?.id
              : undefined;
          move =
            (burned ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            decision.options.find((option) => option.text === 'Play Volcanic Island')?.id ??
            castSkite ??
            activate ??
            castBolt ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= activate !== undefined && move === activate;
          if (castSkite !== undefined && move === castSkite) {
            // The move id carries the host card, and the projection keys the
            // same card, so the creature this seat is about to burn is named by
            // id rather than by a name seventeen copies share.
            const host: string | undefined = /^ability-(\d+)-/u.exec(castSkite)?.[1];
            if (host === undefined) throw new Error(`unreadable ability id ${castSkite}`);
            skiteOid = `forge-card-${host}`;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (retargetTaken === null || phyrexianLabel === null) {
        throw new Error(`never reached the retarget\n${trace.slice(-120).join('\n')}`);
      }
      // The cost was the choice this phase added: two life for a symbol a dual
      // land on the battlefield could have paid instead.
      expect(phyrexianLabel).toBe('Pay 2 life for a Phyrexian mana');
      expect(lifeAfterPhyrexian).toBe((lifeBeforePhyrexian ?? 0) - 2);
      // The retarget was asked about a stack object this seat put there, and it
      // named the target rather than the spell.
      expect(retargetPrompt).toContain('Spellskite');
      expect(retargetLabels).toHaveLength(1);
      expect(retargetTaken).toContain("Lightning Bolt's target");
      expect(boltTarget).toBe('Target Forge AI');
      // And the board is the assertion. The Bolt moved: the player it named is
      // still on twenty and the creature that took the target away is holding
      // its three damage, which a 0/4 survives and an untouched player does not
      // pay for.
      expect(burned).toBe(true);
      expect(opponentLifeWhenBurned).toBe(20);
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );
  forgeIt(
    'names a card out of every card ever printed and stops the named ability',
    async () => {
      const backend = installedForgeBackend({ timeoutMs: 180_000 });
      expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires tools/forge/dist').not.toBeNull();
      if (backend === null) return;
      expect(await backend.supports(OPEN_CARD_NAMING_TABLE)).toEqual([]);
      const opened = await backend.open(OPEN_CARD_NAMING_TABLE);
      if (!opened.ok) throw new Error(opened.error.message);

      let session: ObservedSession = opened.session;
      let box: TextDecisionInput | null = null;
      let namePrompt: string | null = null;
      let offeredWithBox: number | null = null;
      let unknownRefusal: string | null = null;
      let landRefusal: string | null = null;
      let named: string | null = null;
      let levelUpBefore: string | null = null;
      let sampledPhase: string | null = null;
      let sampledStep: string | null = null;
      let levelUpAfter: readonly string[] | null = null;
      const trace: string[] = [];
      for (let submitted = 0; session.status === 'awaiting' && submitted < 2500; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no decision');
        const seat = session.view.seats[0];
        const students = seat.battlefield.filter((card) => card.name === 'Student of Warfare');
        const revokers = seat.battlefield.filter((card) => card.name === 'Phyrexian Revoker');
        const lands = seat.battlefield.filter((card) => card.name === 'Plains');
        const untapped = lands.filter((card) => !card.tapped).length;
        trace.push(
          `t${String(session.view.turn.number)} a${String(session.view.turn.active)} ` +
            `${session.view.turn.phase}/${session.view.turn.step} ` +
            `plains ${String(lands.length)}/${String(untapped)} students ${String(students.length)} ` +
            `revokers ${String(revokers.length)} | ${decision.kind}: ${decision.prompt} || ${decision.options
              .map((option) => option.text)
              .join(' | ')}`,
        );
        let move = pregameOrManaPayment(decision);
        if (decision.kind === 'card-name') {
          const input = decision.input;
          if (input === undefined) throw new Error('Forge asked for a card name with no box to type in');
          box ??= input;
          namePrompt ??= decision.prompt;
          offeredWithBox ??= decision.options.length;
          // Both refusals are submitted against this same pending decision, and
          // the answer that follows them is submitted against it too. A refusal
          // that had moved the revision would fail the third submit as stale
          // rather than reaching Forge, so the seat being asked again rather
          // than answered for is what the run proves.
          if (unknownRefusal === null) {
            const refused = await session.submit(textSubmission(input, 'Nostrilbearing Wallaby'));
            if (refused.ok) throw new Error('Forge accepted a name no printed card carries');
            unknownRefusal = refused.error.message;
            continue;
          }
          if (landRefusal === null) {
            const refused = await session.submit(textSubmission(input, 'Plains'));
            if (refused.ok) throw new Error('Forge accepted a land name behind a nonland filter');
            landRefusal = refused.error.message;
            continue;
          }
          named = 'Student of Warfare';
          move = textSubmission(input, named);
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const levelUp = decision.options.find((option) => isLevelUp(option.text));
          // One board shape, sampled twice. The Student is standing, a Plains is
          // untapped, the stack is empty and this seat is the active one, so the
          // only difference between the two readings is the card that was named.
          const sampleable =
            session.view.turn.active === 0 && session.view.stack.length === 0 && students.length > 0;
          if (sampleable && untapped >= 1 && revokers.length === 0 && levelUpBefore === null) {
            if (levelUp !== undefined) {
              levelUpBefore = levelUp.text;
              sampledPhase = session.view.turn.phase;
              sampledStep = session.view.turn.step;
            }
          }
          if (
            sampleable &&
            untapped >= 1 &&
            named !== null &&
            revokers.length > 0 &&
            levelUpAfter === null &&
            session.view.turn.phase === sampledPhase &&
            session.view.turn.step === sampledStep
          ) {
            levelUpAfter = decision.options.map((option) => option.text);
          }
          const castStudent: string | undefined =
            students.length === 0 && untapped >= 1
              ? decision.options.find((option) => isCast(option.text, 'Student of Warfare'))?.id
              : undefined;
          // Four lands, so paying the Revoker still leaves the Student's own
          // mana standing: the reading after the naming is taken on a board that
          // could have leveled up and was refused, not on one that could not pay.
          const castRevoker: string | undefined =
            levelUpBefore !== null && revokers.length === 0 && untapped >= 4
              ? decision.options.find((option) => isCast(option.text, 'Phyrexian Revoker'))?.id
              : undefined;
          move =
            (levelUpAfter === null
              ? undefined
              : decision.options.find((option) => option.text === 'Concede')?.id) ??
            decision.options.find((option) => option.text === 'Play Plains')?.id ??
            castStudent ??
            castRevoker ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-40).join('\n')}`);
        session = advanced.session;
      }

      if (box === null || named === null || levelUpAfter === null) {
        throw new Error(`never reached the naming\n${trace.slice(-120).join('\n')}`);
      }
      // The question arrived as a text box rather than as a list, which is the
      // whole of what phase 8 added to the wire.
      expect(offeredWithBox).toBe(0);
      expect(box.kind).toBe('text');
      expect(box.id).toBe('card-name');
      expect(box.label).toBe('Name a card');
      expect(box.minLength).toBe(1);
      // Derived from the card database rather than typed: far longer than the
      // answer this run submits, and still a real ceiling.
      expect(box.maxLength).toBeGreaterThan('Student of Warfare'.length);
      expect(box.maxLength).toBeLessThan(200);
      // The English the seat reads is the card's own sentence, not the script
      // expression `Card.nonLand` the filter is written in.
      expect(namePrompt).toBe('Phyrexian Revoker: Choose a nonland card name.');
      // A name no card carries and a name outside the filter are both refused
      // with the decision still pending, in Forge's words rather than ours.
      expect(unknownRefusal).toBe('no printed card is named Nostrilbearing Wallaby');
      expect(landRefusal).toBe('Plains does not match Card.nonLand');
      // And the board is the assertion. The ability the seat could activate
      // before it named the card is not on the list after it.
      expect(levelUpBefore).toBe(LEVEL_UP);
      expect(levelUpAfter.filter(isLevelUp)).toEqual([]);
      expect(levelUpAfter).toContain('Pass priority');
      await session.close();
      await backend.shutdown?.();
    },
    420_000,
  );
});

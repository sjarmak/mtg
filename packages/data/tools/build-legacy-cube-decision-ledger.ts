/** Deterministically builds the Forge decision-family ledger from an explicitly extracted archive. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  LEGACY_CUBE_PUBLIC_GRAVEYARD_SELECTION_SHAPES,
  legacyCubePublicGraveyardSelectionRefusals,
} from '../src/legacy-cube/public-graveyard-selection';
import { generatedTokenScriptNames } from '../src/printed-card/token-references';
import {
  LEGACY_CUBE_DECISION_FAMILIES,
  LEGACY_CUBE_BRIDGE_FAMILY_REVIEW,
  LEGACY_CUBE_BRIDGE_MATCH_PROBE,
  LEGACY_CUBE_AURA_TARGET_PROBE,
  LEGACY_CUBE_AURA_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_BANESLAYER_PROTECTION_EXCLUDED_POSITIONS,
  LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE,
  LEGACY_CUBE_BANESLAYER_PROTECTION_SAFE_POSITIONS,
  LEGACY_CUBE_CHART_A_COURSE_DISCARD_EXCLUDED_POSITIONS,
  LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE,
  LEGACY_CUBE_CHART_A_COURSE_DISCARD_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE,
  LEGACY_CUBE_REVIEWED_LEVEL_UP_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REVIEWED_LEVEL_UP_SAFE_POSITIONS,
  LEGACY_CUBE_SELFLESS_SPIRIT_EXCLUDED_POSITIONS,
  LEGACY_CUBE_SELFLESS_SPIRIT_PROBE,
  LEGACY_CUBE_SELFLESS_SPIRIT_SAFE_POSITIONS,
  LEGACY_CUBE_REMORSEFUL_CLERIC_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE,
  LEGACY_CUBE_REMORSEFUL_CLERIC_SAFE_POSITIONS,
  LEGACY_CUBE_COLDSTEEL_HEART_EXCLUDED_POSITIONS,
  LEGACY_CUBE_COLDSTEEL_HEART_PROBE,
  LEGACY_CUBE_COLDSTEEL_HEART_SAFE_POSITIONS,
  LEGACY_CUBE_BOUNDED_MULTI_SELECTION_COHORTS,
  LEGACY_CUBE_BOUNDED_MULTI_SELECTION_EXCLUDED_POSITIONS,
  LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE,
  LEGACY_CUBE_BOUNDED_MULTI_SELECTION_SAFE_POSITIONS,
  LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_COHORTS,
  LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_EXCLUDED_POSITIONS,
  LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE,
  LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_SAFE_POSITIONS,
  LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT,
  LEGACY_CUBE_ANNOUNCED_NUMBER_COHORTS,
  LEGACY_CUBE_ANNOUNCED_NUMBER_EXCLUDED_POSITIONS,
  LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE,
  LEGACY_CUBE_ANNOUNCED_NUMBER_SAFE_POSITIONS,
  LEGACY_CUBE_STATED_ORDERING_COHORTS,
  LEGACY_CUBE_STATED_ORDERING_EXCLUDED_POSITIONS,
  LEGACY_CUBE_STATED_ORDERING_PROBE,
  LEGACY_CUBE_STATED_ORDERING_SAFE_POSITIONS,
  LEGACY_CUBE_STATED_DISTRIBUTION_COHORTS,
  LEGACY_CUBE_STATED_DISTRIBUTION_EXCLUDED_POSITIONS,
  LEGACY_CUBE_STATED_DISTRIBUTION_PROBE,
  LEGACY_CUBE_STATED_DISTRIBUTION_SAFE_POSITIONS,
  LEGACY_CUBE_STATED_RETARGET_COHORTS,
  LEGACY_CUBE_STATED_RETARGET_EXCLUDED_POSITIONS,
  LEGACY_CUBE_STATED_RETARGET_PROBE,
  LEGACY_CUBE_STATED_RETARGET_SAFE_POSITIONS,
  LEGACY_CUBE_OPEN_CARD_NAMING_COHORTS,
  LEGACY_CUBE_OPEN_CARD_NAMING_EXCLUDED_POSITIONS,
  LEGACY_CUBE_OPEN_CARD_NAMING_PROBE,
  LEGACY_CUBE_OPEN_CARD_NAMING_SAFE_POSITIONS,
  LEGACY_CUBE_PHYREXIAN_MANA_PAYMENT_AUDIT,
  LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT,
  LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS,
  LEGACY_CUBE_PERMANENT_COST_PROBE,
  LEGACY_CUBE_CHOSEN_COST_PAYMENT_REFUSED_POSITIONS,
  LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_COHORTS,
  LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS,
  LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_EXCLUDED_POSITIONS,
  LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE,
  LEGACY_CUBE_OTHER_CREATURE_SACRIFICE_COST_POSITIONS,
  LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS,
  LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_COST_POSITIONS,
  LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_EXCLUDED_POSITIONS,
  LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE,
  LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_SAFE_POSITIONS,
  LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS,
  LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION,
  LEGACY_CUBE_EXTINCTION_EVENT_PROBE,
  LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS,
  LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE,
  LEGACY_CUBE_FETTERS_AURA_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_FALL_AURA_TARGET_PROBE,
  LEGACY_CUBE_FALL_AURA_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_EQUIP_TARGET_PROBE,
  LEGACY_CUBE_EQUIP_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_ORDINARY_COMBAT_PROBE,
  LEGACY_CUBE_ORDINARY_COMBAT_SAFE_POSITIONS,
  LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE,
  LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_EXCLUDED_POSITIONS,
  LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE,
  LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_PALADIN_CLASS_PROBE,
  LEGACY_CUBE_PALADIN_CLASS_SAFE_POSITIONS,
  LEGACY_CUBE_SHOCKLAND_OPTIONAL_COST_EXCLUDED_POSITIONS,
  LEGACY_CUBE_SHOCKLAND_PROBE,
  LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS,
  LEGACY_CUBE_TRIGGER_TARGET_EXCLUDED_POSITIONS,
  LEGACY_CUBE_TRIGGER_TARGET_PROBE,
  LEGACY_CUBE_TRIGGER_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT,
  LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE,
  LEGACY_CUBE_PRIORITY_ONLY_PROBE,
  LEGACY_CUBE_PRIORITY_ONLY_SAFE_POSITIONS,
  LEGACY_CUBE_SINGLE_TARGET_PROBE,
  LEGACY_CUBE_SINGLE_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE,
  LEGACY_CUBE_SINGLE_STACK_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE,
  LEGACY_CUBE_SINGLE_ZONE_CARD_SAFE_POSITIONS,
  LEGACY_CUBE_SYNTAX_REVIEW_SHA256,
  LEGACY_CUBE_GENERATED_TOKEN_AUDIT,
  LEGACY_CUBE_GENERATED_OBJECT_COHORTS,
  LEGACY_CUBE_GENERATED_OBJECT_CHOSEN_COST_POSITIONS,
  LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS,
  LEGACY_CUBE_GENERATED_OBJECT_PREEXISTING_SAFE_POSITIONS,
  LEGACY_CUBE_GENERATED_OBJECT_PROBE,
  LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COHORTS,
  LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE,
  LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_COHORTS,
  LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE,
  LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_COHORTS,
  LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE,
  LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_COHORTS,
  LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE,
  LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_COHORTS,
  LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE,
  LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_COHORTS,
  LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE,
  LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_COHORTS,
  LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE,
  LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS,
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_COHORTS,
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_EXCLUDED_POSITIONS,
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PREEXISTING_SAFE_POSITIONS,
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE,
  LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_COHORTS,
  LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE,
  LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_COHORTS,
  LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE,
  LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_COHORTS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE,
  LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_COHORTS,
  LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE,
  LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_CASCADE_COHORTS,
  LEGACY_CUBE_REVIEWED_CASCADE_PROBE,
  LEGACY_CUBE_REVIEWED_CASCADE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS,
  LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE,
  LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_COHORTS,
  LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE,
  LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MANA_COMBO_COHORTS,
  LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE,
  LEGACY_CUBE_REVIEWED_MANA_COMBO_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_COHORTS,
  LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE,
  LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_COHORTS,
  LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE,
  LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_COHORTS,
  LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE,
  LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_KALITAS_COHORTS,
  LEGACY_CUBE_REVIEWED_KALITAS_PROBE,
  LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_URO_COHORTS,
  LEGACY_CUBE_REVIEWED_URO_PROBE,
  LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_KROXA_COHORTS,
  LEGACY_CUBE_REVIEWED_KROXA_PROBE,
  LEGACY_CUBE_REVIEWED_KROXA_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_HUNTMASTER_COHORTS,
  LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE,
  LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_COHORTS,
  LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE,
  LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_FINAL_SIX_COHORTS,
  LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE,
  LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS,
  LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_PROBE,
  LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_COHORTS,
  LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE,
  LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_COHORTS,
  LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE,
  LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_COHORTS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE,
  LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_KARN_LIBERATED_COHORTS,
  LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE,
  LEGACY_CUBE_REVIEWED_KARN_LIBERATED_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_COHORTS,
  LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE,
  LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_COHORTS,
  LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE,
  LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BARAL_COHORTS,
  LEGACY_CUBE_REVIEWED_BARAL_PROBE,
  LEGACY_CUBE_REVIEWED_BARAL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_UNLESS_COST_COHORTS,
  LEGACY_CUBE_REVIEWED_UNLESS_COST_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE,
  LEGACY_CUBE_REVIEWED_UNLESS_COST_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_COHORTS,
  LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE,
  LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MISCALCULATION_COHORTS,
  LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE,
  LEGACY_CUBE_REVIEWED_MISCALCULATION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_COHORTS,
  LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE,
  LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_EMBERCLEAVE_COHORTS,
  LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE,
  LEGACY_CUBE_REVIEWED_EMBERCLEAVE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LIVING_WEAPON_COHORTS,
  LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE,
  LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_FORETELL_COHORTS,
  LEGACY_CUBE_REVIEWED_FORETELL_PROBE,
  LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_COHORTS,
  LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE,
  LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_COHORTS,
  LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE,
  LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_COHORTS,
  LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE,
  LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_HIDEAWAY_COHORTS,
  LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE,
  LEGACY_CUBE_REVIEWED_HIDEAWAY_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_COHORTS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_COHORTS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE,
  LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_COHORTS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE,
  LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_COHORTS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE,
  LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_COHORTS,
  LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE,
  LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_COHORTS,
  LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE,
  LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BIRGI_COHORTS,
  LEGACY_CUBE_REVIEWED_BIRGI_PROBE,
  LEGACY_CUBE_REVIEWED_BIRGI_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BIRTHING_POD_COHORTS,
  LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE,
  LEGACY_CUBE_REVIEWED_BIRTHING_POD_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_COHORTS,
  LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE,
  LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_FORBID_COHORTS,
  LEGACY_CUBE_REVIEWED_FORBID_PROBE,
  LEGACY_CUBE_REVIEWED_FORBID_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_REVEILLARK_COHORTS,
  LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE,
  LEGACY_CUBE_REVIEWED_REVEILLARK_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_COHORTS,
  LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE,
  LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_COHORTS,
  LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE,
  LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_COHORTS,
  LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE,
  LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_COHORTS,
  LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE,
  LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_COHORTS,
  LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE,
  LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_COHORTS,
  LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE,
  LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_COHORTS,
  LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE,
  LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_COHORTS,
  LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE,
  LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_CONVOKE_COHORTS,
  LEGACY_CUBE_REVIEWED_CONVOKE_PROBE,
  LEGACY_CUBE_REVIEWED_CONVOKE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_DELVE_COHORTS,
  LEGACY_CUBE_REVIEWED_DELVE_PROBE,
  LEGACY_CUBE_REVIEWED_DELVE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_COHORTS,
  LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE,
  LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_COHORTS,
  LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE,
  LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GILDED_GOOSE_COHORTS,
  LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE,
  LEGACY_CUBE_REVIEWED_GILDED_GOOSE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_COHORTS,
  LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE,
  LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_TREACHERY_COHORTS,
  LEGACY_CUBE_REVIEWED_TREACHERY_PROBE,
  LEGACY_CUBE_REVIEWED_TREACHERY_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_COHORTS,
  LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE,
  LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_COHORTS,
  LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE,
  LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_COHORTS,
  LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE,
  LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_COHORTS,
  LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE,
  LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_COHORTS,
  LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE,
  LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_COHORTS,
  LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE,
  LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_CRYPTBREAKER_COHORTS,
  LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE,
  LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_COHORTS,
  LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE,
  LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_TREASURE_COHORT_COHORTS,
  LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE,
  LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_COHORTS,
  LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE,
  LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_COHORTS,
  LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE,
  LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_COHORTS,
  LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE,
  LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LINGERING_SOULS_COHORTS,
  LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE,
  LEGACY_CUBE_REVIEWED_LINGERING_SOULS_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_COHORTS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE,
  LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GLORYBRINGER_COHORTS,
  LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE,
  LEGACY_CUBE_REVIEWED_GLORYBRINGER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_COHORTS,
  LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE,
  LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_COHORTS,
  LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE,
  LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_COHORTS,
  LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE,
  LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_COHORTS,
  LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE,
  LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_COMPANION_COHORTS,
  LEGACY_CUBE_REVIEWED_COMPANION_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE,
  LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE,
  LEGACY_CUBE_ALTERNATE_COST_COHORTS,
  LEGACY_CUBE_ALTERNATE_COST_EXCLUDED_POSITIONS,
  LEGACY_CUBE_ALTERNATE_COST_PROBE,
  LEGACY_CUBE_ALTERNATE_COST_SAFE_POSITIONS,
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_COHORTS,
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_EXCLUDED_POSITIONS,
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE,
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PREEXISTING_SAFE_POSITIONS,
  LEGACY_CUBE_OPTIONAL_DECIDER_YOU_SAFE_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_COHORTS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_EXCLUDED_POSITIONS,
  LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE,
  LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_SAFE_POSITIONS,
  LEGACY_CUBE_ALTERNATE_MODE_COHORTS,
  LEGACY_CUBE_ALTERNATE_MODE_EXCLUDED_POSITIONS,
  LEGACY_CUBE_ALTERNATE_MODE_PROBE,
  LEGACY_CUBE_ALTERNATE_MODE_SAFE_POSITIONS,
  LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE,
  LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS,
  LegacyCubeDecisionLedgerSchema,
  classifyForgeControllerCallback,
  classifyLegacyCubeForgeScript,
  forgeBridgeControllerOwnership,
  forgePlayerControllerAbstractCallbacks,
  inventoryLegacyCubeForgeScript,
  legacyCubeDecisionLedgerContentSha256,
  legacyCubeAuraTargetProfileRefusals,
  legacyCubeBaneslayerProtectionProfileRefusals,
  legacyCubeChartACourseDiscardProfileRefusals,
  legacyCubeReviewedLevelUpProfileRefusals,
  legacyCubeSelflessSpiritProfileRefusals,
  legacyCubeRemorsefulClericProfileRefusals,
  legacyCubeColdsteelHeartProfileRefusals,
  legacyCubeExtinctionEventProfileRefusals,
  legacyCubeOptionalTriggerConfirmProfileRefusals,
  legacyCubeOptionalDeciderYouRefusals,
  legacyCubeReviewedOptionalLibrarySearchRefusals,
  legacyCubeReviewedAlternateModeRefusals,
  legacyCubeBoundedMultiSelectionRefusals,
  legacyCubeBoundedEnumeratedChoiceRefusals,
  verifyLegacyCubeExtinctionEventImplementation,
  legacyCubeFallAuraTargetProfileRefusals,
  legacyCubeFettersAuraTargetProfileRefusals,
  legacyCubeEquipTargetProfileRefusals,
  legacyCubeAnnouncedManaPaymentRefusals,
  legacyCubePhyrexianManaPaymentRefusals,
  legacyCubeAnnouncedNumberRefusals,
  legacyCubeStatedOrderingRefusals,
  legacyCubeStatedDistributionRefusals,
  legacyCubeStatedRetargetRefusals,
  legacyCubeOpenCardNamingRefusals,
  legacyCubeDiscardOrSourceSacrificeCostRefusals,
  legacyCubePinnedGeneratedObjectRefusals,
  legacyCubeChosenCostPaymentRefusals,
  legacyCubeOrdinaryManaPaymentRefusals,
  legacyCubeOrdinaryCombatSingleTargetRefusals,
  legacyCubeOrdinaryCombatTriggeredSingleTargetRefusals,
  legacyCubeMandatoryTriggeredSingleTargetRefusals,
  legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals,
  legacyCubeReviewedTriggerTargetRefusals,
  legacyCubeReviewedCounterTypeChoiceRefusals,
  legacyCubeReviewedOptionalTargetRefusals,
  legacyCubeReviewedPhyrexianSpellCostRefusals,
  legacyCubeReviewedCascadeRefusals,
  legacyCubeReviewedRepeatableModeRefusals,
  legacyCubeReviewedMultipleTargetRefusals,
  legacyCubeReviewedManaComboRefusals,
  legacyCubeReviewedCrypticCommandRefusals,
  legacyCubeReviewedPrismariCommandRefusals,
  legacyCubeReviewedBlessedAllianceRefusals,
  legacyCubeReviewedKalitasRefusals,
  legacyCubeReviewedUroRefusals,
  legacyCubeReviewedKroxaRefusals,
  legacyCubeReviewedHuntmasterRefusals,
  legacyCubeReviewedRemainingPlaneswalkersRefusals,
  legacyCubeReviewedFinalSixRefusals,
  legacyCubeReviewedPhantasmalImageRefusals,
  legacyCubeReviewedPeekAndRevealRefusals,
  legacyCubeReviewedGeneratedTokenSacrificeRefusals,
  legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals,
  legacyCubeReviewedAlternateCostGeneratedObjectRefusals,
  legacyCubeReviewedResidualGeneratedTokenRefusals,
  legacyCubeReviewedMultiTargetTransformationRefusals,
  legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals,
  legacyCubeReviewedCopySpellRetargetRefusals,
  legacyCubeReviewedOptionalCopyReplacementRefusals,
  legacyCubeReviewedKarnLiberatedRefusals,
  legacyCubeReviewedRattleclawMysticRefusals,
  legacyCubeReviewedLightningPhoenixRefusals,
  legacyCubeReviewedBaralRefusals,
  legacyCubeReviewedUnlessCostRefusals,
  legacyCubeReviewedCounterUnlessCostRefusals,
  legacyCubeReviewedMiscalculationRefusals,
  legacyCubeReviewedMaulOfTheSkyclavesRefusals,
  legacyCubeReviewedEmbercleaveRefusals,
  legacyCubeReviewedLivingWeaponRefusals,
  legacyCubeReviewedForetellRefusals,
  legacyCubeReviewedSatyrWayfinderRefusals,
  legacyCubeReviewedBlueLibrarySelectionRefusals,
  legacyCubeReviewedGideonGarrukBloodlineRefusals,
  legacyCubeReviewedHideawayRefusals,
  legacyCubeReviewedSwordOfFireAndIceRefusals,
  legacyCubeReviewedSwordOfFeastAndFamineRefusals,
  legacyCubeReviewedSwordOfLightAndShadowRefusals,
  legacyCubeReviewedSwordOfBodyAndMindRefusals,
  legacyCubeReviewedSwordOfHearthAndHomeRefusals,
  legacyCubeReviewedUmezawasJitteRefusals,
  legacyCubeReviewedBirgiRefusals,
  legacyCubeReviewedBirthingPodRefusals,
  legacyCubeReviewedRangerCaptainOfEosRefusals,
  legacyCubeReviewedForbidRefusals,
  legacyCubeReviewedReveillarkRefusals,
  legacyCubeReviewedBloodchiefsThirstRefusals,
  legacyCubeReviewedPrimalMightRefusals,
  legacyCubeReviewedEngineeredExplosivesRefusals,
  legacyCubeReviewedReorderOrShuffleRefusals,
  legacyCubeReviewedAnimateDeadRefusals,
  legacyCubeReviewedHeartlessActRefusals,
  legacyCubeReviewedAgadeemsAwakeningRefusals,
  legacyCubeReviewedModalLandSpellRefusals,
  legacyCubeReviewedConvokeRefusals,
  legacyCubeReviewedDelveRefusals,
  legacyCubeReviewedFreeCounterspellRefusals,
  legacyCubeReviewedLegionsLandingRefusals,
  legacyCubeReviewedGildedGooseRefusals,
  legacyCubeReviewedPiaSiegeGangRefusals,
  legacyCubeReviewedTreacheryRefusals,
  legacyCubeReviewedSkyclaveApparitionRefusals,
  legacyCubeReviewedPathToExileRefusals,
  legacyCubeReviewedGlenElendraArchmageRefusals,
  legacyCubeReviewedRecurringNightmareRefusals,
  legacyCubeReviewedPriestOfFellRitesRefusals,
  legacyCubeReviewedSmugglersCopterRefusals,
  legacyCubeReviewedCryptbreakerRefusals,
  legacyCubeReviewedMyrBattlesphereRefusals,
  legacyCubeReviewedTreasureCohortRefusals,
  legacyCubeReviewedChampionOfWitsRefusals,
  legacyCubeReviewedUtopiaSprawlRefusals,
  legacyCubeReviewedSplinterTwinRefusals,
  legacyCubeReviewedLingeringSoulsRefusals,
  legacyCubeReviewedOptionalGeneratedTokenRefusals,
  legacyCubeReviewedGlorybringerRefusals,
  legacyCubeReviewedGrimLavamancerRefusals,
  legacyCubeReviewedGiftsUngivenRefusals,
  legacyCubeReviewedLilianaTwoPilesRefusals,
  legacyCubeReviewedFactOrFictionRefusals,
  legacyCubeReviewedCompanionRefusals,
  legacyCubeReviewedAlternateCostRefusals,
  legacyCubePaladinClassProfileRefusals,
  legacyCubeShocklandProfileRefusals,
  resolveLegacyCubeGeneratedScriptDependencies,
  loadLegacyCubeProvenance,
  loadLegacyCubeSyntaxReview,
  type LegacyCubeDecisionLedger,
  type LegacyCubeDecisionSyntaxToken,
  type LegacyCubeTopLevelCapabilityProfile,
} from '@mtg/data';

function requiredValue(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = argv[index + 1];
  if (index < 0 || value === undefined || value.startsWith('--')) throw new Error(`${flag} is required`);
  return value;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const capabilityBundle = (
  topLevel: LegacyCubeTopLevelCapabilityProfile,
  options: {
    readonly manaPayment?:
      'ordinary-mana-payment-v1' | 'announced-mana-payment-v1' | 'phyrexian-mana-payment-v1';
    readonly generatedObjects?: 'none' | 'pinned-token-scripts-v1';
  } = {},
) => ({
  topLevel,
  manaPayment: options.manaPayment ?? ('ordinary-mana-payment-v1' as const),
  generatedObjects: options.generatedObjects ?? ('none' as const),
});

export async function main(argv: readonly string[]): Promise<void> {
  const scriptsRoot = requiredValue(argv, '--forge-scripts');
  const tokenScriptsRoot = requiredValue(argv, '--forge-token-scripts');
  const controllerJavap = requiredValue(argv, '--controller-javap');
  const chooseEvenOddClass = requiredValue(argv, '--choose-even-odd-class');
  const chooseEvenOddSource = requiredValue(argv, '--choose-even-odd-source');
  const bridgeSource = requiredValue(argv, '--bridge-source');
  const output = requiredValue(argv, '--out');
  const provenance = loadLegacyCubeProvenance();
  const baselineNames = ['Flame Rift', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
  const baselineScripts = baselineNames.map((name) => ({
    name,
    forgeScript: `${name.charAt(0).toLowerCase()}/${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}.txt`,
  }));
  const scripts = [
    ...provenance.identities.map((identity) => ({
      name: identity.correctedName,
      forgeScript: identity.forgeScript,
    })),
    ...baselineScripts,
  ].map((row) => ({ ...row, bytes: readFileSync(join(scriptsRoot, row.forgeScript)) }));
  const syntax = new Map<string, { kind: LegacyCubeDecisionSyntaxToken['kind']; token: string }>();
  for (const script of scripts) {
    for (const token of inventoryLegacyCubeForgeScript(script.bytes)) {
      syntax.set(`${token.kind}\0${token.token}`, token);
    }
  }
  const actualSyntax = [...syntax.values()].sort((left, right) =>
    left.kind === right.kind ? left.token.localeCompare(right.token) : left.kind.localeCompare(right.kind),
  );
  const syntaxInventory: LegacyCubeDecisionSyntaxToken[] = [...loadLegacyCubeSyntaxReview()];
  const reviewedKeys = syntaxInventory.map((row) => `${row.kind}\0${row.token}`);
  const actualKeys = actualSyntax.map((row) => `${row.kind}\0${row.token}`);
  if (JSON.stringify(reviewedKeys) !== JSON.stringify(actualKeys)) {
    const unknown = actualKeys.find((key) => !reviewedKeys.includes(key));
    const stale = reviewedKeys.find((key) => !actualKeys.includes(key));
    throw new Error(
      unknown === undefined
        ? `syntax review contains token absent from pinned corpus: ${stale ?? 'unknown'}`
        : `pinned corpus contains unreviewed syntax token: ${unknown}`,
    );
  }
  const initialEntries = provenance.identities.map((identity) => {
    const bytes = readFileSync(join(scriptsRoot, identity.forgeScript));
    const classification = classifyLegacyCubeForgeScript(bytes, syntaxInventory);
    return {
      corpus: 'official-full-cardlist' as const,
      position: identity.position,
      sourceName: identity.sourceName,
      correctedName: identity.correctedName,
      forgeScript: identity.forgeScript,
      forgeScriptSha256: sha256(bytes),
      families: [...classification.families],
      evidenceMarkers: [...classification.evidenceMarkers],
      unknownDecisionSyntax: [...classification.unknownDecisionSyntax],
      risk: classification.families.length >= 4 ? ('high' as const) : ('ordinary' as const),
      cardFamilySafe: false,
      bridgeCapabilityProfile: null,
      runtimeProbeId: null as string | null,
      generatedScriptDependencies: [],
    };
  });
  const signatures = [
    ...new Set(
      initialEntries.filter((entry) => entry.risk === 'high').map((entry) => entry.families.join('+')),
    ),
  ].sort();
  const probeIdBySignature = new Map(
    signatures.map((signature, index) => [
      signature,
      `unsupported-family-signature-${String(index + 1).padStart(3, '0')}`,
    ]),
  );
  const priorityOnlyPositions = new Set<number>(LEGACY_CUBE_PRIORITY_ONLY_SAFE_POSITIONS);
  const singleTargetPositions = new Set<number>(LEGACY_CUBE_SINGLE_TARGET_SAFE_POSITIONS);
  const singleStackTargetPositions = new Set<number>(LEGACY_CUBE_SINGLE_STACK_TARGET_SAFE_POSITIONS);
  const singleZoneCardPositions = new Set<number>(LEGACY_CUBE_SINGLE_ZONE_CARD_SAFE_POSITIONS);
  const ordinaryCombatPositions = new Set<number>(LEGACY_CUBE_ORDINARY_COMBAT_SAFE_POSITIONS);
  const ordinaryCombatSingleTargetPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_SAFE_POSITIONS,
  );
  const ordinaryCombatSingleTargetExcludedPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_EXCLUDED_POSITIONS,
  );
  const ordinaryCombatTriggerTargetPositions = new Set<number>(
    LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_SAFE_POSITIONS,
  );
  const triggerTargetPositions = new Set<number>(LEGACY_CUBE_TRIGGER_TARGET_SAFE_POSITIONS);
  const triggerTargetExcludedPositions = new Set<number>(LEGACY_CUBE_TRIGGER_TARGET_EXCLUDED_POSITIONS);
  const paladinClassPositions = new Set<number>(LEGACY_CUBE_PALADIN_CLASS_SAFE_POSITIONS);
  const shocklandPositions = new Set<number>(LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS);
  const shocklandExcludedPositions = new Set<number>(LEGACY_CUBE_SHOCKLAND_OPTIONAL_COST_EXCLUDED_POSITIONS);
  const equipTargetPositions = new Set<number>(LEGACY_CUBE_EQUIP_TARGET_SAFE_POSITIONS);
  const auraTargetPositions = new Set<number>(LEGACY_CUBE_AURA_TARGET_SAFE_POSITIONS);
  const fettersAuraTargetPositions = new Set<number>(LEGACY_CUBE_FETTERS_AURA_TARGET_SAFE_POSITIONS);
  const fallAuraTargetPositions = new Set<number>(LEGACY_CUBE_FALL_AURA_TARGET_SAFE_POSITIONS);
  const baneslayerProtectionPositions = new Set<number>(LEGACY_CUBE_BANESLAYER_PROTECTION_SAFE_POSITIONS);
  const baneslayerProtectionExcludedPositions = new Set<number>(
    LEGACY_CUBE_BANESLAYER_PROTECTION_EXCLUDED_POSITIONS,
  );
  const chartACourseDiscardPositions = new Set<number>(LEGACY_CUBE_CHART_A_COURSE_DISCARD_SAFE_POSITIONS);
  const chartACourseDiscardExcludedPositions = new Set<number>(
    LEGACY_CUBE_CHART_A_COURSE_DISCARD_EXCLUDED_POSITIONS,
  );
  const studentOfWarfareLevelUpPositions = new Set<number>(LEGACY_CUBE_REVIEWED_LEVEL_UP_SAFE_POSITIONS);
  const studentOfWarfareLevelUpExcludedPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LEVEL_UP_EXCLUDED_POSITIONS,
  );
  const selflessSpiritPositions = new Set<number>(LEGACY_CUBE_SELFLESS_SPIRIT_SAFE_POSITIONS);
  const selflessSpiritExcludedPositions = new Set<number>(LEGACY_CUBE_SELFLESS_SPIRIT_EXCLUDED_POSITIONS);
  const remorsefulClericPositions = new Set<number>(LEGACY_CUBE_REMORSEFUL_CLERIC_SAFE_POSITIONS);
  const remorsefulClericExcludedPositions = new Set<number>(LEGACY_CUBE_REMORSEFUL_CLERIC_EXCLUDED_POSITIONS);
  const coldsteelHeartPositions = new Set<number>(LEGACY_CUBE_COLDSTEEL_HEART_SAFE_POSITIONS);
  const coldsteelHeartExcludedPositions = new Set<number>(LEGACY_CUBE_COLDSTEEL_HEART_EXCLUDED_POSITIONS);
  const extinctionEventPositions = new Set<number>(LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS);
  const extinctionEventExcludedPositions = new Set<number>(LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS);
  const optionalTriggerConfirmPositions = new Set<number>(
    LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_SAFE_POSITIONS,
  );
  const optionalTriggerConfirmExcludedPositions = new Set<number>(
    LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_EXCLUDED_POSITIONS,
  );
  const boundedMultiSelectionPositions = new Set<number>(LEGACY_CUBE_BOUNDED_MULTI_SELECTION_SAFE_POSITIONS);
  const boundedMultiSelectionExcludedPositions = new Set<number>(
    LEGACY_CUBE_BOUNDED_MULTI_SELECTION_EXCLUDED_POSITIONS,
  );
  // A position may not borrow the review written for a different family
  // signature, so the admission checks the exact signature its own cohort row
  // was reviewed under rather than the union of the eight.
  const boundedMultiSelectionSignatures = new Map<number, string>(
    LEGACY_CUBE_BOUNDED_MULTI_SELECTION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const boundedEnumeratedChoicePositions = new Set<number>(
    LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_SAFE_POSITIONS,
  );
  const boundedEnumeratedChoiceExcludedPositions = new Set<number>(
    LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_EXCLUDED_POSITIONS,
  );
  const boundedEnumeratedChoiceSignatures = new Map<number, string>(
    LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const vraskaGeneratedTokenPositions = new Set<number>(LEGACY_CUBE_VRASKA_GENERATED_TOKEN_SAFE_POSITIONS);
  const generatedObjectPositions = new Set<number>(LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS);
  const generatedObjectExcludedPositions = new Set<number>(LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS);
  const generatedObjectSignatures = new Map<number, string>(
    LEGACY_CUBE_GENERATED_OBJECT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const statedOrderingTriggerTargetPositions = new Set<number>(
    LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_SAFE_POSITIONS,
  );
  const statedOrderingTriggerTargetExcludedPositions = new Set<number>(
    LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_EXCLUDED_POSITIONS,
  );
  const statedOrderingTriggerTargetSignatures = new Map<number, string>(
    LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedTriggerTargetPositions = new Set<number>(LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_SAFE_POSITIONS);
  const reviewedTriggerTargetSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCounterTypeChoicePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_SAFE_POSITIONS,
  );
  const reviewedCounterTypeChoiceSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedOptionalTargetPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_SAFE_POSITIONS,
  );
  const reviewedOptionalTargetSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPhyrexianSpellCostPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_SAFE_POSITIONS,
  );
  const reviewedPhyrexianSpellCostSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCascadePositions = new Set<number>(LEGACY_CUBE_REVIEWED_CASCADE_SAFE_POSITIONS);
  const reviewedCascadeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_CASCADE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedRepeatableModePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_SAFE_POSITIONS,
  );
  const reviewedRepeatableModeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedMultipleTargetPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_SAFE_POSITIONS,
  );
  const reviewedMultipleTargetSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedManaComboPositions = new Set<number>(LEGACY_CUBE_REVIEWED_MANA_COMBO_SAFE_POSITIONS);
  const reviewedManaComboSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MANA_COMBO_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCrypticCommandPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_SAFE_POSITIONS,
  );
  const reviewedCrypticCommandSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPrismariCommandPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS,
  );
  const reviewedPrismariCommandSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBlessedAlliancePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_SAFE_POSITIONS,
  );
  const reviewedBlessedAllianceSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedKalitasPositions = new Set<number>(LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS);
  const reviewedKalitasSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_KALITAS_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedUroPositions = new Set<number>(LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS);
  const reviewedUroSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_URO_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedKroxaPositions = new Set<number>(LEGACY_CUBE_REVIEWED_KROXA_SAFE_POSITIONS);
  const reviewedKroxaSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_KROXA_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedHuntmasterPositions = new Set<number>(LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS);
  const reviewedHuntmasterSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_HUNTMASTER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedRemainingPlaneswalkerPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS,
  );
  const reviewedRemainingPlaneswalkerSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedFinalSixPositions = new Set<number>(LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS);
  const reviewedFinalSixSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_FINAL_SIX_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPhantasmalImagePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_SAFE_POSITIONS,
  );
  const reviewedPhantasmalImageSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPeekAndRevealPositions = new Set<number>(LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_SAFE_POSITIONS);
  const reviewedPeekAndRevealSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGeneratedTokenSacrificePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS,
  );
  const reviewedGeneratedTokenSacrificeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGeneratedObjectBoundedChoicePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS,
  );
  const reviewedGeneratedObjectBoundedChoiceSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedAlternateCostGeneratedObjectPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS,
  );
  const reviewedAlternateCostGeneratedObjectSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedResidualGeneratedTokenPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS,
  );
  const reviewedResidualGeneratedTokenSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedMultiTargetTransformationPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS,
  );
  const reviewedMultiTargetTransformationSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPlaneswalkerUnlessSacrificePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS,
  );
  const reviewedPlaneswalkerUnlessSacrificeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCopySpellRetargetPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS,
  );
  const reviewedCopySpellRetargetSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedOptionalCopyReplacementPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_SAFE_POSITIONS,
  );
  const reviewedOptionalCopyReplacementSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedKarnLiberatedPositions = new Set<number>(LEGACY_CUBE_REVIEWED_KARN_LIBERATED_SAFE_POSITIONS);
  const reviewedKarnLiberatedSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_KARN_LIBERATED_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedRattleclawMysticPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_SAFE_POSITIONS,
  );
  const reviewedRattleclawMysticSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedLightningPhoenixPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_SAFE_POSITIONS,
  );
  const reviewedLightningPhoenixSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBaralPositions = new Set<number>(LEGACY_CUBE_REVIEWED_BARAL_SAFE_POSITIONS);
  const reviewedBaralSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BARAL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedUnlessCostPositions = new Set<number>(LEGACY_CUBE_REVIEWED_UNLESS_COST_SAFE_POSITIONS);
  const reviewedUnlessCostSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_UNLESS_COST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCounterUnlessCostPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_SAFE_POSITIONS,
  );
  const reviewedCounterUnlessCostSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedMiscalculationPositions = new Set<number>(LEGACY_CUBE_REVIEWED_MISCALCULATION_SAFE_POSITIONS);
  const reviewedMiscalculationSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MISCALCULATION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedMaulOfTheSkyclavesPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_SAFE_POSITIONS,
  );
  const reviewedMaulOfTheSkyclavesSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedEmbercleavePositions = new Set<number>(LEGACY_CUBE_REVIEWED_EMBERCLEAVE_SAFE_POSITIONS);
  const reviewedEmbercleaveSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_EMBERCLEAVE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedLivingWeaponPositions = new Set<number>(LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS);
  const reviewedLivingWeaponSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_LIVING_WEAPON_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedForetellPositions = new Set<number>(LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS);
  const reviewedForetellSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_FORETELL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSatyrWayfinderPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_SAFE_POSITIONS,
  );
  const reviewedSatyrWayfinderSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBlueLibrarySelectionPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_SAFE_POSITIONS,
  );
  const reviewedBlueLibrarySelectionSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGideonGarrukBloodlinePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_SAFE_POSITIONS,
  );
  const reviewedGideonGarrukBloodlineSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedHideawayPositions = new Set<number>(LEGACY_CUBE_REVIEWED_HIDEAWAY_SAFE_POSITIONS);
  const reviewedHideawaySignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_HIDEAWAY_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSwordOfFireAndIcePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_SAFE_POSITIONS,
  );
  const reviewedSwordOfFireAndIceSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSwordOfFeastAndFaminePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_SAFE_POSITIONS,
  );
  const reviewedSwordOfFeastAndFamineSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSwordOfLightAndShadowPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_SAFE_POSITIONS,
  );
  const reviewedSwordOfLightAndShadowSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSwordOfBodyAndMindPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_SAFE_POSITIONS,
  );
  const reviewedSwordOfBodyAndMindSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSwordOfHearthAndHomePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_SAFE_POSITIONS,
  );
  const reviewedSwordOfHearthAndHomeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedUmezawasJittePositions = new Set<number>(LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_SAFE_POSITIONS);
  const reviewedUmezawasJitteSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBirgiPositions = new Set<number>(LEGACY_CUBE_REVIEWED_BIRGI_SAFE_POSITIONS);
  const reviewedBirgiSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BIRGI_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBirthingPodPositions = new Set<number>(LEGACY_CUBE_REVIEWED_BIRTHING_POD_SAFE_POSITIONS);
  const reviewedBirthingPodSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BIRTHING_POD_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedRangerCaptainOfEosPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_SAFE_POSITIONS,
  );
  const reviewedRangerCaptainOfEosSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedForbidPositions = new Set<number>(LEGACY_CUBE_REVIEWED_FORBID_SAFE_POSITIONS);
  const reviewedForbidSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_FORBID_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedReveillarkPositions = new Set<number>(LEGACY_CUBE_REVIEWED_REVEILLARK_SAFE_POSITIONS);
  const reviewedReveillarkSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_REVEILLARK_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedBloodchiefsThirstPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_SAFE_POSITIONS,
  );
  const reviewedBloodchiefsThirstSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPrimalMightPositions = new Set<number>(LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_SAFE_POSITIONS);
  const reviewedPrimalMightSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedEngineeredExplosivesPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_SAFE_POSITIONS,
  );
  const reviewedEngineeredExplosivesSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedReorderOrShufflePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_SAFE_POSITIONS,
  );
  const reviewedReorderOrShuffleSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedAnimateDeadPositions = new Set<number>(LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_SAFE_POSITIONS);
  const reviewedAnimateDeadSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedHeartlessActPositions = new Set<number>(LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_SAFE_POSITIONS);
  const reviewedHeartlessActSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedAgadeemsAwakeningPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_SAFE_POSITIONS,
  );
  const reviewedAgadeemsAwakeningSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedModalLandSpellPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_SAFE_POSITIONS,
  );
  const reviewedModalLandSpellSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedConvokePositions = new Set<number>(LEGACY_CUBE_REVIEWED_CONVOKE_SAFE_POSITIONS);
  const reviewedConvokeSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_CONVOKE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedDelvePositions = new Set<number>(LEGACY_CUBE_REVIEWED_DELVE_SAFE_POSITIONS);
  const reviewedDelveSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_DELVE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedFreeCounterspellPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_SAFE_POSITIONS,
  );
  const reviewedFreeCounterspellSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedLegionsLandingPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_SAFE_POSITIONS,
  );
  const reviewedLegionsLandingSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGildedGoosePositions = new Set<number>(LEGACY_CUBE_REVIEWED_GILDED_GOOSE_SAFE_POSITIONS);
  const reviewedGildedGooseSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GILDED_GOOSE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPiaSiegeGangPositions = new Set<number>(LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS);
  const reviewedPiaSiegeGangSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedTreacheryPositions = new Set<number>(LEGACY_CUBE_REVIEWED_TREACHERY_SAFE_POSITIONS);
  const reviewedTreacherySignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_TREACHERY_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSkyclaveApparitionPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_SAFE_POSITIONS,
  );
  const reviewedSkyclaveApparitionSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPathToExilePositions = new Set<number>(LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_SAFE_POSITIONS);
  const reviewedPathToExileSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGlenElendraArchmagePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_SAFE_POSITIONS,
  );
  const reviewedGlenElendraArchmageSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedRecurringNightmarePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_SAFE_POSITIONS,
  );
  const reviewedRecurringNightmareSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedPriestOfFellRitesPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_SAFE_POSITIONS,
  );
  const reviewedPriestOfFellRitesSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSmugglersCopterPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_SAFE_POSITIONS,
  );
  const reviewedSmugglersCopterSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCryptbreakerPositions = new Set<number>(LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS);
  const reviewedCryptbreakerSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_CRYPTBREAKER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedMyrBattlespherePositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS,
  );
  const reviewedMyrBattlesphereSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedTreasureCohortPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS,
  );
  const reviewedTreasureCohortSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_TREASURE_COHORT_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedChampionOfWitsPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_SAFE_POSITIONS,
  );
  const reviewedChampionOfWitsSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedUtopiaSprawlPositions = new Set<number>(LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_SAFE_POSITIONS);
  const reviewedUtopiaSprawlSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedSplinterTwinPositions = new Set<number>(LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_SAFE_POSITIONS);
  const reviewedSplinterTwinSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedLingeringSoulsPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LINGERING_SOULS_SAFE_POSITIONS,
  );
  const reviewedLingeringSoulsSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_LINGERING_SOULS_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedOptionalGeneratedTokenPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
  );
  const reviewedOptionalGeneratedTokenExcludedPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_EXCLUDED_POSITIONS,
  );
  const reviewedOptionalGeneratedTokenSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGlorybringerPositions = new Set<number>(LEGACY_CUBE_REVIEWED_GLORYBRINGER_SAFE_POSITIONS);
  const reviewedGlorybringerSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GLORYBRINGER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGrimLavamancerPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_SAFE_POSITIONS,
  );
  const reviewedGrimLavamancerSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedGiftsUngivenPositions = new Set<number>(LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_SAFE_POSITIONS);
  const reviewedGiftsUngivenSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedLilianaTwoPilesPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_SAFE_POSITIONS,
  );
  const reviewedLilianaTwoPilesSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedFactOrFictionPositions = new Set<number>(LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_SAFE_POSITIONS);
  const reviewedFactOrFictionSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedCompanionPositions = new Set<number>(LEGACY_CUBE_REVIEWED_COMPANION_SAFE_POSITIONS);
  const reviewedCompanionSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_COMPANION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const alternateCostPositions = new Set<number>(LEGACY_CUBE_ALTERNATE_COST_SAFE_POSITIONS);
  const alternateCostExcludedPositions = new Set<number>(LEGACY_CUBE_ALTERNATE_COST_EXCLUDED_POSITIONS);
  const alternateCostSignatures = new Map<number, string>(
    LEGACY_CUBE_ALTERNATE_COST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const optionalDeciderYouPositions = new Set<number>(LEGACY_CUBE_OPTIONAL_DECIDER_YOU_SAFE_POSITIONS);
  const optionalDeciderYouExcludedPositions = new Set<number>(
    LEGACY_CUBE_OPTIONAL_DECIDER_YOU_EXCLUDED_POSITIONS,
  );
  const optionalDeciderYouSignatures = new Map<number, string>(
    LEGACY_CUBE_OPTIONAL_DECIDER_YOU_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const reviewedOptionalLibrarySearchPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_SAFE_POSITIONS,
  );
  const reviewedOptionalLibrarySearchExcludedPositions = new Set<number>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_EXCLUDED_POSITIONS,
  );
  const reviewedOptionalLibrarySearchSignatures = new Map<number, string>(
    LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const alternateModePositions = new Set<number>(LEGACY_CUBE_ALTERNATE_MODE_SAFE_POSITIONS);
  const alternateModeExcludedPositions = new Set<number>(LEGACY_CUBE_ALTERNATE_MODE_EXCLUDED_POSITIONS);
  const alternateModeSignatures = new Map<number, string>(
    LEGACY_CUBE_ALTERNATE_MODE_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const announcedNumberPositions = new Set<number>(LEGACY_CUBE_ANNOUNCED_NUMBER_SAFE_POSITIONS);
  const announcedNumberExcludedPositions = new Set<number>(LEGACY_CUBE_ANNOUNCED_NUMBER_EXCLUDED_POSITIONS);
  const announcedNumberSignatures = new Map<number, string>(
    LEGACY_CUBE_ANNOUNCED_NUMBER_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const statedOrderingPositions = new Set<number>(LEGACY_CUBE_STATED_ORDERING_SAFE_POSITIONS);
  const statedOrderingExcludedPositions = new Set<number>(LEGACY_CUBE_STATED_ORDERING_EXCLUDED_POSITIONS);
  const statedOrderingSignatures = new Map<number, string>(
    LEGACY_CUBE_STATED_ORDERING_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const statedDistributionPositions = new Set<number>(LEGACY_CUBE_STATED_DISTRIBUTION_SAFE_POSITIONS);
  const statedDistributionExcludedPositions = new Set<number>(
    LEGACY_CUBE_STATED_DISTRIBUTION_EXCLUDED_POSITIONS,
  );
  const statedDistributionSignatures = new Map<number, string>(
    LEGACY_CUBE_STATED_DISTRIBUTION_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const statedRetargetPositions = new Set<number>(LEGACY_CUBE_STATED_RETARGET_SAFE_POSITIONS);
  const statedRetargetExcludedPositions = new Set<number>(LEGACY_CUBE_STATED_RETARGET_EXCLUDED_POSITIONS);
  const statedRetargetSignatures = new Map<number, string>(
    LEGACY_CUBE_STATED_RETARGET_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const openCardNamingPositions = new Set<number>(LEGACY_CUBE_OPEN_CARD_NAMING_SAFE_POSITIONS);
  const openCardNamingExcludedPositions = new Set<number>(LEGACY_CUBE_OPEN_CARD_NAMING_EXCLUDED_POSITIONS);
  const openCardNamingSignatures = new Map<number, string>(
    LEGACY_CUBE_OPEN_CARD_NAMING_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const discardOrSourceSacrificeCostPositions = new Set<number>(
    LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS,
  );
  const discardOrSourceSacrificeCostExcludedPositions = new Set<number>(
    LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_EXCLUDED_POSITIONS,
  );
  const discardOrSourceSacrificeCostSignatures = new Map<number, string>(
    LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_COHORTS.flatMap((cohort) =>
      cohort.positions.map((position): readonly [number, string] => [
        position,
        JSON.stringify(cohort.families),
      ]),
    ),
  );
  const chosenCostPaymentRefusedPositions = new Set<number>(
    LEGACY_CUBE_CHOSEN_COST_PAYMENT_REFUSED_POSITIONS,
  );
  // Every admitted card pays its costs through the same two seams, so both are
  // checked at every admission: the mana half under the payment profile the
  // card's own profile names, and the non-mana half under the one boundary
  // `mtg-fp4l` phase 4 wired `getCostDecisionMaker` to.
  const requirePayableCosts = (
    entry: (typeof initialEntries)[number],
    manaPayment: 'ordinary' | 'announced' | 'phyrexian',
    options: {
      readonly allowReviewedManaCombo?: boolean;
      readonly allowReviewedExertCostPart?: boolean;
      readonly allowReviewedDrawCostPart?: boolean;
      readonly allowReviewedGraveyardExileCostPart?: boolean;
      readonly allowReviewedTriggerTargetCostParts?: boolean;
      readonly allowReviewedSourceDiscardCostPart?: boolean;
      readonly allowReviewedSourceReturnCostPart?: boolean;
      readonly allowReviewedDiscardCostParts?: boolean;
      readonly allowReviewedCreatureSacrificeCostParts?: boolean;
      readonly allowReviewedGildedGooseFoodSacrificeCostPart?: boolean;
      readonly allowReviewedPiaSiegeGangSacrificeCostParts?: boolean;
      readonly allowReviewedGeneratedTokenSacrificeCostParts?: boolean;
      readonly allowSpecialPaymentKeyword?: boolean;
      readonly allowReviewedAlternativeCost?: boolean;
      readonly allowReviewedFreeCounterspellCostParts?: boolean;
      readonly allowReviewedKalitasCostPart?: boolean;
      readonly allowReviewedTitanEscapeCostPart?: boolean;
      readonly allowReviewedFinalSixCostParts?: boolean;
    } = {},
  ): void => {
    const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
    const graveyardShape = LEGACY_CUBE_PUBLIC_GRAVEYARD_SELECTION_SHAPES[entry.position ?? 0];
    const manaRefusals =
      manaPayment === 'ordinary'
        ? legacyCubeOrdinaryManaPaymentRefusals(bytes)
        : manaPayment === 'phyrexian' &&
            (reviewedPhyrexianSpellCostPositions.has(entry.position ?? 0) ||
              reviewedBirthingPodPositions.has(entry.position ?? 0) ||
              reviewedOptionalCopyReplacementPositions.has(entry.position ?? 0))
          ? legacyCubePhyrexianManaPaymentRefusals(bytes)
          : legacyCubeAnnouncedManaPaymentRefusals(bytes);
    const refusals = [
      ...(graveyardShape === undefined
        ? []
        : legacyCubePublicGraveyardSelectionRefusals(bytes, graveyardShape)),
      ...manaRefusals.filter(
        (refusal) =>
          !(options.allowReviewedAlternativeCost === true && refusal === 'alternative or additional cost') &&
          !(options.allowReviewedManaCombo === true && refusal === 'multi-mana combo') &&
          !(options.allowSpecialPaymentKeyword === true && refusal === 'special payment keyword'),
      ),
      ...legacyCubeChosenCostPaymentRefusals(bytes, {
        allowPhyrexianManaCostParts: manaPayment === 'phyrexian',
        allowBoundedPermanentCostParts: LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedDiscardCostParts:
          options.allowReviewedDiscardCostParts === true ||
          discardOrSourceSacrificeCostPositions.has(entry.position ?? 0),
        allowReviewedCreatureDiscardCostPart: entry.position === 333,
        allowReviewedCreatureSacrificeCostParts:
          options.allowReviewedCreatureSacrificeCostParts === true ||
          LEGACY_CUBE_CHOSEN_CREATURE_SACRIFICE_COST_POSITIONS.some(
            (position) => position === entry.position,
          ),
        allowReviewedGeneratedObjectCostParts: LEGACY_CUBE_GENERATED_OBJECT_CHOSEN_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        ...(options.allowReviewedGildedGooseFoodSacrificeCostPart === true
          ? { allowReviewedGildedGooseFoodSacrificeCostPart: true }
          : {}),
        ...(options.allowReviewedPiaSiegeGangSacrificeCostParts === true
          ? { allowReviewedPiaSiegeGangSacrificeCostParts: true }
          : {}),
        ...(options.allowReviewedGeneratedTokenSacrificeCostParts === true
          ? { allowReviewedGeneratedTokenSacrificeCostParts: true }
          : {}),
        ...(options.allowReviewedFreeCounterspellCostParts === true
          ? { allowReviewedFreeCounterspellCostParts: true }
          : {}),
        ...(options.allowReviewedKalitasCostPart === true ? { allowReviewedKalitasCostPart: true } : {}),
        ...(options.allowReviewedTitanEscapeCostPart === true
          ? { allowReviewedTitanEscapeCostPart: true }
          : {}),
        ...(options.allowReviewedFinalSixCostParts === true ? { allowReviewedFinalSixCostParts: true } : {}),
        allowReviewedOtherCreatureSacrificeCostPart: LEGACY_CUBE_OTHER_CREATURE_SACRIFICE_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
        allowReviewedTriggerTargetCostParts:
          options.allowReviewedTriggerTargetCostParts === true &&
          LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS.some(
            (position) => position === entry.position,
          ),
        ...(options.allowReviewedSourceDiscardCostPart === true
          ? { allowReviewedSourceDiscardCostPart: true }
          : {}),
        ...(options.allowReviewedSourceReturnCostPart === true
          ? { allowReviewedSourceReturnCostPart: true }
          : {}),
        ...(options.allowReviewedExertCostPart === true ? { allowReviewedExertCostPart: true } : {}),
        ...(options.allowReviewedDrawCostPart === true ? { allowReviewedDrawCostPart: true } : {}),
        ...(options.allowReviewedGraveyardExileCostPart === true
          ? { allowReviewedGraveyardExileCostPart: true }
          : {}),
      }),
    ];
    if (refusals.length > 0) {
      throw new Error(
        `reviewed safe position ${String(entry.position)} ${entry.correctedName} has unsupported ${manaPayment} payment: ${refusals.join(', ')}`,
      );
    }
  };
  const ordinaryCombatSingleTargetCohort = initialEntries
    .filter((entry) => JSON.stringify(entry.families) === JSON.stringify(['priority', 'targets', 'combat']))
    .map((entry) => entry.position);
  const reviewedOrdinaryCombatSingleTargetCohort = [
    ...ordinaryCombatSingleTargetPositions,
    ...ordinaryCombatSingleTargetExcludedPositions,
    ...ordinaryCombatTriggerTargetPositions,
    ...vraskaGeneratedTokenPositions,
    ...statedRetargetPositions,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(ordinaryCombatSingleTargetCohort) !==
    JSON.stringify(reviewedOrdinaryCombatSingleTargetCohort)
  ) {
    throw new Error('ordinary-combat singleton-target cohort drift');
  }
  for (const position of ordinaryCombatSingleTargetExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
    const refusals = [
      ...legacyCubeOrdinaryCombatSingleTargetRefusals(bytes),
      ...legacyCubeOrdinaryCombatTriggeredSingleTargetRefusals(bytes),
      ...legacyCubeOrdinaryManaPaymentRefusals(bytes),
    ];
    if (refusals.length === 0) {
      throw new Error(
        `excluded ordinary-combat singleton-target position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const baneslayerProtectionCohort = initialEntries
    .filter(
      (entry) =>
        JSON.stringify(entry.families) === JSON.stringify(['priority', 'combat', 'naming-text-numbers']),
    )
    .map((entry) => entry.position);
  const reviewedBaneslayerProtectionCohort = [
    ...baneslayerProtectionPositions,
    ...baneslayerProtectionExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(baneslayerProtectionCohort) !== JSON.stringify(reviewedBaneslayerProtectionCohort)) {
    throw new Error('Baneslayer fixed-protection cohort drift');
  }
  for (const position of baneslayerProtectionExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeBaneslayerProtectionProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Baneslayer fixed-protection position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const discardSelectionCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return script
        .split(/\r?\n/u)
        .some((line) => /\b(?:DB|AB|SP)\$\s*Discard\b/u.test(line) && /\bMode\$\s*TgtChoose\b/u.test(line));
    })
    .map((entry) => entry.position);
  const reviewedDiscardSelectionCohort = [
    ...chartACourseDiscardPositions,
    ...chartACourseDiscardExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(discardSelectionCohort) !== JSON.stringify(reviewedDiscardSelectionCohort)) {
    throw new Error('Chart a Course discard-selection cohort drift');
  }
  for (const position of chartACourseDiscardExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeChartACourseDiscardProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Chart a Course discard-selection position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const levelUpCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return script.split(/\r?\n/u).some((line) => line.startsWith('K:Level up:'));
    })
    .map((entry) => entry.position);
  const reviewedLevelUpCohort = [
    ...studentOfWarfareLevelUpPositions,
    ...studentOfWarfareLevelUpExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(levelUpCohort) !== JSON.stringify(reviewedLevelUpCohort)) {
    throw new Error('reviewed level-up cohort drift');
  }
  for (const position of studentOfWarfareLevelUpExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeReviewedLevelUpProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded reviewed level-up position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const selflessSpiritCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return script
        .split(/\r?\n/u)
        .some(
          (line) =>
            line ===
            'A:AB$ PumpAll | Cost$ Sac<1/CARDNAME> | ValidCards$ Creature.YouCtrl | KW$ Indestructible | SpellDescription$ Creatures you control gain indestructible until end of turn.',
        );
    })
    .map((entry) => entry.position);
  const reviewedSelflessSpiritCohort = [...selflessSpiritPositions, ...selflessSpiritExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(selflessSpiritCohort) !== JSON.stringify(reviewedSelflessSpiritCohort)) {
    throw new Error('Selfless Spirit exact-ability cohort drift');
  }
  for (const position of selflessSpiritExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeSelflessSpiritProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Selfless Spirit profile position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const remorsefulClericCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return script
        .split(/\r?\n/u)
        .some(
          (line) =>
            line ===
            "A:AB$ ChangeZoneAll | Cost$ Sac<1/CARDNAME> | ValidTgts$ Player | Origin$ Graveyard | ChangeType$ Card | IsCurse$ True | Destination$ Exile | SpellDescription$ Exile all cards from target player's graveyard.",
        );
    })
    .map((entry) => entry.position);
  const reviewedRemorsefulClericCohort = [
    ...remorsefulClericPositions,
    ...remorsefulClericExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(remorsefulClericCohort) !== JSON.stringify(reviewedRemorsefulClericCohort)) {
    throw new Error('Remorseful Cleric exact-ability cohort drift');
  }
  for (const position of remorsefulClericExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeRemorsefulClericProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Remorseful Cleric profile position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const coldsteelHeartCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return script.split(/\r?\n/u).some((line) => line.trim() === 'K:ETBReplacement:Other:ChooseColor');
    })
    .map((entry) => entry.position);
  const reviewedColdsteelHeartCohort = [...coldsteelHeartPositions, ...coldsteelHeartExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(coldsteelHeartCohort) !== JSON.stringify(reviewedColdsteelHeartCohort)) {
    throw new Error('Coldsteel Heart entry-color cohort drift');
  }
  for (const position of coldsteelHeartExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeColdsteelHeartProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Coldsteel Heart profile position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const extinctionEventCohort = initialEntries
    .filter((entry) => {
      const source = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return /\bChooseEvenOdd\b|\bcmcChosenEvenOdd\b/u.test(source);
    })
    .map((entry) => entry.position);
  const reviewedExtinctionEventCohort = [
    ...extinctionEventPositions,
    ...extinctionEventExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(extinctionEventCohort) !== JSON.stringify(reviewedExtinctionEventCohort)) {
    throw new Error('Extinction Event odd-even cohort drift');
  }
  for (const position of extinctionEventExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeExtinctionEventProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded Extinction Event profile position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const optionalTriggerConfirmCohort = initialEntries
    .filter(
      (entry) =>
        JSON.stringify(entry.families) ===
        JSON.stringify(['priority', 'combat', 'replacement-trigger-choices']),
    )
    .map((entry) => entry.position);
  const reviewedOptionalTriggerConfirmCohort = [
    ...optionalTriggerConfirmPositions,
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
    ...optionalTriggerConfirmExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(optionalTriggerConfirmCohort) !== JSON.stringify(reviewedOptionalTriggerConfirmCohort)) {
    throw new Error('optional-trigger confirm cohort drift');
  }
  for (const position of optionalTriggerConfirmExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeOptionalTriggerConfirmProfileRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded optional-trigger confirm position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // `mtg-fp4l` phase 2. The eight reviewed cohort signatures and the two refused
  // entire are one population: every official card whose whole added surface is
  // a bounded selection out of a list Forge has already enumerated, plus the one
  // modal choice. Four of those positions were admitted by an earlier profile
  // and stay with it, so the drift check is against the union rather than
  // against this profile's own safe list alone.
  const boundedMultiSelectionFamilies: readonly string[] = [
    'priority',
    'combat',
    'targets',
    'zone-card-selection',
    'modes',
  ];
  const boundedMultiSelectionCohort = initialEntries
    .filter(
      (entry) =>
        entry.families.every((family) => boundedMultiSelectionFamilies.includes(family)) &&
        (entry.families.includes('zone-card-selection') || entry.families.includes('modes')),
    )
    .map((entry) => entry.position);
  const reviewedBoundedMultiSelectionCohort = [
    ...boundedMultiSelectionPositions,
    ...boundedMultiSelectionExcludedPositions,
    ...singleZoneCardPositions,
    ...chartACourseDiscardPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(boundedMultiSelectionCohort) !== JSON.stringify(reviewedBoundedMultiSelectionCohort)) {
    throw new Error('bounded multi-selection cohort drift');
  }
  for (const position of boundedMultiSelectionExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeBoundedMultiSelectionRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded bounded multi-selection position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // `mtg-fp4l` phase 3. The population is every official card whose whole added
  // surface is one choice out of a list Forge enumerated: the phase-2 families
  // plus the two the wired choose-one callbacks answer. Three of those positions
  // were admitted by an earlier single-card profile and stay with it, so the
  // drift check is against the union rather than this profile's safe list alone.
  const boundedEnumeratedChoiceFamilies: readonly string[] = [
    ...boundedMultiSelectionFamilies,
    'naming-text-numbers',
    'piles-votes',
  ];
  const boundedEnumeratedChoiceCohort = initialEntries
    .filter(
      (entry) =>
        entry.families.every((family) => boundedEnumeratedChoiceFamilies.includes(family)) &&
        (entry.families.includes('naming-text-numbers') || entry.families.includes('piles-votes')),
    )
    .map((entry) => entry.position);
  const reviewedBoundedEnumeratedChoiceCohort = [
    ...boundedEnumeratedChoicePositions,
    ...boundedEnumeratedChoiceExcludedPositions,
    ...baneslayerProtectionPositions,
    ...extinctionEventPositions,
    ...coldsteelHeartPositions,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(boundedEnumeratedChoiceCohort) !== JSON.stringify(reviewedBoundedEnumeratedChoiceCohort)
  ) {
    throw new Error('bounded enumerated choice cohort drift');
  }
  for (const position of boundedEnumeratedChoiceExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeBoundedEnumeratedChoiceRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded bounded enumerated choice position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // `mtg-fp4l` phase 4. The population is every official card whose whole added
  // surface is the phase-3 shapes plus an announced number: the X the caster
  // states, the count a cost reduction or a keyword cost asks for, and the
  // number a bounded range offers. None of the 36 was admitted by an earlier
  // profile, so the drift check is against this profile's own two lists.
  const announcedNumberFamilies: readonly string[] = [...boundedEnumeratedChoiceFamilies, 'mana-x'];
  const announcedNumberCohort = initialEntries
    .filter(
      (entry) =>
        entry.families.every((family) => announcedNumberFamilies.includes(family)) &&
        entry.families.includes('mana-x'),
    )
    .map((entry) => entry.position);
  const reviewedAnnouncedNumberCohort = [...announcedNumberPositions, ...announcedNumberExcludedPositions]
    .filter((position) => initialEntries[position - 1]?.families.includes('mana-x'))
    .sort((left, right) => left - right);
  if (JSON.stringify(announcedNumberCohort) !== JSON.stringify(reviewedAnnouncedNumberCohort)) {
    throw new Error('announced number cohort drift');
  }
  // A derived SVar:X also needs the wider boundary, even though it adds no
  // mana-x family. Compare its whole matching population with the reviewed
  // extension and the cards already owned by three earlier profiles.
  const derivedAmountCohort = initialEntries
    .filter((entry) => {
      if (entry.families.includes('mana-x')) return false;
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return (
        /^SVar:X:/mu.test(bytes.toString('utf8')) &&
        legacyCubeAnnouncedNumberRefusals(bytes, syntaxInventory).length === 0
      );
    })
    .map((entry) => entry.position);
  const previouslyReviewedAmounts = [
    ...priorityOnlyPositions,
    ...singleTargetPositions,
    ...ordinaryCombatPositions,
  ].filter((position) => derivedAmountCohort.includes(position));
  const reviewedDerivedAmounts = [
    ...previouslyReviewedAmounts,
    ...[...announcedNumberPositions].filter(
      (position) => !initialEntries[position - 1]?.families.includes('mana-x'),
    ),
  ].sort((left, right) => left - right);
  if (JSON.stringify(derivedAmountCohort) !== JSON.stringify(reviewedDerivedAmounts)) {
    throw new Error('derived amount cohort drift');
  }
  for (const position of announcedNumberExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeAnnouncedNumberRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded announced number position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // `mtg-fp4l` phase 5. The population is every official card whose whole added
  // surface is the phase-4 shapes plus an order the seat states. A card that
  // orders something and also chooses a cost or answers a replacement effect
  // falls out here rather than being excluded by hand: it carries a family this
  // filter does not list, so it never enters the cohort.
  const statedOrderingFamilies: readonly string[] = [...announcedNumberFamilies, 'ordering'];
  const statedOrderingCohort = initialEntries
    .filter(
      (entry) =>
        entry.families.every((family) => statedOrderingFamilies.includes(family)) &&
        entry.families.includes('ordering'),
    )
    .map((entry) => entry.position);
  const reviewedStatedOrderingCohort = [...statedOrderingPositions, ...statedOrderingExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(statedOrderingCohort) !== JSON.stringify(reviewedStatedOrderingCohort)) {
    throw new Error('stated ordering cohort drift');
  }
  for (const position of statedOrderingExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeStatedOrderingRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded stated ordering position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // `mtg-fp4l` phase 6. This cohort is the one that cannot be named by a family
  // filter. Every earlier phase added a family nothing before it carried, so
  // the filter and the population were the same statement; a division adds no
  // family at all, and the four cards' signatures are all subsets of the
  // announced-number families, so a filter naming them would name twenty-three
  // cards it has no review for. The population is therefore read off the script
  // shape the boundary is written against: every audited position whose Forge
  // script states a division.
  const statedDistributionCohort = initialEntries
    .filter((entry) =>
      /\bDividedAsYouChoose\$/mu.test(readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8')),
    )
    .map((entry) => entry.position);
  const reviewedStatedDistributionCohort = [
    ...statedDistributionPositions,
    ...statedDistributionExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(statedDistributionCohort) !== JSON.stringify(reviewedStatedDistributionCohort)) {
    throw new Error('stated distribution cohort drift');
  }
  for (const position of statedDistributionExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeStatedDistributionRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded stated distribution position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // Phase 7's cohort is read off the script shape for the same reason phase 6's
  // is: a retargeting card carries whatever family signature its other text
  // gives it, so the population is every audited position that changes a target.
  const statedRetargetCohort = initialEntries
    .filter((entry) => /\bChangeTargets\b/mu.test(readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8')))
    .map((entry) => entry.position);
  const reviewedStatedRetargetCohort = [...statedRetargetPositions, ...statedRetargetExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(statedRetargetCohort) !== JSON.stringify(reviewedStatedRetargetCohort)) {
    throw new Error('stated retarget cohort drift');
  }
  for (const position of statedRetargetExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeStatedRetargetRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded stated retarget position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // Phase 8's cohort is read off the script shape for the same reason phases 6
  // and 7 are: a naming card carries whatever family signature its other text
  // gives it, so the population is every audited position that names a card.
  const openCardNamingCohort = initialEntries
    .filter((entry) =>
      /\b(?:AB|SP|DB)\$\s*NameCard\b/mu.test(readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8')),
    )
    .map((entry) => entry.position);
  const reviewedOpenCardNamingCohort = [...openCardNamingPositions, ...openCardNamingExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(openCardNamingCohort) !== JSON.stringify(reviewedOpenCardNamingCohort)) {
    throw new Error('open card naming cohort drift');
  }
  for (const position of openCardNamingExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const refusals = legacyCubeOpenCardNamingRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded open card naming position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const discardOrSourceSacrificeCostCohort = initialEntries
    .filter((entry) => {
      const script = readFileSync(join(scriptsRoot, entry.forgeScript), 'utf8');
      return /(?:^|\|)\s*Cost\$\s*[^|\n]*(?:Discard|Sac)</mu.test(script);
    })
    .map((entry) => entry.position);
  const reviewedDiscardOrSourceSacrificeCostCohort = [
    ...LEGACY_CUBE_REMORSEFUL_CLERIC_SAFE_POSITIONS,
    ...LEGACY_CUBE_SELFLESS_SPIRIT_SAFE_POSITIONS,
    ...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_CHOSEN_COST_POSITIONS.filter((position) => position === 192),
    ...LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS,
    ...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(discardOrSourceSacrificeCostCohort) !==
    JSON.stringify(reviewedDiscardOrSourceSacrificeCostCohort)
  ) {
    throw new Error('discard or source-sacrifice cost cohort drift');
  }
  for (const position of discardOrSourceSacrificeCostExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing discard/sacrifice cost exclusion ${String(position)}`);
    const refusals = legacyCubeDiscardOrSourceSacrificeCostRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded discard/sacrifice cost position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const boundedPermanentCostCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return (
        legacyCubeChosenCostPaymentRefusals(bytes).length > 0 &&
        legacyCubeChosenCostPaymentRefusals(bytes, { allowBoundedPermanentCostParts: true }).length === 0
      );
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(boundedPermanentCostCohort) !==
    JSON.stringify(LEGACY_CUBE_BOUNDED_PERMANENT_COST_POSITIONS)
  ) {
    throw new Error('bounded permanent cost cohort drift');
  }
  // Preserve evidence for the payment the reviewed visitor still refuses.
  for (const position of chosenCostPaymentRefusedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing chosen-cost position ${String(position)}`);
    const refusals = legacyCubeChosenCostPaymentRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)));
    if (refusals.length === 0) {
      throw new Error(
        `chosen-cost refused position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const reviewedPiaSiegeGangCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPiaSiegeGangRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPiaSiegeGangCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Pia/Siege-Gang exact-composition cohort drift');
  }
  const reviewedTreacheryCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedTreacheryRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedTreacheryCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_TREACHERY_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Treachery exact-composition cohort drift');
  }
  const reviewedSkyclaveApparitionCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedSkyclaveApparitionRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedSkyclaveApparitionCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Skyclave Apparition exact-composition cohort drift');
  }
  const reviewedPathToExileCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPathToExileRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPathToExileCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Path to Exile exact-composition cohort drift');
  }
  const reviewedReveillarkCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedReveillarkRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedReveillarkCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_REVEILLARK_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Reveillark exact-composition cohort drift');
  }
  const reviewedBloodchiefsThirstCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedBloodchiefsThirstRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedBloodchiefsThirstCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_SAFE_POSITIONS)
  ) {
    throw new Error("reviewed Bloodchief's Thirst exact-composition cohort drift");
  }
  const reviewedPrimalMightCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPrimalMightRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPrimalMightCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Primal Might exact-composition cohort drift');
  }
  const reviewedEngineeredExplosivesCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedEngineeredExplosivesRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedEngineeredExplosivesCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Engineered Explosives exact-composition cohort drift');
  }
  const reviewedPriestOfFellRitesCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPriestOfFellRitesRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPriestOfFellRitesCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Priest of Fell Rites exact-composition cohort drift');
  }
  const reviewedSmugglersCopterCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedSmugglersCopterRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedSmugglersCopterCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_SAFE_POSITIONS)
  ) {
    throw new Error("reviewed Smuggler's Copter exact-composition cohort drift");
  }
  const reviewedCryptbreakerCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedCryptbreakerRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedCryptbreakerCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_CRYPTBREAKER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Cryptbreaker exact-composition cohort drift');
  }
  const reviewedMyrBattlesphereCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedMyrBattlesphereRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedMyrBattlesphereCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Myr Battlesphere exact-composition cohort drift');
  }
  const reviewedTreasureCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedTreasureCohortRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedTreasureCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_TREASURE_COHORT_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Treasure cohort exact-composition cohort drift');
  }
  const reviewedChampionOfWitsCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedChampionOfWitsRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedChampionOfWitsCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Champion of Wits exact-composition cohort drift');
  }
  const reviewedReorderOrShuffleCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedReorderOrShuffleRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedReorderOrShuffleCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed reorder-or-shuffle exact-composition cohort drift');
  }
  const reviewedAnimateDeadCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedAnimateDeadRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedAnimateDeadCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Animate Dead exact-composition cohort drift');
  }
  const reviewedHeartlessActCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedHeartlessActRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedHeartlessActCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Heartless Act exact-composition cohort drift');
  }
  const reviewedAgadeemsAwakeningCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedAgadeemsAwakeningRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedAgadeemsAwakeningCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_SAFE_POSITIONS)
  ) {
    throw new Error("reviewed Agadeem's Awakening exact-composition cohort drift");
  }
  const reviewedModalLandSpellCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedModalLandSpellRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedModalLandSpellCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed modal land spell exact-composition cohort drift');
  }
  const reviewedConvokeCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedConvokeRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (JSON.stringify(reviewedConvokeCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_CONVOKE_SAFE_POSITIONS)) {
    throw new Error('reviewed Convoke exact-composition cohort drift');
  }
  const reviewedDelveCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedDelveRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (JSON.stringify(reviewedDelveCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_DELVE_SAFE_POSITIONS)) {
    throw new Error('reviewed Delve exact-composition cohort drift');
  }
  const reviewedFreeCounterspellCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedFreeCounterspellRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedFreeCounterspellCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed free-counterspell exact-composition cohort drift');
  }
  const reviewedLegionsLandingCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedLegionsLandingRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedLegionsLandingCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_SAFE_POSITIONS)
  ) {
    throw new Error("reviewed Legion's Landing exact-composition cohort drift");
  }
  const triggerTargetCohort = initialEntries
    .filter((entry) => JSON.stringify(entry.families) === JSON.stringify(['priority', 'targets']))
    .map((entry) => entry.position);
  const reviewedTriggerTargetCohort = [
    ...singleTargetPositions,
    ...singleStackTargetPositions,
    ...triggerTargetPositions,
    ...paladinClassPositions,
    ...equipTargetPositions,
    ...auraTargetPositions,
    ...fettersAuraTargetPositions,
    ...fallAuraTargetPositions,
    ...reviewedMaulOfTheSkyclavesPositions,
    ...triggerTargetExcludedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(triggerTargetCohort) !== JSON.stringify(reviewedTriggerTargetCohort)) {
    throw new Error('pending priority-plus-targets trigger-target cohort drift');
  }
  for (const position of triggerTargetExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing excluded position ${String(position)}`);
    const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
    const refusals = [
      ...legacyCubeMandatoryTriggeredSingleTargetRefusals(bytes),
      ...legacyCubeEquipTargetProfileRefusals(bytes),
      ...legacyCubeAuraTargetProfileRefusals(bytes),
      ...legacyCubeFettersAuraTargetProfileRefusals(bytes),
      ...legacyCubeFallAuraTargetProfileRefusals(bytes),
      ...legacyCubeOrdinaryManaPaymentRefusals(bytes),
    ];
    if (refusals.length === 0) {
      throw new Error(
        `excluded trigger-target position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const shocklandCohort = initialEntries
    .filter((entry) => JSON.stringify(entry.families) === JSON.stringify(['priority', 'optional-costs']))
    .map((entry) => entry.position);
  const reviewedShocklandCohort = [...shocklandPositions, ...shocklandExcludedPositions].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(shocklandCohort) !== JSON.stringify(reviewedShocklandCohort)) {
    throw new Error('shockland optional-cost cohort drift');
  }
  for (const position of shocklandExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing shockland optional-cost exclusion ${String(position)}`);
    const refusals = legacyCubeShocklandProfileRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)));
    if (refusals.length === 0) {
      throw new Error(
        `excluded optional-cost position ${String(position)} ${entry.correctedName} has no shockland refusal evidence`,
      );
    }
  }
  const generatedObjectCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return generatedTokenScriptNames(bytes).length > 0;
    })
    .map((entry) => entry.position);
  const completeReviewedGeneratedObjectCohort = [
    ...LEGACY_CUBE_GENERATED_OBJECT_PREEXISTING_SAFE_POSITIONS,
    ...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions,
  ].sort((left, right) => left - right);
  if (JSON.stringify(generatedObjectCohort) !== JSON.stringify(completeReviewedGeneratedObjectCohort)) {
    throw new Error(
      `generated-object root cohort drift: observed ${generatedObjectCohort.join(',')}; reviewed ${completeReviewedGeneratedObjectCohort.join(',')}`,
    );
  }
  const reviewedGeneratedPins = new Map<string, string>(
    LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts.map((row) => [row.name, row.sha256]),
  );
  const observedGeneratedPins = new Map<string, string>();
  for (const position of LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing generated-object position ${String(position)}`);
    const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
    const dependencies = resolveLegacyCubeGeneratedScriptDependencies(
      bytes,
      (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
      syntaxInventory,
    );
    for (const dependency of dependencies) {
      const expected = reviewedGeneratedPins.get(dependency.name);
      if (expected !== dependency.sha256) {
        throw new Error(
          `generated token-script review drift for ${dependency.name}: expected ${expected ?? 'no pin'}, got ${dependency.sha256}`,
        );
      }
      observedGeneratedPins.set(dependency.name, dependency.sha256);
    }
    if (generatedObjectExcludedPositions.has(position)) {
      const refusals = [
        ...legacyCubePinnedGeneratedObjectRefusals(bytes, syntaxInventory),
        ...legacyCubeAnnouncedManaPaymentRefusals(bytes),
        ...legacyCubeChosenCostPaymentRefusals(bytes),
      ];
      if (refusals.length === 0) {
        throw new Error(
          `excluded generated-object position ${String(position)} ${entry.correctedName} has no refusal evidence`,
        );
      }
    }
  }
  const exactObservedGeneratedPins = [...observedGeneratedPins]
    .map(([name, dependencySha256]) => ({ name, sha256: dependencySha256 }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (
    JSON.stringify(exactObservedGeneratedPins) !==
    JSON.stringify(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts)
  ) {
    throw new Error('generated token-script dependency inventory drift');
  }
  const statedOrderingTriggerTargetCohort = initialEntries
    .filter((entry) =>
      legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      ).includes('trigger target'),
    )
    .map((entry) => entry.position);
  const completeReviewedStatedOrderingTriggerTargetCohort = [
    ...LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PREEXISTING_SAFE_POSITIONS,
    ...LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_SAFE_POSITIONS,
    ...LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(statedOrderingTriggerTargetCohort) !==
    JSON.stringify(completeReviewedStatedOrderingTriggerTargetCohort)
  ) {
    throw new Error('stated-ordering trigger-target cohort drift');
  }
  for (const position of statedOrderingTriggerTargetExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing trigger-target exclusion ${String(position)}`);
    const refusals = legacyCubeReviewedTriggerTargetRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded stated-ordering trigger-target position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const soleCounterTypeChoiceCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = [
        ...new Set([
          ...legacyCubeStatedOrderingRefusals(bytes, syntaxInventory),
          ...legacyCubeAnnouncedManaPaymentRefusals(bytes),
          ...legacyCubeChosenCostPaymentRefusals(bytes),
        ]),
      ];
      return refusals.length === 1 && refusals[0] === 'counter-type choice';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleCounterTypeChoiceCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker counter-type choice cohort drift');
  }
  const soleOptionalTargetCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = [
        ...new Set([
          ...legacyCubeStatedOrderingRefusals(bytes, syntaxInventory),
          ...legacyCubeAnnouncedManaPaymentRefusals(bytes),
          ...legacyCubeChosenCostPaymentRefusals(bytes),
        ]),
      ];
      return refusals.length === 1 && refusals[0] === 'optional target';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleOptionalTargetCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker optional-target cohort drift');
  }
  const solePhyrexianSpellCostCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = [
        ...new Set([
          ...legacyCubeStatedOrderingRefusals(bytes, syntaxInventory),
          ...legacyCubeAnnouncedManaPaymentRefusals(bytes),
          ...legacyCubeChosenCostPaymentRefusals(bytes),
        ]),
      ];
      return refusals.length === 1 && refusals[0] === 'Phyrexian mana cost';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(solePhyrexianSpellCostCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker Phyrexian spell-cost cohort drift');
  }
  const soleCascadeCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = [
        ...new Set([
          ...legacyCubeStatedOrderingRefusals(bytes, syntaxInventory),
          ...legacyCubeAnnouncedManaPaymentRefusals(bytes),
          ...legacyCubeChosenCostPaymentRefusals(bytes),
        ]),
      ];
      return refusals.length === 1 && refusals[0] === 'unbounded decision token keyword:Cascade';
    })
    .map((entry) => entry.position);
  if (JSON.stringify(soleCascadeCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_CASCADE_SAFE_POSITIONS)) {
    throw new Error('reviewed sole-blocker Cascade cohort drift');
  }
  const soleRepeatableModeCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'repeatable mode selection';
    })
    .map((entry) => entry.position);
  const soleRepeatableModeExpected = LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_COHORTS.filter(
    (cohort) => !(cohort.families as readonly string[]).includes('optional-costs'),
  ).flatMap((cohort) => [...cohort.positions]);
  if (JSON.stringify(soleRepeatableModeCohort) !== JSON.stringify(soleRepeatableModeExpected)) {
    throw new Error('reviewed sole-blocker repeatable-mode cohort drift');
  }
  const reviewedRepeatableModeCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedRepeatableModeRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedRepeatableModeCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed repeatable-mode composition cohort drift');
  }
  const soleMultipleTargetCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'multiple targets';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleMultipleTargetCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker multiple-target cohort drift');
  }
  const soleManaComboCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'multi-mana combo';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleManaComboCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_MANA_COMBO_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker mana-combo cohort drift');
  }
  const stackTargetFalsePositiveCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'retarget ability';
    })
    .map((entry) => entry.position);
  const reviewedStackTargetFalsePositiveCohort = [
    ...singleStackTargetPositions,
    ...LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_SAFE_POSITIONS,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(stackTargetFalsePositiveCohort) !== JSON.stringify(reviewedStackTargetFalsePositiveCohort)
  ) {
    throw new Error('reviewed Stack-target false-positive cohort drift');
  }
  const reviewedPrismariCommandCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedPrismariCommandRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPrismariCommandCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Prismari Command composition cohort drift');
  }
  const reviewedBlessedAllianceCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedBlessedAllianceRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedBlessedAllianceCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Blessed Alliance composition cohort drift');
  }
  const reviewedKalitasCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedKalitasRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)), syntaxInventory)
          .length === 0,
    )
    .map((entry) => entry.position);
  if (JSON.stringify(reviewedKalitasCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_KALITAS_SAFE_POSITIONS)) {
    throw new Error('reviewed Kalitas composition cohort drift');
  }
  const reviewedUroCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedUroRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)), syntaxInventory)
          .length === 0,
    )
    .map((entry) => entry.position);
  if (JSON.stringify(reviewedUroCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS)) {
    throw new Error('reviewed Uro composition cohort drift');
  }
  const reviewedKroxaCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedKroxaRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)), syntaxInventory)
          .length === 0,
    )
    .map((entry) => entry.position);
  if (JSON.stringify(reviewedKroxaCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_KROXA_SAFE_POSITIONS)) {
    throw new Error('reviewed Kroxa composition cohort drift');
  }
  const reviewedHuntmasterCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedHuntmasterRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedHuntmasterCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_HUNTMASTER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed Huntmaster composition cohort drift');
  }
  const reviewedRemainingPlaneswalkerCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedRemainingPlaneswalkersRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedRemainingPlaneswalkerCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed remaining planeswalker composition cohort drift');
  }
  const reviewedFinalSixCohort = initialEntries
    .filter(
      (entry) =>
        legacyCubeReviewedFinalSixRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).length === 0,
    )
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedFinalSixCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_FINAL_SIX_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed final-six composition cohort drift');
  }
  const soleOptionalCopyReplacementCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return (
        refusals.length === 1 &&
        refusals[0] === 'unbounded decision token semantic-marker:optional-copy-replacement'
      );
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleOptionalCopyReplacementCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker optional-copy replacement cohort drift');
  }
  const reviewedOptionalCopyReplacementCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedOptionalCopyReplacementRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedOptionalCopyReplacementCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed optional-copy replacement exact-composition cohort drift');
  }
  const reviewedPeekAndRevealCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPeekAndRevealRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPeekAndRevealCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed PeekAndReveal exact-composition cohort drift');
  }
  const reviewedGeneratedTokenSacrificeCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedGeneratedTokenSacrificeRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedGeneratedTokenSacrificeCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed generated-token sacrifice exact-composition cohort drift');
  }
  const reviewedGeneratedObjectBoundedChoiceCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedGeneratedObjectBoundedChoiceCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed generated-object bounded-choice exact-composition cohort drift');
  }
  const reviewedAlternateCostGeneratedObjectCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedAlternateCostGeneratedObjectRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedAlternateCostGeneratedObjectCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed alternate-cost generated-object exact-composition cohort drift');
  }
  const reviewedResidualGeneratedTokenCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedResidualGeneratedTokenRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedResidualGeneratedTokenCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed residual generated-token exact-composition cohort drift');
  }
  const reviewedMultiTargetTransformationCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedMultiTargetTransformationRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedMultiTargetTransformationCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed multi-target transformation exact-composition cohort drift');
  }
  const reviewedPlaneswalkerUnlessSacrificeCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedPlaneswalkerUnlessSacrificeCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed planeswalker UnlessCost sacrifice exact-composition cohort drift');
  }
  const reviewedCopySpellRetargetCohort = initialEntries
    .filter((entry) => {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      return legacyCubeReviewedCopySpellRetargetRefusals(bytes, syntaxInventory).length === 0;
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedCopySpellRetargetCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed copy-spell retarget exact-composition cohort drift');
  }
  const soleGameRestartCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'game-restart lifecycle';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleGameRestartCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_KARN_LIBERATED_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker game-restart cohort drift');
  }
  const soleMorphCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'unbounded decision token keyword:Morph';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleMorphCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker Morph cohort drift');
  }
  const soleTriggeredPaymentCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return (
        refusals.length === 1 && refusals[0] === 'unbounded decision token semantic-marker:triggered-payment'
      );
    })
    .map((entry) => entry.position);
  const completeTriggeredPaymentCohort = [
    ...LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_EXCLUDED_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_BARAL_SAFE_POSITIONS,
  ].sort((left, right) => left - right);
  if (JSON.stringify(soleTriggeredPaymentCohort) !== JSON.stringify(completeTriggeredPaymentCohort)) {
    throw new Error('reviewed sole-blocker triggered-payment cohort drift');
  }
  const soleUnlessCostCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'unbounded decision token parameter-key:UnlessCost';
    })
    .map((entry) => entry.position);
  const completeUnlessCostCohort = [
    ...LEGACY_CUBE_REVIEWED_UNLESS_COST_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_UNLESS_COST_EXCLUDED_POSITIONS,
    ...LEGACY_CUBE_SHOCKLAND_SAFE_POSITIONS,
  ].sort((left, right) => left - right);
  if (JSON.stringify(soleUnlessCostCohort) !== JSON.stringify(completeUnlessCostCohort)) {
    throw new Error('reviewed sole-blocker UnlessCost cohort drift');
  }
  const counterUnlessCostCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return (
        refusals.length === 2 &&
        refusals.includes('retarget ability') &&
        refusals.includes('unbounded decision token parameter-key:UnlessCost')
      );
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(counterUnlessCostCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed counter UnlessCost cohort drift');
  }
  const soleOptionalAttackCostCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return (
        refusals.length === 1 && refusals[0] === 'unbounded decision token ability-api:OptionalAttackCost'
      );
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleOptionalAttackCostCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GLORYBRINGER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker OptionalAttackCost cohort drift');
  }
  const soleChoiceCostCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'choice cost';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleChoiceCostCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker choice-cost cohort drift');
  }
  const soleDistinctNameCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'distinct-name selection constraint';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleDistinctNameCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker distinct-name cohort drift');
  }
  const soleTwoPilesCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'unbounded decision token ability-api:TwoPiles';
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(soleTwoPilesCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed sole-blocker TwoPiles cohort drift');
  }
  const reviewedFactOrFictionCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedFactOrFictionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Fact or Fiction composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedFactOrFictionCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Fact or Fiction cohort drift');
  }
  const reviewedEmbercleaveCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedEmbercleaveRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Embercleave composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedEmbercleaveCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_EMBERCLEAVE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Embercleave cohort drift');
  }
  const reviewedLivingWeaponCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedLivingWeaponRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Living Weapon composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedLivingWeaponCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_LIVING_WEAPON_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Living Weapon cohort drift');
  }
  const reviewedForetellCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedForetellRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Foretell composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedForetellCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_FORETELL_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Foretell cohort drift');
  }
  const reviewedSatyrWayfinderCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedSatyrWayfinderRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Satyr Wayfinder composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedSatyrWayfinderCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Satyr Wayfinder cohort drift');
  }
  const reviewedBlueLibrarySelectionCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedBlueLibrarySelectionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed blue library-selection composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedBlueLibrarySelectionCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact blue library-selection cohort drift');
  }
  const reviewedGideonGarrukBloodlineCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedGideonGarrukBloodlineRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Gideon/Garruk/Bloodline composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedGideonGarrukBloodlineCohort) !==
    JSON.stringify(LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Gideon/Garruk/Bloodline cohort drift');
  }
  const reviewedHideawayCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeReviewedHideawayRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return !refusals.includes('exact reviewed Hideaway-four composition');
    })
    .map((entry) => entry.position);
  if (
    JSON.stringify(reviewedHideawayCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_HIDEAWAY_SAFE_POSITIONS)
  ) {
    throw new Error('reviewed exact Hideaway-four cohort drift');
  }
  const soleCompanionCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return refusals.length === 1 && refusals[0] === 'unbounded decision token keyword:Companion';
    })
    .map((entry) => entry.position);
  if (JSON.stringify(soleCompanionCohort) !== JSON.stringify(LEGACY_CUBE_REVIEWED_COMPANION_SAFE_POSITIONS)) {
    throw new Error('reviewed sole-blocker companion cohort drift');
  }
  const alternateCostCohort = initialEntries
    .filter(
      (entry) =>
        !legacyCubeReviewedAlternateCostRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).includes('missing reviewed alternate-cost keyword'),
    )
    .map((entry) => entry.position);
  const completeReviewedAlternateCostCohort = [
    ...LEGACY_CUBE_ALTERNATE_COST_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_MISCALCULATION_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_KROXA_SAFE_POSITIONS,
    ...LEGACY_CUBE_ALTERNATE_COST_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (JSON.stringify(alternateCostCohort) !== JSON.stringify(completeReviewedAlternateCostCohort)) {
    throw new Error('reviewed alternate-cost keyword cohort drift');
  }
  for (const position of alternateCostExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing alternate-cost exclusion ${String(position)}`);
    const refusals = legacyCubeReviewedAlternateCostRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded alternate-cost position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const optionalDeciderYouCohort = initialEntries
    .filter(
      (entry) =>
        !legacyCubeOptionalDeciderYouRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).includes('missing OptionalDecider$ You marker'),
    )
    .map((entry) => entry.position);
  const completeOptionalDeciderYouCohort = [
    ...LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PREEXISTING_SAFE_POSITIONS,
    ...LEGACY_CUBE_OPTIONAL_DECIDER_YOU_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_URO_SAFE_POSITIONS,
    ...LEGACY_CUBE_OPTIONAL_DECIDER_YOU_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (JSON.stringify(optionalDeciderYouCohort) !== JSON.stringify(completeOptionalDeciderYouCohort)) {
    throw new Error(
      `OptionalDecider$ You cohort drift: observed ${JSON.stringify(optionalDeciderYouCohort)}, reviewed ${JSON.stringify(completeOptionalDeciderYouCohort)}`,
    );
  }
  for (const position of optionalDeciderYouExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing OptionalDecider$ You exclusion ${String(position)}`);
    const refusals = legacyCubeOptionalDeciderYouRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded OptionalDecider$ You position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const reviewedOptionalLibrarySearchCohort = initialEntries
    .filter((entry) => {
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      return (
        refusals.includes('unbounded decision token parameter-key:OptionalDecider') &&
        refusals.includes('unbounded decision token parameter-key:ShuffleNonMandatory')
      );
    })
    .map((entry) => entry.position);
  const completeReviewedOptionalLibrarySearchCohort = [
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(reviewedOptionalLibrarySearchCohort) !==
    JSON.stringify(completeReviewedOptionalLibrarySearchCohort)
  ) {
    throw new Error('reviewed optional library-search cohort drift');
  }
  for (const position of reviewedOptionalLibrarySearchExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) {
      throw new Error(`missing optional library-search exclusion ${String(position)}`);
    }
    const refusals = legacyCubeReviewedOptionalLibrarySearchRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded optional library-search position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const alternateModeCohort = initialEntries
    .filter(
      (entry) =>
        !legacyCubeReviewedAlternateModeRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ).includes('missing reviewed alternate-mode marker'),
    )
    .map((entry) => entry.position);
  const completeAlternateModeCohort = [
    ...LEGACY_CUBE_ALTERNATE_MODE_SAFE_POSITIONS,
    ...LEGACY_CUBE_ALTERNATE_MODE_EXCLUDED_POSITIONS,
    194,
  ].sort((left, right) => left - right);
  if (JSON.stringify(alternateModeCohort) !== JSON.stringify(completeAlternateModeCohort)) {
    throw new Error(
      `reviewed alternate-mode cohort drift: observed ${JSON.stringify(alternateModeCohort)}, reviewed ${JSON.stringify(completeAlternateModeCohort)}`,
    );
  }
  for (const position of alternateModeExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined) throw new Error(`missing alternate-mode exclusion ${String(position)}`);
    const refusals = legacyCubeReviewedAlternateModeRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded alternate-mode position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  const optionalGeneratedTokenBlockers = [
    'unbounded decision token ability-api:Token',
    'unbounded decision token parameter-key:OptionalDecider',
    'unpinned generated-object source',
  ].sort();
  const reviewedOptionalGeneratedTokenCohort = initialEntries
    .filter((entry) => {
      const refusals = [
        ...legacyCubeStatedOrderingRefusals(
          readFileSync(join(scriptsRoot, entry.forgeScript)),
          syntaxInventory,
        ),
      ].sort();
      return JSON.stringify(refusals) === JSON.stringify(optionalGeneratedTokenBlockers);
    })
    .map((entry) => entry.position);
  const completeReviewedOptionalGeneratedTokenCohort = [
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_SAFE_POSITIONS,
    ...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_EXCLUDED_POSITIONS,
  ].sort((left, right) => left - right);
  if (
    JSON.stringify(reviewedOptionalGeneratedTokenCohort) !==
    JSON.stringify(completeReviewedOptionalGeneratedTokenCohort)
  ) {
    throw new Error(
      `reviewed optional generated-token cohort drift: observed ${JSON.stringify(reviewedOptionalGeneratedTokenCohort)}, reviewed ${JSON.stringify(completeReviewedOptionalGeneratedTokenCohort)}`,
    );
  }
  for (const position of reviewedOptionalGeneratedTokenExcludedPositions) {
    const entry = initialEntries[position - 1];
    if (entry === undefined)
      throw new Error(`missing optional generated-token exclusion ${String(position)}`);
    const refusals = legacyCubeReviewedOptionalGeneratedTokenRefusals(
      readFileSync(join(scriptsRoot, entry.forgeScript)),
      syntaxInventory,
    );
    if (refusals.length === 0) {
      throw new Error(
        `excluded optional generated-token position ${String(position)} ${entry.correctedName} has no refusal evidence`,
      );
    }
  }
  // A position no profile admits keeps its high-risk probe pointer and nothing
  // else; the cost seam sends its remaining refusal straight here, before any
  // profile can claim them.
  const unclassified = (entry: (typeof initialEntries)[number]) => ({
    ...entry,
    runtimeProbeId: entry.risk === 'high' ? (probeIdBySignature.get(entry.families.join('+')) ?? null) : null,
  });
  const entries = initialEntries.map((entry) => {
    if (entry.position !== null && reviewedLingeringSoulsPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedLingeringSoulsRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Lingering Souls position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedLingeringSoulsSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Lingering Souls position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-lingering-souls-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedOptionalGeneratedTokenPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedOptionalGeneratedTokenRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed optional generated-token position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedOptionalGeneratedTokenSignatures.get(entry.position)) {
        throw new Error(
          `reviewed optional generated-token position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-optional-generated-token-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedLegionsLandingPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedLegionsLandingRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Legion's Landing position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedLegionsLandingSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Legion's Landing position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-legions-landing-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedReveillarkPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedReveillarkRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Reveillark position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedReveillarkSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Reveillark position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-reveillark-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedBloodchiefsThirstPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedBloodchiefsThirstRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Bloodchief's Thirst position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBloodchiefsThirstSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Bloodchief's Thirst position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-bloodchiefs-thirst-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedPrimalMightPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedPrimalMightRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Primal Might position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPrimalMightSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Primal Might position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-primal-might-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedEngineeredExplosivesPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedEngineeredExplosivesRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Engineered Explosives position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedEngineeredExplosivesSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Engineered Explosives position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('announced-number-and-reviewed-engineered-explosives-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedReorderOrShufflePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedReorderOrShuffleRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed reorder-or-shuffle position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedReorderOrShuffleSignatures.get(entry.position)) {
        throw new Error(
          `reviewed reorder-or-shuffle position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-reorder-or-shuffle-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedAnimateDeadPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedAnimateDeadRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Animate Dead position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedAnimateDeadSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Animate Dead position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-animate-dead-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedHeartlessActPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedHeartlessActRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Heartless Act position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedHeartlessActSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Heartless Act position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-heartless-act-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedAgadeemsAwakeningPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedAgadeemsAwakeningRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Agadeem's Awakening position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedAgadeemsAwakeningSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Agadeem's Awakening position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-agadeems-awakening-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedModalLandSpellPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedModalLandSpellRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed modal land spell position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedModalLandSpellSignatures.get(entry.position)) {
        throw new Error(
          `reviewed modal land spell position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-modal-land-spells-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
          generatedObjects: entry.position === 70 ? 'pinned-token-scripts-v1' : 'none',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedConvokePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowSpecialPaymentKeyword: true });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedConvokeRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Convoke position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedConvokeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Convoke position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-convoke-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_CONVOKE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedDelvePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowSpecialPaymentKeyword: true });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedDelveRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Delve position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedDelveSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Delve position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-delve-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_DELVE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedFreeCounterspellPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary', {
        allowReviewedAlternativeCost: true,
        allowReviewedFreeCounterspellCostParts: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedFreeCounterspellRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed free-counterspell position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedFreeCounterspellSignatures.get(entry.position)) {
        throw new Error(
          `reviewed free-counterspell position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-free-counterspell-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGildedGoosePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedGildedGooseFoodSacrificeCostPart: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedGildedGooseRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Gilded Goose position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGildedGooseSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Gilded Goose position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-gilded-goose-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedPiaSiegeGangPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary', {
        allowReviewedPiaSiegeGangSacrificeCostParts: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedPiaSiegeGangRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Pia/Siege-Gang position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPiaSiegeGangSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Pia/Siege-Gang position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-pia-siege-gang-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedTreacheryPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedTreacheryRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Treachery position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedTreacherySignatures.get(entry.position)) {
        throw new Error(
          `reviewed Treachery position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-treachery-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_TREACHERY_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSkyclaveApparitionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedSkyclaveApparitionRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Skyclave Apparition position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSkyclaveApparitionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Skyclave Apparition position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-skyclave-apparition-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedPathToExilePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedPathToExileRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Path to Exile position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPathToExileSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Path to Exile position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-path-to-exile-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE.id,
      };
    }
    if (entry.position !== null && chosenCostPaymentRefusedPositions.has(entry.position)) {
      return unclassified(entry);
    }
    if (entry.position !== null && priorityOnlyPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority'])) {
        throw new Error(
          `reviewed priority-only position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('priority-only-v1'),
        runtimeProbeId: LEGACY_CUBE_PRIORITY_ONLY_PROBE.id,
      };
    }
    if (entry.position !== null && singleTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed singleton-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-nonstack-target-v1'),
        runtimeProbeId: LEGACY_CUBE_SINGLE_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && singleStackTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed singleton-stack-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('singleton-stack-target-v1'),
        runtimeProbeId: LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && singleZoneCardPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'zone-card-selection'])) {
        throw new Error(
          `reviewed singleton-zone-card position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('singleton-library-zone-card-v1'),
        runtimeProbeId: LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE.id,
      };
    }
    if (entry.position !== null && ordinaryCombatPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'combat'])) {
        throw new Error(
          `reviewed ordinary-combat position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('ordinary-combat-v1'),
        runtimeProbeId: LEGACY_CUBE_ORDINARY_COMBAT_PROBE.id,
      };
    }
    if (entry.position !== null && ordinaryCombatSingleTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeOrdinaryCombatSingleTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed ordinary-combat singleton-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets', 'combat'])) {
        throw new Error(
          `reviewed ordinary-combat singleton-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'ordinary-combat-and-mandatory-singleton-nonstack-target-v1',
        ),
        runtimeProbeId: LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && ordinaryCombatTriggerTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeOrdinaryCombatTriggeredSingleTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed ordinary-combat trigger-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets', 'combat'])) {
        throw new Error(
          `reviewed ordinary-combat trigger-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'ordinary-combat-and-mandatory-singleton-trigger-target-v1',
        ),
        runtimeProbeId: LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && triggerTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeMandatoryTriggeredSingleTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed trigger-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed trigger-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-trigger-target-v1'),
        runtimeProbeId: LEGACY_CUBE_TRIGGER_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && paladinClassPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubePaladinClassProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Paladin Class position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed Paladin Class position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('paladin-class-installed-trigger-target-v1'),
        runtimeProbeId: LEGACY_CUBE_PALADIN_CLASS_PROBE.id,
      };
    }
    if (entry.position !== null && shocklandPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeShocklandProfileRefusals(readFileSync(join(scriptsRoot, entry.forgeScript)));
      if (refusals.length > 0) {
        throw new Error(
          `reviewed shockland position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'optional-costs'])) {
        throw new Error(
          `reviewed shockland position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('shockland-pay-two-life-entry-replacement-v1'),
        runtimeProbeId: LEGACY_CUBE_SHOCKLAND_PROBE.id,
      };
    }
    if (entry.position !== null && equipTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeEquipTargetProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Equip target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed Equip target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-equip-target-v1'),
        runtimeProbeId: LEGACY_CUBE_EQUIP_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && auraTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeAuraTargetProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Aura target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed Aura target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-aura-target-v1'),
        runtimeProbeId: LEGACY_CUBE_AURA_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && fettersAuraTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeFettersAuraTargetProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Faith's Fetters position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed Faith's Fetters position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-fetters-aura-target-v1'),
        runtimeProbeId: LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && fallAuraTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeFallAuraTargetProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Fall from Favor position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets'])) {
        throw new Error(
          `reviewed Fall from Favor position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('mandatory-singleton-fall-aura-target-v1'),
        runtimeProbeId: LEGACY_CUBE_FALL_AURA_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && baneslayerProtectionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeBaneslayerProtectionProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Baneslayer fixed-protection position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'combat', 'naming-text-numbers'])) {
        throw new Error(
          `reviewed Baneslayer fixed-protection position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('ordinary-combat-baneslayer-protection-v1'),
        runtimeProbeId: LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE.id,
      };
    }
    if (entry.position !== null && chartACourseDiscardPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeChartACourseDiscardProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Chart a Course discard position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'zone-card-selection'])) {
        throw new Error(
          `reviewed Chart a Course discard position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('draw-two-conditional-singleton-discard-v1'),
        runtimeProbeId: LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE.id,
      };
    }
    if (entry.position !== null && studentOfWarfareLevelUpPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedLevelUpProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Level up position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'optional-costs', 'combat'])) {
        throw new Error(
          `reviewed Level up position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('ordinary-combat-reviewed-level-up-v2'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE.id,
      };
    }
    if (entry.position !== null && selflessSpiritPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeSelflessSpiritProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Selfless Spirit position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !==
        JSON.stringify(['priority', 'optional-costs', 'zone-card-selection', 'combat'])
      ) {
        throw new Error(
          `reviewed Selfless Spirit position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1',
        ),
        runtimeProbeId: LEGACY_CUBE_SELFLESS_SPIRIT_PROBE.id,
      };
    }
    if (entry.position !== null && remorsefulClericPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeRemorsefulClericProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Remorseful Cleric position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !==
        JSON.stringify(['priority', 'targets', 'optional-costs', 'zone-card-selection', 'combat'])
      ) {
        throw new Error(
          `reviewed Remorseful Cleric position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1',
        ),
        runtimeProbeId: LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE.id,
      };
    }
    if (entry.position !== null && coldsteelHeartPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeColdsteelHeartProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Coldsteel Heart position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'naming-text-numbers'])) {
        throw new Error(
          `reviewed Coldsteel Heart position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('coldsteel-heart-entry-color-chosen-mana-v1'),
        runtimeProbeId: LEGACY_CUBE_COLDSTEEL_HEART_PROBE.id,
      };
    }
    if (entry.position !== null && extinctionEventPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeExtinctionEventProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Extinction Event position ${String(entry.position)} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'naming-text-numbers'])) {
        throw new Error(
          `reviewed Extinction Event position ${String(entry.position)} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('extinction-event-odd-even-exile-v1'),
        runtimeProbeId: LEGACY_CUBE_EXTINCTION_EVENT_PROBE.id,
      };
    }
    if (entry.position !== null && optionalTriggerConfirmPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeOptionalTriggerConfirmProfileRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed optional-trigger confirm position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !==
        JSON.stringify(['priority', 'combat', 'replacement-trigger-choices'])
      ) {
        throw new Error(
          `reviewed optional-trigger confirm position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('optional-trigger-confirm-v1'),
        runtimeProbeId: LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE.id,
      };
    }
    if (entry.position !== null && boundedMultiSelectionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeBoundedMultiSelectionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed bounded multi-selection position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== boundedMultiSelectionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed bounded multi-selection position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('bounded-multi-selection-v1'),
        runtimeProbeId: LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE.id,
      };
    }
    if (entry.position !== null && boundedEnumeratedChoicePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeBoundedEnumeratedChoiceRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed bounded enumerated choice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== boundedEnumeratedChoiceSignatures.get(entry.position)) {
        throw new Error(
          `reviewed bounded enumerated choice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('bounded-enumerated-choice-v1'),
        runtimeProbeId: LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE.id,
      };
    }
    if (entry.position !== null && announcedNumberPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeAnnouncedNumberRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed announced number position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== announcedNumberSignatures.get(entry.position)) {
        throw new Error(
          `reviewed announced number position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('announced-number-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.id,
      };
    }
    if (entry.position !== null && statedOrderingPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeStatedOrderingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed stated ordering position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== statedOrderingSignatures.get(entry.position)) {
        throw new Error(
          `reviewed stated ordering position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_STATED_ORDERING_PROBE.id,
      };
    }
    if (entry.position !== null && statedDistributionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeStatedDistributionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed stated distribution position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== statedDistributionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed stated distribution position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-distribution-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_STATED_DISTRIBUTION_PROBE.id,
      };
    }
    if (entry.position !== null && statedRetargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'phyrexian');
      const refusals = legacyCubeStatedRetargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed stated retarget position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== statedRetargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed stated retarget position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-retarget-v1', {
          manaPayment: 'phyrexian-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_STATED_RETARGET_PROBE.id,
      };
    }
    if (entry.position !== null && openCardNamingPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeOpenCardNamingRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed open card naming position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== openCardNamingSignatures.get(entry.position)) {
        throw new Error(
          `reviewed open card naming position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('open-card-naming-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_OPEN_CARD_NAMING_PROBE.id,
      };
    }
    if (entry.position !== null && discardOrSourceSacrificeCostPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeDiscardOrSourceSacrificeCostRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed discard/source-sacrifice cost position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== discardOrSourceSacrificeCostSignatures.get(entry.position)) {
        throw new Error(
          `reviewed discard/source-sacrifice cost position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('discard-or-reviewed-sacrifice-cost-v2', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE.id,
      };
    }
    if (entry.position !== null && generatedObjectPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubePinnedGeneratedObjectRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed generated-object position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== generatedObjectSignatures.get(entry.position)) {
        throw new Error(
          `reviewed generated-object position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-pinned-generated-token-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_GENERATED_OBJECT_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && statedOrderingTriggerTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeStatedOrderingTriggerTargetAndHiddenHandRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed stated-ordering trigger-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== statedOrderingTriggerTargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed stated-ordering trigger-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-trigger-target-and-reviewed-hidden-hand-v1',
          { manaPayment: 'announced-mana-payment-v1' },
        ),
        runtimeProbeId: LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedTriggerTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedTriggerTargetCostParts: true });
      const refusals = legacyCubeReviewedTriggerTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed trigger-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedTriggerTargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed trigger-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-trigger-target-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCounterTypeChoicePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedCounterTypeChoiceRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed counter-type choice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCounterTypeChoiceSignatures.get(entry.position)) {
        throw new Error(
          `reviewed counter-type choice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-counter-type-choice-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedOptionalTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedOptionalTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed optional-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedOptionalTargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed optional-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-optional-target-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedPhyrexianSpellCostPositions.has(entry.position)) {
      requirePayableCosts(entry, 'phyrexian');
      const refusals = legacyCubeReviewedPhyrexianSpellCostRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Phyrexian spell-cost position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPhyrexianSpellCostSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Phyrexian spell-cost position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-phyrexian-spell-cost-v1', {
          manaPayment: 'phyrexian-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCascadePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedCascadeRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Cascade position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCascadeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Cascade position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-cascade-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_CASCADE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedRepeatableModePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedRepeatableModeRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed repeatable-mode position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedRepeatableModeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed repeatable-mode position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-repeatable-mode-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedMultipleTargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedMultipleTargetRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed multiple-target position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedMultipleTargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed multiple-target position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-plow-under-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedManaComboPositions.has(entry.position)) {
      // The general payment boundary rejects every multi-mana Combo. This one
      // exception is still exact-gated immediately below before admission.
      requirePayableCosts(entry, 'announced', { allowReviewedManaCombo: true });
      const refusals = legacyCubeReviewedManaComboRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed mana-combo position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedManaComboSignatures.get(entry.position)) {
        throw new Error(
          `reviewed mana-combo position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-coalition-relic-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCrypticCommandPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedCrypticCommandRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Cryptic Command position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCrypticCommandSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Cryptic Command position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-cryptic-command-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedPrismariCommandPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedPrismariCommandRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Prismari Command position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPrismariCommandSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Prismari Command position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-prismari-command-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedBlessedAlliancePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedBlessedAllianceRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Blessed Alliance position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBlessedAllianceSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Blessed Alliance position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-blessed-alliance-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedKalitasPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedKalitasCostPart: true });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedKalitasRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Kalitas position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedKalitasSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Kalitas position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-kalitas-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_KALITAS_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedUroPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedAlternativeCost: true,
        allowReviewedTitanEscapeCostPart: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedUroRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Uro position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedUroSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Uro position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-uro-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_URO_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedKroxaPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedAlternativeCost: true,
        allowReviewedTitanEscapeCostPart: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedKroxaRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Kroxa position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedKroxaSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Kroxa position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-kroxa-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_KROXA_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedHuntmasterPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedHuntmasterRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Huntmaster position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedHuntmasterSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Huntmaster position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-huntmaster-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedRemainingPlaneswalkerPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedRemainingPlaneswalkersRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed remaining planeswalker position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedRemainingPlaneswalkerSignatures.get(entry.position)) {
        throw new Error(
          `reviewed remaining planeswalker position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-remaining-planeswalkers-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: generatedScriptDependencies.length === 0 ? 'none' : 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedFinalSixPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedFinalSixCostParts: true,
        allowSpecialPaymentKeyword: entry.position === 393,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedFinalSixRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed final-six position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedFinalSixSignatures.get(entry.position)) {
        throw new Error(
          `reviewed final-six position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-final-six-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: generatedScriptDependencies.length === 0 ? 'none' : 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedPhantasmalImagePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedPhantasmalImageRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Phantasmal Image position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPhantasmalImageSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Phantasmal Image position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-phantasmal-image-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedPeekAndRevealPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedPeekAndRevealRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed PeekAndReveal position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPeekAndRevealSignatures.get(entry.position)) {
        throw new Error(
          `reviewed PeekAndReveal position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-peek-and-reveal-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGeneratedTokenSacrificePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedGeneratedTokenSacrificeCostParts: true,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedGeneratedTokenSacrificeRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed generated-token sacrifice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGeneratedTokenSacrificeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed generated-token sacrifice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-generated-token-sacrifice-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedGeneratedObjectBoundedChoicePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedGeneratedObjectBoundedChoiceRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed generated-object bounded-choice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !== reviewedGeneratedObjectBoundedChoiceSignatures.get(entry.position)
      ) {
        throw new Error(
          `reviewed generated-object bounded-choice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-generated-object-bounded-choice-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedAlternateCostGeneratedObjectPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedAlternateCostGeneratedObjectRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed alternate-cost generated-object position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !== reviewedAlternateCostGeneratedObjectSignatures.get(entry.position)
      ) {
        throw new Error(
          `reviewed alternate-cost generated-object position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-alternate-cost-generated-object-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedResidualGeneratedTokenPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedManaCombo: entry.position === 418,
      });
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedResidualGeneratedTokenRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed residual generated-token position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedResidualGeneratedTokenSignatures.get(entry.position)) {
        throw new Error(
          `reviewed residual generated-token position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-residual-generated-token-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedMultiTargetTransformationPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedMultiTargetTransformationRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed multi-target transformation position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !== reviewedMultiTargetTransformationSignatures.get(entry.position)
      ) {
        throw new Error(
          `reviewed multi-target transformation position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-multi-target-transformation-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedPlaneswalkerUnlessSacrificePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedPlaneswalkerUnlessSacrificeRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed planeswalker UnlessCost sacrifice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (
        JSON.stringify(entry.families) !== reviewedPlaneswalkerUnlessSacrificeSignatures.get(entry.position)
      ) {
        throw new Error(
          `reviewed planeswalker UnlessCost sacrifice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1',
          {
            manaPayment: 'announced-mana-payment-v1',
            generatedObjects: 'pinned-token-scripts-v1',
          },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedCopySpellRetargetPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedCopySpellRetargetRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed copy-spell retarget position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCopySpellRetargetSignatures.get(entry.position)) {
        throw new Error(
          `reviewed copy-spell retarget position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-copy-spell-retarget-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedOptionalCopyReplacementPositions.has(entry.position)) {
      const isMetamorph = entry.position === 496;
      requirePayableCosts(entry, isMetamorph ? 'phyrexian' : 'announced');
      const refusals = legacyCubeReviewedOptionalCopyReplacementRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed optional-copy replacement position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedOptionalCopyReplacementSignatures.get(entry.position)) {
        throw new Error(
          `reviewed optional-copy replacement position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-optional-copy-replacement-v1',
          { manaPayment: isMetamorph ? 'phyrexian-mana-payment-v1' : 'announced-mana-payment-v1' },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedKarnLiberatedPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedKarnLiberatedRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Karn Liberated position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedKarnLiberatedSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Karn Liberated position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-karn-liberated-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedRattleclawMysticPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedRattleclawMysticRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Rattleclaw Mystic position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedRattleclawMysticSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Rattleclaw Mystic position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-rattleclaw-mystic-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedLightningPhoenixPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedLightningPhoenixRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Lightning Phoenix position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedLightningPhoenixSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Lightning Phoenix position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-lightning-phoenix-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedBaralPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedDrawCostPart: true });
      const refusals = legacyCubeReviewedBaralRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Baral position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBaralSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Baral position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-baral-triggered-loot-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BARAL_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedUnlessCostPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedUnlessCostRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed UnlessCost position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedUnlessCostSignatures.get(entry.position)) {
        throw new Error(
          `reviewed UnlessCost position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-unless-cost-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCounterUnlessCostPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedCounterUnlessCostRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed counter UnlessCost position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCounterUnlessCostSignatures.get(entry.position)) {
        throw new Error(
          `reviewed counter UnlessCost position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-counter-unless-cost-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedMiscalculationPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedSourceDiscardCostPart: true });
      const refusals = legacyCubeReviewedMiscalculationRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Miscalculation position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedMiscalculationSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Miscalculation position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-miscalculation-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedMaulOfTheSkyclavesPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedMaulOfTheSkyclavesRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Maul position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedMaulOfTheSkyclavesSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Maul position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-maul-of-the-skyclaves-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedEmbercleavePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedEmbercleaveRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Embercleave position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedEmbercleaveSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Embercleave position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-embercleave-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedLivingWeaponPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedLivingWeaponRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Living Weapon position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedLivingWeaponSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Living Weapon position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-living-weapon-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedForetellPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedForetellRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Foretell position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedForetellSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Foretell position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-foretell-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_FORETELL_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedSatyrWayfinderPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSatyrWayfinderRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Satyr Wayfinder position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSatyrWayfinderSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Satyr Wayfinder position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-satyr-wayfinder-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedBlueLibrarySelectionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedBlueLibrarySelectionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed blue library-selection position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBlueLibrarySelectionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed blue library-selection position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-blue-library-selection-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGideonGarrukBloodlinePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedGideonGarrukBloodlineRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Gideon/Garruk/Bloodline position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGideonGarrukBloodlineSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Gideon/Garruk/Bloodline position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-gideon-garruk-bloodline-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
          generatedObjects: entry.position === 25 ? 'none' : 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedHideawayPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedHideawayRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Hideaway-four position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedHideawaySignatures.get(entry.position)) {
        throw new Error(
          `reviewed Hideaway-four position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-hideaway-four-v1', {
          manaPayment: 'ordinary-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSwordOfFireAndIcePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSwordOfFireAndIceRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Sword of Fire and Ice position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSwordOfFireAndIceSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Sword of Fire and Ice position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-sword-of-fire-and-ice-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSwordOfFeastAndFaminePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSwordOfFeastAndFamineRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Sword of Feast and Famine position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSwordOfFeastAndFamineSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Sword of Feast and Famine position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-sword-of-feast-and-famine-v1',
          { manaPayment: 'announced-mana-payment-v1' },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSwordOfLightAndShadowPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSwordOfLightAndShadowRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Sword of Light and Shadow position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSwordOfLightAndShadowSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Sword of Light and Shadow position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-sword-of-light-and-shadow-v1',
          { manaPayment: 'announced-mana-payment-v1' },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSwordOfBodyAndMindPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedSwordOfBodyAndMindRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Sword of Body and Mind position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSwordOfBodyAndMindSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Sword of Body and Mind position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-sword-of-body-and-mind-v1', {
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    if (entry.position !== null && reviewedSwordOfHearthAndHomePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSwordOfHearthAndHomeRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Sword of Hearth and Home position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSwordOfHearthAndHomeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Sword of Hearth and Home position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle(
          'stated-ordering-and-reviewed-sword-of-hearth-and-home-v1',
          { manaPayment: 'announced-mana-payment-v1' },
        ),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedUmezawasJittePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedUmezawasJitteRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Umezawa's Jitte position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedUmezawasJitteSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Umezawa's Jitte position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-umezawas-jitte-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedBirgiPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedDiscardCostParts: true });
      const refusals = legacyCubeReviewedBirgiRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Birgi position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBirgiSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Birgi position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-birgi-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BIRGI_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedBirthingPodPositions.has(entry.position)) {
      requirePayableCosts(entry, 'phyrexian', { allowReviewedCreatureSacrificeCostParts: true });
      const refusals = legacyCubeReviewedBirthingPodRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Birthing Pod position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedBirthingPodSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Birthing Pod position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-birthing-pod-v1', {
          manaPayment: 'phyrexian-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedRangerCaptainOfEosPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedRangerCaptainOfEosRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Ranger-Captain of Eos position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedRangerCaptainOfEosSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Ranger-Captain of Eos position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-ranger-captain-of-eos-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedForbidPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedForbidRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Forbid position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedForbidSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Forbid position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-forbid-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_FORBID_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGlenElendraArchmagePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedGlenElendraArchmageRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Glen Elendra Archmage position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGlenElendraArchmageSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Glen Elendra Archmage position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-glen-elendra-archmage-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedRecurringNightmarePositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary', {
        allowReviewedCreatureSacrificeCostParts: true,
        allowReviewedSourceReturnCostPart: true,
      });
      const refusals = legacyCubeReviewedRecurringNightmareRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Recurring Nightmare position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedRecurringNightmareSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Recurring Nightmare position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-recurring-nightmare-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedPriestOfFellRitesPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const refusals = legacyCubeReviewedPriestOfFellRitesRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Priest of Fell Rites position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedPriestOfFellRitesSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Priest of Fell Rites position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-priest-of-fell-rites-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSmugglersCopterPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary', { allowReviewedDrawCostPart: true });
      const refusals = legacyCubeReviewedSmugglersCopterRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Smuggler's Copter position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSmugglersCopterSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Smuggler's Copter position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-smugglers-copter-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCryptbreakerPositions.has(entry.position)) {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedCryptbreakerRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Cryptbreaker position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCryptbreakerSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Cryptbreaker position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-cryptbreaker-v1', {
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE.id,
        generatedScriptDependencies: [
          ...resolveLegacyCubeGeneratedScriptDependencies(
            bytes,
            (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
            syntaxInventory,
          ),
        ],
      };
    }
    if (entry.position !== null && reviewedMyrBattlespherePositions.has(entry.position)) {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedMyrBattlesphereRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Myr Battlesphere position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedMyrBattlesphereSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Myr Battlesphere position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-myr-battlesphere-v1', {
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE.id,
        generatedScriptDependencies: [
          ...resolveLegacyCubeGeneratedScriptDependencies(
            bytes,
            (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
            syntaxInventory,
          ),
        ],
      };
    }
    if (entry.position !== null && reviewedTreasureCohortPositions.has(entry.position)) {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedTreasureCohortRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Treasure cohort position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedTreasureCohortSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Treasure cohort position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-audited-treasure-cohort-v1', {
          manaPayment: entry.position === 281 ? 'announced-mana-payment-v1' : 'ordinary-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE.id,
        generatedScriptDependencies: [
          ...resolveLegacyCubeGeneratedScriptDependencies(
            bytes,
            (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
            syntaxInventory,
          ),
        ],
      };
    }
    if (entry.position !== null && reviewedChampionOfWitsPositions.has(entry.position)) {
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeReviewedChampionOfWitsRefusals(bytes, syntaxInventory);
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Champion of Wits position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedChampionOfWitsSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Champion of Wits position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-champion-of-wits-v1'),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedUtopiaSprawlPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedUtopiaSprawlRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Utopia Sprawl position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedUtopiaSprawlSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Utopia Sprawl position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-utopia-sprawl-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedSplinterTwinPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedSplinterTwinRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Splinter Twin position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedSplinterTwinSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Splinter Twin position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-splinter-twin-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGlorybringerPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedExertCostPart: true });
      const refusals = legacyCubeReviewedGlorybringerRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Glorybringer position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGlorybringerSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Glorybringer position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-glorybringer-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGrimLavamancerPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', { allowReviewedGraveyardExileCostPart: true });
      const refusals = legacyCubeReviewedGrimLavamancerRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Grim Lavamancer position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGrimLavamancerSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Grim Lavamancer position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-grim-lavamancer-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedGiftsUngivenPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedGiftsUngivenRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Gifts Ungiven position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedGiftsUngivenSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Gifts Ungiven position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-gifts-ungiven-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedLilianaTwoPilesPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedLilianaTwoPilesRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Liliana of the Veil position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedLilianaTwoPilesSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Liliana of the Veil position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-liliana-two-piles-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedFactOrFictionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedFactOrFictionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed Fact or Fiction position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedFactOrFictionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed Fact or Fiction position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-fact-or-fiction-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedCompanionPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedCompanionRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed companion position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedCompanionSignatures.get(entry.position)) {
        throw new Error(
          `reviewed companion position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-companion-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId:
          entry.position === 444
            ? LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE.id
            : LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE.id,
      };
    }
    if (entry.position !== null && alternateCostPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced', {
        allowReviewedTitanEscapeCostPart: LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS.some(
          (position) => position === entry.position,
        ),
      });
      const refusals = legacyCubeReviewedAlternateCostRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed alternate-cost position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== alternateCostSignatures.get(entry.position)) {
        throw new Error(
          `reviewed alternate-cost position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-alternate-cost-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_ALTERNATE_COST_PROBE.id,
      };
    }
    if (entry.position !== null && optionalDeciderYouPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeOptionalDeciderYouRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed OptionalDecider$ You position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== optionalDeciderYouSignatures.get(entry.position)) {
        throw new Error(
          `reviewed OptionalDecider$ You position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-optional-decider-you-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE.id,
      };
    }
    if (entry.position !== null && reviewedOptionalLibrarySearchPositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedOptionalLibrarySearchRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed optional library-search position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== reviewedOptionalLibrarySearchSignatures.get(entry.position)) {
        throw new Error(
          `reviewed optional library-search position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-optional-library-search-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE.id,
      };
    }
    if (entry.position !== null && alternateModePositions.has(entry.position)) {
      requirePayableCosts(entry, 'announced');
      const refusals = legacyCubeReviewedAlternateModeRefusals(
        readFileSync(join(scriptsRoot, entry.forgeScript)),
        syntaxInventory,
      );
      if (refusals.length > 0) {
        throw new Error(
          `reviewed alternate-mode position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== alternateModeSignatures.get(entry.position)) {
        throw new Error(
          `reviewed alternate-mode position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('stated-ordering-and-reviewed-alternate-mode-v1', {
          manaPayment: 'announced-mana-payment-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_ALTERNATE_MODE_PROBE.id,
      };
    }
    if (entry.position !== null && vraskaGeneratedTokenPositions.has(entry.position)) {
      requirePayableCosts(entry, 'ordinary');
      const bytes = readFileSync(join(scriptsRoot, entry.forgeScript));
      const refusals = legacyCubeOrdinaryCombatSingleTargetRefusals(bytes, {
        allowPinnedGeneratedTokenScripts: true,
      });
      if (refusals.length > 0) {
        throw new Error(
          `reviewed generated-token position ${String(entry.position)} ${entry.correctedName} has unsupported shape: ${refusals.join(', ')}`,
        );
      }
      if (JSON.stringify(entry.families) !== JSON.stringify(['priority', 'targets', 'combat'])) {
        throw new Error(
          `reviewed generated-token position ${String(entry.position)} ${entry.correctedName} classified as ${entry.families.join('+')}`,
        );
      }
      const generatedScriptDependencies = resolveLegacyCubeGeneratedScriptDependencies(
        bytes,
        (name) => readFileSync(join(tokenScriptsRoot, `${name}.txt`)),
        syntaxInventory,
      );
      return {
        ...entry,
        cardFamilySafe: true,
        bridgeCapabilityProfile: capabilityBundle('ordinary-combat-target-and-pinned-generated-token-v1', {
          generatedObjects: 'pinned-token-scripts-v1',
        }),
        runtimeProbeId: LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE.id,
        generatedScriptDependencies: [...generatedScriptDependencies],
      };
    }
    return unclassified(entry);
  });
  const families = LEGACY_CUBE_DECISION_FAMILIES.map((tag) => ({
    tag,
    scope: tag === 'mulligan' || tag === 'starting-player' ? ('match' as const) : ('card' as const),
    ...LEGACY_CUBE_BRIDGE_FAMILY_REVIEW[tag],
    representativePositions:
      tag === 'mulligan' || tag === 'starting-player'
        ? [1]
        : entries
            .filter((entry) => entry.families.includes(tag))
            .slice(0, 3)
            .map((entry) => entry.position),
  }));
  const completedProbeId = LEGACY_CUBE_BRIDGE_MATCH_PROBE.id;
  const safe = baselineScripts.map(({ name, forgeScript }) => {
    const bytes = readFileSync(join(scriptsRoot, forgeScript));
    const paymentRefusals = legacyCubeOrdinaryManaPaymentRefusals(bytes);
    if (paymentRefusals.length > 0) {
      throw new Error(`bridge baseline ${name} has unsupported ordinary mana payment`);
    }
    const classification = classifyLegacyCubeForgeScript(bytes, syntaxInventory);
    return {
      corpus: 'bridge-baseline' as const,
      position: null,
      sourceName: name,
      correctedName: name,
      forgeScript,
      forgeScriptSha256: sha256(bytes),
      families: [...classification.families],
      evidenceMarkers: [...classification.evidenceMarkers],
      unknownDecisionSyntax: [...classification.unknownDecisionSyntax],
      risk: 'ordinary' as const,
      cardFamilySafe: true,
      bridgeCapabilityProfile: capabilityBundle('priority-only-v1'),
      runtimeProbeId: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.id,
      generatedScriptDependencies: [],
    };
  });
  const runtimeProbes = [
    {
      id: completedProbeId,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: [...LEGACY_CUBE_BRIDGE_MATCH_PROBE.cardNames],
      families: [...LEGACY_CUBE_BRIDGE_MATCH_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_BRIDGE_MATCH_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_PRIORITY_ONLY_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'priority-only-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_PRIORITY_ONLY_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_PRIORITY_ONLY_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_SINGLE_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-nonstack-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_SINGLE_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_SINGLE_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'singleton-library-zone-card-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_SINGLE_ZONE_CARD_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'singleton-stack-target-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_SINGLE_STACK_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ORDINARY_COMBAT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ORDINARY_COMBAT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ORDINARY_COMBAT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'ordinary-combat-and-mandatory-singleton-nonstack-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ORDINARY_COMBAT_SINGLE_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'ordinary-combat-target-and-pinned-generated-token-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_VRASKA_GENERATED_TOKEN_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_GENERATED_OBJECT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-pinned-generated-token-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_GENERATED_OBJECT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_GENERATED_OBJECT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-trigger-target-and-reviewed-hidden-hand-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_STATED_ORDERING_TRIGGER_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-trigger-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_TRIGGER_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-counter-type-choice-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_COUNTER_TYPE_CHOICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-optional-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_OPTIONAL_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-phyrexian-spell-cost-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PHYREXIAN_SPELL_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_CASCADE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-cascade-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_CASCADE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_CASCADE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-repeatable-mode-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_REPEATABLE_MODE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-plow-under-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MULTIPLE_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-coalition-relic-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MANA_COMBO_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-cryptic-command-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_CRYPTIC_COMMAND_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-prismari-command-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-blessed-alliance-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BLESSED_ALLIANCE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_KALITAS_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-kalitas-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_KALITAS_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_KALITAS_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_URO_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-uro-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_URO_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_URO_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_KROXA_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-kroxa-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_KROXA_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_KROXA_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-huntmaster-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_HUNTMASTER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-remaining-planeswalkers-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_REMAINING_PLANESWALKER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-final-six-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_FINAL_SIX_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.position !== null &&
            LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_POSITIONS.some((position) => position === entry.position),
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_TITAN_ESCAPE_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-phantasmal-image-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PHANTASMAL_IMAGE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-peek-and-reveal-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PEEK_AND_REVEAL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-generated-token-sacrifice-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GENERATED_TOKEN_SACRIFICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-generated-object-bounded-choice-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GENERATED_OBJECT_BOUNDED_CHOICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-alternate-cost-generated-object-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_ALTERNATE_COST_GENERATED_OBJECT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-residual-generated-token-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_RESIDUAL_GENERATED_TOKEN_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-multi-target-transformation-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MULTI_TARGET_TRANSFORMATION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-planeswalker-unless-sacrifice-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PLANESWALKER_UNLESS_SACRIFICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-copy-spell-retarget-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_COPY_SPELL_RETARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-optional-copy-replacement-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_OPTIONAL_COPY_REPLACEMENT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-karn-liberated-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_KARN_LIBERATED_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-rattleclaw-mystic-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_RATTLECLAW_MYSTIC_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-lightning-phoenix-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LIGHTNING_PHOENIX_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BARAL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-baral-triggered-loot-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_BARAL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BARAL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-unless-cost-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_UNLESS_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-counter-unless-cost-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_COUNTER_UNLESS_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 133,
      correctedName: 'Miscalculation',
      cardNames: ['Miscalculation'],
      families: [...LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MISCALCULATION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 81,
      correctedName: 'Maul of the Skyclaves',
      cardNames: ['Maul of the Skyclaves'],
      families: [...LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MAUL_OF_THE_SKYCLAVES_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 312,
      correctedName: 'Embercleave',
      cardNames: ['Embercleave'],
      families: [...LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_EMBERCLEAVE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-living-weapon-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LIVING_WEAPON_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_FORETELL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-foretell-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_FORETELL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_FORETELL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 341,
      correctedName: 'Satyr Wayfinder',
      cardNames: ['Satyr Wayfinder'],
      families: [...LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SATYR_WAYFINDER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 84,
      correctedName: 'Augur of Bolas',
      cardNames: ['Augur of Bolas', 'Search for Azcanta', 'Narset, Parter of Veils'],
      families: [...LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BLUE_LIBRARY_SELECTION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 25,
      correctedName: 'Gideon Blackblade',
      cardNames: ['Gideon Blackblade', 'Bloodline Keeper', 'Garruk Wildspeaker'],
      families: [...LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GIDEON_GARRUK_BLOODLINE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 79,
      correctedName: 'Windbrisk Heights',
      cardNames: ['Windbrisk Heights', 'Shelldock Isle'],
      families: [...LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_HIDEAWAY_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 521,
      correctedName: 'Sword of Fire and Ice',
      cardNames: ['Sword of Fire and Ice'],
      families: [...LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SWORD_OF_FIRE_AND_ICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 478,
      correctedName: 'Sword of Feast and Famine',
      cardNames: ['Sword of Feast and Famine'],
      families: [...LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SWORD_OF_FEAST_AND_FAMINE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 487,
      correctedName: 'Sword of Light and Shadow',
      cardNames: ['Sword of Light and Shadow'],
      families: [...LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SWORD_OF_LIGHT_AND_SHADOW_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 509,
      correctedName: 'Sword of Body and Mind',
      cardNames: ['Sword of Body and Mind'],
      families: [...LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SWORD_OF_BODY_AND_MIND_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 508,
      correctedName: 'Sword of Hearth and Home',
      cardNames: ['Sword of Hearth and Home'],
      families: [...LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SWORD_OF_HEARTH_AND_HOME_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 506,
      correctedName: "Umezawa's Jitte",
      cardNames: ["Umezawa's Jitte"],
      families: [...LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_UMEZAWAS_JITTE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BIRGI_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 265,
      correctedName: 'Birgi, God of Storytelling',
      cardNames: ['Birgi, God of Storytelling'],
      families: [...LEGACY_CUBE_REVIEWED_BIRGI_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BIRGI_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 382,
      correctedName: 'Birthing Pod',
      cardNames: ['Birthing Pod'],
      families: [...LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BIRTHING_POD_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 26,
      correctedName: 'Ranger-Captain of Eos',
      cardNames: ['Ranger-Captain of Eos'],
      families: [...LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_RANGER_CAPTAIN_OF_EOS_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_FORBID_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 142,
      correctedName: 'Forbid',
      cardNames: ['Forbid'],
      families: [...LEGACY_CUBE_REVIEWED_FORBID_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_FORBID_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 334,
      correctedName: 'Gilded Goose',
      cardNames: ['Gilded Goose', 'Lightning Bolt'],
      families: [...LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GILDED_GOOSE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: ['Pia Nalaar', 'Pia and Kiran Nalaar', 'Siege-Gang Commander'],
      families: [...LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PIA_SIEGE_GANG_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_TREACHERY_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 115,
      correctedName: 'Treachery',
      cardNames: ['Treachery'],
      families: [...LEGACY_CUBE_REVIEWED_TREACHERY_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_TREACHERY_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 32,
      correctedName: 'Reveillark',
      cardNames: ['Reveillark'],
      families: [...LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_REVEILLARK_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 230,
      correctedName: "Bloodchief's Thirst",
      cardNames: ["Bloodchief's Thirst"],
      families: [...LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_BLOODCHIEFS_THIRST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 344,
      correctedName: 'Primal Might',
      cardNames: ['Primal Might'],
      families: [...LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PRIMAL_MIGHT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 483,
      correctedName: 'Engineered Explosives',
      cardNames: ['Engineered Explosives'],
      families: [...LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_ENGINEERED_EXPLOSIVES_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 125,
      correctedName: 'Ponder',
      cardNames: ['Ponder', 'Portent'],
      families: [...LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_REORDER_OR_SHUFFLE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 210,
      correctedName: 'Animate Dead',
      cardNames: ['Animate Dead'],
      families: [...LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_ANIMATE_DEAD_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 215,
      correctedName: 'Heartless Act',
      cardNames: ['Heartless Act'],
      families: [...LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_HEARTLESS_ACT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 236,
      correctedName: "Agadeem's Awakening",
      cardNames: ["Agadeem's Awakening", 'Agadeem, the Undercrypt'],
      families: [...LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_AGADEEMS_AWAKENING_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 70,
      correctedName: "Emeria's Call",
      cardNames: [
        "Emeria's Call",
        'Emeria, Shattered Skyclave',
        'Turntimber Symbiosis',
        'Turntimber, Serpentine Wood',
      ],
      families: [...LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MODAL_LAND_SPELL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_CONVOKE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 33,
      correctedName: 'Venerated Loxodon',
      cardNames: ['Venerated Loxodon', 'Conclave Tribunal', 'Stoke the Flames', 'Chord of Calling'],
      families: [...LEGACY_CUBE_REVIEWED_CONVOKE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_CONVOKE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_DELVE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 111,
      correctedName: 'Murktide Regent',
      cardNames: ['Murktide Regent', 'Tasigur, the Golden Fang', 'Hogaak, Arisen Necropolis'],
      families: [...LEGACY_CUBE_REVIEWED_DELVE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_DELVE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 143,
      correctedName: 'Force of Negation',
      cardNames: ['Force of Negation', 'Force of Will', 'Daze'],
      families: [...LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_FREE_COUNTERSPELL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 4,
      correctedName: "Legion's Landing",
      cardNames: ["Legion's Landing"],
      families: [...LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LEGIONS_LANDING_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 18,
      correctedName: 'Skyclave Apparition',
      cardNames: ['Skyclave Apparition'],
      families: [...LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SKYCLAVE_APPARITION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 44,
      correctedName: 'Path to Exile',
      cardNames: ['Path to Exile'],
      families: [...LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PATH_TO_EXILE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 105,
      correctedName: 'Glen Elendra Archmage',
      cardNames: ['Glen Elendra Archmage'],
      families: [...LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GLEN_ELENDRA_ARCHMAGE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 220,
      correctedName: 'Recurring Nightmare',
      cardNames: ['Recurring Nightmare'],
      families: [...LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_RECURRING_NIGHTMARE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 424,
      correctedName: 'Priest of Fell Rites',
      cardNames: ['Priest of Fell Rites'],
      families: [...LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_PRIEST_OF_FELL_RITES_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 517,
      correctedName: "Smuggler's Copter",
      cardNames: ["Smuggler's Copter"],
      families: [...LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SMUGGLERS_COPTER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 161,
      correctedName: 'Cryptbreaker',
      cardNames: ['Cryptbreaker'],
      families: [...LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_CRYPTBREAKER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 501,
      correctedName: 'Myr Battlesphere',
      cardNames: ['Myr Battlesphere'],
      families: [...LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_MYR_BATTLESPHERE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: 'Goldspan Dragon / Magda, Brazen Outlaw',
      cardNames: ['Goldspan Dragon', 'Magda, Brazen Outlaw'],
      families: [...LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_TREASURE_COHORT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 95,
      correctedName: 'Champion of Wits',
      cardNames: ['Champion of Wits'],
      families: [...LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_CHAMPION_OF_WITS_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 367,
      correctedName: 'Utopia Sprawl',
      cardNames: ['Utopia Sprawl'],
      families: [...LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_UTOPIA_SPRAWL_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 309,
      correctedName: 'Splinter Twin',
      cardNames: ['Splinter Twin'],
      families: [...LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_SPLINTER_TWIN_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 50,
      correctedName: 'Lingering Souls',
      cardNames: ['Lingering Souls'],
      families: [...LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LINGERING_SOULS_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-optional-generated-token-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_OPTIONAL_GENERATED_TOKEN_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-glorybringer-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GLORYBRINGER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-grim-lavamancer-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GRIM_LAVAMANCER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-gifts-ungiven-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_GIFTS_UNGIVEN_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-liliana-two-piles-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LILIANA_TWO_PILES_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 144,
      correctedName: 'Fact or Fiction',
      cardNames: ['Fact or Fiction'],
      families: [...LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_FACT_OR_FICTION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 444,
      correctedName: 'Yorion, Sky Nomad',
      cardNames: ['Yorion, Sky Nomad'],
      families: [...LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_YORION_COMPANION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: 455,
      correctedName: 'Obosh, the Preypiercer',
      cardNames: ['Obosh, the Preypiercer'],
      families: [...LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_OBOSH_COMPANION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ALTERNATE_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-alternate-cost-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ALTERNATE_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ALTERNATE_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-optional-decider-you-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_OPTIONAL_DECIDER_YOU_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'stated-ordering-and-reviewed-optional-library-search-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_OPTIONAL_LIBRARY_SEARCH_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ALTERNATE_MODE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-and-reviewed-alternate-mode-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ALTERNATE_MODE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ALTERNATE_MODE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'ordinary-combat-and-mandatory-singleton-trigger-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ORDINARY_COMBAT_TRIGGER_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_TRIGGER_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-trigger-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_TRIGGER_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_TRIGGER_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_PALADIN_CLASS_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'paladin-class-installed-trigger-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_PALADIN_CLASS_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_PALADIN_CLASS_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_SHOCKLAND_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel === 'shockland-pay-two-life-entry-replacement-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_SHOCKLAND_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_SHOCKLAND_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_EQUIP_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-equip-target-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_EQUIP_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_EQUIP_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_AURA_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-aura-target-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_AURA_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_AURA_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-fetters-aura-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_FETTERS_AURA_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_FALL_AURA_TARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'mandatory-singleton-fall-aura-target-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_FALL_AURA_TARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_FALL_AURA_TARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-baneslayer-protection-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_BANESLAYER_PROTECTION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'draw-two-conditional-singleton-discard-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_CHART_A_COURSE_DISCARD_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'ordinary-combat-reviewed-level-up-v2')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REVIEWED_LEVEL_UP_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_SELFLESS_SPIRIT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'ordinary-combat-selfless-spirit-self-sacrifice-indestructible-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_SELFLESS_SPIRIT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_SELFLESS_SPIRIT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.bridgeCapabilityProfile?.topLevel ===
            'ordinary-combat-remorseful-cleric-self-sacrifice-target-graveyard-exile-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_REMORSEFUL_CLERIC_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_COLDSTEEL_HEART_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'coldsteel-heart-entry-color-chosen-mana-v1',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_COLDSTEEL_HEART_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_COLDSTEEL_HEART_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_EXTINCTION_EVENT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'extinction-event-odd-even-exile-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_EXTINCTION_EVENT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_EXTINCTION_EVENT_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'optional-trigger-confirm-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_OPTIONAL_TRIGGER_CONFIRM_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_PERMANENT_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) =>
            entry.position !== null &&
            (LEGACY_CUBE_PERMANENT_COST_PROBE.positions as readonly number[]).includes(entry.position),
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_PERMANENT_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_PERMANENT_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter(
          (entry) => entry.bridgeCapabilityProfile?.topLevel === 'discard-or-reviewed-sacrifice-cost-v2',
        )
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_DISCARD_OR_SOURCE_SACRIFICE_COST_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'bounded-multi-selection-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_BOUNDED_MULTI_SELECTION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'bounded-enumerated-choice-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_BOUNDED_ENUMERATED_CHOICE_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'announced-number-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ANNOUNCED_NUMBER_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_STATED_ORDERING_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-ordering-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_STATED_ORDERING_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_STATED_ORDERING_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_STATED_DISTRIBUTION_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-distribution-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_STATED_DISTRIBUTION_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_STATED_DISTRIBUTION_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_STATED_RETARGET_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'stated-retarget-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_STATED_RETARGET_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_STATED_RETARGET_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_OPEN_CARD_NAMING_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: entries
        .filter((entry) => entry.bridgeCapabilityProfile?.topLevel === 'open-card-naming-v1')
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_OPEN_CARD_NAMING_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_OPEN_CARD_NAMING_PROBE.evidence,
    },
    {
      id: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.id,
      kind: 'observed-forge-session' as const,
      position: null,
      correctedName: null,
      cardNames: [...entries, ...safe]
        .filter((entry) => entry.cardFamilySafe)
        .map((entry) => entry.correctedName),
      families: [...LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.families],
      outcome: 'completed' as const,
      evidence: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_PROBE.evidence,
    },
    ...signatures.flatMap((signature) => {
      const representative = entries.find(
        (entry) => !entry.cardFamilySafe && entry.families.join('+') === signature,
      );
      if (representative === undefined) return [];
      return [
        {
          id: probeIdBySignature.get(signature)!,
          kind: 'observed-backend-containment' as const,
          position: representative.position,
          correctedName: representative.correctedName,
          cardNames: [representative.correctedName],
          families: representative.families,
          outcome: 'refused-before-spawn' as const,
          evidence:
            'Required integration test invoked the composed observed backend supports() gate; it refused this family-signature representative before Forge spawn. This is containment evidence, not mechanic execution.',
        },
      ];
    }),
  ];
  const javapBytes = readFileSync(controllerJavap);
  const chooseEvenOddClassBytes = readFileSync(chooseEvenOddClass);
  const chooseEvenOddSourceBytes = readFileSync(chooseEvenOddSource);
  verifyLegacyCubeExtinctionEventImplementation(chooseEvenOddClassBytes, chooseEvenOddSourceBytes);
  const abstractCallbacks = forgePlayerControllerAbstractCallbacks(javapBytes).map((signature) => {
    const classification = classifyForgeControllerCallback(signature);
    return {
      signature,
      disposition: classification.disposition,
      families: [...classification.families],
      bridgeOwnership: forgeBridgeControllerOwnership(signature),
    };
  });
  const draft: LegacyCubeDecisionLedger = {
    schemaVersion: 1,
    classifierVersion: 'forge-script-controller-family-v1',
    provenanceArtifact: {
      file: 'legacy-cube-2021-v1.json',
      sha256: sha256(readFileSync(new URL('../data/legacy-cube-2021-v1.json', import.meta.url))),
      normalizedRowsSha256: provenance.normalization.sha256,
    },
    forge: {
      version: provenance.forge.version,
      cardScriptArchiveSha256: provenance.forge.cardScriptArchiveSha256,
      chooseEvenOddEffect: structuredClone(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION),
    },
    bridgeReview: {
      bead: 'mtg-fp4l',
      capability: 'priority-universal-and-bounded-card-profiles-v133',
      source: 'packages/forge-export/bridge/ForgeBridge.java',
      sourceSha256: sha256(readFileSync(bridgeSource)),
      sessionHumanControlled: false,
      universalMatchFamilies: ['mulligan', 'starting-player'],
      ordinaryManaPayment: {
        ...LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT,
        callbacks: [...LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.callbacks],
        excludedPositions: [...LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.excludedPositions],
        baselineNames: [...LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.baselineNames],
        sourceShapes: LEGACY_CUBE_ORDINARY_MANA_PAYMENT_AUDIT.sourceShapes.map((row) => ({
          ...row,
          representativePositions: [...row.representativePositions],
        })),
      },
      announcedManaPayment: {
        ...LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT,
        callbacks: [...LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT.callbacks],
        excludedPositions: [...LEGACY_CUBE_ANNOUNCED_MANA_PAYMENT_AUDIT.excludedPositions],
      },
      phyrexianManaPayment: {
        ...LEGACY_CUBE_PHYREXIAN_MANA_PAYMENT_AUDIT,
        callbacks: [...LEGACY_CUBE_PHYREXIAN_MANA_PAYMENT_AUDIT.callbacks],
      },
      chosenCostPayment: {
        ...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT,
        reviewedPositions: [...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.reviewedPositions],
        callbacks: [...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.callbacks],
        refusedPositions: [...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.refusedPositions],
      },
      generatedTokenScripts: {
        ...LEGACY_CUBE_GENERATED_TOKEN_AUDIT,
        runtimeProbeIds: [...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.runtimeProbeIds],
        reviewedPositions: [...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions],
        safePositions: [...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.safePositions],
        excludedPositions: [...LEGACY_CUBE_GENERATED_TOKEN_AUDIT.excludedPositions],
        exactTokenScripts: LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts.map((row) => ({
          ...row,
        })),
      },
    },
    controllerSurface: {
      command:
        'javap -classpath forge-gui-desktop-2.0.14-jar-with-dependencies.jar -public forge.game.player.PlayerController',
      sha256: sha256(javapBytes),
      abstractCallbacks,
    },
    families,
    syntaxReview: {
      file: 'legacy-cube-forge-syntax-review-v1.json',
      sha256: LEGACY_CUBE_SYNTAX_REVIEW_SHA256,
    },
    syntaxInventory,
    auditedCards: [...entries, ...safe],
    runtimeProbes,
    contentSha256: '0'.repeat(64),
  };
  const ledger = { ...draft, contentSha256: legacyCubeDecisionLedgerContentSha256(draft) };
  const parsed = LegacyCubeDecisionLedgerSchema.parse(ledger);
  writeFileSync(
    output,
    await format(JSON.stringify(parsed), {
      ...(await resolveConfig(join(process.cwd(), 'package.json'))),
      filepath: output,
    }),
  );
}

if (process.argv[1]?.endsWith('build-legacy-cube-decision-ledger.ts')) await main(process.argv.slice(2));

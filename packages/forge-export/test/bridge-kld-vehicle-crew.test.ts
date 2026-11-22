import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

/** Every Kaladesh Vehicle, Smuggler's Copter included since mtg-hqqtb folded its Crew route into this table. */
const REVIEWED = {
  'Aradara Express': 4,
  'Ballista Charger': 3,
  'Bomat Bazaar Barge': 3,
  "Cultivator's Caravan": 3,
  'Demolition Stomper': 5,
  'Fleetwheel Cruiser': 2,
  'Ovalchase Dragster': 1,
  'Renegade Freighter': 2,
  'Sky Skiff': 1,
  'Skysovereign, Consul Flagship': 3,
  "Smuggler's Copter": 1,
};

describe('the Forge bridge reviews the plain Crew N of every Kaladesh Vehicle', () => {
  it('holds exactly the reviewed Vehicles at their printed Crew numbers', () => {
    const block = /REVIEWED_KLD_VANILLA_CREW_VEHICLES\s*=\s*Map\.ofEntries\(([\s\S]*?)\);/u.exec(bridge);
    if (block === null) throw new Error('the reviewed Kaladesh Vehicle table moved');
    const entries = [...(block[1] ?? '').matchAll(/Map\.entry\("([^"]+)",\s*(\d+)\)/gu)];
    expect(Object.fromEntries(entries.map((entry) => [entry[1], Number(entry[2])]))).toEqual(REVIEWED);
  });

  it('refuses any other activated ability on those cards except a mana ability', () => {
    const guards = bridge.match(
      /isKldVanillaCrewVehicle\([^)]*\)[\s\S]{0,200}?isReviewedKldVehicleCrewAbility/gu,
    );
    expect(guards).toHaveLength(2);
    for (const guard of guards ?? []) {
      expect(guard).toContain('ability.isActivatedAbility()');
      expect(guard).toContain('!ability.isManaAbility()');
    }
  });

  it('pins the exact Crew cost shape before using the bounded tap-cost chooser', () => {
    expect(bridge).toContain('return session.chooseVehicleCrewCost(player, ability, tap);');
    expect(bridge).toContain('"Creature.Other+withTotalPowerGE" + crewAmount');
    expect(bridge).toContain('("tapXType<Any/" + typeFilter + ">").equals(ability.getParam("Cost"))');
    expect(bridge).toContain('Forge reached Crew payment outside reviewed-kld-vehicle-crew-v1');
    expect(bridge).toContain('ability.isCrew()');
    expect(bridge).toContain('"Any".equals(cost.getAmount())');
    expect(bridge).toContain('&& cost.canTapSource');
    expect(bridge).toContain('CostTapType recorded = (CostTapType) parts.get(0);');
    expect(bridge).not.toContain('parts.get(0) == cost');
  });
});

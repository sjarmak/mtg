/** Installed-Forge witnesses that every Kaladesh Vehicle other than Smuggler's Copter crews through the bridge. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

/** Crew number and printed body of each Kaladesh Vehicle, read off the printed cards. */
const VEHICLES = [
  { name: 'Sky Skiff', crew: 1, power: 2, toughness: 3 },
  { name: 'Ovalchase Dragster', crew: 1, power: 6, toughness: 1 },
  { name: 'Fleetwheel Cruiser', crew: 2, power: 5, toughness: 3 },
  { name: 'Renegade Freighter', crew: 2, power: 4, toughness: 3 },
  { name: 'Ballista Charger', crew: 3, power: 6, toughness: 6 },
  { name: 'Bomat Bazaar Barge', crew: 3, power: 5, toughness: 5 },
  { name: "Cultivator's Caravan", crew: 3, power: 5, toughness: 5 },
  { name: 'Skysovereign, Consul Flagship', crew: 3, power: 6, toughness: 5 },
  { name: 'Aradara Express', crew: 4, power: 8, toughness: 6 },
  { name: 'Demolition Stomper', crew: 5, power: 10, toughness: 7 },
] as const;

/** Powers 0, 2 and 3, tapped in this order, pass through every Crew number from 1 to 5. */
const CREW_ORDER = [
  { name: 'Tasseled Dromedary', power: 0 },
  { name: 'Curio Vendor', power: 2 },
  { name: 'Terrain Elemental', power: 3 },
] as const;

function spec(vehicle: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'kld-aer' },
    seats: [
      {
        name: 'Crew captain',
        controller: 'local',
        deck: { name: `kld-crew-${vehicle}`, cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Crew observer',
        controller: 'engine',
        deck: { name: 'kld-crew-observer', cards: [{ name: 'Forest', count: 60 }] },
      },
    ],
    seed: `kld-vehicle-crew-${vehicle}-v1`,
    maximumTurns: 3,
  };
}

function publicPosition(view: TableView): unknown {
  return {
    turn: view.turn,
    priority: view.priority,
    stack: view.stack,
    seats: view.seats.map((seat) => ({
      life: seat.life,
      hand: seat.hand,
      graveyard: seat.graveyard,
      exile: seat.exile,
      battlefield: seat.battlefield,
    })),
  };
}

describe.skipIf(!required)('KLD Vehicle Crew witnesses', () => {
  it.each(VEHICLES)(
    'crews $name at exactly Crew $crew and it becomes a creature',
    async (vehicle) => {
      if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
        throw new Error('Installed Forge required');
      const backend = await snapshotForgeScenarioBackend(
        {
          schemaVersion: 1,
          active: 0,
          phase: 'MAIN1',
          seats: [
            {
              life: 20,
              hand: [],
              battlefield: [vehicle.name, ...CREW_ORDER.map((creature) => creature.name)],
              library: ['Swamp', 'Swamp'],
              graveyard: [],
            },
            { life: 20, hand: [], battlefield: [], library: ['Forest', 'Forest'], graveyard: [] },
          ],
        },
        {
          ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
          diagnosticCardNames: [
            vehicle.name,
            ...CREW_ORDER.map((creature) => creature.name),
            'Forest',
            'Swamp',
          ],
        },
      );
      if (backend === null) throw new Error('Installed Forge required');
      const opened = await backend.open(spec(vehicle.name));
      if (!opened.ok) {
        await backend.shutdown?.();
        throw new Error(opened.error.message);
      }
      let session: ObservedSession = opened.session;
      const trace: string[] = [];
      const oidOf = (name: string): string => {
        const found = session.view.seats[0].battlefield.find((card) => card.name === name);
        if (found === undefined) throw new Error(`${name} is not on the battlefield`);
        return found.oid;
      };
      const vehicleOid = oidOf(vehicle.name);
      const creatureOids = new Map(CREW_ORDER.map((creature) => [creature.name, oidOf(creature.name)]));
      let attempt: 'cancel' | 'pay' = 'cancel';
      let activated = false;
      let before: unknown = null;
      let picked = 0;
      let chosenPower = 0;
      let inventedRejected = false;
      let canceledCleanly = false;
      let thresholdChecks = 0;
      let crewed = false;
      try {
        for (let index = 0; index < 60 && session.status === 'awaiting' && !crewed; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error(`Forge offered no ${vehicle.name} decision`);
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move: string | undefined;
          if (decision.kind === 'cost-crew-selection') {
            expect(decision.prompt).toContain(`Crew ${vehicle.crew}`);
            const offered = decision.options
              .filter((option) => option.id !== 'cost-crew-finish' && option.id !== 'cost-crew-cancel')
              .flatMap((option) => option.targets.map((target) => target.oid))
              .sort();
            const remaining = CREW_ORDER.slice(picked).map((creature) => creatureOids.get(creature.name));
            expect(offered).toEqual(remaining.map(String).sort());
            expect(offered).not.toContain(vehicleOid);
            expect(decision.options.some((option) => option.id === 'cost-crew-cancel')).toBe(true);
            expect(decision.options.some((option) => option.id === 'cost-crew-finish')).toBe(
              chosenPower >= vehicle.crew,
            );
            thresholdChecks += 1;
            if (!inventedRejected) {
              await expect(session.submit('cost-crew-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              inventedRejected = true;
            }
            const next = CREW_ORDER[picked];
            if (attempt === 'cancel' && picked === 1) {
              move = 'cost-crew-cancel';
            } else if (next === undefined) {
              move = 'cost-crew-finish';
            } else {
              const candidate = decision.options.find(
                (option) => option.targets[0]?.oid === creatureOids.get(next.name),
              );
              if (candidate === undefined) throw new Error(`Forge did not offer ${next.name} for Crew`);
              move = candidate.id;
              picked += 1;
              chosenPower += next.power;
            }
          } else if (decision.kind === 'priority') {
            const vehicleCard = session.view.seats[0].battlefield.find((card) => card.oid === vehicleOid);
            if (vehicleCard === undefined) throw new Error(`${vehicle.name} left the battlefield`);
            const resolved = activated && attempt === 'pay' && vehicleCard.typeLine.includes('Creature');
            if (resolved) {
              crewed = true;
              break;
            }
            if (!activated && session.view.stack.length === 0) {
              const crew = decision.options.find(
                (option) => option.text.startsWith(`${vehicle.name}:`) && option.text.includes('Crew'),
              );
              if (crew === undefined) {
                throw new Error(
                  `Forge offered no Crew option on ${vehicle.name}: ${decision.options.map((option) => option.text).join(' | ')}`,
                );
              }
              expect(crew.text).toContain(`Crew ${vehicle.crew}`);
              before = publicPosition(session.view);
              activated = true;
              picked = 0;
              chosenPower = 0;
              move = crew.id;
            } else {
              move = decision.options.find((option) => option.text === 'Pass priority')?.id;
            }
          }
          if (move === undefined)
            throw new Error(`Unhandled ${vehicle.name} decision\n${trace.slice(-6).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-6).join('\n')}`);
          session = advanced.session;
          if (move === 'cost-crew-cancel') {
            expect(publicPosition(session.view)).toEqual(before);
            canceledCleanly = true;
            attempt = 'pay';
            activated = false;
          }
        }
        const evidence = trace.slice(-12).join('\n');
        expect(canceledCleanly, evidence).toBe(true);
        expect(crewed, evidence).toBe(true);
        expect(thresholdChecks, evidence).toBeGreaterThanOrEqual(1 + CREW_ORDER.length);
        const seat = session.view.seats[0];
        const body = seat.battlefield.find((card) => card.oid === vehicleOid);
        expect(body?.typeLine, evidence).toContain('Artifact');
        expect(body?.typeLine, evidence).toContain('Creature');
        expect(body?.power, evidence).toBe(vehicle.power);
        expect(body?.toughness, evidence).toBe(vehicle.toughness);
        for (const creature of CREW_ORDER) {
          expect(
            seat.battlefield.find((card) => card.oid === creatureOids.get(creature.name))?.tapped,
            `${creature.name} taps to pay Crew`,
          ).toBe(true);
        }
        expect(session.view.stack, evidence).toEqual([]);
      } finally {
        await session.close();
        await backend.shutdown?.();
      }
    },
    180_000,
  );

  it("still taps Cultivator's Caravan for mana, which the Crew review must not refuse", async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Tasseled Dromedary'],
            battlefield: ["Cultivator's Caravan"],
            library: ['Swamp', 'Swamp'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Forest', 'Forest'], graveyard: [] },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ["Cultivator's Caravan", 'Tasseled Dromedary', 'Forest', 'Swamp'],
      },
    );
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(spec("Cultivator's Caravan mana"));
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session: ObservedSession = opened.session;
    const trace: string[] = [];
    let cast = false;
    let tapped = false;
    try {
      for (let index = 0; index < 40 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error("Forge offered no Cultivator's Caravan decision");
        const seat = session.view.seats[0];
        if (seat.battlefield.some((card) => card.name === 'Tasseled Dromedary')) break;
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = cast
            ? decision.options.find((option) => option.text === 'Pass priority')?.id
            : decision.options.find((option) => option.text.startsWith('Tasseled Dromedary:'))?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'mana-payment') {
          const source = decision.options.find(
            (option) =>
              option.id.startsWith('mana-source-') &&
              option.text.includes("Cultivator's Caravan") &&
              option.text.endsWith('{W}'),
          );
          if (source === undefined) throw new Error('Forge did not offer the Caravan for {W}');
          tapped = true;
          move = source.id;
        }
        if (move === undefined) throw new Error(`Unhandled Caravan decision\n${trace.slice(-6).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-6).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-8).join('\n');
      expect(cast, evidence).toBe(true);
      expect(tapped, evidence).toBe(true);
      const battlefield = session.view.seats[0].battlefield;
      expect(battlefield.map((card) => card.name).sort(), evidence).toEqual([
        "Cultivator's Caravan",
        'Tasseled Dromedary',
      ]);
      expect(battlefield.find((card) => card.name === "Cultivator's Caravan")?.tapped, evidence).toBe(true);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});

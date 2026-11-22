import { z } from 'zod';

// Fixtures contain names only, never Forge state directives or custom scripts.
const Name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^;|=\r\n]+$/u);
const Zone = z.array(Name).max(100);
const Seat = z
  .object({
    life: z.number().int().min(1).max(100),
    hand: Zone,
    library: Zone,
    battlefield: Zone,
    graveyard: Zone,
  })
  .strict();

/** Trusted launcher input only; deliberately absent from SessionSpec / JSONL. */
export const ForgeScenarioStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    active: z.union([z.literal(0), z.literal(1)]),
    phase: z.enum(['MAIN1', 'COMBAT_BEGIN', 'OPENING_HAND']),
    seats: z.tuple([Seat, Seat]),
  })
  .strict()
  // The bridge refuses these at session open (ForgeBridge.ScenarioState), with these same reasons;
  // refusing them here fails at construction instead of after a Forge boot.
  .superRefine((state, context) => {
    if (state.phase !== 'OPENING_HAND') return;
    if (state.active !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['active'],
        message: 'OPENING_HAND active seat is fixed to 0 by Puzzle mode',
      });
    }
    state.seats.forEach((seat, index) => {
      for (const zone of ['battlefield', 'graveyard'] as const) {
        if (seat[zone].length === 0) continue;
        context.addIssue({
          code: 'custom',
          path: ['seats', index, zone],
          message: `OPENING_HAND seat may not declare ${zone}`,
        });
      }
    });
  });

export type ForgeScenarioState = z.infer<typeof ForgeScenarioStateSchema>;

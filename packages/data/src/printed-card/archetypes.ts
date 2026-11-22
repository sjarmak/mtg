import { z } from 'zod';

const ColorSchema = z.enum(['W', 'U', 'B', 'R', 'G']);
const colorOrder = new Map(ColorSchema.options.map((color, index) => [color, index]));
const ColorsSchema = z
  .array(ColorSchema)
  .min(1)
  .max(5)
  .superRefine((colors, context) => {
    const canonical = [...new Set(colors)].sort(
      (left, right) => (colorOrder.get(left) ?? 0) - (colorOrder.get(right) ?? 0),
    );
    if (canonical.join('') !== colors.join('')) {
      context.addIssue({ code: 'custom', message: 'colors must be unique and in WUBRG order' });
    }
  });

export const PrintedArchetypeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  name: z.string().trim().min(1).max(100),
  colors: ColorsSchema,
  signpost: z.strictObject({
    name: z.string().trim().min(1),
    physicalId: z.string().trim().min(1),
  }),
  plan: z.string().trim().min(1).max(300),
});

export const PrintedArchetypeListSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    formatId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    archetypes: z.array(PrintedArchetypeSchema).min(1),
  })
  .superRefine((list, context) => {
    const ids = new Set<string>();
    for (const [index, archetype] of list.archetypes.entries()) {
      if (ids.has(archetype.id)) {
        context.addIssue({ code: 'custom', path: ['archetypes', index, 'id'], message: 'duplicate id' });
      }
      ids.add(archetype.id);
    }
  });

export type PrintedArchetype = z.infer<typeof PrintedArchetypeSchema>;
export type PrintedArchetypeList = z.infer<typeof PrintedArchetypeListSchema>;

export interface PrintedArchetypePoolCard {
  readonly physicalId: string;
  readonly name: string;
}

export function parsePrintedArchetypeList(input: unknown): PrintedArchetypeList {
  return PrintedArchetypeListSchema.parse(input);
}

export function validatePrintedArchetypeList(
  input: unknown,
  cards: readonly PrintedArchetypePoolCard[],
): PrintedArchetypeList {
  const list = parsePrintedArchetypeList(input);
  const byPhysicalId = new Map(cards.map((card) => [card.physicalId, card.name]));
  for (const archetype of list.archetypes) {
    const poolName = byPhysicalId.get(archetype.signpost.physicalId);
    if (poolName === undefined) {
      throw new Error(`${archetype.signpost.physicalId} is not in ${list.formatId}'s printed card pool`);
    }
    if (poolName !== archetype.signpost.name) {
      throw new Error(`${archetype.signpost.physicalId} is ${poolName}, not ${archetype.signpost.name}`);
    }
  }
  return list;
}

export function printedArchetypeListForPoolSchema(
  formatId: string,
  cards: readonly PrintedArchetypePoolCard[],
) {
  const byPhysicalId = new Map(cards.map((card) => [card.physicalId, card.name]));
  return PrintedArchetypeListSchema.superRefine((list, context) => {
    if (list.formatId !== formatId) {
      context.addIssue({ code: 'custom', path: ['formatId'], message: `formatId must be ${formatId}` });
    }
    for (const [index, archetype] of list.archetypes.entries()) {
      const poolName = byPhysicalId.get(archetype.signpost.physicalId);
      if (poolName === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['archetypes', index, 'signpost', 'physicalId'],
          message: `${archetype.signpost.physicalId} is not in ${formatId}'s printed card pool`,
        });
      } else if (poolName !== archetype.signpost.name) {
        context.addIssue({
          code: 'custom',
          path: ['archetypes', index, 'signpost', 'name'],
          message: `${archetype.signpost.physicalId} is ${poolName}, not ${archetype.signpost.name}`,
        });
      }
    }
  });
}

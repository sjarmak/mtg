// @vitest-environment jsdom
/**
 * The Design tab, driven the way a person drives it, against a stubbed server.
 *
 * `mtg-yddw.2`, `.3`, `.5`. The server itself is tested over a real socket in
 * `packages/setgen/test/design-server.test.ts`; what is unanswerable there and
 * answerable here is the half this page owns — that a refusal lands next to the
 * field that earned it, that the JSON box is the value that was judged rather
 * than a reconstruction of it, that the draft survives a reload, and that with
 * no server at all the editor still edits and names the command that starts one.
 *
 * `fetch` is stubbed rather than mocked through a library: four routes, each
 * answering a literal, is less machinery than a mock server and it makes the
 * "no server" case a one-line change (throw instead of answer), which is the
 * case most worth having.
 *
 * Nothing here proves a pixel; jsdom performs no layout. The two-column
 * arrangement argues itself in `../../src/styles/design.ts`.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DESIGN_SERVER_COMMAND } from '../../src/routes/design/client';
import { DesignRoute, NEW_BRIEF_LABEL } from '../../src/routes/design/DesignRoute';
import type { DesignRouteProps } from '../../src/routes/design/DesignRoute';
import { DRAFT_STORAGE_KEY } from '../../src/routes/design/draft-store';
import { UNFINISHED_NOTE, VALID_NOTE } from '../../src/routes/design/StatusPanel';
import { outstandingNote, RUN_LABEL } from '../../src/routes/design/RunPanel';

afterEach(cleanup);

const VOCABULARY = {
  keywords: ['flying', 'lifelink'],
  effectKinds: ['damage', 'draw'],
  abilityKinds: ['static', 'triggered', 'activated'],
  triggerConditions: ['onAttack'],
  colors: ['W', 'U', 'B', 'R', 'G'],
  requiredPools: ['W', 'U', 'B', 'R', 'G', 'colorless'],
  rarities: ['common', 'uncommon', 'rare', 'mythic'],
  sliceRarities: ['common', 'uncommon', 'rare'],
  cardKinds: ['creature', 'instant'],
  counterKinds: ['charge'],
  spellRoles: ['removal', 'card advantage'],
  colorPieSubjects: ['lifegain'],
  targetSize: { min: 60, max: 400, default: 250 },
  mechanics: { min: 1, max: 6 },
  setCodePattern: '^[A-Z0-9]{3,5}$',
  subtypePattern: '^[A-Za-z]+$',
};

const PLAN = {
  setCode: 'TGR',
  setName: 'Tideglass Reach',
  targetSize: 250,
  slots: 250,
  pools: [{ pool: 'W', byRarity: { common: 20, uncommon: 12, rare: 6 }, total: 38 }],
  curve: [
    { manaValue: 1, slots: 30 },
    { manaValue: 2, slots: 60 },
  ],
  mechanics: [{ name: 'Undertow', slots: 24, commonSlots: 10 }],
  seated: [
    {
      name: 'Tide-Bound Herald',
      slotId: 'w-014',
      pool: 'W',
      rarity: 'rare',
      cardKind: 'creature',
      role: 'signpost',
      manaValueMin: 3,
      manaValueMax: 4,
    },
  ],
  unseated: [],
  pinNotes: ['A pin for two white rares landed on one.'],
  notes: ['Seated the named cards first.'],
};

/** What each route answers. A case reassigns one entry to change the world. */
interface Answers {
  vocabulary: unknown;
  validate: unknown;
  plan: unknown;
  run: unknown;
  /** Set to throw from `fetch` itself, which is what no server looks like. */
  offline: boolean;
}

let answers: Answers;

function stubFetch(): void {
  const fetcher = (path: unknown): Promise<unknown> => {
    if (answers.offline) return Promise.reject(new Error('connection refused'));
    const route = String(path);
    const body = route.endsWith('/vocabulary')
      ? answers.vocabulary
      : route.endsWith('/validate')
        ? answers.validate
        : route.endsWith('/plan')
          ? answers.plan
          : answers.run;
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
  };
  // The page reaches `fetch` off the global, and the workspace tsconfig has no
  // `lib: dom`, so the stub is installed structurally rather than typed.
  (globalThis as { fetch?: unknown }).fetch = fetcher;
}

beforeEach(() => {
  answers = {
    vocabulary: VOCABULARY,
    validate: { ok: true, derived: { tertiaryBudget: 25, requiredCards: 1, authoredCards: 0, mechanics: 1 } },
    plan: { ok: true, plan: PLAN },
    run: { ok: true, enforceable: true, cards: [{}, {}, {}], report: {} },
    offline: false,
  };
  stubFetch();
  const store = (globalThis as { localStorage?: { clear(): void } }).localStorage;
  store?.clear();
});

/**
 * `DesignRoute`'s props are optional, which makes `createElement` pick its
 * no-props overload and refuse `quietMs`; naming the component's own prop type
 * here is what puts the debounce under the test's control.
 */
const Route = DesignRoute as (props: DesignRouteProps) => ReactElement;

function draw(): void {
  render(h(Route, { quietMs: 1 }));
}

describe('the editor with a server behind it', () => {
  it('offers the closed lists it was given rather than a copy of its own', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'flying' })).toBeDefined();
    });
  });

  it('says the brief is legal and reports the budget the run will use', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(VALID_NOTE)).toBeDefined();
    });
    expect(screen.getByText('25')).toBeDefined();
  });

  it('draws the skeleton the brief would build, without anything being run', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(/250 slots for a target of 250/)).toBeDefined();
    });
    expect(screen.getByText(/Undertow: 24 slots, 10 of them common/)).toBeDefined();
    expect(screen.getByText(/Tide-Bound Herald: W rare creature/)).toBeDefined();
    expect(screen.getByText('A pin for two white rares landed on one.')).toBeDefined();
  });

  it('calls out a mechanic that reaches no common, which is the failure it exists to catch', async () => {
    answers.plan = {
      ok: true,
      plan: { ...PLAN, mechanics: [{ name: 'Undertow', slots: 4, commonSlots: 0 }] },
    };
    draw();
    await waitFor(() => {
      expect(screen.getByText(/Undertow reaches no common slot/)).toBeDefined();
    });
  });
});

/** The attribute is read structurally: the workspace tsconfig has no `lib: dom`. */
function attribute(element: unknown, name: string): string | null {
  return (element as { getAttribute(name: string): string | null }).getAttribute(name);
}

/** What a blank brief is refused for: the seven the schema states, as Zod says them. */
const BLANK_ISSUES = {
  ok: false,
  issues: [
    { path: ['setCode'], pointer: 'setCode', message: 'set code must be 3-5 uppercase alphanumerics' },
    { path: ['setName'], pointer: 'setName', message: 'Too small: expected string to have >=1 characters' },
    { path: ['theme'], pointer: 'theme', message: 'Too small: expected string to have >=1 characters' },
    { path: ['seed'], pointer: 'seed', message: 'Too small: expected string to have >=1 characters' },
    {
      path: ['mechanics', 0, 'name'],
      pointer: 'mechanics.0.name',
      message: 'Too small: expected string to have >=1 characters',
    },
    {
      path: ['mechanics', 0, 'description'],
      pointer: 'mechanics.0.description',
      message: 'Too small: expected string to have >=1 characters',
    },
    { path: ['targetSize'], pointer: 'targetSize', message: 'Too small: expected number to be >=60' },
  ],
};

describe('a brief nobody has typed into yet', () => {
  beforeEach(() => {
    answers.validate = BLANK_ISSUES;
  });

  it('marks no field, because a field nobody has reached has not been got wrong', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(UNFINISHED_NOTE)).toBeDefined();
    });
    for (const label of ['Set code', 'Set name', 'Theme', 'Seed', 'Target size']) {
      expect(attribute(screen.getByLabelText(label), 'data-refused')).toBe('false');
    }
    expect(screen.queryByText(/fields are refused, marked above/)).toBeNull();
  });

  it('counts what is outstanding beside the button it is about', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(outstandingNote(7))).toBeDefined();
    });
    expect((screen.getByRole('button', { name: RUN_LABEL }) as { disabled?: boolean }).disabled).toBe(true);
  });

  it('leaks no schema phrasing to the person filling it in', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(UNFINISHED_NOTE)).toBeDefined();
    });
    for (const label of ['Set name', 'Theme', 'Seed']) {
      fireEvent.blur(screen.getByLabelText(label));
    }
    await waitFor(() => {
      expect(screen.getByText('Every set needs a name.')).toBeDefined();
    });
    expect(screen.queryByText(/expected string to have/)).toBeNull();
    expect(screen.getByText(/the paragraph the model is handed/)).toBeDefined();
  });

  it('reveals one field at a time, and counts only what is marked', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(UNFINISHED_NOTE)).toBeDefined();
    });
    fireEvent.blur(screen.getByLabelText('Set name'));
    await waitFor(() => {
      expect(attribute(screen.getByLabelText('Set name'), 'data-refused')).toBe('true');
    });
    expect(attribute(screen.getByLabelText('Theme'), 'data-refused')).toBe('false');
    expect(screen.getByText('One field is refused. It is marked above.')).toBeDefined();
  });

  it('says a set code is wrong without restating the rule printed under the box', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(UNFINISHED_NOTE)).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText('Set code'), { target: { value: 'abc' } });
    fireEvent.blur(screen.getByLabelText('Set code'));
    await waitFor(() => {
      expect(screen.getByText('That is not a set code.')).toBeDefined();
    });
    expect(screen.queryByText('set code must be 3-5 uppercase alphanumerics')).toBeNull();
    expect(screen.getAllByText('Three to five uppercase letters or digits.')).toHaveLength(1);
  });
});

describe('a field the server refuses', () => {
  beforeEach(() => {
    answers.validate = {
      ok: false,
      issues: [
        { path: ['setCode'], pointer: 'setCode', message: 'set code must be 3-5 uppercase alphanumerics' },
      ],
    };
  });

  it('is marked next to the field rather than in a list at the bottom', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(UNFINISHED_NOTE)).toBeDefined();
    });
    fireEvent.blur(screen.getByLabelText('Set code'));
    await waitFor(() => {
      expect(screen.getByText(/Every set needs a code/)).toBeDefined();
    });
    expect(attribute(screen.getByLabelText('Set code'), 'data-refused')).toBe('true');
  });

  it('leaves the run unavailable, because there is nothing legal to run', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(outstandingNote(1))).toBeDefined();
    });
    const run = screen.getByRole('button', { name: RUN_LABEL });
    expect((run as { disabled?: boolean }).disabled).toBe(true);
  });
});

describe('what is typed', () => {
  it('is in the brief on screen, exactly as the server was given it', async () => {
    draw();
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Tideglass Reach' } });
    await waitFor(() => {
      const json = screen.getByLabelText('Brief JSON') as { value?: string };
      expect(json.value).toContain('"setName": "Tideglass Reach"');
    });
  });

  it('survives a reload, because losing an evening of theme to one is the failure', async () => {
    draw();
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Tideglass Reach' } });
    await waitFor(() => {
      const kept = (
        globalThis as { localStorage?: { getItem(key: string): string | null } }
      ).localStorage?.getItem(DRAFT_STORAGE_KEY);
      expect(kept ?? '').toContain('Tideglass Reach');
    });
    cleanup();
    draw();
    expect((screen.getByLabelText('Set name') as { value?: string }).value).toBe('Tideglass Reach');
  });

  it('is cleared by starting a new brief', async () => {
    draw();
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Tideglass Reach' } });
    fireEvent.click(screen.getByRole('button', { name: NEW_BRIEF_LABEL }));
    await waitFor(() => {
      expect((screen.getByLabelText('Set name') as { value?: string }).value).toBe('');
    });
  });
});

describe('the free run', () => {
  it('reports what came back and whether the set is runnable', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(VALID_NOTE)).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: RUN_LABEL }));
    await waitFor(() => {
      expect(screen.getByText(/3 cards came back/)).toBeDefined();
    });
    expect(screen.getByText(/passes the deterministic gates/)).toBeDefined();
  });

  it('names the recording command only for a fixture that was never recorded', async () => {
    answers.run = { ok: false, reason: 'no fixture for this brief', unrecorded: true };
    draw();
    await waitFor(() => {
      expect(screen.getByText(VALID_NOTE)).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: RUN_LABEL }));
    await waitFor(() => {
      expect(screen.getByText(/--record --max-usd/)).toBeDefined();
    });
  });

  it('says a refusal in the pipeline’s own words, with no command attached', async () => {
    answers.run = { ok: false, reason: 'the allocator could not seat Tide-Bound Herald', unrecorded: false };
    draw();
    await waitFor(() => {
      expect(screen.getByText(VALID_NOTE)).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: RUN_LABEL }));
    await waitFor(() => {
      expect(screen.getByText('the allocator could not seat Tide-Bound Herald')).toBeDefined();
    });
  });
});

describe('with no design server at all', () => {
  beforeEach(() => {
    answers.offline = true;
  });

  it('still edits, and says which command starts one', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getByText(new RegExp(DESIGN_SERVER_COMMAND))).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Tideglass Reach' } });
    await waitFor(() => {
      const json = screen.getByLabelText('Brief JSON') as { value?: string };
      expect(json.value).toContain('Tideglass Reach');
    });
  });

  it('says the closed lists are missing rather than drawing empty rows', async () => {
    draw();
    await waitFor(() => {
      expect(screen.getAllByText(/closed list is not on screen yet/).length).toBeGreaterThan(0);
    });
  });
});

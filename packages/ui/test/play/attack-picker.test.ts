// @vitest-environment jsdom
/**
 * The combat band's "who do they attack" picker: markup in, clicks out.
 *
 * `mtg-bc2.154.6.5.4`. The picker is a radio group with nothing checked until the
 * player checks one, and it is the whole instruction: a table that pre-checked a
 * defender would be choosing for the player, and a table that said nothing would
 * leave a click on a creature meaning something the player had not been told. At
 * a table with one opponent the band draws no picker at all.
 */
import { createElement as h } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Choice } from '@mtg/kernel';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CHOOSE_DEFENDER_LABEL, NO_STAGING, attackControls } from '../../src/routes/play/combat';
import type { AttackStaging } from '../../src/routes/play/combat';
import type { AttackDefender, AttackTargeting } from '../../src/routes/play/attack-targets';

afterEach(cleanup);

/** The workspace tsconfig has no `lib: dom`; this is the slice of an element the test reads. */
interface Node {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): Node | null;
  querySelectorAll(selector: string): { readonly [index: number]: Node; readonly length: number };
}

const all = (root: Node, selector: string): Node[] => {
  const found = root.querySelectorAll(selector);
  return Array.from({ length: found.length }, (_, at) => found[at]!);
};
const press = (node: Node): Parameters<typeof fireEvent.click>[0] =>
  node as unknown as Parameters<typeof fireEvent.click>[0];

const BO: AttackDefender = { key: 'seat:1', label: 'Bo', kind: 'player' };
const CY: AttackDefender = { key: 'seat:2', label: 'Cy', kind: 'player' };
const JACE: AttackDefender = { key: 'card:jace-2', label: 'Jace, Telepath Unbound', kind: 'planeswalker' };

function targeting(extra: Partial<AttackTargeting> = {}): AttackTargeting {
  return { options: [BO, CY, JACE], picked: null, pick: () => undefined, counts: new Map(), ...extra };
}

function staging(extra: Partial<AttackStaging> = {}): AttackStaging {
  return { ...NO_STAGING, confirm: 0, ...extra };
}

function draw(band: AttackStaging, onChoose: (choice: Choice) => void = () => undefined): Node {
  const { container } = render(h('div', null, attackControls(band, onChoose) as ReactNode));
  return container as unknown as Node;
}

describe('the attack picker', () => {
  it('is drawn only when the declaration carries a question about whom', () => {
    expect(all(draw(staging()), '.mtg-combat__targets')).toHaveLength(0);
    expect(all(draw(staging({ targets: targeting() })), '.mtg-combat__targets')).toHaveLength(1);
  });

  it('is one radio per defender, in the order offered, with nobody checked and the instruction stated', () => {
    const root = draw(staging({ targets: targeting() }));
    const group = root.querySelector('.mtg-combat__targets');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.getAttribute('aria-label')).toBe('Who to attack');
    expect(group?.getAttribute('data-picked')).toBe('false');
    const radios = all(root, '.mtg-combat__target');
    expect(radios.map((radio) => radio.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(radios.map((radio) => radio.getAttribute('data-kind'))).toEqual([
      'player',
      'player',
      'planeswalker',
    ]);
    expect(radios.map((radio) => radio.textContent)).toEqual(['Bo', 'Cy', 'Jace, Telepath Unbound']);
    expect(root.querySelector('.mtg-combat__targets-ask')?.textContent).toBe(CHOOSE_DEFENDER_LABEL);
  });

  it('checks the one that is picked and stops asking', () => {
    const root = draw(staging({ targets: targeting({ picked: CY.key }) }));
    expect(root.querySelector('.mtg-combat__targets')?.getAttribute('data-picked')).toBe('true');
    expect(all(root, '.mtg-combat__target').map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(root.querySelector('.mtg-combat__targets-ask')).toBeNull();
  });

  it('says how many staged creatures are going at each defender, and nothing at zero', () => {
    const counts = new Map([
      [BO.key, 2],
      [JACE.key, 1],
    ]);
    const radios = all(draw(staging({ targets: targeting({ counts }) })), '.mtg-combat__target');
    expect(radios.map((radio) => radio.getAttribute('data-going'))).toEqual(['2', '0', '1']);
    expect(
      radios.map((radio) => radio.querySelector('.mtg-combat__target-count')?.textContent ?? null),
    ).toEqual(['2', null, '1']);
  });

  it('picks the defender pressed and submits nothing, since choosing whom is not declaring', () => {
    const pick = vi.fn<(key: string) => void>();
    const onChoose = vi.fn<(choice: Choice) => void>();
    const root = draw(staging({ targets: targeting({ pick }) }), onChoose);
    fireEvent.click(press(all(root, '.mtg-combat__target')[2]!));
    expect(pick).toHaveBeenCalledExactlyOnceWith(JACE.key);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('sits before the confirm, which still reads the count of creatures staged', () => {
    const root = draw(
      staging({
        targets: targeting(),
        staged: new Set(['wolf', 'bear']),
        eligible: new Set(['wolf', 'bear', 'owl']),
      }),
    );
    const kinds = all(root, '.mtg-combat__button').map((button) => button.getAttribute('data-kind'));
    expect(kinds).toEqual(['player', 'player', 'planeswalker', 'confirm', 'all']);
    expect(root.querySelector('[data-kind="confirm"]')?.textContent).toBe('Attack with 2');
  });
});

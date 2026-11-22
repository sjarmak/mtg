/**
 * The two claims a brief makes about *what a color prints*: the roles a tier is
 * asked to cover, and the subjects a color is declared not to touch.
 *
 * `mtg-yddw.4`. Both are optional and a brief that states neither is a complete
 * brief — the generator has its own defaults for the first and the color pie for
 * the second. They are here because they are the two places a designer overrides
 * a default rather than fills a blank, and an editor that could not reach them
 * would send every serious brief back to a text editor.
 *
 * A spell-role row names a *tier*: a rarity out of the three the skeleton
 * allocates, and a pool. A signature row names a color and the color-pie
 * subjects this set decides it does not print, which is how a set says "our
 * white has no lifegain" and has the generator hold to it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BriefIssue, Vocabulary } from './client';
import type { BriefDraft, SignatureDraft, SpellRolesDraft } from './draft';
import { chipsField, panel, removedAt, replacedAt, selectField, textField, toggled } from './fields';

export const ROLES_TITLE = 'Spell roles by tier';

const ROLES_EXPLAIN =
  'What each rarity and pool has to cover. Stating none leaves the generator’s own defaults in place, which is the usual answer; state a tier here when this set wants something different from it.';

export const SIGNATURES_TITLE = 'What a color does not print';

const SIGNATURES_EXPLAIN =
  'A color signature narrows the color pie for this set: the subjects listed are the ones that color will not be given. It removes, it never adds, so a set cannot use this to put counterspells in red.';

export const ADD_ROLES_LABEL = 'Add a tier';
export const ADD_SIGNATURE_LABEL = 'Add a color';
export const REMOVE_LABEL = 'Remove';

export const NO_ROLES_NOTE = 'No tier is overridden. The generator uses its own role coverage.';
export const NO_SIGNATURES_NOTE = 'No color is narrowed. The full color pie is available to every color.';

const NO_VOCABULARY = 'The design server has not answered, so this closed list is not on screen yet.';

const EMPTY_ROLES: SpellRolesDraft = { rarity: '', pool: '', roles: [], why: '' };
const EMPTY_SIGNATURE: SignatureDraft = { color: '', absent: [] };

export interface RolesPanelProps {
  readonly draft: BriefDraft;
  readonly onChange: (draft: BriefDraft) => void;
  readonly issues: readonly BriefIssue[];
  readonly vocabulary: Vocabulary | null;
}

/** The tier rows. */
export function SpellRolesPanel(props: RolesPanelProps): ReactElement {
  const { draft, onChange, issues, vocabulary } = props;
  const roleOptions = vocabulary === null ? [] : vocabulary.spellRoles;

  const rows = draft.spellRoles.map((tier, index) => {
    const at = `spellRoles.${String(index)}`;
    const replace = (next: SpellRolesDraft): void => {
      onChange({ ...draft, spellRoles: replacedAt(draft.spellRoles, index, next) });
    };
    return createElement(
      'article',
      { key: at, className: 'mtg-design__item' },
      createElement(
        'div',
        { className: 'mtg-design__row' },
        selectField({
          id: `${at}-rarity`,
          label: 'Rarity',
          value: tier.rarity,
          options: vocabulary === null ? [] : vocabulary.sliceRarities,
          onChange: (value: string): void => {
            replace({ ...tier, rarity: value });
          },
          issues,
          pointer: `${at}.rarity`,
          anyLabel: 'Pick a rarity',
        }),
        selectField({
          id: `${at}-pool`,
          label: 'Pool',
          value: tier.pool,
          options: vocabulary === null ? [] : vocabulary.requiredPools,
          onChange: (value: string): void => {
            replace({ ...tier, pool: value });
          },
          issues,
          pointer: `${at}.pool`,
          anyLabel: 'Pick a pool',
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            onClick: (): void => {
              onChange({ ...draft, spellRoles: removedAt(draft.spellRoles, index) });
            },
          },
          REMOVE_LABEL,
        ),
      ),
      chipsField({
        label: 'Roles this tier covers',
        options: roleOptions,
        selected: tier.roles,
        onToggle: (option: string): void => {
          replace({ ...tier, roles: toggled(tier.roles, option, roleOptions) });
        },
        issues,
        pointer: `${at}.roles`,
        absent: NO_VOCABULARY,
      }),
      textField({
        id: `${at}-why`,
        label: 'Why this set wants that',
        value: tier.why,
        onChange: (value: string): void => {
          replace({ ...tier, why: value });
        },
        issues,
        pointer: `${at}.why`,
        rows: 2,
      }),
    );
  });

  return panel(
    ROLES_TITLE,
    ROLES_EXPLAIN,
    ...(rows.length === 0 ? [createElement('p', { className: 'mtg-design__hint' }, NO_ROLES_NOTE)] : rows),
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            onChange({ ...draft, spellRoles: [...draft.spellRoles, EMPTY_ROLES] });
          },
        },
        ADD_ROLES_LABEL,
      ),
    ),
  );
}

/** The color rows. */
export function SignaturesPanel(props: RolesPanelProps): ReactElement {
  const { draft, onChange, issues, vocabulary } = props;
  const subjects = vocabulary === null ? [] : vocabulary.colorPieSubjects;

  const rows = draft.colorSignatures.map((signature, index) => {
    const at = `colorSignatures.${String(index)}`;
    const replace = (next: SignatureDraft): void => {
      onChange({ ...draft, colorSignatures: replacedAt(draft.colorSignatures, index, next) });
    };
    return createElement(
      'article',
      { key: at, className: 'mtg-design__item' },
      createElement(
        'div',
        { className: 'mtg-design__row' },
        selectField({
          id: `${at}-color`,
          label: 'Color',
          value: signature.color,
          options: vocabulary === null ? [] : vocabulary.colors,
          onChange: (value: string): void => {
            replace({ ...signature, color: value });
          },
          issues,
          pointer: `${at}.color`,
          anyLabel: 'Pick a color',
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            onClick: (): void => {
              onChange({ ...draft, colorSignatures: removedAt(draft.colorSignatures, index) });
            },
          },
          REMOVE_LABEL,
        ),
      ),
      chipsField({
        label: 'Subjects it does not print',
        options: subjects,
        selected: signature.absent,
        onToggle: (option: string): void => {
          replace({ ...signature, absent: toggled(signature.absent, option, subjects) });
        },
        issues,
        pointer: `${at}.absent`,
        absent: NO_VOCABULARY,
      }),
    );
  });

  return panel(
    SIGNATURES_TITLE,
    SIGNATURES_EXPLAIN,
    ...(rows.length === 0
      ? [createElement('p', { className: 'mtg-design__hint' }, NO_SIGNATURES_NOTE)]
      : rows),
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            onChange({ ...draft, colorSignatures: [...draft.colorSignatures, EMPTY_SIGNATURE] });
          },
        },
        ADD_SIGNATURE_LABEL,
      ),
    ),
  );
}

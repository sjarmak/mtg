/**
 * The frame as text, and the system prompt that tells the model what it is.
 *
 * Both are part of the fixture key (`hash(system, prompt, schema)`), so editing
 * either one invalidates every recorded ruling on purpose: a replay is only
 * evidence about the prompt that produced it.
 */
import type { FramedPlayer, RefereeFrame } from './frame';

export const REFEREE_SYSTEM = [
  'You are a rules referee for a Magic: The Gathering engine.',
  '',
  'The engine owns the game. It has already worked out every legal move from the',
  'current position and numbered them. Your only job is to choose one of those',
  'numbers and say why in one sentence.',
  '',
  'You never describe what happens next, never invent or amend an action, and',
  'never assume information the position does not state. Hidden zones are shown',
  'as counts because they are hidden from the player you are ruling for; ruling',
  'as if you knew their contents is cheating.',
  '',
  'Answer with the index of exactly one listed option.',
].join('\n');

/** The whole position, the question, and the numbered options. */
export function renderFrame(frame: RefereeFrame): string {
  const sections: string[] = [
    `Turn ${String(frame.turn.number)}, ${frame.turn.step} step. ` +
      `Active player: ${String(frame.turn.active)}. ` +
      `Priority: ${frame.turn.priority === null ? 'nobody' : String(frame.turn.priority)}.`,
    '',
    ...frame.players.map((player) => renderPlayer(player, frame.asking)),
  ];

  sections.push(...block('Stack (top last)', frame.stack));
  sections.push(...block('Combat', frame.combat));
  sections.push(...block('Exile', frame.exile));

  sections.push('', frame.question, '');
  sections.push('Options:');
  for (const option of frame.options) {
    sections.push(`  ${String(option.index)}: ${option.summary}`);
  }
  if (frame.omittedOptions > 0) {
    sections.push(
      `  (${String(frame.omittedOptions)} further option(s) exist and are not listed; ` +
        'choose from the ones above.)',
    );
  }
  if (!frame.enumerationComplete) {
    sections.push(
      '  (The engine could not enumerate every legal move from this position, so this list is a subset.)',
    );
  }
  return sections.join('\n');
}

function renderPlayer(player: FramedPlayer, asking: number): string {
  const who =
    player.player === asking ? `Player ${String(player.player)} (you)` : `Player ${String(player.player)}`;
  const lines: string[] = [
    `${who}: ${String(player.life)} life, ` +
      `${String(player.librarySize)} cards in library (hidden), ` +
      `${String(player.handSize)} cards in hand${player.hand === null ? ' (hidden)' : ''}.`,
  ];
  if (player.hand !== null) {
    lines.push(...indent('Hand', player.hand));
  }
  lines.push(...indent('Battlefield', player.battlefield));
  lines.push(...indent('Graveyard', player.graveyard));
  return lines.join('\n');
}

function indent(label: string, items: readonly string[]): readonly string[] {
  if (items.length === 0) return [`  ${label}: empty.`];
  return [`  ${label}:`, ...items.map((item) => `    - ${item}`)];
}

function block(label: string, items: readonly string[]): readonly string[] {
  if (items.length === 0) return [];
  return ['', `${label}:`, ...items.map((item) => `  - ${item}`)];
}

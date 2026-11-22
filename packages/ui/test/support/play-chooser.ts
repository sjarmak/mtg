/**
 * Pressing through the Play chooser to the sealed builder.
 *
 * `mtg-tewc.5` turned Play into a page that asks what you want to play before
 * it deals anything: the decks this set ships with, and a Sealed section whose
 * button opens six packs. Every test that was written against the old surface
 * arrived at a pool because the route dealt one on sight, and each of them now
 * has to press the button a person presses. One helper rather than a literal
 * label in a dozen files, so the next rename is one edit.
 */
import { fireEvent, screen } from '@testing-library/react';
import { PLAY_GENERATE_LABEL, PLAY_RESUME_LABEL } from '../../src/routes/play/SealedChooser';

/** Opens a fresh pool from the Sealed section. */
export function generateSealed(): void {
  fireEvent.click(screen.getByRole('button', { name: PLAY_GENERATE_LABEL }));
}

/** Reopens the stored pool. Throws when the section is not offering one. */
export function resumeSealed(): void {
  fireEvent.click(screen.getByRole('button', { name: PLAY_RESUME_LABEL }));
}

/** Whether the Sealed section is offering a stored pool at all. */
export function offersResume(): boolean {
  return screen.queryByRole('button', { name: PLAY_RESUME_LABEL }) !== null;
}

/**
 * Parsing tests over output captured verbatim from Forge 2.0.14.
 *
 * Hermetic: the sample below is a real `sim` transcript recorded during spike
 * A, trimmed but not reworded, so the parser is tested against the format
 * Forge actually prints rather than the format we wish it printed.
 */
import { describe, expect, it } from 'vitest';
import {
  describeStartupFailure,
  diagnoseStartupFailure,
  parseSimOutput,
  problemCardNames,
} from '@mtg/forge-export';

const REAL_SIM_OUTPUT = [
  'Error handling registered!',
  '12:41:52 [INFO ] GuiBase: APP: Forge v.2.0.14-SNAPSHOT-08.08',
  'The card Treetop Recluse was not assigned to any set. Adding it to UNKNOWN set... to fix see res/editions/ folder. ',
  'Upcoming set Star Trek (TRK) dated in the future. All `upcoming` cards will be added to this set with unknown rarity.',
  'Read cards: 836 files in 0 ms (8 parts) using thread pool',
  'Simulation mode',
  'Ai(1)-Abzan Siege vs Ai(2)-Air Forces - one game of Constructed',
  'Game Outcome: Turn 9',
  'Game Outcome: Ai(1)-Abzan Siege has lost because life total reached 0',
  'Game Outcome: Ai(2)-Air Forces has won because all opponents have lost',
  'Match Result: Ai(1)-Abzan Siege: 0 Ai(2)-Air Forces: 1 ',
  '',
  'Game Result: Game 1 ended in 1700 ms. Ai(2)-Air Forces has won!',
  '',
].join('\n');

describe('parseSimOutput', () => {
  it('extracts each completed game with its duration and outcome', () => {
    const parsed = parseSimOutput(REAL_SIM_OUTPUT);
    expect(parsed.games).toEqual([{ game: 1, durationMs: 1700, outcome: 'Ai(2)-Air Forces has won!' }]);
  });

  it('extracts the match result and the card-file count', () => {
    const parsed = parseSimOutput(REAL_SIM_OUTPUT);
    expect(parsed.matchResults).toEqual(['Ai(1)-Abzan Siege: 0 Ai(2)-Air Forces: 1']);
    expect(parsed.cardFilesRead).toBe(836);
  });

  it('returns empty results for output with no games', () => {
    const parsed = parseSimOutput('Simulation mode\n');
    expect(parsed.games).toEqual([]);
    expect(parsed.matchResults).toEqual([]);
    expect(parsed.cardFilesRead).toBeNull();
  });

  /**
   * Recorded from a real 2.0.14 boot gate over the thin slice's 90-card set on
   * 2026-08-09. Forge reads each card source separately, so a run prints
   * several of these lines and the last one is the single-file token folder —
   * reporting that as "the card files Forge read" would have said `1`.
   */
  it('totals every card-file batch instead of keeping the last one', () => {
    const boot = [
      'Read cards: 33617 archived files in 0 ms (25 parts) using thread pool',
      'Read cards: 90 files in 0 ms (1 parts) using thread pool',
      'Read cards: 836 files in 0 ms (8 parts) using thread pool',
      'Read cards: 1 files in 0 ms (1 parts) using thread pool',
    ].join('\n');
    expect(parseSimOutput(boot).cardFilesRead).toBe(927);
  });
});

describe('problemCardNames', () => {
  it('names cards Forge could not assign to a set', () => {
    expect(problemCardNames(REAL_SIM_OUTPUT)).toContain('Treetop Recluse');
  });

  /**
   * Both of these were captured from real failure runs in which Forge still
   * exited 0 and still printed a "Game Result" line, which is exactly why the
   * gate cannot trust the exit code.
   */
  it('names a card a deck referenced but Forge does not know', () => {
    expect(problemCardNames('An unsupported card was requested: "Skywatch Sentinel" from "SLC". ')).toEqual([
      'Skywatch Sentinel',
    ]);
  });

  it('names a card whose script crashed while building its ability', () => {
    const crash = [
      'java.lang.RuntimeException: crash in raw Ability, check card script of Lightning Lash',
      'Caused by: java.lang.RuntimeException: AbilityFactory:getAbility: crash when trying to create ability  of card: Lightning Lash',
      'Caused by: java.lang.RuntimeException: Element NotARealApi not found in ApiType enum',
    ].join('\n');
    expect(problemCardNames(crash)).toEqual(['Lightning Lash']);
    expect(parseSimOutput(crash).exceptions.length).toBeGreaterThan(0);
  });

  it('reports nothing for a clean run', () => {
    expect(problemCardNames('Game Result: Game 1 ended in 900 ms. Ai(1)-A has won!')).toEqual([]);
  });
});

describe('diagnoseStartupFailure', () => {
  it('claims a missing display only when Forge printed a signature for it', () => {
    const authFailure = diagnoseStartupFailure({
      exitCode: 1,
      stdout: '',
      stderr: 'Authorization required, but no authorization protocol specified',
    });
    expect(authFailure).toEqual({
      kind: 'no-display',
      evidence: 'Authorization required, but no authorization protocol specified',
    });

    const headless = diagnoseStartupFailure({
      exitCode: 1,
      stdout: '',
      stderr: 'java.awt.HeadlessException: no X11 DISPLAY',
    });
    expect(headless?.kind).toBe('no-display');
  });

  /**
   * Verified 2026-08-09 and again 2026-08-18: with `DISPLAY` unset, Forge
   * 2.0.14 exits 1 with zero bytes on both streams. Nothing in that run's
   * *output* names a cause, but the empty variable does, and the 2026-08-18
   * check closed it — the identical command under `xvfb-run -a` boots the
   * 261-card flagship and plays five games. So the silence plus the unset
   * variable is a diagnosis, not a guess.
   *
   * Every case here passes `display` rather than letting the parameter default
   * to `process.env`: a test whose verdict depends on whether the machine
   * running it has a screen is a test about the machine.
   */
  it('names the display when the run was silent and had none', () => {
    const failure = diagnoseStartupFailure({ exitCode: 1, stdout: '', stderr: '' }, undefined);
    expect(failure).toEqual({
      kind: 'silent-without-display',
      evidence: 'Forge exited 1 having printed nothing at all on stdout or stderr',
    });
    expect(diagnoseStartupFailure({ exitCode: 1, stdout: '', stderr: '' }, '   ')).toEqual(failure);
  });

  /**
   * The caution the three-way split exists to keep. A silent exit on a machine
   * that *has* a screen is still unexplained: a corrupt jar or a killed JVM
   * looks exactly the same from here, and the gate says so rather than blaming
   * the nearest familiar cause.
   */
  it('reports a silent exit under a real display as unrecognised', () => {
    expect(diagnoseStartupFailure({ exitCode: 1, stdout: '', stderr: '' }, ':99')).toEqual({
      kind: 'unrecognised',
      evidence: 'Forge exited 1 having printed nothing at all on stdout or stderr',
    });
  });

  it('leaves a failure that said something to the caller to report', () => {
    expect(
      diagnoseStartupFailure({ exitCode: 1, stdout: 'Simulation mode\n', stderr: 'boom' }, undefined),
    ).toBeNull();
    expect(diagnoseStartupFailure({ exitCode: 0, stdout: '', stderr: '' }, undefined)).toBeNull();
  });
});

describe('describeStartupFailure', () => {
  it('names the display and quotes the signature that proved it', () => {
    const reason = describeStartupFailure({
      kind: 'no-display',
      evidence: 'Authorization required, but no authorization protocol specified',
    });
    expect(reason).toContain('DISPLAY');
    expect(reason).toContain('Signature matched: Authorization required');
    expect(reason).toContain('not a verdict on the cards');
  });

  /**
   * The honesty property, asserted rather than trusted: an unrecognised failure
   * must not smuggle in the display diagnosis it never observed.
   */
  it('says it cannot say why, and claims no cause it did not observe', () => {
    const reason = describeStartupFailure({
      kind: 'unrecognised',
      evidence: 'Forge exited 1 having printed nothing at all on stdout or stderr',
    });
    expect(reason).toContain('cannot say why');
    expect(reason).toContain('printed nothing at all on stdout or stderr');
    expect(reason).not.toContain('DISPLAY');
    expect(reason).not.toContain('X server');
    expect(reason).not.toContain('Swing');
  });

  /**
   * The reason this kind was split off the unrecognised one: the report has to
   * hand back a command that works, because the run that prompted it printed
   * nothing to search for. `xvfb-run -a` is that command, and it is how this
   * gate's passing runs are made.
   */
  it('hands back the command that makes a screenless run work', () => {
    const reason = describeStartupFailure({
      kind: 'silent-without-display',
      evidence: 'Forge exited 1 having printed nothing at all on stdout or stderr',
    });
    expect(reason).toContain('DISPLAY');
    expect(reason).toContain('xvfb-run -a');
    expect(reason).toContain('printed nothing at all on stdout or stderr');
    expect(reason).toContain('not a verdict on the cards');
  });
});

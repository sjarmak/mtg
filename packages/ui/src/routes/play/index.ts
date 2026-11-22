export type { SeatNames } from './position';
export { boardPosition, describeTarget, nameOf } from './position';

export type { PlayChoice, PlayPrompt } from './prompt';
export { buildPrompt, describeStep, playableFromHand } from './prompt';

export type { PlayViewProps } from './PlayView';
export { LEGAL_MOVES_LABEL, PASS_LABEL, PlayView, UNDO_LABEL } from './PlayView';

export type { LiveGameProps } from './LiveGame';
export { LiveGame } from './LiveGame';

export type { RemoteGameProps } from './RemoteGame';
export { CONNECTING_LABEL, RemoteGame } from './RemoteGame';

export { WAITING_LABEL } from './rail';

export type { DealOptions, DealtGame } from './deal';
// \`dealMirrorGame\` is deliberately not re-exported here or from the package
// root: it deals from a raw card pool with no deck built at all, which is a
// fixture shape rather than a surface's. See its docblock in \`./deal.ts\`.
export { dealSealedGame } from './deal';

export type { SealedBuild } from './sealed';
export {
  chosenCards,
  clearSelection,
  deckFor,
  openSealed,
  resuggest,
  suggestSelection,
  toggle,
} from './sealed';

export type { SealedBuilderProps } from './SealedBuilder';
export { SEALED_POOL_LABEL, SealedBuilder } from './SealedBuilder';

export type { SealedGameProps } from './SealedGame';
export { SealedGame } from './SealedGame';

export type { PlayConfig, PlaySessionHandle } from './use-session';
export { usePlaySession } from './use-session';

export type { BackendGameProps } from './BackendGame';
export {
  BackendGame,
  CLOSED_SESSION_LABEL,
  CLOSE_GAME_LABEL,
  OPENING_SESSION_LABEL,
  SUBMITTING_MOVE_LABEL,
} from './BackendGame';

export type { PlaySessionController, PlaySessionControllerState } from './session-controller';
export { createPlaySessionController } from './session-controller';

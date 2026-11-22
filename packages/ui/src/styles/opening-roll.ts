export const OPENING_ROLL_CSS = `
.mtg-opening-roll {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mtg-space-4);
  padding: var(--mtg-space-5) var(--mtg-space-4);
  background: color-mix(in srgb, var(--mtg-surface-page) 82%, transparent);
  backdrop-filter: blur(6px);
}
.mtg-opening-roll__title { margin: 0; font-size: var(--mtg-text-lg); color: var(--mtg-ink); }
.mtg-opening-roll__table {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mtg-space-5);
  width: 100%;
}
.mtg-opening-roll__seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mtg-space-2);
}
.mtg-opening-roll__name { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-opening-roll__sentence { margin: 0; font-size: var(--mtg-text-base); color: var(--mtg-ink); text-align: center; }
.mtg-opening-roll__actions { display: flex; gap: var(--mtg-space-3); }
.mtg-opening-roll[data-phase='rolling'],
.mtg-opening-roll[data-phase='rearm'] { cursor: pointer; }

.mtg-d20-stage {
  position: relative;
  width: calc(var(--mtg-d20-edge) * 1.6);
  height: calc(var(--mtg-d20-edge) * 1.6);
  perspective: calc(var(--mtg-d20-edge) * 7);
}
.mtg-d20__glow {
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  background: var(--mtg-d20-glow);
  filter: blur(calc(var(--mtg-d20-edge) * 0.12));
  pointer-events: none;
}
.mtg-d20-stage[data-tint='purple'] {
  --mtg-d20-fill: var(--mtg-d20-purple);
  --mtg-d20-edge-ink: var(--mtg-d20-purple-edge);
  --mtg-d20-glow: var(--mtg-d20-purple-glow);
}
.mtg-d20-stage[data-tint='pink'] {
  --mtg-d20-fill: var(--mtg-d20-pink);
  --mtg-d20-edge-ink: var(--mtg-d20-pink-edge);
  --mtg-d20-glow: var(--mtg-d20-pink-glow);
}
.mtg-d20__spin {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}
.mtg-d20-stage[data-phase='rolling'] .mtg-d20__spin {
  transition: transform 1800ms cubic-bezier(0.16, 0.84, 0.3, 1);
}
.mtg-d20 {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}
.mtg-d20__face {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--mtg-d20-edge);
  height: calc(var(--mtg-d20-edge) * 0.86603);
  margin: calc(var(--mtg-d20-edge) * -0.57735) 0 0 calc(var(--mtg-d20-edge) * -0.5);
  transform-origin: 50% 66.667%;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  background:
    linear-gradient(160deg, var(--mtg-d20-sheen), transparent 55%),
    var(--mtg-d20-fill);
  box-shadow: inset 0 0 0 2px var(--mtg-d20-edge-ink);
  backface-visibility: hidden;
}
.mtg-d20__pip {
  position: absolute;
  left: 50%;
  top: 66.667%;
  transform: translate(-50%, -50%);
  font-family: var(--mtg-font-mono);
  font-weight: 700;
  font-size: calc(var(--mtg-d20-edge) * 0.26);
  line-height: 1;
  color: var(--mtg-d20-pip);
  text-shadow: 0 0 6px var(--mtg-d20-pip-shadow);
}
.mtg-d20__sparkle {
  position: absolute;
  inset: -12%;
  pointer-events: none;
  background-image:
    radial-gradient(circle, var(--mtg-d20-spark) 0 1.5px, transparent 2.5px),
    radial-gradient(circle, var(--mtg-d20-edge-ink) 0 1px, transparent 2px),
    radial-gradient(circle, var(--mtg-d20-spark) 0 1px, transparent 2px);
  background-size: 37px 41px, 53px 47px, 29px 59px;
  background-position: 3px 7px, 19px 29px, 11px 2px;
  opacity: 0.55;
  animation: mtg-d20-sparkle 1.6s ease-in-out infinite alternate;
}
.mtg-d20-stage[data-phase='rolling'] .mtg-d20__sparkle { animation-duration: 0.45s; opacity: 0.9; }
@keyframes mtg-d20-sparkle {
  from { opacity: 0.35; transform: scale(0.97) rotate(0deg); }
  to { opacity: 0.9; transform: scale(1.03) rotate(3deg); }
}
@media (prefers-reduced-motion: reduce) {
  .mtg-d20__sparkle { animation-name: none; }
}
@media (min-width: 720px) {
  .mtg-opening-roll__table { flex-direction: row; justify-content: center; gap: var(--mtg-space-6); }
  .mtg-opening-roll__seat[data-seat='viewer'] { flex-direction: column-reverse; }
}
`;

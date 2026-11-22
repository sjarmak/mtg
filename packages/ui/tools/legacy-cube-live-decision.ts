interface LegalMoveGroup {
  querySelector(selector: string): unknown;
}

interface ContinueControl {
  readonly disabled: boolean;
  click(): void;
}

interface Decision<TGroup extends LegalMoveGroup> {
  readonly kind: 'moves' | 'continue';
  readonly value: TGroup | ContinueControl;
}

type WaitFor = <T>(description: string, predicate: () => T | null, milliseconds: number) => Promise<T>;

export async function waitForLegacyCubeDecision<TGroup extends LegalMoveGroup>(
  waitFor: WaitFor,
  legalMoves: () => TGroup | null,
  continueControl: () => ContinueControl | undefined,
  description: string,
  milliseconds: number,
): Promise<TGroup> {
  while (true) {
    const decision = await waitFor<Decision<TGroup>>(
      description,
      () => {
        const group = legalMoves();
        if (group !== null && group.querySelector('button:not(:disabled)') !== null) {
          return { kind: 'moves', value: group };
        }
        const control = continueControl();
        return control !== undefined && !control.disabled ? { kind: 'continue', value: control } : null;
      },
      milliseconds,
    );
    if (decision.kind === 'moves') return decision.value as TGroup;
    (decision.value as ContinueControl).click();
  }
}

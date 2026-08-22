/** Anything that stops a draft before it starts, or during it. */
export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftError';
  }
}

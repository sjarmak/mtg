export function withoutBridgeIdentifiers(text: string, identifiers: readonly string[]): string {
  if (!text.includes(' [')) return text;
  return identifiers.reduce((held, identifier) => held.split(` [${identifier}]`).join(''), text);
}

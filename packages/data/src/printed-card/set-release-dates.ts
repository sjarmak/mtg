import type Database from 'better-sqlite3';

export interface SetReleaseDates {
  readonly schemaVersion: 1;
  readonly releaseDates: Readonly<Record<string, string | null>>;
}

const EARLIEST_PRINTING = `
  SELECT MIN(released_at) AS released_at
  FROM printing
  WHERE set_code = ? COLLATE NOCASE AND released_at IS NOT NULL
`;

export function readSetReleaseDates(
  database: Database.Database,
  setCodes: readonly string[],
): SetReleaseDates {
  const statement = database.prepare(EARLIEST_PRINTING);
  const releaseDates = Object.fromEntries(
    setCodes.map((code) => {
      const row = statement.get(code) as { readonly released_at: string | null };
      return [code.toUpperCase(), row.released_at];
    }),
  );
  return { schemaVersion: 1, releaseDates };
}

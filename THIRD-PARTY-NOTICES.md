# Third-party notices

Direct npm dependencies, with the license each declares. Transitive
dependencies are resolved by `package-lock.json`; every one of the 302 packages
in the installed tree at the time this file was written declares a permissive
license, and none declares GPL, LGPL, AGPL or any other copyleft term.

## Runtime

| Package             | Version | License |
| ------------------- | ------- | ------- |
| `zod`               | ^4.1.12 | MIT     |
| `@anthropic-ai/sdk` | ^0.71.0 | MIT     |
| `better-sqlite3`    | ^12.4.1 | MIT     |

`zod` is the only one of these the engine packages reach. `@anthropic-ai/sdk`
is used by one provider inside `@mtg/llm` and is never imported from feature
code. `better-sqlite3` is used by `@mtg/data` for the local card store and is
deliberately unreachable from anything a browser bundles.

## Browser bundle

The lab's bundle reduces to three packages, all MIT:

| Package     | Version | License |
| ----------- | ------- | ------- |
| `react`     | ^19.2.8 | MIT     |
| `react-dom` | ^19.2.8 | MIT     |
| `zod`       | ^4.1.12 | MIT     |

## Development

| Package                       | Version  | License    |
| ----------------------------- | -------- | ---------- |
| `@eslint/js`                  | ^9.39.1  | MIT        |
| `@testing-library/react`      | ^16.3.2  | MIT        |
| `@testing-library/user-event` | ^14.6.3  | MIT        |
| `@types/better-sqlite3`       | ^7.6.13  | MIT        |
| `@types/node`                 | ^22.19.0 | MIT        |
| `@types/react`                | ^19.2.18 | MIT        |
| `@types/react-dom`            | ^19.2.4  | MIT        |
| `@vitejs/plugin-react`        | ^5.2.0   | MIT        |
| `eslint`                      | ^9.39.1  | MIT        |
| `jsdom`                       | ^30.0.1  | MIT        |
| `prettier`                    | ^3.6.2   | MIT        |
| `tsx`                         | ^4.20.6  | MIT        |
| `typescript`                  | ^5.9.3   | Apache-2.0 |
| `typescript-eslint`           | ^8.46.0  | MIT        |
| `vite`                        | ^7.3.6   | MIT        |
| `vitest`                      | ^3.2.4   | MIT        |

## Not dependencies

Forge, XMage, Argentum and Draftmancer are named in `NOTICE`. None of them is
an npm dependency and none of their source is present in this tree. Forge in
particular is GPL-3.0 and is only ever downloaded at run time and driven as a
subprocess.

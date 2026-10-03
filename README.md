# Experience Playground

A two-pane workspace where designers pick a VDS experience, prompt an agent to
change it, and see the result rendered from A2UI JSON, including its impact on
the real pages where it appears.

Full plan: [docs/PLAN.md](docs/PLAN.md). Read [CLAUDE.md](CLAUDE.md) before any task.

## Setup

```sh
npm install
```

`@shadab5114/*` packages are on GitHub Packages, not the public npm registry.
If install fails with a 404/401, add a GitHub PAT (`read:packages` scope) to
your global `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=<token>
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Typecheck + production build |
| `npm run lint` | oxlint |
| `npm test` | Vitest (unit/component tests) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run e2e` | Playwright, against the system-installed Chrome (see note below) |

### Playwright and browser binaries

`playwright.config.ts` points the `chromium` project at the system-installed
Chrome (`channel: 'chrome'`) rather than Playwright's own downloaded binary,
since `npx playwright install` needs network access to `cdn.playwright.dev`
that may not be available in every environment. If Chrome isn't installed
locally, run `npx playwright install chromium` once and drop the `channel`
option from the config.

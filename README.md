# Modumunje public source

Application source for a study and practice service, including the frontend, login and session handling, administrator authorization, grading logic, and database schema.

This source distribution excludes the production question bank, answers, explanations, private diagrams, learner records, operational configuration, and internal documents. The fixtures are small, newly authored English examples for development and tests. They are not exam preparation material. A build does not contain the production learning catalogue.

## Local checks

Use Node.js 22.13 or newer and npm:

```sh
node scripts/check-public-boundary.mjs
npm ci
npm run lint
npm run check:types
npm run check:backend
npm run verify:migrations
npm run test:synthetic
npm run build
```

The source includes the SKCT learning entry and setup screens, safe answer-selection state handling, bounded catalog motion, and response timing instrumentation. Production cache headers depend on the hosting platform; this repository does not change a live deployment.

Run `npm run dev` for a local development server. Authentication requires your own OAuth configuration; use `.env.example` as the starting point. No production credentials or data are supplied. The public build has no live D1/R2 bindings; full sign-in and persisted learning require separately provisioned storage bindings and data. Grading examples and static-asset boundaries are tested with synthetic fixtures; migration checks use an in-memory SQLite database. Existing tests requiring private fixtures are outside public CI. Contact email addresses are neutral placeholders.

CI uses standard GitHub runners without repository secrets. Dependency updates are configured in `.github/dependabot.yml`; executable workflows are `ci.yml` and `security.yml`. The content scan reports every raw Hangul/answer-key match and accepts only individually reviewed source-code false positives with an exact file hash. Changes to those files require renewed review.

## Contribution boundary

Do not add real questions, answers, learner data, environment files, database exports, internal reports, or deployment credentials. Run `npm run verify:public` before committing. The first public commit contains no private repository history. GitHub Actions uses read-only permissions and needs no repository secrets.

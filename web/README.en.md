# PM Canvas 0.21.0

English · [한국어](README.md)

A self-hosted team workspace for tasks, WBS, Gantt schedules and completion records. Node.js 22.18+, PostgreSQL 18 and Docker Compose are required. The frontend uses native JavaScript modules without a build step.

## Install

```sh
npm ci --ignore-scripts
npm run setup -- --email admin@example.com
npm run service:up
```

The default URL is http://localhost:3000/pmcanvas/. The initial password is generated in the private `.env` file. The first administrator sign-in requires MFA enrollment. Use HTTPS and configure trusted reverse proxies for public deployments. See [deployment instructions](docs/DEPLOYMENT.md).

## Daily use

1. Create a project and add team members.
2. Enter task names, assignees, dates and effort in **Tasks · Schedule**. Use Tab, Enter, Ctrl+S, copy/paste or the Gantt chart.
3. Share access and explicitly link accounts to team members for **My work**.
4. Check work when it is actually complete. Progress is weighted by estimated effort.

Choose English or Korean on the sign-in screen or in the header. The choice is saved in this browser. Unsaved work and open dialogs block language changes. User-entered names, notes and roles are preserved. CSV and Excel headers follow the chosen language. Authentication emails include English guidance.

Concurrent changes are compared against the last loaded version. Independent changes are combined; conflicting fields require an explicit choice. Applying choices updates a draft for review before saving. Server permissions, validation and revision checks remain authoritative.

## Operations

Administrator settings contain users, email, authentication/security and backups. Under **Authentication & security → Operations status**, configure failure alerts for backup, restore verification and email delivery. Alerts are disabled until configured. Blank recipients use active administrators; custom recipient lists support up to ten addresses. Incidents are grouped by type, delivered at most hourly and attempted up to three times. SMTP failures may also prevent alert delivery, so check the in-app status. Acknowledging a count preserves later failures.

Mail failure details distinguish connection, TLS, authentication, recipient and other failures. Clear permanent recipient address/mailbox rejections are recorded without triggering operational email alerts. Policy, temporary and ambiguous failures still alert. Earlier failures are not reclassified. SMTP responses, recipient addresses and credentials are excluded from these diagnostic records.

Back up the database before upgrades. Keep the DB dumps and encryption key in separate external locations. JSON export moves individual projects; it does not restore all accounts, permissions or history.

JSON backups also preserve uncommitted WBS input. Importing restores that input as an editable draft; review and correct it before saving. The original project is preserved. If creating the imported project fails, the draft remains available for retry or another JSON backup.

## Verification

```sh
npm run format:check
npm run public:check
npm test
npx playwright install chromium --only-shell
npm run test:browser
npm run test:performance
```

Linux browser setup may require `npx playwright install --with-deps chromium --only-shell`. The browser suite starts its own memory store and loopback TLS mailbox on ports 4193/4192, with no production accounts, DB or external email. CI also runs HTTP/SMTP, dedicated PostgreSQL, dependency audit, backup/restore verification and CodeQL. A separate recovery rehearsal dumps and restores synthetic data, then verifies login, MFA, encrypted SMTP settings with actual TLS delivery, task completion records, shared permissions and invalidated old authentication. See [development notes](CONTRIBUTING.md).

Use reserved example domains in public documentation and configuration examples. After committing changes, run `npm run release` to build and inspect a public ZIP in `releases/`. Private environment files, live authentication/mail settings, keys and dumps are excluded. See [public file checks](docs/PUBLIC-FILES.md).

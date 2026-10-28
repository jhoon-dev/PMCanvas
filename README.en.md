# PM Canvas

The repository separates two products and their shared source.

| Directory                     | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| [web/](web/README.en.md)      | Self-hosted Node.js and PostgreSQL web application |
| [desktop/](desktop/README.md) | Offline Windows and macOS application              |
| [shared/](shared/README.md)   | Shared calculations, validation, and reusable UI   |
| .github/                      | Product-specific CI and desktop packaging          |

Install dependencies inside each product. The root package only forwards development commands. Existing web configuration, keys, backups, documentation and operational scripts now live under `web/`. Run web administration commands there. The Compose project keeps the existing default name `pmcanvas`.

See the product READMEs for development, testing and packaging. Windows checks cover current-user 0.2.0 installation, removal and reinstallation, plus file save/restart and CSV/XLSX workflows in the installed executable. Release signing and macOS execution remain unverified. Existing web installations should follow the [data-preserving upgrade instructions](web/docs/DEPLOYMENT.md).

# Third-party license register

Production dependencies are checked on every CI run by [`tools/license-check.mjs`](../../tools/license-check.mjs)
(allowlist: MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense, BlueOak-1.0.0, PSF-2.0, CC0-1.0).
A CycloneDX SBOM is produced by CI for every commit. GPL/AGPL/SSPL/BUSL/non-commercial licenses are forbidden.

## Reviewed exceptions

| Package                  | License                                        | Use                                                          | Assessment                                                                                             |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `mariadb`                | LGPL-2.1-or-later                              | MySQL wire-protocol driver used by `@prisma/adapter-mariadb` | Used unmodified as a library; JavaScript source is distributed as-is, satisfying relinking. Permitted. |
| `@img/sharp-*` (libvips) | Apache-2.0 AND LGPL-3.0-or-later               | Next.js image optimisation                                   | Dynamically linked, unmodified. Permitted.                                                             |
| `caniuse-lite`           | CC-BY-4.0                                      | Browser-support data used at build time                      | Attribution: “Data from caniuse.com by Alexis Deveria, CC BY 4.0.”                                     |
| `elkjs`                  | EPL-2.0                                        | Graph layout inside Prisma Studio (Prisma CLI)               | Development/deploy tool only; not linked into application runtime.                                     |
| `busboy`, `streamsearch` | MIT (LICENSE file; `package.json` omits field) | Multipart parsing (Express/multer)                           | Permitted.                                                                                             |

## Fonts and assets

Geist and Geist Mono — SIL Open Font License 1.1, served via `next/font` (self-hosted at build time).
Lucide icons — ISC. The Neural Frontier logo and illustrations are original work.

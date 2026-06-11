# Contributing to paperclip-adapter-hermes-gateway

Thanks for considering a contribution! Bug reports, feature requests and pull requests are all welcome.

## Reporting bugs

Please open an [issue](https://github.com/felipefontoura/paperclip-adapter-hermes-gateway/issues/new/choose) using the **Bug report** template. Include the smallest reproduction you can and the versions of Paperclip, Hermes Agent and this package.

## Asking for a feature

Use the **Feature request** template. Describe the use case before the implementation: knowing the *why* makes it much easier to design something that fits.

## Submitting code

1. Fork the repository and create a topic branch off `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. Install dependencies and verify the project compiles:
   ```bash
   pnpm install
   pnpm typecheck
   pnpm build
   ```
3. Make your change with a [Conventional Commits](https://www.conventionalcommits.org/) message (e.g. `feat: add streaming support`, `fix: handle 304 Not Modified`).
4. Open a pull request and fill in the PR template.

For non-trivial work, please open an issue first so we can agree on the design before you start coding.

## Code style

- TypeScript `strict` is on; please keep it that way.
- Two-space indentation, LF line endings (enforced by `.editorconfig` and `.gitattributes`).
- Don't introduce new runtime dependencies unless they're clearly necessary; lockfile changes require justification in the PR description.

## Releasing (maintainer notes)

Releases are tag-driven: pushing a `v0.x.y` tag triggers the `release` workflow which publishes the package to npm and (where applicable) the container image to GitHub Container Registry.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to abide by it.

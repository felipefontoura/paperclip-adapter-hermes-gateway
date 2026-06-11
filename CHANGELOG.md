# Changelog

## 0.1.3 — 2026-06-11

- **feat**: wrap each instruction tier in a labeled `<<< BEGIN <file> — <role> (loaded from <path>) >>>` / `<<< END <file> >>>` delimiter so the model can tell SOUL identity claims apart from TOOLS examples in the same system message. Mirrors how the upstream `opencode-local` adapter trails loaded instructions with "The above agent instructions were loaded from <path>", just done as a wrap-around marker so the order signal stays adjacent to each block.


## 0.1.2 — 2026-06-11

- **feat**: read all four Hermes Agent identity tiers — `SOUL.md`, `AGENTS.md`,
  `HEARTBEAT.md`, `TOOLS.md` — from the agent's `instructions/` directory and
  concatenate them, in that order, into the system message. Mirrors the
  layered bundle the local `hermes` CLI used to read off disk so an operator
  who already maintains those four files keeps the same identity behaviour
  when routed through the HTTP gateway. Files that don't exist or are empty
  are skipped silently. The existing `adapterConfig.instructionsFilePath`
  override (single-file mode) and a non-default
  `adapterConfig.instructionsEntryFile` both still resolve to a single file
  — tier concatenation only triggers on the default `"AGENTS.md"` entry.



## 0.1.1 — 2026-06-11

- **fix**: respect the agent's `adapterConfig.paperclipSkillSync.desiredSkills`
  when building the skills catalog injected into Hermes' system prompt.
  Previously the adapter pasted every skill the bridge knew about — for an
  operator with a populated company library (10+ skills, each with multiple
  reference files) that meant ~10-14k extra prompt tokens on every wake,
  even when the agent had a single skill enabled. The catalog now filters
  by namespace-suffix match before serializing.


All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-11

Initial release.

### Added
- Paperclip external adapter type `hermes_gateway`, installable via `POST /api/adapters/install` or the Paperclip UI's "Install Adapter" dialog (npm package name `@felipefontoura/paperclip-adapter-hermes-gateway`).
- Sends OpenAI-compatible chat completions to a Hermes Agent API server (`POST /v1/chat/completions`) on every wake; passes the agent's AGENTS.md bundle as the system message.
- Discovers Paperclip skills at wake time via the companion bridge and lists each file URL in the system prompt (progressive disclosure).
- Auto-discovery of the Paperclip `companyId` — operators never have to copy or paste the UUID; the adapter injects `/companies/<id>` into the bridge URL automatically.
- Three-tier configuration: top-level `adapterConfig.<key>` (API PATCH) → `adapterConfig.env.<KEY>` (UI Environment Variables) → `process.env.<KEY>` (container-level).
- SSRF guard rejecting `file://`, loopback, RFC1918, link-local, cloud-metadata, and cluster-internal targets before any bearer is sent.
- Canonical `AdapterExecutionResult` shape (`signal: null`, `timedOut`, `provider`, normalized `usage`) so the Paperclip agent state transitions cleanly to `idle` on success.
- Sanitized error bodies (token-shaped substrings redacted, truncated to 200 chars) before they are logged or surfaced.
- `agentConfigurationSchema` exported for future Paperclip UI builds that render adapter-specific fields.

### Documentation
- User-focused README with install via the Paperclip UI, configuration via Environment Variables, and a small troubleshooting note for finding the company UUID.
- Hardening audit in `docs/AUDIT-v0.1.0.md` covering every blocker and high-severity item closed before publish.

[Unreleased]: https://github.com/felipefontoura/paperclip-adapter-hermes-gateway/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/felipefontoura/paperclip-adapter-hermes-gateway/releases/tag/v0.1.0

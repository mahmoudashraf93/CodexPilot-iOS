# ShipPilot Full Project Plan

ShipPilot is an SDK-first agentic mobile QA runner. Teams write Markdown QA cases, configure an iOS project, an Android project, or both, choose a Codex auth mode, and run the tool from GitHub Actions, Bitrise, or local CI. Codex drives the app through an iOS simulator or Android emulator, verifies expected outcomes, captures screenshot evidence when available, writes reports, and fails CI when a case fails.

## Core Design

- TypeScript/Node CLI published as `shippilot`.
- Product name: ShipPilot.
- GitHub repo: `mahmoudashraf93/ShipPilot`.
- Primary engine: `@openai/codex-sdk`.
- iOS automation backend: XcodeBuildMCP CLI.
- Android automation backend: Android SDK `adb` with the project Gradle wrapper or a prebuilt APK.
- v1 is test-and-report only: no edits, commits, patches, pushes, or PR creation.
- `codex app-server` is reserved for future advanced integrations.

## CLI

```bash
npx shippilot init
npx shippilot doctor
npx shippilot doctor --platform android
npx shippilot run --case qa/login.md
npx shippilot run --cases qa/ --platform android
npx shippilot run --cases qa/
npx shippilot report --run .shippilot/run.json
```

## Auth Modes

- `api_key`: uses `OPENAI_API_KEY`, recommended for hosted CI.
- `access_token`: uses `CODEX_ACCESS_TOKEN`, recommended for trusted Business/Enterprise automation.
- `chatgpt_hosted_experimental`: restores a pre-authenticated Codex home from `CODEX_HOME_TGZ_BASE64`; fragile and not recommended for fork PRs.

## CI Semantics

- `passed` exits `0`.
- `failed` exits `1`.
- setup/auth/config/device errors exit `2`.
- `blocked` exits `3`.

`codex.fail_on: never` enables report-only mode.

`codex.verbose: true` or `shippilot run --verbose` streams build output and Codex SDK events for CI debugging. It shows reasoning summaries and tool activity, not private chain-of-thought.

For device UI automation, ShipPilot keeps Codex in `workspace-write` by default and exposes simulator or emulator actions through a ShipPilot-controlled MCP bridge. The parent ShipPilot process still communicates with XcodeBuildMCP/CoreSimulator or `adb` for setup and the allowlisted bridge tools.

## Milestones

1. Create public repo and initial docs.
2. Scaffold TypeScript CLI.
3. Implement config and QA case parsing.
4. Implement auth validation and redaction.
5. Implement XcodeBuildMCP doctor checks.
6. Implement Codex SDK execution.
7. Implement reports and exit codes.
8. Add GitHub Actions and Bitrise examples.
9. Add sample iOS app and smoke cases.
10. Publish initial npm package as `shippilot`.
11. Add Android emulator QA support with platform-aware cases and reports.

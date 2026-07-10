<p align="center">
  <img src="https://raw.githubusercontent.com/mahmoudashraf93/ShipPilot/main/assets/shippilot-icon.png" alt="ShipPilot icon" width="180">
</p>

# ShipPilot

[![CI](https://github.com/mahmoudashraf93/ShipPilot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mahmoudashraf93/ShipPilot/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shippilot.svg)](https://www.npmjs.com/package/shippilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ShipPilot is an open-source agentic QA runner for iOS and Android apps. Teams write Markdown QA cases, run them from GitHub Actions, Bitrise, or local CI, and fail the pipeline when Codex cannot verify expected app behavior.

ShipPilot is intentionally test-and-report only. It does not edit source files, create patches, commit, push, or open pull requests.

## Quick Start

Prerequisites:

- For iOS: macOS with Xcode and the target simulator installed.
- For Android: the Android SDK with `adb`, a booted emulator, and either a Gradle wrapper or a prebuilt APK.
- Node.js 20+.
- One supported Codex auth mode.

```bash
npx shippilot init
npx shippilot doctor --platform ios
npx shippilot run --case qa/login.md --platform ios --verbose
```

## Usage Guide

ShipPilot reads `shippilot.yml` by default.

```yaml
codex:
  engine: sdk
  auth: api_key # api_key | access_token | chatgpt_hosted_experimental
  model: default
  sandbox: workspace-write
  fail_on: failed_or_blocked
  verbose: false
  allow_experimental_personal_hosted_auth: false

ios:
  project: MyApp.xcodeproj
  bundle_id:
  scheme: MyApp
  simulator: iPhone 17 Pro
  backend: xcodebuildmcp
  configuration: Debug

# Configure android instead of ios, or configure both.
# android:
#   project: .
#   gradle_task: :app:assembleDebug
#   apk_path:
#   package_id: com.example.myapp
#   emulator: emulator-5554
#   backend: adb
#   launch_activity: .MainActivity

reports:
  output_dir: .shippilot
  markdown: true
  json: true
  junit: true
  screenshots: true
```

Configure at least one platform. For iOS, use either `ios.project` or `ios.workspace`, not both. Add `ios.bundle_id` when available; it avoids a separate bundle-id discovery step during CI. See the [Android guide](docs/android.md) for APK discovery, emulator selection, and CI requirements.

### QA Cases

QA cases are Markdown files with YAML front matter:

```md
---
id: login-happy-path
title: Login happy path
required_env:
  - TEST_EMAIL
  - TEST_PASSWORD
tags:
  - release
  - smoke
platforms:
  - ios
  - android
---

Launch the app.
Dismiss onboarding, permission prompts, or paywalls if they appear.
Enter `${TEST_EMAIL}` and `${TEST_PASSWORD}`.
Tap Log In.
Expect the Home screen to be visible.
```

Environment placeholders are resolved at runtime and redacted from prompts, verbose output, and text reports. Screenshot evidence can still contain values that the app renders visibly. Declare every secret placeholder in `required_env`; missing required variables fail setup before the agent runs.

`platforms` is optional. Without it, a case runs on every selected configured platform. Use `platforms: [ios]` or `platforms: [android]` for platform-specific cases.

### Running Cases

```bash
npx shippilot doctor
npx shippilot doctor --platform android
npx shippilot run --case qa/login.md
npx shippilot run --case qa/login.md --platform android
npx shippilot run --cases qa/
```

Use verbose mode while developing or debugging CI:

```bash
npx shippilot run --case qa/login.md --verbose
```

`--platform` accepts `ios`, `android`, or `all` (the default). With both platforms configured, unscoped cases run once per platform.

Verbose mode streams platform setup output and Codex SDK events, including progress, tool calls, command executions, reasoning summaries, errors, and token usage. It does not expose private model chain-of-thought.

## Auth Modes

Choose one auth mode:

- `api_key`: uses `OPENAI_API_KEY`. Recommended for hosted CI and open-source projects.
- `access_token`: uses `CODEX_ACCESS_TOKEN`. Recommended for trusted Business/Enterprise automation.
- `chatgpt_hosted_experimental`: restores a pre-authenticated Codex home from `CODEX_HOME_TGZ_BASE64`. This is only for experimental personal ChatGPT subscription use on trusted runners.

The personal ChatGPT hosted-runner path is sensitive and fragile. Do not cache or upload restored auth directories, and do not run it on arbitrary fork PRs.

## Device Access And Security

For simulator and emulator UI automation, use:

```yaml
codex:
  sandbox: workspace-write
```

ShipPilot keeps Codex in a workspace sandbox and exposes device UI automation through a ShipPilot-controlled MCP bridge. The bridge only provides allowlisted QA tools such as snapshot, screenshot, tap, type, swipe, stop app, and app relaunch. Codex default shell tools are disabled during the QA turn, and the local bridge tools are auto-approved so CI can run non-interactively.

This reduces prompt-injection blast radius. QA case text, app UI text, screenshots, logs, and files are treated as untrusted inputs. During the QA turn, injected instructions cannot use normal Codex shell, git, filesystem, web search, dependency install, or network tools because those tools are not exposed. The device bridge binds the selected simulator or emulator and app id, and declared secret values are typed through `type_env` without printing them back to the agent.

These controls minimize impact, but they do not make untrusted UI or test text safe. The agent can still interact with the device, type into the app, and make a bad QA judgment if malicious UI misleads it. Use least-privilege test accounts and trusted CI triggers when secrets are present.

`danger-full-access` remains available as an explicit escape hatch, but ShipPilot prints a warning when it is configured.

Run ShipPilot only in trusted workflows when secrets are present. For open-source repositories, prefer `workflow_dispatch`, releases, schedules, or maintainer-approved workflows. ShipPilot blocks secret-backed GitHub fork PR runs by default; set `SHIPPILOT_ALLOW_UNTRUSTED_SECRETS=true` only after confirming the runner is trusted. Use `actions/checkout` with `persist-credentials: false`.

## GitHub Actions

Use a macOS runner for iOS. For Android, use a runner with the Android SDK and boot a hardware-accelerated emulator before invoking ShipPilot. The commands are otherwise the same; pass `--platform` when the config contains both platforms.

```yaml
name: ShipPilot QA

on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  shippilot:
    runs-on: macos-15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run ShipPilot
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: |
          npx shippilot doctor --platform ios
          npx shippilot run --case qa/login.md --platform ios --verbose

      - name: Upload ShipPilot report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shippilot-report
          path: .shippilot/
          include-hidden-files: true
```

## Bitrise

Use a macOS stack with Xcode for iOS, or an Android stack with `adb` and a booted emulator for Android, then add a Script Step:

```bash
#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor --platform android
shippilot run --case qa/login.md --platform android --verbose
```

Upload `.shippilot/` as build artifacts so failed QA runs still leave reports and screenshots.

## Reports And Exit Codes

Reports are written to `.shippilot/`:

```text
.shippilot/
  run.json
  report.md
  junit.xml
  screenshots/
```

ShipPilot exits like a test runner:

- `0`: all cases passed
- `1`: at least one case failed
- `2`: setup/auth/project/device/config error
- `3`: at least one case was blocked or inconclusive

Set `codex.fail_on: never` for report-only mode.

## Contribution Guide

Contributions should keep ShipPilot test-and-report focused. Avoid features that let the CI agent edit source, commit, push, or open PRs unless that behavior is explicitly designed behind a separate mode such as Wall of Apps submissions.

Before opening a PR:

```bash
npm run build
npm test
```

Useful areas to improve:

- config validation and clearer doctor checks
- QA case parsing and secret redaction
- report quality and artifact collection
- XcodeBuildMCP and Android `adb` integration robustness
- CI examples for common hosted runners

## Roadmap

- Add richer screenshot and log attachments to reports.
- Add sample app integration tests.
- Add Bitrise Step packaging.
- Add automatic Android emulator provisioning.

## Documentation

- [Full plan](docs/plan.md)
- [Android setup](docs/android.md)
- [Auth modes](docs/auth.md)
- [GitHub Actions](docs/github-actions.md)
- [Bitrise](docs/bitrise.md)
- [Release process](docs/release.md)
- [Personal ChatGPT subscription](docs/personal-chatgpt-subscription.md)
- [Security](docs/security.md)

## Wall of Apps

Apps using ShipPilot can be added to the Wall of Apps with a contributor pull request:

```bash
npx shippilot wall submit --app "1234567890" --dry-run
npx shippilot wall submit --app "1234567890" --confirm
```

The submit command resolves the public App Store name, URL, and icon automatically. It uses your authenticated `gh` session to fork ShipPilot, update `docs/wall-of-apps.json` and this README, and open a pull request.

<!-- shippilot-wall:start -->
<table>
  <tr>
    <td align="center" width="80"><a href="https://apps.apple.com/us/app/trainerskit-client-tracker/id6446181545?uo=4"><img src="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/31/93/47/319347cd-f815-b7cd-c091-02401dba4cd2/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/512x512bb.jpg" alt="TrainersKit: Client Tracker icon" title="TrainersKit: Client Tracker" width="64" height="64"></a></td>
  </tr>
</table>
<!-- shippilot-wall:end -->

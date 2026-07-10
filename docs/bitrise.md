# Bitrise

Add ShipPilot as a Script Step after dependency setup.

```bash
#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor --platform ios
shippilot run --case qa/login.md --platform ios
```

Requirements:

- For iOS, a macOS stack with Xcode. ShipPilot installs its bundled XcodeBuildMCP dependency; no separate XcodeBuildMCP step is needed.
- For Android, an Android stack with `adb` and a booted emulator. Run with `--platform android`.
- App project dependencies installed before the step runs.
- `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN` as Bitrise Secrets.
- App test credentials such as `TEST_EMAIL` and `TEST_PASSWORD`.

Upload `.shippilot/` as Bitrise artifacts so failed QA runs still leave evidence.

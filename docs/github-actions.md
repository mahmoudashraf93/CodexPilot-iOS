# GitHub Actions

Use a macOS runner for iOS because simulator testing requires Xcode. ShipPilot bundles XcodeBuildMCP through its npm dependencies, so workflows do not install it separately.

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
          npx shippilot run --case qa/login.md --platform ios

      - name: Upload ShipPilot report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shippilot-report
          path: .shippilot/
```

For open-source projects, prefer `workflow_dispatch`, releases, schedules, or maintainer-approved labels. ShipPilot blocks secret-backed GitHub fork PR runs by default; set `SHIPPILOT_ALLOW_UNTRUSTED_SECRETS=true` only after confirming the runner is trusted.

For Android, use a runner with the Android SDK and hardware acceleration, then provision and boot the emulator before the ShipPilot commands:

```yaml
- name: Run ShipPilot
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    adb devices
    npx shippilot doctor --platform android
    npx shippilot run --cases qa/ --platform android
```

The emulator setup is runner-specific and is intentionally separate from ShipPilot. See [Android setup](android.md) for configuration and APK discovery.

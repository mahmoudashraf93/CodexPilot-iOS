# Android

ShipPilot can build, install, launch, and test an Android app on an already-booted emulator. Android automation uses the Android SDK's `adb` command and a small ShipPilot-controlled device bridge.

## Prerequisites

- Node.js 20 or newer.
- The Android SDK with `adb` on `PATH`.
- One online emulator visible in `adb devices`.
- Either an executable Gradle wrapper in the Android project or a prebuilt APK.
- A supported Codex authentication mode.

ShipPilot selects an existing online emulator; it does not create or boot an Android Virtual Device. When more than one device is online, set `android.emulator` to an adb serial or a unique serial substring such as `emulator-5554` or `5554`.

## Configuration

Use an Android-only config:

```yaml
codex:
  auth: api_key
  sandbox: workspace-write
  fail_on: failed_or_blocked

android:
  project: .
  gradle_task: :app:assembleDebug
  package_id: com.example.myapp.debug
  emulator: emulator-5554
  backend: adb
  launch_activity: .MainActivity

reports:
  output_dir: .shippilot
  markdown: true
  json: true
  junit: true
  screenshots: true
```

Android fields:

- `project`: Android project directory relative to the directory where ShipPilot runs. Defaults to `.`.
- `gradle_task`: Gradle wrapper task used to build the APK. Defaults to `:app:assembleDebug`.
- `apk_path`: Optional prebuilt APK path, relative to the directory where ShipPilot runs. When present, ShipPilot skips the Gradle build.
- `package_id`: Required installed application id, including any build-variant suffix.
- `emulator`: Optional adb serial or unique serial substring. Without it, ShipPilot uses the first online device.
- `backend`: Must be `adb`.
- `launch_activity`: Optional activity or full component, for example `.MainActivity` or `com.example.myapp/.MainActivity`. Without it, ShipPilot launches the package through Android's `monkey` command.

After the default Gradle task, ShipPilot looks for an APK in `app/build/outputs/apk/debug`. Set `apk_path` for another module, build type, flavor, split APK layout, or externally built artifact.

## Run Android QA

Start the emulator and confirm that adb sees it:

```bash
adb devices
npx shippilot doctor --platform android
npx shippilot run --case qa/login.md --platform android
```

`doctor` verifies `adb`, the project, the Gradle wrapper or configured APK, and a matching online emulator.

## Multi-platform Projects

An app repository can configure both `ios` and `android`. The default platform is `all`, so a case without a `platforms` restriction runs once on each configured platform.

Restrict a case in its YAML front matter when the flow is platform-specific:

```md
---
id: android-deep-link
title: Open an Android deep link
platforms:
  - android
---

Open the app and verify the deep-link destination.
```

You can also select one platform for a run:

```bash
npx shippilot doctor --platform android
npx shippilot run --cases qa/ --platform android
```

JSON records include the platform, Markdown headings show it, and JUnit uses `ShipPilot.android` or `ShipPilot.ios` as the testcase classname.

## CI

Provision and boot the emulator before the ShipPilot step. The CI runner must provide hardware acceleration appropriate to its environment, the Android SDK, `adb`, and project dependencies. Upload `.shippilot/` even when the command fails so reports and screenshot evidence remain available.

ShipPilot does not install the Android SDK, accept SDK licenses, create an AVD, or wait for a CI-specific emulator action to finish.

## Limitations

- Android UI snapshots use `uiautomator`; custom-rendered views may expose limited accessibility data.
- Text entry uses Android's `input text` command and is best suited to ordinary test credentials and ASCII input.
- Split APK installation is not supported; provide a directly installable APK.

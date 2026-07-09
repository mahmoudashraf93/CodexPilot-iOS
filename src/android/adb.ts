import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ShipPilotConfig } from "../config/schema.js";
import { runCommand, type CheckResult } from "../ios/xcodebuildmcp.js";

export type AndroidDevice = {
  serial: string;
  state: string;
};

export function adbCommand(): string {
  return "adb";
}

export function gradleCommand(projectDir: string): string {
  return process.platform === "win32" ? path.join(projectDir, "gradlew.bat") : path.join(projectDir, "gradlew");
}

export function androidProjectDir(config: ShipPilotConfig, cwd = process.cwd()): string {
  if (!config.android) throw new Error("Android config is required.");
  return path.resolve(cwd, config.android.project);
}

export function androidLaunchComponent(packageId: string, launchActivity: string): string {
  return launchActivity.includes("/") ? launchActivity : `${packageId}/${launchActivity}`;
}

export function parseAdbDevices(output: string): AndroidDevice[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((device) => Boolean(device.serial && device.state));
}

export function selectAndroidDevice(devices: AndroidDevice[], requested?: string | null): AndroidDevice | null {
  const online = devices.filter((device) => device.state === "device");
  if (requested) {
    return (
      online.find((device) => device.serial === requested) ??
      online.find((device) => device.serial.includes(requested)) ??
      null
    );
  }
  return online[0] ?? null;
}

export function resolveApkPath(config: ShipPilotConfig, cwd = process.cwd()): string | null {
  if (!config.android) throw new Error("Android config is required.");
  if (config.android.apk_path) {
    const absolute = path.resolve(cwd, config.android.apk_path);
    return existsSync(absolute) ? absolute : null;
  }

  const projectDir = androidProjectDir(config, cwd);
  const outputDir = path.join(projectDir, "app", "build", "outputs", "apk", "debug");
  if (!existsSync(outputDir)) return null;

  const apk = readdirSync(outputDir)
    .filter((file) => file.endsWith(".apk"))
    .sort()
    .at(0);
  return apk ? path.join(outputDir, apk) : null;
}

export function doctorAndroid(config: ShipPilotConfig, cwd = process.cwd()): CheckResult[] {
  if (!config.android) return [];

  const projectDir = androidProjectDir(config, cwd);
  const gradlew = gradleCommand(projectDir);
  const checks: CheckResult[] = [
    runCommand(adbCommand(), ["version"], cwd, "adb"),
    {
      name: "Android project",
      ok: existsSync(projectDir),
      detail: projectDir,
    },
  ];

  if (!config.android.apk_path) {
    checks.push({
      name: "Gradle wrapper",
      ok: existsSync(gradlew),
      detail: gradlew,
    });
  } else {
    const apkPath = path.resolve(cwd, config.android.apk_path);
    checks.push({
      name: "Android APK",
      ok: existsSync(apkPath),
      detail: apkPath,
    });
  }

  const devicesResult = spawnSync(adbCommand(), ["devices"], { cwd, encoding: "utf8" });
  const devicesOutput = [devicesResult.stdout, devicesResult.stderr].filter(Boolean).join("\n").trim();
  const selectedDevice =
    devicesResult.status === 0
      ? selectAndroidDevice(parseAdbDevices(devicesResult.stdout ?? ""), config.android.emulator)
      : null;
  const missingDeviceDetail =
    devicesOutput ||
    devicesResult.error?.message ||
    (config.android.emulator
      ? `No online emulator matched ${config.android.emulator}.`
      : "No online Android emulator found.");
  checks.push({
    name: "Android emulator",
    ok: devicesResult.status === 0 && selectedDevice !== null,
    detail: selectedDevice?.serial ?? missingDeviceDetail,
  });
  return checks;
}

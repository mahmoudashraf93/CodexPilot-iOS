import { z } from "zod";

export const authModes = ["api_key", "access_token", "chatgpt_hosted_experimental"] as const;
export const failModes = ["failed_or_blocked", "never"] as const;
export const platforms = ["ios", "android"] as const;

const iosConfigSchema = z.object({
  project: z.string().optional().nullable(),
  workspace: z.string().optional().nullable(),
  scheme: z.string().min(1),
  bundle_id: z.string().optional().nullable(),
  simulator: z.string().default("iPhone 17 Pro"),
  backend: z.literal("xcodebuildmcp").default("xcodebuildmcp"),
  configuration: z.string().default("Debug"),
});

const androidConfigSchema = z.object({
  project: z.string().default("."),
  gradle_task: z.string().default(":app:assembleDebug"),
  apk_path: z.string().optional().nullable(),
  package_id: z.string().min(1),
  emulator: z.string().optional().nullable(),
  backend: z.literal("adb").default("adb"),
  launch_activity: z.string().optional().nullable(),
});

export const configSchema = z
  .object({
    codex: z
      .object({
        engine: z.literal("sdk").default("sdk"),
        auth: z.enum(authModes).default("api_key"),
        model: z.string().default("default"),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
        fail_on: z.enum(failModes).default("failed_or_blocked"),
        verbose: z.boolean().default(false),
        allow_experimental_personal_hosted_auth: z.boolean().default(false),
      })
      .default({
        engine: "sdk",
        auth: "api_key",
        model: "default",
        sandbox: "workspace-write",
        fail_on: "failed_or_blocked",
        verbose: false,
        allow_experimental_personal_hosted_auth: false,
      }),
    ios: iosConfigSchema.optional(),
    android: androidConfigSchema.optional(),
    reports: z
      .object({
        output_dir: z.string().default(".shippilot"),
        markdown: z.boolean().default(true),
        json: z.boolean().default(true),
        junit: z.boolean().default(true),
        screenshots: z.boolean().default(true),
      })
      .default({
        output_dir: ".shippilot",
        markdown: true,
        json: true,
        junit: true,
        screenshots: true,
      }),
  })
  .superRefine((value, context) => {
    if (!value.ios && !value.android) {
      context.addIssue({
        code: "custom",
        message: "Configure at least one platform: ios or android.",
        path: [],
      });
    }

    if (value.ios) {
      const hasProject = Boolean(value.ios.project);
      const hasWorkspace = Boolean(value.ios.workspace);
      if (hasProject === hasWorkspace) {
        context.addIssue({
          code: "custom",
          message: "Configure exactly one of ios.project or ios.workspace.",
          path: ["ios"],
        });
      }
    }

    if (
      value.codex.auth === "chatgpt_hosted_experimental" &&
      !value.codex.allow_experimental_personal_hosted_auth
    ) {
      context.addIssue({
        code: "custom",
        message:
          "chatgpt_hosted_experimental requires codex.allow_experimental_personal_hosted_auth: true.",
        path: ["codex", "allow_experimental_personal_hosted_auth"],
      });
    }
  });

export type ShipPilotConfig = z.infer<typeof configSchema>;
export type ShipPilotPlatform = (typeof platforms)[number];

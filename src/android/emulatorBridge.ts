import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z, type ZodRawShape } from "zod";
import type { Redactor } from "../security/redact.js";
import { androidLaunchComponent } from "./adb.js";

export const androidBridgeToolNames = [
  "snapshot_ui",
  "screenshot",
  "tap",
  "type_text",
  "type_env",
  "swipe",
  "stop_app",
  "launch_app",
] as const;

export type AndroidBridgeToolName = (typeof androidBridgeToolNames)[number];

export type AndroidBridgeContext = {
  adb: string;
  serial: string;
  packageId: string;
  launchActivity?: string | null;
  cwd: string;
  outputDir: string;
  envValues: Record<string, string>;
  redactor: Redactor;
  verbose: boolean;
};

export type AndroidBridge = {
  url: string;
  close: () => Promise<void>;
};

type ProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type UiNode = {
  text: string;
  contentDescription: string;
  resourceId: string;
  bounds: string;
};

const optionalDelayInputSchema = {
  preDelay: z.number().optional().describe("Seconds to wait before the action."),
  postDelay: z.number().optional().describe("Seconds to wait after the action."),
} satisfies ZodRawShape;

export const androidBridgeToolInputSchemas = {
  snapshot_ui: {},
  screenshot: {},
  tap: {
    label: z.string().optional().describe("Visible text or content description to tap."),
    id: z.string().optional().describe("Android resource id to tap."),
    x: z.number().optional().describe("Screen x coordinate. Must be provided together with y."),
    y: z.number().optional().describe("Screen y coordinate. Must be provided together with x."),
    ...optionalDelayInputSchema,
  },
  type_text: {
    text: z.string().min(1).describe("Non-secret text to type into the focused emulator input."),
  },
  type_env: {
    name: z.string().min(1).describe("Name of a QA case required_env variable to type without revealing its value."),
  },
  swipe: {
    x1: z.number().describe("Swipe start x coordinate."),
    y1: z.number().describe("Swipe start y coordinate."),
    x2: z.number().describe("Swipe end x coordinate."),
    y2: z.number().describe("Swipe end y coordinate."),
    duration: z.number().optional().describe("Swipe duration in milliseconds."),
    ...optionalDelayInputSchema,
  },
  stop_app: {},
  launch_app: {},
} satisfies Record<AndroidBridgeToolName, ZodRawShape>;

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name);
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function optionalFiniteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteNumber(value, name);
}

function delay(seconds?: number): Promise<void> {
  return seconds ? new Promise((resolve) => setTimeout(resolve, seconds * 1000)) : Promise.resolve();
}

export function encodeAndroidInputText(text: string): string {
  const encoded = text.replace(/\s/g, "%s");
  return `'${encoded.replace(/'/g, `'\\''`)}'`;
}

export function formatAndroidBridgeCommandForLog(command: string, args: string[]): string {
  const sanitizedArgs = [...args];
  const inputTextIndex = sanitizedArgs.findIndex(
    (arg, index) => arg === "shell" && sanitizedArgs[index + 1] === "input" && sanitizedArgs[index + 2] === "text",
  );
  if (inputTextIndex !== -1 && inputTextIndex + 3 < sanitizedArgs.length) {
    sanitizedArgs.splice(inputTextIndex + 3, sanitizedArgs.length - inputTextIndex - 3, "[REDACTED_INPUT]");
  }
  return [command, ...sanitizedArgs].join(" ");
}

function runBridgeProcess(command: string, args: string[], context: AndroidBridgeContext): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (context.verbose) {
      console.log(context.redactor.redact(`[shippilot:android-bridge] $ ${formatAndroidBridgeCommandForLog(command, args)}`));
    }

    const child = spawn(command, args, {
      cwd: context.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 60 * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

function combinedOutput(result: ProcessResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function adbArgs(context: AndroidBridgeContext, args: string[]): string[] {
  return ["-s", context.serial, ...args];
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(node: string, name: string): string {
  const match = node.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function parseUiNodes(xml: string): UiNode[] {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => ({
    text: attr(match[0], "text"),
    contentDescription: attr(match[0], "content-desc"),
    resourceId: attr(match[0], "resource-id"),
    bounds: attr(match[0], "bounds"),
  }));
}

function centerOfBounds(bounds: string): { x: number; y: number } | null {
  const match = bounds.match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/);
  if (!match) return null;
  const [, x1, y1, x2, y2] = match.map(Number);
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

async function dumpUiXml(context: AndroidBridgeContext): Promise<string> {
  const remotePath = "/sdcard/window_dump.xml";
  const dump = await runBridgeProcess(context.adb, adbArgs(context, ["shell", "uiautomator", "dump", remotePath]), context);
  if (dump.status !== 0) throw new Error(combinedOutput(dump) || "uiautomator dump failed.");

  const cat = await runBridgeProcess(context.adb, adbArgs(context, ["exec-out", "cat", remotePath]), context);
  if (cat.status !== 0) throw new Error(combinedOutput(cat) || "Could not read UIAutomator dump.");
  return cat.stdout;
}

function renderUiTree(xml: string): string {
  const nodes = parseUiNodes(xml).filter((node) => node.text || node.contentDescription || node.resourceId);
  return nodes
    .map((node) => {
      const parts = [
        node.text ? `text="${node.text}"` : "",
        node.contentDescription ? `contentDescription="${node.contentDescription}"` : "",
        node.resourceId ? `id="${node.resourceId}"` : "",
        node.bounds ? `bounds="${node.bounds}"` : "",
      ].filter(Boolean);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

function findTapTarget(xml: string, input: Record<string, unknown>): { x: number; y: number } {
  const label = optionalString(input.label, "label");
  const id = optionalString(input.id, "id");
  const hasCoordinates = input.x !== undefined || input.y !== undefined;
  const selectorCount = Number(Boolean(label)) + Number(Boolean(id)) + Number(hasCoordinates);
  if (selectorCount !== 1) throw new Error("tap requires exactly one selector: label, id, or x/y.");
  if (hasCoordinates) {
    return { x: requireFiniteNumber(input.x, "x"), y: requireFiniteNumber(input.y, "y") };
  }

  const nodes = parseUiNodes(xml);
  const node = label
    ? nodes.find((candidate) => candidate.text === label || candidate.contentDescription === label)
    : nodes.find((candidate) => candidate.resourceId === id || candidate.resourceId.endsWith(`/${id}`));
  if (!node) throw new Error(`No Android UI node matched ${label ? `label ${label}` : `id ${id}`}.`);

  const center = centerOfBounds(node.bounds);
  if (!center) throw new Error(`Matched Android UI node has invalid bounds: ${node.bounds}`);
  return center;
}

async function runAdbShell(context: AndroidBridgeContext, shellArgs: string[]): Promise<string> {
  const result = await runBridgeProcess(context.adb, adbArgs(context, ["shell", ...shellArgs]), context);
  if (result.status !== 0) {
    const detail = result.timedOut ? "Timed out while running Android bridge tool." : combinedOutput(result) || "No output.";
    throw new Error(detail);
  }
  return context.redactor.redact(combinedOutput(result));
}

async function executeBridgeTool(
  toolName: AndroidBridgeToolName,
  input: Record<string, unknown>,
  context: AndroidBridgeContext,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  await delay(optionalFiniteNumber(input.preDelay, "preDelay"));

  switch (toolName) {
    case "snapshot_ui": {
      const xml = await dumpUiXml(context);
      return textResult(context.redactor.redact(renderUiTree(xml) || "No accessible UI nodes found."));
    }

    case "screenshot": {
      mkdirSync(context.outputDir, { recursive: true });
      const destination = path.join(context.outputDir, `android-${Date.now()}.png`);
      const result = spawnSync(context.adb, adbArgs(context, ["exec-out", "screencap", "-p"]), {
        cwd: context.cwd,
        encoding: "buffer",
        timeout: 60 * 1000,
      });
      if (result.status !== 0) {
        throw new Error(`screenshot failed: ${result.stderr?.toString("utf8") || "No output."}`);
      }
      writeFileSync(destination, result.stdout);
      if (!existsSync(destination)) throw new Error("screenshot failed: file was not written.");
      return textResult(destination);
    }

    case "tap": {
      const target = findTapTarget(await dumpUiXml(context), input);
      const output = await runAdbShell(context, ["input", "tap", String(target.x), String(target.y)]);
      await delay(optionalFiniteNumber(input.postDelay, "postDelay"));
      return textResult(output || `Tapped ${target.x},${target.y}.`);
    }

    case "type_text": {
      await runAdbShell(context, ["input", "text", encodeAndroidInputText(requireString(input.text, "text"))]);
      return textResult("Typed text into the emulator.");
    }

    case "type_env": {
      const name = requireString(input.name, "name");
      if (!Object.prototype.hasOwnProperty.call(context.envValues, name)) {
        throw new Error(`Environment variable ${name} is not declared in this QA case.`);
      }
      await runAdbShell(context, ["input", "text", encodeAndroidInputText(context.envValues[name])]);
      return textResult(`Typed environment value ${name} into the emulator.`);
    }

    case "swipe": {
      const duration = optionalFiniteNumber(input.duration, "duration");
      const args = [
        "input",
        "swipe",
        String(requireFiniteNumber(input.x1, "x1")),
        String(requireFiniteNumber(input.y1, "y1")),
        String(requireFiniteNumber(input.x2, "x2")),
        String(requireFiniteNumber(input.y2, "y2")),
      ];
      if (duration !== undefined) args.push(String(duration));
      const output = await runAdbShell(context, args);
      await delay(optionalFiniteNumber(input.postDelay, "postDelay"));
      return textResult(output || "Swiped on the emulator.");
    }

    case "stop_app":
      return textResult((await runAdbShell(context, ["am", "force-stop", context.packageId])) || "Stopped app.");

    case "launch_app": {
      if (context.launchActivity) {
        const component = androidLaunchComponent(context.packageId, context.launchActivity);
        return textResult((await runAdbShell(context, ["am", "start", "-n", component])) || "Launched app.");
      }
      const result = await runBridgeProcess(context.adb, adbArgs(context, ["shell", "monkey", "-p", context.packageId, "1"]), context);
      if (result.status !== 0) throw new Error(combinedOutput(result) || "Could not launch app.");
      return textResult("Launched app.");
    }
  }
}

function createMcpServer(context: AndroidBridgeContext): McpServer {
  const server = new McpServer({ name: "shippilot-android", version: "0.1.0" });

  for (const toolName of androidBridgeToolNames) {
    server.registerTool(
      toolName,
      {
        description: `ShipPilot allowlisted Android emulator tool: ${toolName}`,
        inputSchema: androidBridgeToolInputSchemas[toolName],
      },
      async (input: unknown) => executeBridgeTool(toolName, input as Record<string, unknown>, context),
    );
  }

  return server;
}

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").trim();
      if (!body) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message }, id: null }));
}

export async function startAndroidBridge(context: AndroidBridgeContext): Promise<AndroidBridge> {
  const httpServer = createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/mcp") {
        sendJsonError(res, 404, "Not found.");
        return;
      }
      if (req.method !== "POST") {
        sendJsonError(res, 405, "Method not allowed.");
        return;
      }

      const mcpServer = createMcpServer(context);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        const body = await readRequestBody(req);
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        sendJsonError(res, 500, error instanceof Error ? error.message : String(error));
      } finally {
        await transport.close().catch(() => undefined);
        await mcpServer.close().catch(() => undefined);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    throw new Error("Android bridge did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve()))),
  };
}

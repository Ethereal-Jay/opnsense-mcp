import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalBooleanString = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const schema = z.object({
  OPNSENSE_URL: z.string().url(),
  OPNSENSE_API_KEY: z.string().min(1),
  OPNSENSE_API_SECRET: z.string().min(1),
  OPNSENSE_WRITE_MODE: z.enum(["disabled", "plan", "enabled"]).default("disabled"),
  OPNSENSE_TLS_VERIFY: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  OPNSENSE_ALLOW_HTTP: booleanString,
  OPNSENSE_CA_FILE: z.string().min(1).optional(),
  OPNSENSE_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
  OPNSENSE_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(50 * 1024 * 1024).default(2 * 1024 * 1024),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  MCP_PATH: z.string().regex(/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/).default("/mcp"),
  MCP_AUTH_TOKEN: z.string().min(32).optional(),
  MCP_ALLOW_UNAUTHENTICATED: optionalBooleanString,
  MCP_ALLOWED_HOSTS: z.string().optional(),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  MCP_MAX_SESSIONS: z.coerce.number().int().min(1).max(10_000).default(100),
  MCP_SESSION_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
  MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  const baseUrl = new URL(parsed.OPNSENSE_URL);
  const loopbackHosts = ["127.0.0.1", "localhost", "::1"];
  const allowedHosts = csv(parsed.MCP_ALLOWED_HOSTS);

  if (baseUrl.protocol !== "https:" && !parsed.OPNSENSE_ALLOW_HTTP) {
    throw new Error("OPNSENSE_URL must use HTTPS unless OPNSENSE_ALLOW_HTTP=true");
  }

  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");

  if (parsed.MCP_TRANSPORT === "http") {
    if (!parsed.MCP_AUTH_TOKEN && !parsed.MCP_ALLOW_UNAUTHENTICATED) {
      throw new Error("MCP_AUTH_TOKEN (at least 32 characters) is required for HTTP transport");
    }
    if (!loopbackHosts.includes(parsed.MCP_HOST) && allowedHosts.length === 0) {
      throw new Error("MCP_ALLOWED_HOSTS is required when MCP_HOST is not a loopback address");
    }
  }

  return {
    baseUrl,
    apiKey: parsed.OPNSENSE_API_KEY,
    apiSecret: parsed.OPNSENSE_API_SECRET,
    writeMode: parsed.OPNSENSE_WRITE_MODE,
    tlsVerify: parsed.OPNSENSE_TLS_VERIFY,
    ca: parsed.OPNSENSE_CA_FILE ? readFileSync(parsed.OPNSENSE_CA_FILE, "utf8") : undefined,
    timeoutMs: parsed.OPNSENSE_TIMEOUT_MS,
    maxResponseBytes: parsed.OPNSENSE_MAX_RESPONSE_BYTES,
    transport: parsed.MCP_TRANSPORT,
    http: {
      host: parsed.MCP_HOST,
      port: parsed.MCP_PORT,
      path: parsed.MCP_PATH,
      authToken: parsed.MCP_AUTH_TOKEN,
      allowUnauthenticated: parsed.MCP_ALLOW_UNAUTHENTICATED,
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : ["127.0.0.1", "localhost", "[::1]"],
      allowedOrigins: csv(parsed.MCP_ALLOWED_ORIGINS),
      maxSessions: parsed.MCP_MAX_SESSIONS,
      sessionTtlMs: parsed.MCP_SESSION_TTL_MS,
      rateLimitPerMinute: parsed.MCP_RATE_LIMIT_PER_MINUTE,
    },
  };
}

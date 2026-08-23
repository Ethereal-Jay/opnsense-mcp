import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

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
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  const baseUrl = new URL(parsed.OPNSENSE_URL);

  if (baseUrl.protocol !== "https:" && !parsed.OPNSENSE_ALLOW_HTTP) {
    throw new Error("OPNSENSE_URL must use HTTPS unless OPNSENSE_ALLOW_HTTP=true");
  }

  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");

  return {
    baseUrl,
    apiKey: parsed.OPNSENSE_API_KEY,
    apiSecret: parsed.OPNSENSE_API_SECRET,
    writeMode: parsed.OPNSENSE_WRITE_MODE,
    tlsVerify: parsed.OPNSENSE_TLS_VERIFY,
    ca: parsed.OPNSENSE_CA_FILE ? readFileSync(parsed.OPNSENSE_CA_FILE, "utf8") : undefined,
    timeoutMs: parsed.OPNSENSE_TIMEOUT_MS,
    maxResponseBytes: parsed.OPNSENSE_MAX_RESPONSE_BYTES,
  };
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { OPNsenseClient } from "./client.js";
import { PlanStore } from "./plans.js";
import { assessRisk } from "./policy.js";
import {
  firewallLogsRequest,
  firewallRulesRequest,
  LOG_SCOPES,
  LOG_SEVERITIES,
  natRulesRequest,
  NAT_TYPES,
  routeTableRequest,
  systemLogsRequest,
} from "./read-only.js";
import { apiRequestShape } from "./schema.js";
import type { ApiRequest } from "./types.js";

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) return { error: "Unknown error" };
  const enriched = error as Error & { status?: number; response?: unknown };
  return {
    error: enriched.message,
    ...(enriched.status !== undefined ? { status: enriched.status } : {}),
    ...(enriched.response !== undefined ? { response: enriched.response } : {}),
  };
}

export function createServer(config: Config, client = new OPNsenseClient(config)): McpServer {
  const server = new McpServer({ name: "opnsense-mcp", version: "0.1.0" });
  const plans = new PlanStore();

  server.registerTool(
    "opnsense_connection_info",
    {
      description: "Show the configured OPNsense target and local safety policy. Credentials are never returned.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      toolResult({
        target: config.baseUrl.origin,
        writeMode: config.writeMode,
        tlsVerification: config.tlsVerify,
        customCaConfigured: config.ca !== undefined,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      }),
  );

  server.registerTool(
    "opnsense_request",
    {
      description:
        "Call a read-classified OPNsense API endpoint. Unknown or mutating commands are rejected even when they use GET; use opnsense_plan_change for those.",
      inputSchema: apiRequestShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const request = input as ApiRequest;
      const risk = assessRisk(request);
      if (risk.level !== "read") {
        return toolResult({ error: "Endpoint is not classified as read-only", risk }, true);
      }
      try {
        return toolResult(await client.call(request));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  const pageShape = {
    page: z.number().int().min(1).default(1).describe("One-based result page"),
    pageSize: z.number().int().min(1).max(1000).default(100).describe("Maximum rows to return"),
    search: z.string().max(512).default("").describe("Case-insensitive search phrase"),
  };

  server.registerTool(
    "opnsense_get_firewall_logs",
    {
      description: "Read structured packet-filter log entries. This cannot stream or clear logs.",
      inputSchema: {
        limit: z.number().int().min(1).max(5000).default(1000),
        digest: z.string().max(256).optional().describe("Optional digest returned by an earlier request for incremental reads"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return toolResult(await client.call(firewallLogsRequest(input)));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  server.registerTool(
    "opnsense_get_logs",
    {
      description:
        "Read a bounded page from an OPNsense system or service log. The endpoint is fixed to query mode and cannot clear, export, or stream logs.",
      inputSchema: {
        scope: z.enum(LOG_SCOPES).describe("Log source"),
        ...pageShape,
        severities: z.array(z.enum(LOG_SEVERITIES)).max(LOG_SEVERITIES.length).optional(),
        sinceMinutes: z.number().int().min(1).max(525_600).optional().describe("Only return entries this many minutes old or newer"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return toolResult(await client.call(systemLogsRequest(input)));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  server.registerTool(
    "opnsense_list_firewall_rules",
    {
      description: "List firewall filter rules visible to the OPNsense automation API. This cannot add, alter, toggle, move, or apply rules.",
      inputSchema: {
        ...pageShape,
        category: z.string().uuid().optional().describe("Optional firewall category UUID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return toolResult(await client.call(firewallRulesRequest(input)));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  server.registerTool(
    "opnsense_list_nat_rules",
    {
      description:
        "List destination NAT, source NAT, one-to-one NAT, or IPv6 NPT rules. Automatic rules are included where OPNsense supplies them.",
      inputSchema: {
        type: z.enum(NAT_TYPES),
        ...pageShape,
        category: z.string().uuid().optional().describe("Optional firewall category UUID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return toolResult(await client.call(natRulesRequest(input)));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  server.registerTool(
    "opnsense_get_route_table",
    {
      description:
        "Read either the active kernel route table or configured static routes. Name resolution is disabled by default for predictable output.",
      inputSchema: {
        source: z.enum(["active", "configured"]).default("active"),
        resolve: z.boolean().default(false).describe("Resolve active route addresses; ignored for configured routes"),
        ...pageShape,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return toolResult(await client.call(routeTableRequest(input)));
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  server.registerTool(
    "opnsense_plan_change",
    {
      description:
        "Assess a non-read OPNsense request and create a short-lived, one-time token. This tool does not contact or change OPNsense.",
      inputSchema: apiRequestShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const request = input as ApiRequest;
      const risk = assessRisk(request);
      if (risk.level === "read") {
        return toolResult({ error: "This endpoint is read-classified; use opnsense_request instead", risk }, true);
      }
      if (config.writeMode === "disabled") {
        return toolResult({ error: "Mutations are disabled by OPNSENSE_WRITE_MODE=disabled", risk, request }, true);
      }
      if (config.writeMode === "plan") {
        return toolResult({ executable: false, risk, request, reason: "OPNSENSE_WRITE_MODE=plan never issues execution tokens" });
      }
      const plan = plans.create(request, risk);
      return toolResult({ executable: true, risk, request, ...plan });
    },
  );

  server.registerTool(
    "opnsense_execute_change",
    {
      description:
        "Execute the exact OPNsense mutation previously assessed by opnsense_plan_change. Tokens expire after five minutes and can be used only once.",
      inputSchema: { ...apiRequestShape, planToken: z.string().min(1).describe("One-time token from opnsense_plan_change") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (config.writeMode !== "enabled") {
        return toolResult({ error: "Execution requires OPNSENSE_WRITE_MODE=enabled" }, true);
      }
      const { planToken, ...requestInput } = input;
      const request = requestInput as ApiRequest;
      try {
        const plan = plans.consume(planToken, request);
        const response = await client.call(request);
        return toolResult({ risk: plan.risk, response });
      } catch (error) {
        return toolResult(formatError(error), true);
      }
    },
  );

  return server;
}

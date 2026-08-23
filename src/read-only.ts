import type { ApiRequest } from "./types.js";

export const LOG_SCOPES = [
  "configd",
  "dnsmasq",
  "filter",
  "firewall",
  "gateways",
  "hostdiscovery",
  "ipsec",
  "kea",
  "lighttpd",
  "ntpd",
  "openvpn",
  "pkg",
  "portalauth",
  "ppp",
  "resolver",
  "routing",
  "suricata",
  "system",
  "wireguard",
  "wireless",
] as const;

export const LOG_SEVERITIES = [
  "Emergency",
  "Alert",
  "Critical",
  "Error",
  "Warning",
  "Notice",
  "Informational",
  "Debug",
] as const;

export const NAT_TYPES = ["destination", "source", "one_to_one", "npt"] as const;

const NAT_CONTROLLERS: Record<(typeof NAT_TYPES)[number], string> = {
  destination: "d_nat",
  source: "source_nat",
  one_to_one: "one_to_one",
  npt: "npt",
};

export interface PageInput {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
}

function searchBody(input: PageInput): Record<string, unknown> {
  return {
    current: input.page ?? 1,
    rowCount: input.pageSize ?? 100,
    sort: {},
    searchPhrase: input.search ?? "",
  };
}

export function firewallLogsRequest(input: { limit?: number | undefined; digest?: string | undefined }): ApiRequest {
  return {
    module: "diagnostics",
    controller: "firewall",
    command: "log",
    method: "GET",
    query: {
      limit: input.limit ?? 1000,
      ...(input.digest ? { digest: input.digest } : {}),
    },
  };
}

export function systemLogsRequest(
  input: PageInput & {
    scope: (typeof LOG_SCOPES)[number];
    severities?: (typeof LOG_SEVERITIES)[number][] | undefined;
    sinceMinutes?: number | undefined;
  },
  now = Date.now(),
): ApiRequest {
  return {
    module: "diagnostics",
    controller: "log",
    command: "core",
    parameters: [input.scope],
    method: "POST",
    body: {
      ...searchBody(input),
      ...(input.severities?.length ? { severity: input.severities } : {}),
      ...(input.sinceMinutes ? { validFrom: Math.floor(now / 1000) - input.sinceMinutes * 60 } : {}),
    },
  };
}

export function firewallRulesRequest(input: PageInput & { category?: string | undefined }): ApiRequest {
  return {
    module: "firewall",
    controller: "filter",
    command: "search_rule",
    method: "POST",
    ...(input.category ? { query: { category: input.category } } : {}),
    body: searchBody(input),
  };
}

export function natRulesRequest(
  input: PageInput & { type: (typeof NAT_TYPES)[number]; category?: string | undefined },
): ApiRequest {
  return {
    module: "firewall",
    controller: NAT_CONTROLLERS[input.type],
    command: "search_rule",
    method: "POST",
    ...(input.category ? { query: { category: input.category } } : {}),
    body: searchBody(input),
  };
}

export function routeTableRequest(
  input: PageInput & { source: "active" | "configured"; resolve?: boolean | undefined },
): ApiRequest {
  if (input.source === "active") {
    return {
      module: "diagnostics",
      controller: "interface",
      command: "get_routes",
      method: "GET",
      ...(input.resolve ? { query: { resolve: true } } : {}),
    };
  }
  return {
    module: "routes",
    controller: "routes",
    command: "searchroute",
    method: "POST",
    body: searchBody(input),
  };
}

import { describe, expect, it } from "vitest";
import {
  firewallLogsRequest,
  firewallRulesRequest,
  natRulesRequest,
  routeTableRequest,
  systemLogsRequest,
} from "./read-only.js";

describe("curated read-only request builders", () => {
  it("uses the structured firewall log endpoint with a bounded limit", () => {
    expect(firewallLogsRequest({ limit: 250, digest: "next" })).toEqual({
      module: "diagnostics",
      controller: "firewall",
      command: "log",
      method: "GET",
      query: { limit: 250, digest: "next" },
    });
  });

  it("queries a fixed general log route without an action parameter", () => {
    expect(
      systemLogsRequest(
        { scope: "system", page: 2, pageSize: 50, search: "error", severities: ["Error"], sinceMinutes: 60 },
        1_800_000,
      ),
    ).toEqual({
      module: "diagnostics",
      controller: "log",
      command: "core",
      parameters: ["system"],
      method: "POST",
      body: {
        current: 2,
        rowCount: 50,
        sort: {},
        searchPhrase: "error",
        severity: ["Error"],
        validFrom: -1800,
      },
    });
  });

  it("builds firewall and NAT searches", () => {
    expect(firewallRulesRequest({ search: "allow web" })).toMatchObject({
      module: "firewall",
      controller: "filter",
      command: "search_rule",
      method: "POST",
    });
    expect(natRulesRequest({ type: "destination" })).toMatchObject({
      module: "firewall",
      controller: "d_nat",
      command: "search_rule",
      method: "POST",
    });
    expect(natRulesRequest({ type: "source" }).controller).toBe("source_nat");
    expect(natRulesRequest({ type: "one_to_one" }).controller).toBe("one_to_one");
    expect(natRulesRequest({ type: "npt" }).controller).toBe("npt");
  });

  it("distinguishes active and configured routes", () => {
    expect(routeTableRequest({ source: "active", resolve: false })).toEqual({
      module: "diagnostics",
      controller: "interface",
      command: "get_routes",
      method: "GET",
    });
    expect(routeTableRequest({ source: "configured", pageSize: 25 })).toEqual({
      module: "routes",
      controller: "routes",
      command: "searchroute",
      method: "POST",
      body: { current: 1, rowCount: 25, sort: {}, searchPhrase: "" },
    });
  });
});

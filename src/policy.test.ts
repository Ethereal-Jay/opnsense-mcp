import { describe, expect, it } from "vitest";
import { assessRisk } from "./policy.js";

describe("assessRisk", () => {
  it("allows conventional reads regardless of HTTP method", () => {
    expect(assessRisk({ module: "core", controller: "service", command: "search", method: "POST" }).level).toBe("read");
  });

  it("does not trust GET for a mutation", () => {
    expect(assessRisk({ module: "firewall", controller: "filter", command: "toggle_rule_log", method: "GET" }).level).toBe("write");
  });

  it("separates activation from staging", () => {
    expect(assessRisk({ module: "firewall", controller: "filter", command: "set_rule" }).level).toBe("write");
    expect(assessRisk({ module: "firewall", controller: "filter", command: "apply" }).level).toBe("activate");
  });

  it("classifies system reset and reboot at higher risk", () => {
    expect(assessRisk({ module: "core", controller: "defaults", command: "factory_defaults" }).level).toBe("catastrophic");
    expect(assessRisk({ module: "core", controller: "defaults", command: "reset" }).level).toBe("catastrophic");
    expect(assessRisk({ module: "unbound", controller: "overview", command: "reset" }).level).toBe("disruptive");
    expect(assessRisk({ module: "core", controller: "system", command: "reboot" }).level).toBe("disruptive");
  });

  it("fails closed for new endpoint names", () => {
    expect(assessRisk({ module: "plugin", controller: "thing", command: "frobnicate" }).level).toBe("unknown");
  });
});

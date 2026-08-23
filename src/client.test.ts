import { describe, expect, it } from "vitest";
import { buildApiUrl } from "./client.js";

describe("buildApiUrl", () => {
  it("constructs and encodes the documented API route", () => {
    const url = buildApiUrl(new URL("https://firewall.example"), {
      module: "firewall",
      controller: "filter",
      command: "get_rule",
      parameters: ["abc 123"],
      query: { current: 1, searchPhrase: "allow web" },
    });
    expect(url.toString()).toBe(
      "https://firewall.example/api/firewall/filter/get_rule/abc%20123?current=1&searchPhrase=allow+web",
    );
  });

  it("rejects path traversal and embedded slash parameters", () => {
    expect(() => buildApiUrl(new URL("https://firewall.example"), { module: "..", controller: "core", command: "status" })).toThrow();
    expect(() =>
      buildApiUrl(new URL("https://firewall.example"), {
        module: "core",
        controller: "system",
        command: "status",
        parameters: ["../reboot"],
      }),
    ).toThrow();
  });
});

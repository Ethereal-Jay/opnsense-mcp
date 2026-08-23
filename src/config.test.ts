import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  OPNSENSE_URL: "https://firewall.example",
  OPNSENSE_API_KEY: "key",
  OPNSENSE_API_SECRET: "secret",
};

describe("remote transport configuration", () => {
  it("requires authentication for HTTP by default", () => {
    expect(() => loadConfig(base)).toThrow("MCP_AUTH_TOKEN");
  });

  it("allows stdio without an MCP bearer token", () => {
    expect(loadConfig({ ...base, MCP_TRANSPORT: "stdio" }).transport).toBe("stdio");
  });

  it("requires allowed hosts on non-loopback bindings", () => {
    expect(() =>
      loadConfig({ ...base, MCP_AUTH_TOKEN: "x".repeat(32), MCP_HOST: "0.0.0.0" }),
    ).toThrow("MCP_ALLOWED_HOSTS");
  });

  it("parses remote security settings", () => {
    const config = loadConfig({
      ...base,
      MCP_AUTH_TOKEN: "x".repeat(32),
      MCP_HOST: "0.0.0.0",
      MCP_PORT: "8080",
      MCP_ALLOWED_HOSTS: "mcp.example.com, localhost",
      MCP_ALLOWED_ORIGINS: "https://agents.example.com",
    });
    expect(config.http).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
      allowedHosts: ["mcp.example.com", "localhost"],
      allowedOrigins: ["https://agents.example.com"],
    });
  });
});

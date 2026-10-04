import { describe, expect, it, vi } from "vitest";
import { Diagnostics, pingSchema, tracerouteSchema, portProbeSchema } from "./diagnostics.js";
import type { ApiRequest } from "./types.js";

const job = "b81da63b-84d7-4ad9-8eae-e11495851cbd";
const reply = (data: unknown) => ({ status: 200, contentType: "application/json", data });

describe("active diagnostics", () => {
  it("runs a bounded ping and cleans up only its own job", async () => {
    const call = vi.fn(async (request: ApiRequest) => {
      if (request.command === "set") return reply({ result: "ok", uuid: job });
      if (request.command === "search_jobs") return reply({ rows: [{ id: "other" }, { id: job, send: 3, received: 3 }] });
      return reply({ status: "ok" });
    });
    const wait = vi.fn(async () => undefined);
    const result = await new Diagnostics({ call }, wait).ping({ host: "1.1.1.1" });
    expect(result.result).toEqual({ id: job, send: 3, received: 3 });
    expect(wait).toHaveBeenCalledWith(3000);
    expect(call.mock.calls.map(([request]) => request.command)).toEqual(["set", "start", "search_jobs", "stop", "remove"]);
    for (const [request] of call.mock.calls) {
      if (["start", "stop", "remove"].includes(request.command)) expect(request.parameters).toEqual([job]);
    }
  });

  it("waits for the asynchronous live snapshot before stopping the job", async () => {
    let running = false;
    let samples = 0;
    const call = vi.fn(async (request: ApiRequest) => {
      if (request.command === "set") return reply({ result: "ok", uuid: job });
      if (request.command === "start") running = true;
      if (request.command === "stop") running = false;
      if (request.command === "search_jobs") {
        expect(running).toBe(true);
        return reply({ rows: [{ id: job, status: "running", send: ++samples > 1 ? 3 : null, received: samples > 1 ? 3 : null }] });
      }
      return reply({ status: "ok" });
    });
    const wait = vi.fn(async () => undefined);
    const result = await new Diagnostics({ call }, wait).ping({ host: "google.com" });
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ send: 3, received: 3 });
    expect(wait.mock.calls).toEqual([[3000], [250]]);
    expect(call.mock.calls.map(([r]) => r.command)).toEqual(["set", "start", "search_jobs", "search_jobs", "stop", "remove"]);
    expect(running).toBe(false);
  });

  it("reports missing statistics as an error and bounds retries while cleaning up", async () => {
    const call = vi.fn(async (r: ApiRequest) => {
      if (r.command === "set") return reply({ result: "ok", uuid: job });
      if (r.command === "search_jobs") return reply({ rows: [{ id: job, send: null, received: null }] });
      return reply({ status: "ok" });
    });
    const wait = vi.fn(async () => undefined);
    const result = await new Diagnostics({ call }, wait).ping({ host: "google.com" });
    expect(result.error).toContain("no ping statistics");
    expect(call.mock.calls.filter(([r]) => r.command === "search_jobs")).toHaveLength(5);
    expect(wait.mock.calls).toEqual([[3000], [250], [250], [250], [250]]);
    expect(call.mock.calls.slice(-2).map(([r]) => r.command)).toEqual(["stop", "remove"]);
  });

  it("distinguishes actual packet loss from missing statistics", async () => {
    const call = vi.fn(async (r: ApiRequest) => {
      if (r.command === "set") return reply({ result: "ok", uuid: job });
      if (r.command === "search_jobs") return reply({ rows: [{ id: job, send: 3, received: 0, loss: "100.00 %" }] });
      return reply({ status: "ok" });
    });
    const result = await new Diagnostics({ call }, async () => undefined).ping({ host: "google.com" });
    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ send: 3, received: 0 });
  });

  it("surfaces backend ping errors and still cleans up", async () => {
    const call = vi.fn(async (r: ApiRequest) => {
      if (r.command === "set") return reply({ result: "ok", uuid: job });
      if (r.command === "search_jobs") return reply({ rows: [{ id: job, send: null, received: null, last_error: "cannot resolve target" }] });
      return reply({ status: "ok" });
    });
    const result = await new Diagnostics({ call }, async () => undefined).ping({ host: "google.com" });
    expect(result.error).toContain("cannot resolve target");
    expect(call.mock.calls.slice(-2).map(([r]) => r.command)).toEqual(["stop", "remove"]);
  });

  it("cleans up after an uncertain start and reports cleanup failures", async () => {
    const call = vi.fn(async (request: ApiRequest) => {
      if (request.command === "set") return reply({ result: "ok", uuid: job });
      if (request.command === "start") throw new Error("Network timeout");
      if (request.command === "remove") throw new Error("Cleanup unavailable");
      return reply({ status: "ok" });
    });
    const result = await new Diagnostics({ call }).ping({ host: "example.com" });
    expect(result.error).toBe("Network timeout");
    expect(result.cleanupErrors).toEqual(["remove: Cleanup unavailable"]);
    expect(call.mock.calls.map(([request]) => request.command)).toEqual(["set", "start", "stop", "remove"]);
  });

  it("rejects semantic validation failures without starting a job", async () => {
    const call = vi.fn(async () => reply({ result: "failed", validations: { hostname: "Invalid" } }));
    await expect(new Diagnostics({ call }).ping({ host: "example.com" })).rejects.toThrow("rejected");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("uses volatile diagnostic payloads for traceroute and one TCP port", async () => {
    const call = vi.fn(async () => reply({ result: "ok", response: [] }));
    const diagnostics = new Diagnostics({ call });
    await diagnostics.traceroute({ host: "2001:db8::1", family: "ipv6", protocol: "icmp" });
    expect(call.mock.calls[0]).toBeDefined();
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining({
      controller: "traceroute", command: "set", body: { traceroute: { settings: {
        hostname: "2001:db8::1", ipproto: "inet6", source_address: "", protocol: "icmp",
      } } },
    }));
    await diagnostics.portProbe({ host: "example.com", port: 443 });
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ controller: "portprobe", command: "set" }));
  });

  it("rejects URL/shell input, oversized pings, and port ranges", () => {
    for (const host of ["https://example.com", "-c10", "example.com;reboot", "a/b"]) {
      expect(pingSchema.safeParse({ host }).success).toBe(false);
    }
    expect(pingSchema.safeParse({ host: "example.com", durationSeconds: 11 }).success).toBe(false);
    expect(pingSchema.safeParse({ host: "example.com", packetSize: 65535 }).success).toBe(false);
    expect(portProbeSchema.safeParse({ host: "example.com", port: "1:65535" }).success).toBe(false);
    expect(tracerouteSchema.safeParse({ host: "example.com", protocol: "tcp" }).success).toBe(false);
  });

  it("rejects concurrent diagnostics and releases the slot after completion", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const call = vi.fn(async () => { await pending; return reply({ result: "ok" }); });
    const diagnostics = new Diagnostics({ call });
    const first = diagnostics.traceroute({ host: "example.com" });
    await expect(diagnostics.portProbe({ host: "example.com", port: 443 })).rejects.toThrow("already running");
    release();
    await first;
    await expect(diagnostics.portProbe({ host: "example.com", port: 443 })).resolves.toEqual({ result: "ok" });
  });
});

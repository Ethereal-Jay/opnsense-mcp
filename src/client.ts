import { Agent, request as httpRequest } from "undici";
import type { Config } from "./config.js";
import type { ApiRequest, ApiResponse } from "./types.js";

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateSegment(value: string, label: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
}

export function buildApiUrl(baseUrl: URL, request: ApiRequest): URL {
  validateSegment(request.module, "module");
  validateSegment(request.controller, "controller");
  validateSegment(request.command, "command");

  const url = new URL(baseUrl);
  const segments = ["api", request.module, request.controller, request.command];
  for (const parameter of request.parameters ?? []) {
    if (parameter.length === 0 || parameter.length > 1024 || parameter.includes("/") || parameter.includes("\0")) {
      throw new Error("parameters must be non-empty path segments without slashes");
    }
    segments.push(parameter);
  }
  url.pathname = `${baseUrl.pathname}/${segments.map(encodeURIComponent).join("/")}`.replace(/\/{2,}/g, "/");

  for (const [key, value] of Object.entries(request.query ?? {})) {
    validateSegment(key, "query key");
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function readBoundedBody(body: AsyncIterable<Uint8Array>, maximum: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maximum) {
      throw new Error(`OPNsense response exceeded the ${maximum}-byte safety limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class OPNsenseClient {
  readonly #config: Config;
  readonly #dispatcher: Agent;

  constructor(config: Config) {
    this.#config = config;
    this.#dispatcher = new Agent({
      connect: {
        rejectUnauthorized: config.tlsVerify,
        ...(config.ca ? { ca: config.ca } : {}),
      },
    });
  }

  async call(apiRequest: ApiRequest): Promise<ApiResponse> {
    const url = buildApiUrl(this.#config.baseUrl, apiRequest);
    const method = apiRequest.method ?? (apiRequest.body === undefined ? "GET" : "POST");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    const authorization = Buffer.from(`${this.#config.apiKey}:${this.#config.apiSecret}`).toString("base64");

    try {
      const response = await httpRequest(url, {
        method,
        dispatcher: this.#dispatcher,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Basic ${authorization}`,
          ...(apiRequest.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(apiRequest.body !== undefined ? { body: JSON.stringify(apiRequest.body) } : {}),
      });
      const contentType = String(response.headers["content-type"] ?? "");
      const text = await readBoundedBody(response.body, this.#config.maxResponseBytes);
      let data: unknown = text;
      if (contentType.includes("application/json") || /^[\s]*[\[{]/.test(text)) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const error = new Error(`OPNsense returned HTTP ${response.statusCode}`);
        Object.assign(error, { status: response.statusCode, response: data });
        throw error;
      }
      return { status: response.statusCode, contentType, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    await this.#dispatcher.close();
  }
}

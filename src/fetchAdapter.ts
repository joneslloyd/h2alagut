// src/fetchAdapter.ts
import { h2Request } from "./adapter";
const log = console.log;
import { FetchResponse, H2FetchInit, ProxyConfig } from "./types";
import {
  assembleInitialResponse,
  createResponseTextMethod,
} from "./helpers/responseHelpers";

/**
 * A fetch‑compatible adapter that uses HTTP/2 with optional HTTP CONNECT tunnelling.
 * It accepts all standard fetch options plus a `proxy` property.
 *
 * @param input The URL (or Request) to fetch.
 * @param init Standard fetch init options, extended with an optional `proxy` property and an optional `debug` flag.
 * @returns A promise that resolves to a Response‑like object.
 */
export async function fetchAdapter(
  input: RequestInfo,
  init?: H2FetchInit,
): Promise<FetchResponse> {
  // Determine the URL string.
  const url = typeof input === "string" ? input : input.url;

  // Extract options with defaults.
  const method = (init && init.method) || "GET";
  const headers =
    init && init.headers
      ? Array.from(new Headers(init.headers).entries()).reduce(
          (acc, [key, value]) => ({ ...acc, [key]: value }),
          {},
        )
      : {};
  let body: Buffer | string | undefined = undefined;

  if (init && init.body) {
    if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
      body = init.body;
    } else {
      // If body is not a string/Buffer, convert it to string.
      body = String(init.body);
    }
  }

  // Extract custom proxy configuration.
  const proxy = init && init.proxy;

  // Use the low-level HTTP/2 request function.
  if (init?.timeout) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, init.timeout);

    try {
      return await handleRequest(
        url,
        method,
        headers,
        body,
        proxy,
        controller.signal,
        init?.debug,
      );
    } finally {
      clearTimeout(timeout);
    }
  } else {
    try {
      return await handleRequest(
        url,
        method,
        headers,
        body,
        proxy,
        undefined,
        init?.debug,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out")) {
        throw error;
      }
      throw new Error(
        `HTTP/2 request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function handleRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | string | undefined,
  proxy?: ProxyConfig,
  signal?: AbortSignal,
  debug?: boolean,
): Promise<FetchResponse> {
  // Declare h2res in an outer scope so that it is available in closures.
  let h2res: any;
  try {
    h2res = await h2Request(
      url,
      method,
      headers,
      body,
      proxy,
      signal,
      undefined,
    );
  } catch (error) {
    throw error;
  }
  if (!h2res) {
    throw new Error("HTTP/2 response is undefined");
  }
  const response = assembleInitialResponse(h2res);
  response.text = createResponseTextMethod(h2res, response);

  // Preserve original h2res.text if available.
  const originalTextMethod =
    typeof h2res.text === "function" ? h2res.text.bind(h2res) : null;

  // Set up text() as a fallback.
  let rawBuffer: Buffer | null = null;
  const streamToBuffer = (stream: any): Promise<Buffer> => {
    if (typeof stream.on !== "function") {
      return Promise.resolve(
        Buffer.isBuffer(stream) ? stream : Buffer.from(stream),
      );
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) => {
        chunks.push(
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
        );
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  };

  response.text = async () => {
    if (!rawBuffer) {
      if (h2res.rawBody) {
        rawBuffer = h2res.rawBody;
      } else if (typeof h2res.on === "function") {
        rawBuffer = await streamToBuffer(h2res);
      } else if (originalTextMethod) {
        const txt = await originalTextMethod();
        rawBuffer = Buffer.from(txt);
      } else if (Buffer.isBuffer(h2res)) {
        rawBuffer = h2res;
      } else if (typeof h2res === "string") {
        rawBuffer = Buffer.from(h2res);
      } else {
        throw new Error("Unable to read response body.");
      }
      if (h2res.headers && h2res.headers["content-encoding"] && debug) {
        log(`Content-Encoding: ${h2res.headers["content-encoding"]}`);
      }
      if (debug) {
        log(`rawBuffer length: ${rawBuffer?.length}`);
      }
      if (!rawBuffer) {
        throw new Error("Response body is null");
      }
      response.push(rawBuffer.toString("utf8"));
      response.push(null);
    }
    return rawBuffer!.toString("utf8");
  };

  response.json = async () => {
    const text = await response.text();
    return JSON.parse(text);
  };

  response.arrayBuffer = async () => {
    if (!rawBuffer) {
      await response.text();
    }
    return rawBuffer!.buffer.slice(
      rawBuffer!.byteOffset,
      rawBuffer!.byteOffset + rawBuffer!.byteLength,
    );
  };

  return response;
}

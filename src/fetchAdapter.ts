import { h2Request } from "./adapter";
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
 * @param init Standard fetch init options, extended with an optional `proxy` property.
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
      );
    } finally {
      clearTimeout(timeout);
    }
  } else {
    try {
      return await handleRequest(url, method, headers, body, proxy);
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

  // Set up text() as a fallback.
  let bodyText = "";
  response.text = async () => {
    if (!bodyText) {
      bodyText = await h2res.text();
      response.push(bodyText);
      response.push(null);
    }
    return bodyText;
  };

  response.json = async () => {
    const text = await response.text();
    return JSON.parse(text);
  };

  response.arrayBuffer = async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of h2res) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).buffer;
  };

  return response;
}

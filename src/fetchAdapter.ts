import { h2Request } from "./adapter";
import { H2FetchInit } from "./types";
import { IncomingMessage } from "http";
import { Socket } from "net";

interface FetchResponse extends IncomingMessage {
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  remoteAddress?: string;
}

/**
 * A fetch‑compatible adapter that uses HTTP/2 with optional HTTP CONNECT tunneling.
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
  const headers = (init && init.headers) || {};
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
      const h2res = await h2Request(
        url,
        method,
        headers as Record<string, string>,
        body,
        proxy,
        controller.signal,
      );

      // Create a response object
      const response = new IncomingMessage(new Socket()) as FetchResponse;
      response.statusCode = h2res.status;

      // Add remoteAddress property if available
      if (h2res.headers[':remote-addr']) {
        response.remoteAddress = h2res.headers[':remote-addr'] as string;
      }

      // Set headers
      Object.entries(h2res.headers)
        .filter(([key]) => !key.startsWith(":"))
        .forEach(([key, value]) => {
          response.headers[key] = value;
        });

      // Add pseudo-headers as custom properties
      Object.entries(h2res.headers)
        .filter(([key]) => key.startsWith(":"))
        .forEach(([key, value]) => {
          (response as any)[key] = value;
        });

      // Set body
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
        const text = await response.text();
        return new TextEncoder().encode(text).buffer;
      };

      return response;
    } finally {
      clearTimeout(timeout);
    }
  } else {
    try {
      const h2res = await h2Request(
        url,
        method,
        headers as Record<string, string>,
        body,
        proxy,
      );

      // Create a response object
      const response = new IncomingMessage(new Socket()) as FetchResponse;
      response.statusCode = h2res.status;

      // Add remoteAddress property if available
      if (h2res.headers[':remote-addr']) {
        response.remoteAddress = h2res.headers[':remote-addr'] as string;
      }

      // Set headers
      Object.entries(h2res.headers)
        .filter(([key]) => !key.startsWith(":"))
        .forEach(([key, value]) => {
          response.headers[key] = value;
        });

      // Add pseudo-headers as custom properties
      Object.entries(h2res.headers)
        .filter(([key]) => key.startsWith(":"))
        .forEach(([key, value]) => {
          (response as any)[key] = value;
        });

      // Set body
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
        const text = await response.text();
        return new TextEncoder().encode(text).buffer;
      };

      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out")) {
        throw error;
      }
      throw new Error(
        `HTTP/2 request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

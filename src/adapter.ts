// src/adapter.ts
import * as http2 from "http2";
import http from "http";
import https from "https";
import tls from "tls";
import { gunzipSync, inflateSync, brotliDecompressSync } from "zlib";
import { ProxyConfig } from "./types";
import net from "net";
import type { ClientHttp2Session } from "http2";
import { H2Response } from "./types";
import { URL } from "url";

/**
 * Creates an HTTP/2 client session for the given target URL.
 * If a proxy configuration is provided, it creates an HTTP CONNECT tunnel.
 *
 * @param targetUrl The URL to connect to.
 * @param proxyConfig Optional proxy configuration.
 * @param debug Optional debug flag.
 * @returns A promise that resolves with an HTTP/2 client session.
 */
export function createHttp2Session(
  targetUrl: URL,
  proxyConfig?: ProxyConfig,
  debug?: boolean,
): Promise<http2.ClientHttp2Session | http.ClientRequest> {
  return new Promise((resolve, reject) => {
    getSocket(targetUrl, proxyConfig, debug)
      .then((socket) => {
        const tlsSocket = tls.connect({
          socket,
          servername: targetUrl.hostname,
          ALPNProtocols: ["h2", "http/1.1"],
        });

        tlsSocket.on("secureConnect", () => {
          if (tlsSocket.alpnProtocol === "h2") {
            const session = http2.connect(`https://${targetUrl.hostname}`, {
              createConnection: () => tlsSocket,
            });
            session.on("error", reject);
            resolve(session);
          } else {
            // Fallback to traditional HTTPS (HTTP/1.1) regardless of proxy.
            const req = https.request({
              host: targetUrl.hostname,
              port: Number(targetUrl.port || 443),
              createConnection: () => tlsSocket,
            });
            (req as any).close = () => req.abort();
            resolve(req);
          }
        });

        tlsSocket.on("error", (err) => {
          reject(new Error(`TLS handshake failed: ${err.message}`));
        });
      })
      .catch((err) => reject(err));
  });
}

function isHttp2Session(
  client: http2.ClientHttp2Session | http.ClientRequest,
): client is ClientHttp2Session {
  return typeof (client as any).request === "function";
}

/**
 * Performs an HTTP/2 request and returns a simplified response object.
 *
 * @param url The URL to request.
 * @param method HTTP method.
 * @param headers Request headers.
 * @param body Optional request body.
 * @param proxy Optional proxy configuration.
 * @param signal Optional AbortSignal.
 * @param debug Optional debug flag.
 * @returns A promise resolving with an object containing status, headers, and methods to retrieve the response body.
 */
export async function h2Request(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | string | undefined,
  proxy?: ProxyConfig,
  signal?: AbortSignal,
  debug?: boolean,
): Promise<H2Response> {
  const targetUrl = new URL(url);
  const log = (...args: any[]) => {
    if (debug) console.log(...args);
  };
  let client: http2.ClientHttp2Session | http.ClientRequest | null = null;

  try {
    client = await createHttp2Session(targetUrl, proxy, debug);

    return new Promise((resolve, reject) => {
      if (!client) {
        return reject(new Error("HTTP/2 client session is null"));
      }
      // Ensure the client is non-null for further usage.
      const safeClient = client!;

      if (isHttp2Session(safeClient)) {
        const pseudoHeaders = {
          ":method": method,
          ":path": targetUrl.pathname + targetUrl.search,
          ":scheme": targetUrl.protocol.slice(0, -1),
          ":authority": targetUrl.host,
          ...headers,
        };
        log("HTTP/2 request headers (pseudo-headers):", pseudoHeaders);

        const req = safeClient.request({
          ":method": method,
          ":path": targetUrl.pathname + targetUrl.search,
          ":scheme": targetUrl.protocol.slice(0, -1),
          ":authority": targetUrl.host,
          ...headers,
        });

        if (body) {
          req.write(body);
        }
        req.end();

        let responseHeaders: http2.IncomingHttpHeaders = {};
        const chunks: Buffer[] = [];

        req.on("response", (hdrs) => {
          responseHeaders = hdrs;
        });

        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        req.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let decompressed: Buffer;
          const encoding = responseHeaders["content-encoding"];
          try {
            if (encoding === "gzip") {
              decompressed = gunzipSync(buffer);
            } else if (encoding === "deflate") {
              decompressed = inflateSync(buffer);
            } else if (encoding === "br") {
              decompressed = brotliDecompressSync(buffer);
            } else {
              decompressed = buffer;
            }
          } catch (err) {
            if (client && isHttp2Session(client)) {
              client.close();
            }
            return reject(
              new Error(`Decompression failed: ${(err as Error).message}`),
            );
          }

          const rawBody = decompressed; // Preserve the raw decompressed data.
          const bodyText = rawBody.toString("utf8");
          if (client && isHttp2Session(client)) {
            client.close();
          }

          let rawStatus =
            responseHeaders[":status"] || responseHeaders["status"];
          if (rawStatus === undefined) {
            const descriptors =
              Object.getOwnPropertyDescriptors(responseHeaders);
            if (
              descriptors[":status"] &&
              descriptors[":status"].value !== undefined
            ) {
              rawStatus = descriptors[":status"].value;
            } else if (
              descriptors["status"] &&
              descriptors["status"].value !== undefined
            ) {
              rawStatus = descriptors["status"].value;
            }
          }
          const statusVal =
            rawStatus !== undefined ? Number(rawStatus) : undefined;
          resolve({
            status: statusVal,
            headers: responseHeaders,
            rawBody, // new property for binary data
            text: async () => bodyText,
            json: async () => {
              try {
                return JSON.parse(bodyText);
              } catch (err) {
                throw new Error(
                  `JSON parsing failed: ${(err as Error).message}`,
                );
              }
            },
            socket:
              client?.socket && client.socket.localAddress
                ? { localAddress: client.socket.localAddress }
                : undefined,
            remoteAddress: (client?.socket as any)?._remoteAddress,
          });
        });

        req.on("error", (err) => {
          if (client && isHttp2Session(client)) {
            client.close();
          }
          reject(new Error(`Request failed: ${(err as Error).message}`));
        });

        if (proxy?.timeout) {
          req.setTimeout(proxy.timeout, () => {
            req.destroy(new Error("Request timed out"));
          });
        }

        if (signal) {
          signal.addEventListener("abort", () => {
            req.destroy(new Error("Request timed out"));
            if (client && isHttp2Session(client)) {
              client.close();
            }
          });
        }
      } else {
        log("HTTP/1.1 request headers:", headers);
        // Handle HTTP/1.1 request
        const req = safeClient;
        req.end();

        let responseHeaders: http.IncomingHttpHeaders = {};
        let statusCode: number | undefined;
        const chunks: Buffer[] = [];

        req.on("response", (res) => {
          statusCode = res.statusCode;
          responseHeaders = res.headers;
        });

        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        req.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let decompressed: Buffer;
          const encoding = responseHeaders["content-encoding"];
          try {
            if (encoding === "gzip") {
              decompressed = gunzipSync(buffer);
            } else if (encoding === "deflate") {
              decompressed = inflateSync(buffer);
            } else if (encoding === "br") {
              decompressed = brotliDecompressSync(buffer);
            } else {
              decompressed = buffer;
            }
          } catch (err) {
            if (client && isHttp2Session(client)) {
              client.close();
            }
            return reject(
              new Error(`Decompression failed: ${(err as Error).message}`),
            );
          }
          const rawBody = decompressed;
          const bodyText = rawBody.toString("utf8");
          if (client && isHttp2Session(client)) {
            client.close();
          }

          const statusVal =
            statusCode !== undefined
              ? statusCode
              : responseHeaders[":status"] !== undefined
                ? Number(responseHeaders[":status"])
                : undefined;
          resolve({
            status: statusVal,
            headers: responseHeaders,
            rawBody, // added rawBody here too
            text: async () => bodyText,
            json: async () => {
              try {
                return JSON.parse(bodyText);
              } catch (err) {
                throw new Error(
                  `JSON parsing failed: ${(err as Error).message}`,
                );
              }
            },
          });
        });

        req.on("error", (err) => {
          if (client && isHttp2Session(client)) {
            client.close();
          }
          reject(new Error(`Request failed: ${(err as Error).message}`));
        });

        if (proxy?.timeout) {
          req.setTimeout(proxy.timeout, () => {
            req.destroy(new Error("Request timed out"));
          });
        }

        if (signal) {
          signal.addEventListener("abort", () => {
            req.destroy(new Error("Request timed out"));
            if (client && isHttp2Session(client)) {
              client.close();
            }
          });
        }
      }
    });
  } catch (err) {
    if (client && isHttp2Session(client)) {
      client.close();
    }
    throw new Error(
      `HTTP/2 session creation failed: ${(err as Error).message}`,
    );
  }
}

function getSocket(
  targetUrl: URL,
  proxyConfig?: ProxyConfig,
  debug?: boolean,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const log = (...args: any[]) => {
      if (debug) console.log(...args);
    };
    if (proxyConfig) {
      const { host: proxyHost, port: proxyPort, auth } = proxyConfig;
      if (!proxyHost || !proxyPort || proxyHost === "" || proxyPort === 0) {
        return reject(new Error("Proxy configuration is incomplete"));
      }

      // Use the same CONNECT options as the old working version:
      const connectOptions: http.RequestOptions = {
        host: proxyHost,
        port: proxyPort,
        method: "CONNECT",
        path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
        headers: {},
      };

      if (auth) {
        const [username, password] = auth.split(":");
        if (!username || !password) {
          return reject(
            new Error(
              'Invalid proxy authentication format. Expected "username:password"',
            ),
          );
        }
        // Explicitly set extra headers as in your old working version.
        connectOptions.headers = {
          ...connectOptions.headers,
          "Proxy-Authorization": `Basic ${Buffer.from(
            `${username}:${password}`,
          ).toString("base64")}`,
          "Proxy-Connection": "Keep-Alive",
          Host: `${targetUrl.hostname}:${targetUrl.port || 443}`,
        };
      }

      log("CONNECT request options:", connectOptions);
      const req = http.request(connectOptions);
      req.setTimeout(30000, () => {
        req.destroy(new Error("CONNECT request timed out"));
      });
      req.end();

      req.on("connect", (res, socket) => {
        log("CONNECT response received:", res.statusCode, res.headers);
        if (res.statusCode !== 200) {
          socket.destroy();
          if (res.statusCode === 407) {
            return reject(new Error("Proxy authentication failed"));
          }
          return reject(
            new Error(
              `Tunnel establishment failed with status code ${res.statusCode}`,
            ),
          );
        }
        // Store the proxy's IP address
        (socket as any)._remoteAddress = req.socket?.remoteAddress || undefined;
        resolve(socket);
      });

      req.on("error", (err) => {
        console.error("Error event on CONNECT request:", err);
        reject(new Error(`Proxy connection failed: ${err.message}`));
      });
    } else {
      const socket = net.connect({
        host: targetUrl.hostname,
        port: Number(targetUrl.port || 443),
      });
      (socket as any)._remoteAddress = socket.remoteAddress;
      socket.on("error", reject);
      socket.on("connect", () => resolve(socket));
    }
  });
}

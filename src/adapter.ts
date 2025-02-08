import * as http2 from "http2";
import http from "http";
import https from "https";
import tls from "tls";
import { gunzipSync, inflateSync, brotliDecompressSync } from "zlib";
import { ProxyConfig } from "./types";
import net from "net";
import type { ClientHttp2Session } from "http2";

/**
 * Creates an HTTP/2 client session for the given target URL.
 * If a proxy configuration is provided, it creates an HTTP CONNECT tunnel.
 *
 * @param targetUrl The URL to connect to.
 * @param proxyConfig Optional proxy configuration.
 * @returns A promise that resolves with an HTTP/2 client session.
 */
export function createHttp2Session(
  targetUrl: URL,
  proxyConfig?: ProxyConfig,
): Promise<http2.ClientHttp2Session | http.ClientRequest> {
  return new Promise((resolve, reject) => {
    getSocket(targetUrl, proxyConfig)
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
            // Fallback to HTTPS for HTTP/1.1
            const req = https.request({
              host: targetUrl.hostname,
              port: Number(targetUrl.port || 443),
              createConnection: () => tlsSocket,
            });
            // Add a polyfill so that session.close() works in tests.
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
 * @returns A promise resolving with an object containing status, headers, and methods to retrieve the response body.
 */
export async function h2Request(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | string | undefined,
  proxy?: ProxyConfig,
  signal?: AbortSignal,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
}> {
  const targetUrl = new URL(url);
  let client: http2.ClientHttp2Session | http.ClientRequest | null = null;

  try {
    client = await createHttp2Session(targetUrl, proxy);

    return new Promise((resolve, reject) => {
      if (!client) {
        return reject(new Error("HTTP/2 client session is null"));
      }
      // Ensure the client is non-null for further usage.
      const safeClient = client!;

      if (isHttp2Session(safeClient)) {
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

          const bodyText = decompressed.toString("utf8");
          if (client && isHttp2Session(client)) {
            client.close();
          }

          resolve({
            status: Number(responseHeaders[":status"]) || 0,
            headers: responseHeaders,
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
      } else {
        // Handle HTTP/1.1 request
        const req = safeClient;
        req.end();

        let responseHeaders: http.IncomingHttpHeaders = {};
        const chunks: Buffer[] = [];

        req.on("response", (res) => {
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

          const bodyText = decompressed.toString("utf8");
          if (client && isHttp2Session(client)) {
            client.close();
          }

          resolve({
            status: Number(responseHeaders[":status"]) || 0,
            headers: responseHeaders,
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

// New helper: Incrementally obtain a socket, either via proxy or directly.
function getSocket(
  targetUrl: URL,
  proxyConfig?: ProxyConfig,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (proxyConfig) {
      const { host: proxyHost, port: proxyPort, auth } = proxyConfig;
      if (!proxyHost || !proxyPort || proxyHost === "" || proxyPort === 0) {
        return reject(new Error("Proxy configuration is incomplete"));
      }

      const connectOptions: http.RequestOptions = {
        host: proxyHost,
        port: Number(proxyPort),
        method: "CONNECT",
        path: `${targetUrl.hostname}:${Number(targetUrl.port || 443)}`,
        headers: {},
      };

      if (auth) {
        const [username, password] = auth.split(":");
        if (!username || !password) {
          return reject(new Error("Invalid proxy authentication format"));
        }
        connectOptions.headers = {
          "Proxy-Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        };
      }

      const req = http.request(connectOptions);
      req.end();

      req.on("connect", (res, socket) => {
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
        resolve(socket);
      });

      req.on("error", (err) => {
        reject(new Error(`Proxy connection failed: ${err.message}`));
      });
    } else {
      const socket = net.connect({
        host: targetUrl.hostname,
        port: Number(targetUrl.port || 443),
      });
      socket.on("error", reject);
      socket.on("connect", () => resolve(socket));
    }
  });
}

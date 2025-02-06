import http2 from "http2";
import http from "http";
import tls from "tls";
import { gunzipSync, inflateSync, brotliDecompressSync } from "zlib";
import { ProxyConfig } from "./types";

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
): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    if (!proxyConfig) {
      // Direct connection
      try {
        const session = http2.connect(targetUrl.origin);
        session.on("error", reject);
        return resolve(session);
      } catch (err) {
        return reject(err);
      }
    }

    // Validate proxy configuration
    const { host: proxyHost, port: proxyPort, auth } = proxyConfig;
    if (!proxyHost || !proxyPort) {
      return reject(
        new Error(
          "Proxy configuration is incomplete. Both HOST and PORT must be set",
        ),
      );
    }

    if (proxyHost === "" || proxyPort === 0) {
      return reject(
        new Error(
          "Proxy configuration is incomplete. Both HOST and PORT must be set",
        ),
      );
    }

    // Create an HTTP CONNECT tunnel via the proxy.
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
      connectOptions.headers = {
        ...connectOptions.headers,
        "Proxy-Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      };
    }

    const req = http.request(connectOptions);
    req.end();

    req.on("connect", (res, socket) => {
      if (res.statusCode === 407) {
        socket.destroy();
        return reject(
          new Error(
            `Proxy authentication failed. Status code: ${res.statusCode}, Message: ${res.statusMessage}`,
          ),
        );
      }
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(
          new Error(
            `Tunnel establishment failed. Status code: ${res.statusCode}, Message: ${res.statusMessage}`,
          ),
        );
      }

      // Perform TLS handshake through the tunnel.
      const tlsSocket: tls.TLSSocket = tls.connect(
        {
          socket,
          servername: targetUrl.hostname,
          ALPNProtocols: ["h2", "http/1.1"],
        },
        () => {
          if (tlsSocket.alpnProtocol !== "h2") {
            return reject(
              new Error(
                `Server did not negotiate HTTP/2, got: ${tlsSocket.alpnProtocol}`,
              ),
            );
          }
          const clientSession = http2.connect(`https://${targetUrl.hostname}`, {
            createConnection: () => tlsSocket,
          });
          clientSession.on("error", reject);
          resolve(clientSession);
        },
      );

      tlsSocket.on("error", (err) => {
        reject(new Error(`TLS handshake failed: ${err.message}`));
      });
    });

    req.on("error", (err) => {
      if (err.message.includes("timed out")) {
        return reject(err);
      }
      reject(
        new Error(
          `Proxy connection failed: ${err.message}. Check proxy settings: ${connectOptions.host}:${connectOptions.port}`,
        ),
      );
    });

    if (proxyConfig?.timeout) {
      req.setTimeout(proxyConfig.timeout, () => {
        req.destroy(new Error("Request timed out"));
      });
    }
  });
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
  let client: http2.ClientHttp2Session | null = null;

  try {
    client = await createHttp2Session(targetUrl, proxy);

    return new Promise((resolve, reject) => {
      if (!client) {
        return reject(new Error("HTTP/2 client session is null"));
      }
      const req = client.request({
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
          client?.close();
          return reject(
            new Error(`Decompression failed: ${(err as Error).message}`),
          );
        }

        const bodyText = decompressed.toString("utf8");
        client?.close();

        resolve({
          status: Number(responseHeaders[":status"]) || 0,
          headers: responseHeaders,
          text: async () => bodyText,
          json: async () => {
            try {
              return JSON.parse(bodyText);
            } catch (err) {
              throw new Error(`JSON parsing failed: ${(err as Error).message}`);
            }
          },
        });
      });

      req.on("error", (err) => {
        client?.close();
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
          client?.close();
        });
      }
    });
  } catch (err) {
    client?.close();
    throw new Error(
      `HTTP/2 session creation failed: ${(err as Error).message}`,
    );
  }
}

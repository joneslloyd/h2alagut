import { IncomingMessage } from "http";
import { Socket } from "net";
import { FetchResponse, H2Response } from "../types";
import { gunzip, inflate, brotliDecompress } from "zlib";
import { promisify } from "util";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

export async function decompressBuffer(
  buffer: Buffer,
  encoding?: string,
): Promise<Buffer> {
  if (!encoding) return buffer;
  if (encoding === "gzip") {
    return await gunzipAsync(buffer);
  }
  if (encoding === "deflate") {
    return await inflateAsync(buffer);
  }
  if (encoding === "br") {
    return await brotliDecompressAsync(buffer);
  }
  return buffer;
}

export function assembleInitialResponse(h2res: H2Response): FetchResponse {
  const response = new IncomingMessage(new Socket()) as FetchResponse;
  if (h2res.socket && h2res.socket.localAddress) {
    response.remoteAddress = h2res.socket.localAddress;
  }
  const rawStatus = h2res.headers[":status"] || h2res.status;
  response.status = rawStatus !== undefined ? Number(rawStatus) : undefined;
  Object.entries(h2res.headers)
    .filter(([key]) => !key.startsWith(":"))
    .forEach(([key, value]) => {
      response.headers[key] = value;
    });
  Object.entries(h2res.headers)
    .filter(([key]) => key.startsWith(":"))
    .forEach(([key, value]) => {
      (response as any)[key] = value;
    });
  return response;
}

export function createResponseTextMethod(
  h2res: H2Response,
  response: FetchResponse,
): () => Promise<string> {
  let cachedBody: string = "";
  return async () => {
    if (!cachedBody) {
      let data = await h2res.text();
      const encoding =
        typeof h2res.headers["content-encoding"] === "string"
          ? (h2res.headers["content-encoding"] as string)
          : undefined;
      if (Buffer.isBuffer(data)) {
        data = (await decompressBuffer(data, encoding)).toString();
      }
      cachedBody = data as string;
      response.push(cachedBody);
      response.push(null);
    }
    return cachedBody;
  };
}

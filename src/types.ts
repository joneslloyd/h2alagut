import { IncomingMessage } from "http";

export interface ProxyConfig {
  host: string;
  port: number;
  auth?: string; // Format: "username:password"
  timeout?: number;
}

/**
 * Extend the standard RequestInit with an optional proxy configuration.
 */
export interface H2FetchInit extends RequestInit {
  proxy?: ProxyConfig;
  timeout?: number;
  signal?: AbortSignal;
}

export interface FetchResponse extends IncomingMessage {
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  remoteAddress?: string;
}

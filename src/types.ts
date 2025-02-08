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
  debug?: boolean;
}

export interface FetchResponse extends IncomingMessage {
  status: number | undefined;
  json: () => Promise<any>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  remoteAddress?: string;
}

export interface H2Response {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
  ":status"?: string | number; // Add pseudo-header support
  ":remote-addr"?: string; // Add other pseudo-headers as needed
  socket?: { localAddress: string }; // Add socket property
  remoteAddress?: string; // Add remoteAddress property
}

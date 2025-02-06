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

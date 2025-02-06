import { ProxyConfig, H2FetchInit } from "../src/types";

describe("Type Definitions", () => {
  it("should validate ProxyConfig interface", () => {
    const config: ProxyConfig = {
      host: "proxy.com",
      port: 8080,
      auth: "user:pass",
    };
    expect(config).toBeDefined();
  });

  it("should validate H2FetchInit interface", () => {
    const init: H2FetchInit = {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      proxy: {
        host: "proxy.com",
        port: 8080,
      },
    };
    expect(init).toBeDefined();
  });
});

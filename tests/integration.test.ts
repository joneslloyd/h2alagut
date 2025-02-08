import { fetch } from "../src";

describe("Integration Tests", () => {
  it("should handle gzip compressed response", async () => {
    const response = await fetch("https://httpbin.org/gzip");
    const data = await response.json();
    expect(data.gzipped).toBe(true);
  }, 20000);

  it("should handle deflate compressed response", async () => {
    const response = await fetch("https://httpbin.org/deflate");
    const data = await response.json();
    expect(data.deflated).toBe(true);
  }, 20000);

  it("should handle brotli compressed response", async () => {
    const response = await fetch("https://httpbin.org/brotli");
    const data = await response.json();
    expect(data.brotli).toBe(true);
  }, 20000);

  it("should handle proxy authentication", async () => {
    if (!process.env.HOST || !process.env.PORT || !process.env.AUTH) {
      console.warn("Skipping proxy test - no proxy configuration found");
      return;
    }

    try {
      const response = await fetch("https://www.linkedin.com", {
        proxy: {
          host: process.env.HOST,
          port: parseInt(process.env.PORT),
          auth: process.env.AUTH,
        },
      });
      expect(response.status).toBe(200);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("Proxy authentication failed")
      ) {
        console.warn("Proxy authentication failed - check credentials");
        return;
      }
      throw error;
    }
  }, 20000);

  it("should handle HTTP/2 errors", async () => {
    await expect(fetch("https://invalid.domain")).rejects.toThrow();
  }, 20000);

  it("should handle different content types", async () => {
    const jsonResponse = await fetch("https://httpbin.org/json");
    expect(await jsonResponse.json()).toBeDefined();

    const textResponse = await fetch("https://httpbin.org/encoding/utf8");
    expect(await textResponse.text()).toBeDefined();

    const binaryResponse = await fetch("https://httpbin.org/image/png");
    expect(await binaryResponse.arrayBuffer()).toBeDefined();
  }, 20000);

  it("should handle timeout", async () => {
    await expect(
      fetch("https://httpbin.org/delay/3", {
        timeout: 1000,
      }),
    ).rejects.toThrow("Request timed out");
  }, 5000);
});

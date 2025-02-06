import { createHttp2Session } from "../src/adapter";
import { URL } from "url";

describe("createHttp2Session", () => {
  it("should create a direct connection without proxy", async () => {
    const url = new URL("https://example.com");
    const session = await createHttp2Session(url);
    expect(session).toBeDefined();
    session.close();
  });

  it("should throw error for incomplete proxy config", async () => {
    const url = new URL("https://example.com");
    await expect(
      createHttp2Session(url, {
        host: "",
        port: 0,
      }),
    ).rejects.toThrow("Proxy configuration is incomplete");
  });

  it("should throw error for proxy authentication failure", async () => {
    const url = new URL("https://example.com");
    await expect(
      createHttp2Session(url, {
        host: process.env.HOST ?? "invalid.proxy",
        port: parseInt(process.env.PORT ?? "0"),
        auth: "invalid:credentials",
      }),
    ).rejects.toThrow("Proxy authentication failed");
  });
});

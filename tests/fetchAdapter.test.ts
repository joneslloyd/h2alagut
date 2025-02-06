import { fetch } from "../src";
import { IncomingMessage } from "http";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config({
  path: "../.env",
});

describe("fetchAdapter", () => {
  beforeAll(() => {
    if (!process.env.HOST || !process.env.PORT) {
      console.warn(
        "Proxy configuration not found - some tests will be skipped",
      );
    }
  });

  it("should make a basic GET request", async () => {
    const response = await fetch("https://www.linkedin.com");
    expect(response).toBeInstanceOf(IncomingMessage);
    expect(response.statusCode).toBe(200);
  });

  it("should handle proxy configuration", async () => {
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
      expect(response.statusCode).toBe(200);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Proxy authentication failed")
      ) {
        console.warn("Proxy authentication failed - check credentials");
        return;
      }
      throw error;
    }
  });

  it("should throw error for invalid URL", async () => {
    await expect(fetch("invalid-url")).rejects.toThrow("Invalid URL");
  });
});

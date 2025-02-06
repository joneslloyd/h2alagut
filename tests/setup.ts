import dotenv from "dotenv";
import { resolve } from "path";

// Load .env from the root directory
dotenv.config({ path: resolve(__dirname, "../.env") });

// Verify environment variables are loaded
if (!process.env.HOST || !process.env.PORT) {
  console.warn("Proxy configuration not found in .env file");
}

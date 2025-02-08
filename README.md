# h2Alagút

**h2Alagút** is a fetch adapter for Node.js that uses HTTP/2 to perform requests and can tunnel through an HTTP/1 proxy via HTTP CONNECT. The name is inspired by the Hungarian word _alagút_ (meaning "tunnel").

## Features

- **HTTP/2:** Utilizes Node's built‑in [http2](https://nodejs.org/api/http2.html) module.
- **Proxy Tunneling:** Automatically tunnels through an HTTP/1 proxy (via HTTP CONNECT) when a `proxy` configuration is provided.
- **Fetch-like API:** Provides a drop‑in replacement for the standard Fetch API. The returned `Response` object supports properties such as `status` and methods like `text()` and `json()`.

## Installation

`npm install h2alagut` or `yarn add h2alagut` or `pnpm add h2alagut`

## Usage

```js
import { fetch } from "h2alagut";

const response = await fetch("https://example.com");
console.log(response.statusCode);
```

## Proxy Configuration

```js
const response = await fetch("https://example.com", {
  proxy: {
    host: "your-proxy-server",
    port: 8080,
    auth: "username:password", // Optional
  },
});
```

## Response Object

The `Response` object returned by `h2Alagút` supports the following properties and methods:

- `statusCode`: The HTTP status code.
- `text()`: Returns the response body as a string.
- `json()`: Parses the response body as JSON.
- `arrayBuffer()`: Returns the response body as an `ArrayBuffer`.

## Timeout Handling

You can specify a timeout for the request:

```js
const response = await fetch("https://example.com", {
  timeout: 5000, // Timeout in milliseconds
});
```

## Error Handling

The adapter throws errors for:

- Invalid URLs
- Proxy authentication failures
- Request timeouts
- HTTP/2 negotiation failures

## Example

```js
import { fetch } from "h2alagut";

try {
  const response = await fetch("https://example.com", {
    proxy: {
      host: "proxy.example.com",
      port: 8080,
      auth: "user:pass",
    },
    timeout: 3000,
  });

  console.log(response.status);
  console.log(await response.text());
} catch (error) {
  console.error("Request failed:", error.message);
}
```

## License

MIT

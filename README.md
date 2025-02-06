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
import h2Alagut from "h2alagut";

const response = await h2Alagut("https://example.com");
console.log(response.status);
```

## Proxy Configuration

```js
const response = await h2Alagut("https://example.com", {
  proxy: "http://your-proxy-server:8080",
});
```

## Response Object

The `Response` object returned by `h2Alagut` supports the following properties and methods:

- `status`: The HTTP status code.
- `text()`: Returns the response body as a string.
- `json()`: Parses the response body as JSON.

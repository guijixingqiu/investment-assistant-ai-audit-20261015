# Web Core Assistance Journey

This is a dependency-free browser candidate for the completed CORE-1 assistance loop.

Run `npm run build`, then start the local-only server:

```bash
WEB_PORT=4173 WEB_API_BASE_URL=http://127.0.0.1:3000 node apps/web/dev-server.mjs
```

The server binds to loopback by default, serves only repository Web assets, and proxies only existing `/api/mobile/...` routes to a loopback candidate API. Runtime authentication header name and token are entered in the browser, held in memory only, and are not written to Web storage.

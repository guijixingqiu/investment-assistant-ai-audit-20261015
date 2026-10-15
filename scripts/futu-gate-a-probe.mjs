import net from "node:net";

const futuHost = process.env.FUTU_HOST ?? "127.0.0.1";
const futuPort = Number.parseInt(process.env.FUTU_PORT ?? "11111", 10);
const marketDataUrl = process.env.FUTU_MARKET_DATA_URL ?? "http://127.0.0.1:4300";
const symbol = {
  market: process.env.GATE_A_MARKET ?? "HK",
  code: process.env.GATE_A_CODE ?? "09926"
};

const result = {
  checkedAt: new Date().toISOString(),
  futuOpenD: {
    host: futuHost,
    port: futuPort,
    tcpReachable: await tcpReachable(futuHost, futuPort, 2_000)
  },
  marketData: {
    url: marketDataUrl,
    health: await fetchJson(`${marketDataUrl}/health`),
    quote: await fetchJson(`${marketDataUrl}/quote?market=${encodeURIComponent(symbol.market)}&ticker=${encodeURIComponent(symbol.code)}`)
  }
};

const quote = result.marketData.quote.ok ? result.marketData.quote.payload?.quote : null;
const quoteSource = quote && typeof quote === "object" ? quote.source : null;
const ok = Boolean(result.futuOpenD.tcpReachable && result.marketData.health.ok && quote && quoteSource === "futu_quote");

console.log(JSON.stringify({
  ...result,
  gateA: {
    ok,
    status: ok ? "verified" : "unverified",
    message: ok
      ? `Futu OpenD quote verified for ${symbol.market}.${symbol.code}.`
      : "未验证: Futu OpenD or market-data /quote is unavailable, unauthenticated, or not returning source=futu_quote."
  }
}, null, 2));

process.exit(ok ? 0 : 2);

function tcpReachable(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

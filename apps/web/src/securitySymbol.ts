export interface CanonicalSecuritySymbol {
  market: "HK";
  code: string;
  symbol: string;
}

export function parseHongKongSymbol(input: string): { ok: true; value: CanonicalSecuritySymbol } | { ok: false; message: string } {
  const normalized = input.trim().toUpperCase().replace(/\s+/g, "");
  const hkDot = normalized.match(/^HK\.(\d{1,5})$/);
  const hkPrefix = normalized.match(/^HK(\d{1,5})$/);
  const suffix = normalized.match(/^(\d{1,5})\.HK$/);
  const bare = normalized.match(/^(\d{1,5})$/);
  const code = hkDot?.[1] ?? hkPrefix?.[1] ?? suffix?.[1] ?? bare?.[1] ?? null;

  if (!code) {
    return { ok: false, message: "Enter a Hong Kong symbol such as HK.00175 or 00175.hk." };
  }

  const padded = code.padStart(5, "0");
  if (!/^\d{5}$/.test(padded)) {
    return { ok: false, message: "Hong Kong stock code must be five digits after normalization." };
  }

  return {
    ok: true,
    value: {
      market: "HK",
      code: padded,
      symbol: `HK.${padded}`
    }
  };
}

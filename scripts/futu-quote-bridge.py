#!/usr/bin/env python3
"""Loopback-only, read-only market-data adapter for Futu OpenD."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import multiprocessing
import os
import re
import sys
from pathlib import Path
from datetime import date, datetime, time, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional, Set
from urllib.parse import parse_qs, urlparse

HK_TZ = timezone(timedelta(hours=8))
HOLIDAYS_2024 = {
    "2024-01-01", "2024-02-12", "2024-02-13", "2024-03-29", "2024-04-01", "2024-04-04",
    "2024-05-01", "2024-05-15", "2024-06-10", "2024-07-01", "2024-09-18", "2024-10-01",
    "2024-10-11", "2024-12-25", "2024-12-26",
}
HOLIDAYS_2025 = {
    "2025-01-01", "2025-01-29", "2025-01-30", "2025-01-31", "2025-04-04", "2025-04-18",
    "2025-04-21", "2025-05-01", "2025-05-05", "2025-07-01", "2025-10-01", "2025-10-07",
    "2025-10-29", "2025-12-25", "2025-12-26",
}
HOLIDAYS_2026 = {
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19",
    "2026-04-03", "2026-04-06", "2026-04-07", "2026-05-01",
    "2026-05-25", "2026-06-19", "2026-07-01", "2026-10-01",
    "2026-10-19", "2026-12-25",
}
HKEX_HOLIDAYS = {2024: HOLIDAYS_2024, 2025: HOLIDAYS_2025, 2026: HOLIDAYS_2026}
# HKEX cancelled all securities sessions on 2024-09-06 (Typhoon Signal No. 8):
# https://www.hkex.com.hk/News/Market-Communications/2024/2409062news?sc_lang=en
EXTRAORDINARY_CLOSURES = {"2024-09-06"}
HALF_DAYS = {
    "2024-02-09", "2024-12-24", "2024-12-31",
    "2025-01-28", "2025-12-24", "2025-12-31",
    "2026-02-16", "2026-12-24", "2026-12-31",
}
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
MAX_BODY_BYTES = 16_384
DAILY_HISTORY_WINDOW_START = date(2026, 1, 1)
WEINSTEIN_WEEKLY_YEARS = 5
NOTICE_LEAD_LIMIT = 50
OPEND_REQUEST_TIMEOUT_SECONDS = 20.0
OPEND_HEALTH_TIMEOUT_SECONDS = 20.0
OPEND_QUOTE_TIMEOUT_SECONDS = 4.0
OPEND_HISTORY_TIMEOUT_SECONDS = 4.0
OPEND_FINANCIAL_TIMEOUT_SECONDS = 6.0
OPEND_VALUATION_TIMEOUT_SECONDS = 6.0


def history_use_authority(configured: str | None = None) -> dict[str, str]:
    value = (configured if configured is not None
             else os.environ.get("FUTU_HISTORY_USE_AUTHORITY", "")).strip().lower() or "unknown"
    if value not in {"confirmed", "unknown", "denied"}:
        raise BridgeError(503, "FUTU_HISTORY_USE_AUTHORITY must be confirmed, unknown, or denied")
    return {"rights": value, "retention": value, "derivedUse": value}


class BridgeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def real_date(value: object) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise BridgeError(400, "date must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise BridgeError(400, "date must be real") from error


def completed_sessions(cutoff: str, evaluated_at: datetime | None = None,
                       start_value: str | None = None) -> list[str]:
    end = real_date(cutoff)
    start = real_date(start_value) if start_value else date(end.year, 1, 1)
    if start < date(2024, 1, 1) or end > date(2026, 12, 31) or start > end:
        raise BridgeError(400, "verified HKEX calendar requires an ordered 2024-2026 range")
    now = evaluated_at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("evaluated_at must be timezone-aware")
    if end > now.astimezone(HK_TZ).date():
        raise BridgeError(400, "HKEX cutoff cannot be in the future")
    sessions: list[str] = []
    cursor = start
    while cursor <= end:
        session = cursor.isoformat()
        close_at = datetime.combine(cursor, time(16, 10), HK_TZ)
        if (cursor.weekday() < 5 and session not in HKEX_HOLIDAYS[cursor.year]
                and session not in EXTRAORDINARY_CLOSURES and close_at <= now):
            sessions.append(session)
        cursor += timedelta(days=1)
    if not sessions:
        raise BridgeError(503, "no completed HKEX session exists for the cutoff")
    return sessions


def calendar_version(cutoff: str, sessions: list[str]) -> str:
    canonical = json.dumps(sessions, ensure_ascii=False, separators=(",", ":"))
    return f"hkex_completed_sessions_v1:{cutoff}:{hashlib.sha256(canonical.encode()).hexdigest()}"


def finite_number(
    value: object, field: str, *, positive: bool = False, nonnegative: bool = False
) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise BridgeError(503, f"OpenD omitted valid {field}") from error
    if not math.isfinite(number) or (positive and number <= 0) or (nonnegative and number < 0):
        raise BridgeError(503, f"OpenD omitted valid {field}")
    return number


def nonnegative_integer(value: object, field: str) -> int:
    number = finite_number(value, field, nonnegative=True)
    if not number.is_integer():
        raise BridgeError(503, f"OpenD omitted valid {field}")
    return int(number)


def hk_instant(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise BridgeError(503, f"OpenD omitted valid {field}")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=HK_TZ)
    except ValueError as error:
        raise BridgeError(503, f"OpenD omitted valid {field}") from error
    return parsed.isoformat(timespec="seconds")


def hk_news_instant(value: object, fetched_at: datetime, field: str) -> str:
    if not isinstance(value, str):
        raise BridgeError(503, f"OpenD omitted valid {field}")
    try:
        return hk_instant(value, field)
    except BridgeError:
        pass
    try:
        month, day = (int(part) for part in value.split("/"))
        fetched_hk = fetched_at.astimezone(HK_TZ)
        parsed = datetime(fetched_hk.year, month, day, tzinfo=HK_TZ)
        if parsed > fetched_hk:
            parsed = parsed.replace(year=parsed.year - 1)
    except (TypeError, ValueError) as error:
        raise BridgeError(503, f"OpenD omitted valid {field}") from error
    return parsed.isoformat(timespec="seconds")


def change_percent(last: float, previous: float) -> float:
    return round((last / previous - 1) * 100, 6)


def percentage_points_from_ratio(value: object, field: str) -> float:
    return round(finite_number(value, field) * 100, 6)


def has_exact_codes(rows: list[object], expected_codes: Set[str]) -> bool:
    return len(rows) == len(expected_codes) and {
        row.get("code") for row in rows if isinstance(row, dict)
    } == expected_codes


def valid_industry_codes(codes: list[object]) -> bool:
    return len(codes) >= 10 and all(
        isinstance(code, str) and re.fullmatch(r"HK\.LIST\d+", code) for code in codes
    ) and len(set(codes)) == len(codes)


EXPLICIT_UNKNOWN_LIST_CODE = re.compile(r"未知股票 (?:HK\.)?(LIST\d+)")


def explicitly_rejected_industry_code(result: object) -> Optional[str]:
    """Return the one requested HK.LIST code OpenD explicitly rejects, else None."""
    if not isinstance(result, str):
        return None
    match = EXPLICIT_UNKNOWN_LIST_CODE.fullmatch(result.strip())
    return None if match is None else f"HK.{match.group(1)}"


def has_current_daily_history_window(value: object) -> bool:
    try:
        return isinstance(value, str) and date.fromisoformat(value) <= DAILY_HISTORY_WINDOW_START
    except ValueError:
        return False


def load_futu():
    try:
        import futu  # type: ignore
    except ImportError as error:
        raise BridgeError(503, "futu-api is not installed") from error
    return futu


def open_quote_context(futu, host: str, port: int):
    try:
        return futu.OpenQuoteContext(host=host, port=port)
    except Exception as error:
        raise BridgeError(503, "OpenD connection unavailable") from error


def _prepare_worker_stdio() -> None:
    broken = False
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except (OSError, ValueError):
            broken = True
    if broken:
        with open(os.devnull, "w") as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)


def bounded_open_d_call(target, *args, timeout: float = OPEND_REQUEST_TIMEOUT_SECONDS):
    receive, send = multiprocessing.get_context("spawn").Pipe(duplex=False)
    process = multiprocessing.get_context("spawn").Process(
        target=_open_d_child,
        args=(send, target, args),
        daemon=True,
    )
    started = False
    try:
        _prepare_worker_stdio()
        process.start()
        started = True
        send.close()
        if not receive.poll(timeout):
            raise BridgeError(503, "OpenD request timed out")
        kind, payload = receive.recv()
        if kind == "ok":
            return payload
        if kind == "bridge_error":
            raise BridgeError(payload[0], payload[1])
        raise BridgeError(503, "OpenD request failed")
    finally:
        receive.close()
        if started:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)


def _open_d_child(send, target, args) -> None:
    try:
        send.send(("ok", target(*args)))
    except BridgeError as error:
        send.send(("bridge_error", (error.status, str(error))))
    except Exception:
        send.send(("error", None))
    finally:
        send.close()


def health(host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        server_version = opend_server_version(context, futu)
    finally:
        context.close()
    capabilities = ["quote", "market_environment", "stock_search", "stock_screen", "history_kline", "weinstein_weekly", "financial_statements"]
    return {
        "ok": True,
        "source": "futu_opend_read_only_market_data",
        "opendServerVersion": server_version,
        "capabilities": capabilities,
        "noticeLeadsStatus": "unavailable",
    }


def advertise_notice_capability(payload: dict) -> dict:
    return {
        **payload,
        "capabilities": [*payload["capabilities"], "notice_leads", "major_news_leads"],
        "noticeLeadsStatus": "available",
    }


def quote(symbol: str, host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, frame = context.get_market_snapshot([symbol])
        if ret != futu.RET_OK or frame is None or len(frame.index) != 1:
            raise BridgeError(503, "OpenD quote request failed")
        row = frame.iloc[0].to_dict()
    finally:
        context.close()

    if row.get("code") != symbol:
        raise BridgeError(503, "OpenD returned a different quote identity")
    price = finite_number(row.get("last_price"), "last_price", positive=True)
    previous = finite_number(row.get("prev_close_price"), "prev_close_price", positive=True)
    change = finite_number(price - previous, "change_amount")
    change_percent = finite_number(change / previous * 100, "change_percent")
    return {
        "ok": True,
        "quote": {
            "market": "HK",
            "ticker": symbol.split(".", 1)[1],
            "symbol": symbol,
            "name": row.get("name") if isinstance(row.get("name"), str) else None,
            "price": price,
            "prev_close": previous,
            "change_amount": change,
            "change_percent": change_percent,
            "update_time": row.get("update_time"),
            "source": "futu_quote",
            "currency": "HKD",
        },
    }


def stock_search_results(query: str, rows: list[object]) -> list[dict[str, str]]:
    query = query.strip()
    if not 1 <= len(query) <= 80:
        raise BridgeError(400, "search query must contain 1 to 80 characters")
    identity = re.fullmatch(r"(?:hk\.(\d{5})|(\d{5})(?:\.hk)?)", query.casefold())
    needle = (identity.group(1) or identity.group(2)) if identity else query.casefold()
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise BridgeError(503, "OpenD returned malformed Hong Kong stock information")
        if row.get("delisting") in (True, 1):
            continue
        symbol = row.get("code")
        name = row.get("name")
        if isinstance(symbol, str) and re.fullmatch(r"HK\.\d{6}", symbol):
            continue
        if not isinstance(symbol, str) or not re.fullmatch(r"HK\.\d{5}", symbol):
            raise BridgeError(503, "OpenD returned invalid Hong Kong stock identity")
        if not isinstance(name, str) or not name.strip() or symbol in seen:
            raise BridgeError(503, "OpenD returned missing or duplicate Hong Kong stock identity")
        seen.add(symbol)
        code = symbol[3:]
        if needle in code or needle in name.casefold():
            results.append({"market": "HK", "code": code, "symbol": symbol, "name": name.strip()})
    # ponytail: sort the one fetched universe in memory; add an index only if measured search latency needs it.
    return sorted(results, key=lambda item: item["code"])[:20]


def stock_search(query: str, host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, frame = context.get_stock_basicinfo(futu.Market.HK, futu.SecurityType.STOCK)
        if ret != futu.RET_OK or frame is None:
            raise BridgeError(503, "OpenD Hong Kong stock search failed")
        results = stock_search_results(query, frame.to_dict("records"))
    finally:
        context.close()
    return {
        "ok": True,
        "source": "futu_opend_hk_stock_basicinfo",
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "query": query,
        "results": results,
    }


def notice_lead_results(
    symbol: str,
    limit: int,
    rows: list[object],
    fetched_at: datetime,
) -> list[dict[str, object]]:
    if not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "notice symbol must be canonical HK.<five digits>")
    if not 1 <= limit <= NOTICE_LEAD_LIMIT:
        raise BridgeError(400, f"notice limit must be between 1 and {NOTICE_LEAD_LIMIT}")
    if fetched_at.tzinfo is None:
        raise ValueError("fetched_at must be timezone-aware")
    notices: list[dict[str, object]] = []
    news: list[dict[str, object]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise BridgeError(503, "OpenD returned malformed NOTICE rows")
        news_sub_type = row.get("news_sub_type")
        if news_sub_type not in {"NOTICE", "NEWS"}:
            raise BridgeError(503, "OpenD returned an unsupported news subtype")
        title = row.get("title")
        source = row.get("source")
        url = row.get("url")
        related = row.get("related_securities")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 500:
            raise BridgeError(503, "OpenD omitted a valid NOTICE title")
        if not isinstance(source, str) or not 1 <= len(source.strip()) <= 200:
            raise BridgeError(503, "OpenD omitted a valid NOTICE source")
        parsed_url = urlparse(url) if isinstance(url, str) else None
        if (parsed_url is None or len(url) > 2000 or parsed_url.scheme != "https"
                or not parsed_url.hostname or parsed_url.username or parsed_url.password):
            raise BridgeError(503, "OpenD omitted a safe NOTICE URL")
        if (not isinstance(related, list)
                or not all(isinstance(item, str)
                           and re.fullmatch(r"[A-Z]{2,4}\.[A-Z0-9]{1,20}", item)
                           for item in related)
                or len(set(related)) != len(related)):
            raise BridgeError(503, "OpenD returned invalid NOTICE related securities")
        if symbol not in related and (news_sub_type == "NOTICE" or related):
            continue
        published_at = hk_news_instant(row.get("publish_time"), fetched_at, "NOTICE publish_time")
        if datetime.fromisoformat(published_at) > fetched_at.astimezone(HK_TZ):
            raise BridgeError(503, "OpenD returned a future NOTICE publish_time")
        identity = f"{published_at}|{url}"
        if identity in seen:
            continue
        seen.add(identity)
        lead = {
            "kind": "notice" if news_sub_type == "NOTICE" else "major_news",
            "title": title.strip(),
            "source": source.strip(),
            "publish_time": published_at,
            "related_securities": related,
            "url": url,
        }
        (notices if news_sub_type == "NOTICE" else news).append(lead)
    # ponytail: keep one exact NOTICE lead; HKEX remains the complete official-announcement lane.
    selected = notices[:1]
    selected.extend(news[:limit - len(selected)])
    selected.extend(notices[1:1 + max(0, limit - len(selected))])
    return selected


def opend_server_version(context: object, futu: object) -> int:
    ret, state = context.get_global_state()
    value = state.get("server_ver") if ret == futu.RET_OK and isinstance(state, dict) else None
    if not isinstance(value, (int, str)) or not str(value).isdigit():
        raise BridgeError(503, "OpenD version is unavailable")
    return int(value)


def notice_frame(context: object, futu: object, symbol: str, limit: int) -> list[object]:
    method = getattr(context, "get_search_news", None)
    subtype_class = getattr(futu, "NewsSubType", None)
    subtypes = [getattr(subtype_class, name, None) for name in ("NOTICE", "NEWS")]
    if not callable(method) or any(subtype is None for subtype in subtypes):
        raise BridgeError(503, "OpenD information search is unavailable")
    rows: list[object] = []
    for subtype in subtypes:
        ret, frame = method(symbol, max_count=limit, news_sub_type=subtype)
        if ret != futu.RET_OK or frame is None:
            raise BridgeError(503, "OpenD information search is unavailable")
        rows.extend(frame.to_dict("records"))
    return rows


def notice_leads(symbol: str, limit: int, host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        rows = notice_frame(context, futu, symbol, limit)
    finally:
        context.close()
    fetched_at = datetime.now(timezone.utc)
    return {
        "ok": True,
        "source": "futu_opend_search_news_information",
        "requestedSymbol": symbol,
        "fetchedAt": fetched_at.isoformat(timespec="seconds"),
        "leads": notice_lead_results(symbol, limit, rows, fetched_at),
        "evidenceStatus": "unverified_source_lead",
    }


def screen_result(results: object, result_type: str, name: int, days: int | None = None) -> object:
    if not isinstance(results, list):
        raise BridgeError(503, "OpenD returned malformed stock-screen results")
    matches = []
    for result in results:
        if not isinstance(result, dict) or result.get("type") != result_type:
            continue
        prop = result.get("property")
        if not isinstance(prop, dict) or prop.get("name") != name:
            continue
        if days is not None and prop.get("days") != days:
            continue
        matches.append(result)
    if len(matches) != 1:
        raise BridgeError(503, "OpenD omitted one exact stock-screen property")
    result = matches[0]
    return result.get("sval") if result.get("value_type") == 1 else result.get("dval")


def stock_screen(host: str, port: int, target_symbol: str | None = None) -> dict:
    if target_symbol is not None and not re.fullmatch(r"HK\.\d{5}", target_symbol):
        raise BridgeError(400, "stock-screen symbol must be canonical HK.#####")
    futu = load_futu()
    request = futu.StockScreenRequest()
    request.page_from = 0
    request.page_count = 200
    request.add_simple_field(futu.SimpleField.MARKET, [futu.ScrMarket.HK])
    request.add_simple_property(futu.SimpleProperty.PRICE, lower=1)
    request.add_simple_property(futu.SimpleProperty.MARKET_CAP, lower=5_000_000_000)
    request.add_cumulative_property(futu.CumulativeProperty.AVG_TURNOVER, days=20, lower=20_000_000)
    for prop in (futu.BasicProperty.CODE, futu.BasicProperty.NAME, futu.BasicProperty.INDUSTRY):
        request.add_retrieve_basic(prop)
    request.add_retrieve_cumulative(futu.CumulativeProperty.AVG_TURNOVER, days=20)
    request.add_retrieve_cumulative(futu.CumulativeProperty.PRICE_CHANGE_PCT, days=5)
    request.set_sort(
        futu.ScrSortDir.ABS_DESC,
        "cumulative",
        {"name": int(futu.CumulativeProperty.PRICE_CHANGE_PCT), "days": 5},
    )

    context = open_quote_context(futu, host, port)
    try:
        rows = []
        all_count = None
        while True:
            ret, payload = context.get_stock_screen(request)
            if ret != futu.RET_OK or not isinstance(payload, tuple) or len(payload) != 3:
                raise BridgeError(503, "OpenD stock-screen request failed")
            last_page, page_count, page_rows = payload
            if not isinstance(page_rows, list) or not isinstance(last_page, int):
                raise BridgeError(503, "OpenD returned malformed stock-screen rows")
            if all_count is None:
                all_count = page_count
            elif page_count != all_count:
                raise BridgeError(503, "OpenD stock-screen count changed during exact-symbol read")
            if target_symbol is None:
                rows.extend(page_rows)
                if len(rows) > 5000:
                    raise BridgeError(503, "OpenD screening exceeds the supported full-market bound")
                if last_page:
                    if len(rows) != all_count:
                        raise BridgeError(503, "OpenD screening pagination is incomplete")
                    break
                if not page_rows:
                    raise BridgeError(503, "OpenD screening pagination made no progress")
                request.page_from += request.page_count
                continue
            target_code = target_symbol.split(".", 1)[1]
            matches = [row for row in page_rows if screen_result(
                row.get("results") if isinstance(row, dict) else None,
                "basic", int(futu.BasicProperty.CODE),
            ) == target_code]
            if len(matches) > 1:
                raise BridgeError(503, "OpenD returned duplicate exact stock-screen identity")
            if matches or last_page:
                rows = matches
                break
            request.page_from += request.page_count
        decoded = []
        for row in rows:
            if not isinstance(row, dict):
                raise BridgeError(503, "OpenD returned malformed stock-screen row")
            results = row.get("results")
            code = screen_result(results, "basic", int(futu.BasicProperty.CODE))
            name = screen_result(results, "basic", int(futu.BasicProperty.NAME))
            industry = screen_result(results, "basic", int(futu.BasicProperty.INDUSTRY))
            if not isinstance(code, str) or not re.fullmatch(r"\d{5}", code):
                raise BridgeError(503, "OpenD returned invalid Hong Kong stock identity")
            if not isinstance(name, str) or not name.strip():
                raise BridgeError(503, "OpenD omitted stock name")
            decoded.append({
                "symbol": f"HK.{code}",
                "name": name.strip(),
                "industry": industry.strip() if isinstance(industry, str) and industry.strip() else None,
                "average20DayTurnover": finite_number(
                    screen_result(results, "cumulative", int(futu.CumulativeProperty.AVG_TURNOVER), 20),
                    "20-day average turnover",
                    nonnegative=True,
                ),
                "fiveDayChangePercent": percentage_points_from_ratio(
                    screen_result(results, "cumulative", int(futu.CumulativeProperty.PRICE_CHANGE_PCT), 5),
                    "5-day price change ratio",
                ),
            })
        symbols = [item["symbol"] for item in decoded]
        if len(symbols) != len(set(symbols)):
            raise BridgeError(503, "OpenD returned duplicate stock-screen identities")
        snapshot_rows = {}
        # OpenD snapshot calls are bounded; read every screened identity, not one display page.
        for offset in range(0, len(symbols), 200):
            batch = symbols[offset:offset + 200]
            ret, snapshots = context.get_market_snapshot(batch)
            if ret != futu.RET_OK or snapshots is None:
                raise BridgeError(503, "OpenD candidate snapshot request failed")
            batch_rows = snapshots.to_dict("records")
            if not has_exact_codes(batch_rows, set(batch)):
                raise BridgeError(503, "OpenD returned incomplete candidate snapshots")
            snapshot_rows.update({row["code"]: row for row in batch_rows})
    finally:
        context.close()

    candidates = []
    unavailable_symbols = []
    for item in decoded:
        row = snapshot_rows[item["symbol"]]
        if row.get("suspension") in (True, 1):
            continue
        code = item["symbol"].split(".", 1)[1]
        try:
            candidates.append({
                "market": "HK",
                "code": code,
                **item,
                "price": finite_number(row.get("last_price"), "candidate last_price", positive=True),
                "marketCap": finite_number(row.get("total_market_val"), "candidate market cap", positive=True),
                "volumeRatio": finite_number(row.get("volume_ratio"), "candidate volume ratio", nonnegative=True),
                "asOf": hk_instant(row.get("update_time"), "candidate update_time"),
                "why": "符合价格、市值与成交额条件；按5日涨跌幅绝对值排列，停牌股票不纳入。日线研究覆盖需另行核对。",
            })
        except BridgeError:
            unavailable_symbols.append(item["symbol"])

    return {
        "ok": True,
        "source": "futu_opend_stock_screen_v2",
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rule": {
            "id": "market_attention_v1",
            "summary": "港股价格≥1港元、市值≥50亿港元、20日平均成交额≥2000万港元；排除停牌，按5日涨跌幅绝对值排序（包含上涨和下跌）。",
            "notRecommendation": True,
        },
        "totalMatched": nonnegative_integer(all_count, "stock-screen total count"),
        "coverage": {"scope": "selected_symbol" if target_symbol else "market", "complete": True,
                     "scanned": len(rows), "returned": len(candidates), "unavailableSymbols": unavailable_symbols},
        "candidates": candidates,
    }


def normalize_market_state(value: object) -> object:
    return "PRE_OPEN" if value in {"AUCTION", "WAITING_OPEN"} else value


def market_environment(symbol: str, host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    index_codes = ["HK.800000", "HK.800100", "HK.800700"]
    try:
        ret, index_frame = context.get_market_snapshot(index_codes)
        if ret != futu.RET_OK or index_frame is None:
            raise BridgeError(503, "OpenD index snapshot request failed")
        index_rows = {row.get("code"): row for row in index_frame.to_dict("records")}
        indices = [index_fact(index_rows.get(code), code) for code in index_codes]

        ret, state_frame = context.get_market_state(index_codes)
        if ret != futu.RET_OK or state_frame is None:
            raise BridgeError(503, "OpenD market-state request failed")
        state_rows = {row.get("code"): row for row in state_frame.to_dict("records")}
        market_state = normalize_market_state(state_rows.get("HK.800000", {}).get("market_state"))
        if not isinstance(market_state, str) or not market_state:
            raise BridgeError(503, "OpenD omitted valid Hong Kong market state")

        ret, plate_frame = context.get_plate_list(futu.Market.HK, futu.Plate.INDUSTRY)
        if ret != futu.RET_OK or plate_frame is None:
            raise BridgeError(503, "OpenD industry list request failed")
        plate_column = plate_frame.get("code")
        plate_codes = [] if plate_column is None else plate_column.tolist()
        if not valid_industry_codes(plate_codes):
            raise BridgeError(503, "OpenD returned an invalid Hong Kong industry universe")
        plate_code_set = set(plate_codes)
        sector_rows = []
        rejected_codes: list[str] = []
        for offset in range(0, len(plate_codes), 20):
            batch = list(plate_codes[offset:offset + 20])
            while batch:
                ret, sector_frame = context.get_market_snapshot(batch)
                if ret == futu.RET_OK and sector_frame is not None:
                    sector_rows.extend(sector_frame.to_dict("records"))
                    break
                rejected_code = explicitly_rejected_industry_code(sector_frame)
                if rejected_code is None or rejected_code not in batch:
                    raise BridgeError(503, "OpenD industry snapshot request failed")
                batch.remove(rejected_code)
                rejected_codes.append(rejected_code)
        usable_code_set = plate_code_set - set(rejected_codes)
        if len(usable_code_set) < 10:
            raise BridgeError(503, "OpenD returned fewer than ten usable Hong Kong industries")
        if not has_exact_codes(sector_rows, usable_code_set):
            raise BridgeError(503, "OpenD returned an incomplete Hong Kong industry snapshot")
        sectors = [sector_fact(row, usable_code_set) for row in sector_rows]
        sectors.sort(key=lambda item: (item["changePercent"], item["code"]))
        laggards = sectors[:5]
        leaders = list(reversed(sectors[-5:]))

        capital_flow = None if market_state in {"CLOSED", "PRE_OPEN"} else selected_stock_capital_flow(context, futu, symbol)
    finally:
        context.close()

    hsi = indices[0]
    breadth_total = hsi["advancers"] + hsi["decliners"] + hsi["unchanged"]
    if breadth_total <= 0:
        raise BridgeError(503, "OpenD returned empty Hang Seng breadth")
    advance_ratio = round(hsi["advancers"] / breadth_total, 6)
    breadth_signal = "broad_strength" if advance_ratio >= 0.55 else (
        "broad_weakness" if advance_ratio <= 0.45 else "mixed"
    )
    unknowns = ["full_hk_market_net_capital_flow_not_provided_by_opend"]
    if rejected_codes:
        unknowns.append(
            f"行业列表共 {len(plate_codes)} 个，成功返回 {len(sectors)} 个，OpenD 未返回：{'、'.join(sorted(rejected_codes))}。"
            f"领涨领跌排名与行业强弱差仅覆盖已返回的 {len(sectors)} 个行业样本，不代表全部行业。"
        )
    if capital_flow is None:
        unknowns.append("selected_stock_capital_flow_unavailable")
    return {
        "ok": True,
        "environment": {
            "market": "HK",
            "selectedSymbol": symbol,
            "marketState": market_state,
            "indices": indices,
            "sectors": {
                "universeCount": len(sectors),
                "leaders": leaders,
                "laggards": laggards,
            },
            "breadth": {
                "advancers": hsi["advancers"],
                "decliners": hsi["decliners"],
                "unchanged": hsi["unchanged"],
                "advanceRatio": advance_ratio,
            },
            "selectedStockCapitalFlow": capital_flow,
            "risk": {
                "breadthSignal": breadth_signal,
                "sectorDispersionPercent": round(leaders[0]["changePercent"] - laggards[0]["changePercent"], 6),
                "hsiAmplitudePercent": hsi["amplitudePercent"],
            },
            "unknowns": unknowns,
        },
    }


def index_fact(row: object, expected_code: str) -> dict:
    if not isinstance(row, dict) or row.get("code") != expected_code:
        raise BridgeError(503, "OpenD returned mixed index identity")
    if row.get("index_valid") not in (True, 1):
        raise BridgeError(503, "OpenD returned invalid index breadth")
    last = finite_number(row.get("last_price"), "index last_price", positive=True)
    previous = finite_number(row.get("prev_close_price"), "index prev_close_price", positive=True)
    name = row.get("name")
    if not isinstance(name, str) or not name:
        raise BridgeError(503, "OpenD omitted index name")
    return {
        "symbol": expected_code,
        "name": name,
        "last": last,
        "previousClose": previous,
        "changePercent": change_percent(last, previous),
        "turnover": finite_number(row.get("turnover"), "index turnover", nonnegative=True),
        "amplitudePercent": finite_number(row.get("amplitude"), "index amplitude", nonnegative=True),
        "advancers": nonnegative_integer(row.get("index_raise_count"), "index advancers"),
        "decliners": nonnegative_integer(row.get("index_fall_count"), "index decliners"),
        "unchanged": nonnegative_integer(row.get("index_equal_count"), "index unchanged"),
        "asOf": hk_instant(row.get("update_time"), "index update_time"),
    }


def sector_fact(row: object, expected_codes: Set[str]) -> dict:
    if not isinstance(row, dict) or row.get("code") not in expected_codes:
        raise BridgeError(503, "OpenD returned mixed industry identity")
    if row.get("plate_valid") not in (True, 1):
        raise BridgeError(503, "OpenD returned invalid industry breadth")
    last = finite_number(row.get("last_price"), "industry last_price", positive=True)
    previous = finite_number(row.get("prev_close_price"), "industry prev_close_price", positive=True)
    name = row.get("name")
    if not isinstance(name, str) or not name:
        raise BridgeError(503, "OpenD omitted industry name")
    return {
        "code": row["code"],
        "name": name,
        "last": last,
        "previousClose": previous,
        "changePercent": change_percent(last, previous),
        "turnover": finite_number(row.get("turnover"), "industry turnover", nonnegative=True),
        "advancers": nonnegative_integer(row.get("plate_raise_count"), "industry advancers"),
        "decliners": nonnegative_integer(row.get("plate_fall_count"), "industry decliners"),
        "unchanged": nonnegative_integer(row.get("plate_equal_count"), "industry unchanged"),
        "asOf": hk_instant(row.get("update_time"), "industry update_time"),
    }


def selected_stock_capital_flow(context: object, futu: object, symbol: str) -> Optional[dict]:
    ret, frame = context.get_capital_flow(symbol)
    if ret != futu.RET_OK or frame is None or len(frame.index) == 0:
        return None
    latest = latest_valid_capital_flow_row(frame.to_dict("records"))
    if latest is None:
        return None
    row, item_time, last_valid_time = latest
    return {
        "symbol": symbol,
        "asOf": item_time,
        "lastValidAt": last_valid_time,
        "currency": "HKD",
        "netFlow": finite_number(row.get("in_flow"), "capital-flow net flow"),
        "superFlow": finite_number(row.get("super_in_flow"), "capital-flow super flow"),
        "bigFlow": finite_number(row.get("big_in_flow"), "capital-flow big flow"),
        "mediumFlow": finite_number(row.get("mid_in_flow"), "capital-flow medium flow"),
        "smallFlow": finite_number(row.get("sml_in_flow"), "capital-flow small flow"),
    }


def research_funding(symbol: str, session: str, host: str, port: int) -> dict:
    if not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "canonical Hong Kong symbol required")
    try:
        target = date.fromisoformat(session)
    except (ValueError, TypeError) as error:
        raise BridgeError(400, "valid research date required") from error
    if target > datetime.now(HK_TZ).date():
        raise BridgeError(400, "future research date rejected")
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    checks = []
    # Quote-only APIs. SDK returns separate US and HK frames for short data.
    lanes = [
        ("日资金流", "get_capital_flow", {"stock_code": symbol, "period_type": futu.PeriodType.DAY, "start": session, "end": session}, 1,
         "capital_flow_item_time", ["in_flow", "main_in_flow", "super_in_flow", "big_in_flow", "mid_in_flow", "sml_in_flow"]),
        ("每日卖空成交", "get_daily_short_volume", {"code": symbol, "num": 10}, 2,
         "timestamp_str", ["shares_traded", "turnover", "short_sell_shares_traded", "short_sell_turnover", "daily_trade_avg_ratio"]),
        ("已公布空仓", "get_short_interest", {"code": symbol, "num": 10}, 2,
         "timestamp_str", ["aggregated_short", "aggregated_short_ratio"]),
    ]
    try:
        for name, method, params, frame_index, date_key, fields in lanes:
            try:
                result = getattr(context, method)(**params)
                if result[0] != futu.RET_OK or len(result) <= frame_index or result[frame_index] is None:
                    raise ValueError("provider unavailable")
                rows = []
                for row in result[frame_index].to_dict("records"):
                    row_date = str(row.get(date_key, ""))[:10]
                    parsed_date = date.fromisoformat(row_date)
                    if parsed_date > target:
                        continue
                    values = {key: finite_number(row.get(key), key) for key in fields}
                    if method == "get_daily_short_volume":
                        if (values["shares_traded"] <= 0 or values["turnover"] <= 0
                                or not 0 <= values["short_sell_shares_traded"] <= values["shares_traded"]
                                or not 0 <= values["short_sell_turnover"] <= values["turnover"]):
                            raise ValueError("invalid volume denominator")
                        values["shortVolumePercentCalculated"] = round(values["short_sell_shares_traded"] / values["shares_traded"] * 100, 4)
                        values["shortTurnoverPercentCalculated"] = round(values["short_sell_turnover"] / values["turnover"] * 100, 4)
                        values["provider20SessionAverageRatio_NOT_DAILY_RATIO"] = values.pop("daily_trade_avg_ratio")
                    rows.append({"date": row_date, **values})
                rows.sort(key=lambda r: r["date"], reverse=True)
                if method == "get_capital_flow":
                    rows = [r for r in rows if r["date"] == session]
                if not rows:
                    raise ValueError("no dated HK rows")
                note = "单位：港元；Futu按成交单统计，不能识别最终投资者或证明卖压动机。" if method == "get_capital_flow" else "成交股数单位：股；金额：港元；比例为百分数。shortVolumePercentCalculated是卖空股数除以当日总成交股数，shortTurnoverPercentCalculated是卖空金额除以当日总成交金额；provider20SessionAverageRatio_NOT_DAILY_RATIO是供应商20交易日平均比率，不是当日卖空占比；本接口未明确它采用股数还是金额分母，禁止据此计算当日偏离平均值，优先与前一日同分母比率比较。空仓按公布日期，不等于调查日新增卖空。"
                def number(value):
                    return format(value, ".4f").rstrip("0").rstrip(".")
                lines = []
                for row in rows:
                    if method == "get_daily_short_volume":
                        lines.append(f"{row['date']}：总成交{number(row['shares_traded'])}股，卖空成交{number(row['short_sell_shares_traded'])}股，卖空股数占比{number(row['shortVolumePercentCalculated'])}%；总成交金额{number(row['turnover'])}港元，卖空金额{number(row['short_sell_turnover'])}港元，卖空金额占比{number(row['shortTurnoverPercentCalculated'])}%；供应商20日平均比率{number(row['provider20SessionAverageRatio_NOT_DAILY_RATIO'])}%（分母口径尚未核实，不与当天占比比较）。")
                    elif method == "get_short_interest":
                        lines.append(f"公布日期{row['date']}：空仓{number(row['aggregated_short'])}股，占股本{number(row['aggregated_short_ratio'])}%；这是该公布日的存量，不是调查日新增卖空。")
                    else:
                        lines.append(f"{row['date']}：净流入{number(row['in_flow'])}港元，主力净流入{number(row['main_in_flow'])}港元，超大单净流入{number(row['super_in_flow'])}港元，大单净流入{number(row['big_in_flow'])}港元，中单净流入{number(row['mid_in_flow'])}港元，小单净流入{number(row['sml_in_flow'])}港元。负数表示对应统计项净流出。")
                checks.append({"name": name, "status": "available", "text": f"{symbol} 调查日 {session}；{note} " + "\n".join(lines)})
            except Exception:
                checks.append({"name": name, "status": "unavailable", "text": f"已请求 {symbol} {name}，未取得调查日及之前的有效港股数据；不代表数值为零。"})
    finally:
        context.close()
    return {"symbol": symbol, "date": session, "retrievedAt": datetime.now(timezone.utc).isoformat(), "checks": checks}


def research_peers(symbol: str, limit: int, host: str, port: int) -> dict:
    if not re.fullmatch(r"HK\.\d{5}", symbol) or not 1 <= limit <= 48:
        raise BridgeError(400, "canonical stock and shared research budget required")
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, frame = context.get_owner_plate([symbol])
        if ret != futu.RET_OK:
            raise BridgeError(503, "industry membership unavailable")
        industries = [r for r in frame.to_dict("records") if r.get("code") == symbol and r.get("plate_type") == "INDUSTRY"
                      and re.fullmatch(r"HK\.(?:LIST|BK)\d+", str(r.get("plate_code")))]
        if not industries:
            raise BridgeError(503, "no verified industry membership")
        industry = sorted(industries, key=lambda r: r["plate_code"])[0]
        ret, stocks = context.get_plate_stock(industry["plate_code"], sort_field=futu.SortField.TURNOVER, ascend=False)
        if ret != futu.RET_OK:
            raise BridgeError(503, "industry constituents unavailable")
        rows = stocks.to_dict("records")
        if not any(r.get("code") == symbol for r in rows):
            raise BridgeError(503, "industry constituent identity conflict")
        items = [{"symbol": r["code"], "name": str(r.get("stock_name", ""))} for r in rows
                 if r.get("code") != symbol and re.fullmatch(r"HK\.\d{5}", str(r.get("code"))) and r.get("stock_type") == "STOCK"]
        return {"symbol": symbol, "retrievedAt": datetime.now(timezone.utc).isoformat(), "plateCode": industry["plate_code"],
                "plateName": industry["plate_name"], "selection": "Futu INDUSTRY membership; turnover descending; bounded by remaining investigation source budget",
                "availableCount": len(items), "items": items[:limit]}
    finally:
        context.close()


def latest_valid_capital_flow_row(records: object) -> Optional[tuple[dict, str, str]]:
    if not isinstance(records, list) or not records or not all(isinstance(row, dict) for row in records):
        raise BridgeError(503, "OpenD returned malformed capital-flow rows")
    raw_last_valid_times = [row.get("last_valid_time") for row in records]
    if not all(isinstance(value, str) for value in raw_last_valid_times) or len(set(raw_last_valid_times)) != 1:
        raise BridgeError(503, "OpenD omitted one exact capital-flow last valid time")
    last_valid_time = hk_instant(raw_last_valid_times[0], "capital-flow last valid time")
    last_valid_at = datetime.fromisoformat(last_valid_time)
    eligible = []
    for row in records:
        item_time = hk_instant(row.get("capital_flow_item_time"), "capital-flow item time")
        item_at = datetime.fromisoformat(item_time)
        if item_at.date() == last_valid_at.date() and item_at <= last_valid_at:
            eligible.append((item_at, row, item_time))
    if not eligible:
        return None
    _, row, item_time = max(eligible, key=lambda item: item[0])
    return row, item_time, last_valid_time


def history_page(request: object, host: str, port: int) -> dict:
    if not isinstance(request, dict):
        raise BridgeError(400, "JSON object required")
    symbol = request.get("code")
    if not isinstance(symbol, str) or not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "code must be canonical HK.<five digits>")
    if request.get("ktype") != "K_DAY" or request.get("autype") != "QFQ":
        raise BridgeError(400, "only K_DAY QFQ research data is supported")
    if request.get("fields") != ["KL_FIELD.ALL"] or request.get("maxCount") != 1000:
        raise BridgeError(400, "fields and maxCount must match the daily contract")
    if request.get("extendedTime") is not False:
        raise BridgeError(400, "extendedTime must be false")
    if request.get("pageReqKey") is not None:
        raise BridgeError(400, "dated daily history must fit one page")
    start = real_date(request.get("start"))
    end = real_date(request.get("end"))
    if start < date(2024, 1, 1) or end > date(2026, 12, 31) or start > end:
        raise BridgeError(400, "history range must be ordered inside verified 2024-2026 calendar")

    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, frame, next_key = context.request_history_kline(
            symbol,
            start=start.isoformat(),
            end=end.isoformat(),
            ktype=futu.KLType.K_DAY,
            autype=futu.AuType.QFQ,
            fields=[futu.KL_FIELD.ALL],
            max_count=1000,
            page_req_key=None,
            extended_time=False,
        )
        if ret != futu.RET_OK or frame is None:
            raise BridgeError(503, "OpenD history request failed")
        records = frame.to_dict("records")
    finally:
        context.close()

    if next_key is not None:
        raise BridgeError(503, "OpenD daily history unexpectedly exceeded one page")
    if not isinstance(records, list):
        raise BridgeError(503, "OpenD returned malformed history rows")

    sessions = completed_sessions(end.isoformat(), start_value=start.isoformat())
    last_session = sessions[-1]
    if last_session in HALF_DAYS:
        raise BridgeError(503, "half-day HKEX close evidence is not supported")
    rows = []
    for row in records:
        if not isinstance(row, dict):
            raise BridgeError(503, "OpenD returned malformed history rows")
        if row.get("code") != symbol:
            raise BridgeError(503, "OpenD returned mixed history identity")
        time_key = row.get("time_key")
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", time_key) if isinstance(time_key, str) else None
        if not match:
            raise BridgeError(503, "OpenD returned malformed daily time_key")
        try:
            session_date = date.fromisoformat(match.group(1))
        except ValueError as error:
            raise BridgeError(503, "OpenD returned malformed daily time_key") from error
        if not start <= session_date <= end:
            raise BridgeError(503, "OpenD returned history outside the requested range")
        session = session_date.isoformat()
        if session > last_session:
            continue
        volume = finite_number(row.get("volume"), "volume", nonnegative=True)
        if volume == 0:
            raise BridgeError(503, "OpenD cannot prove suspension state for a zero-volume daily bar")
        rows.append({
            "code": symbol,
            "timeKey": time_key,
            "open": finite_number(row.get("open"), "open", positive=True),
            "close": finite_number(row.get("close"), "close", positive=True),
            "high": finite_number(row.get("high"), "high", positive=True),
            "low": finite_number(row.get("low"), "low", positive=True),
            "volume": volume,
            "turnover": finite_number(row.get("turnover"), "turnover", nonnegative=True),
            # A positive traded volume proves this row was not suspended.
            "suspension": False,
        })
    rows.sort(key=lambda row: row["timeKey"])
    present = {row["timeKey"][:10] for row in rows}
    gaps = [{"session": session, "classification": "unexplained"}
            for session in sessions if session not in present]
    return {
        "retCode": 0,
        "code": symbol,
        "timeframe": "1d",
        "adjustment": "forward_qfq_research_only",
        "providerCutoff": end.isoformat(),
        "dataCutoffAt": f"{last_session}T16:10:00+08:00",
        "lastCompletedSession": last_session,
        "calendar": {
            "id": "HKEX",
            "version": calendar_version(end.isoformat(), sessions),
            "timezone": "Asia/Hong_Kong",
        },
        # OpenD must first return the authorized history successfully. The Owner's
        # named local goal explicitly covers PostgreSQL retention and derived indicators.
        **history_use_authority(),
        "expectedSessions": sessions,
        "gaps": gaps,
        "rows": rows,
        "nextPageReqKey": None,
        "partial": False,
    }


def last_completed_week_end(analysis_as_of: date) -> date:
    days_since_friday = (analysis_as_of.weekday() - 4) % 7
    return analysis_as_of - timedelta(days=days_since_friday or 7)


def weinstein_weekly_input(symbol: str, analysis_as_of_value: str, host: str, port: int) -> dict:
    if not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "Weinstein symbol must be canonical HK.<five digits>")
    analysis_as_of = real_date(analysis_as_of_value)
    current_date = datetime.now(HK_TZ).date()
    if analysis_as_of != current_date:
        raise BridgeError(409, "Weinstein historical replay is unavailable because OpenD exposes only current industry identity")
    end = last_completed_week_end(analysis_as_of)
    start = end - timedelta(days=366 * WEINSTEIN_WEEKLY_YEARS)
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, owner_frame = context.get_owner_plate([symbol])
        if ret != futu.RET_OK or owner_frame is None:
            raise BridgeError(503, "OpenD stock-industry ownership request failed")
        ret, industry_frame = context.get_plate_list(futu.Market.HK, futu.Plate.INDUSTRY)
        if ret != futu.RET_OK or industry_frame is None:
            raise BridgeError(503, "OpenD industry universe request failed")
        industry_codes = set(industry_frame.get("code", []).tolist())
        matches = [row for row in owner_frame.to_dict("records") if row.get("plate_code") in industry_codes]
        if len(matches) != 1:
            raise BridgeError(503, "OpenD could not bind the stock to one exact Hong Kong industry")
        sector_symbol = str(matches[0]["plate_code"])
        sector_name = str(matches[0].get("plate_name") or sector_symbol)
        stock_name = str(matches[0].get("name") or symbol)
        stock = weekly_series(context, futu, symbol, stock_name, start, end, futu.AuType.QFQ,
                              "forward_qfq_research_only")
        market = weekly_series(context, futu, "HK.800000", "恒生指数", start, end, futu.AuType.NONE,
                               "none_index_or_sector")
        sector = weekly_series(context, futu, sector_symbol, sector_name, start, end, futu.AuType.NONE,
                               "none_index_or_sector")
    finally:
        context.close()
    return {
        "ok": True,
        "input": {
            "provider": "futu_opend",
            "endpoint": "weinstein-weekly",
            **history_use_authority(),
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "analysisAsOf": analysis_as_of.isoformat(),
            "sectorIdentityAsOf": current_date.isoformat(),
            "stock": stock,
            "marketBenchmark": market,
            "sectorBenchmark": sector,
        },
    }


def historical_weekly_price(symbol: str, analysis_as_of_value: str, host: str, port: int) -> dict:
    if not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "weekly price symbol must be canonical HK.<five digits>")
    analysis_as_of = real_date(analysis_as_of_value)
    if analysis_as_of > datetime.now(HK_TZ).date():
        raise BridgeError(400, "weekly price date cannot be in the future")
    end = last_completed_week_end(analysis_as_of)
    start = end - timedelta(days=366 * WEINSTEIN_WEEKLY_YEARS)
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        stock = weekly_series(context, futu, symbol, symbol, start, end, futu.AuType.QFQ,
                              "forward_qfq_research_only")
    finally:
        context.close()
    if not stock["bars"]:
        raise BridgeError(503, "OpenD returned no completed stock weekly bars")
    return {"ok": True, "price": {
        "symbol": symbol,
        "analysisAsOf": analysis_as_of.isoformat(),
        "completedWeekEnd": end.isoformat(),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "provider": "futu_opend",
        "adjustment": "forward_qfq_research_only",
        "sectorIdentityStatus": "unavailable_historical",
        **history_use_authority(),
        "bars": stock["bars"][-300:],
    }}


def weekly_series(context: object, futu: object, symbol: str, name: str, start: date, end: date,
                  autype: object, adjustment: str) -> dict:
    ret, frame, next_key = context.request_history_kline(
        symbol, start=start.isoformat(), end=end.isoformat(), ktype=futu.KLType.K_WEEK,
        autype=autype, fields=[futu.KL_FIELD.ALL], max_count=1000,
        page_req_key=None, extended_time=False,
    )
    if ret != futu.RET_OK or frame is None or next_key is not None:
        raise BridgeError(503, f"OpenD weekly history request failed for {symbol}")
    bars = normalize_completed_weekly_bars(frame.to_dict("records"), symbol, end)
    return {"symbol": symbol, "name": name, "adjustment": adjustment, "bars": bars}


def normalize_completed_weekly_bars(records: list[dict], symbol: str, end: date) -> list[dict]:
    bars = []
    sector_plate = re.fullmatch(r"HK\.LIST\d+", symbol) is not None
    for row in records:
        if row.get("code") != symbol:
            raise BridgeError(503, f"OpenD weekly history mixed identity for {symbol}")
        time_key = row.get("time_key")
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", time_key) if isinstance(time_key, str) else None
        if not match:
            raise BridgeError(503, f"OpenD weekly history returned malformed period for {symbol}")
        session = real_date(match.group(1))
        week_end = session + timedelta(days=4 - session.weekday())
        if session.weekday() > 4 or week_end > end:
            continue
        open_value = finite_number(row.get("open"), f"{symbol} weekly open", positive=True)
        high = finite_number(row.get("high"), f"{symbol} weekly high", positive=True)
        low = finite_number(row.get("low"), f"{symbol} weekly low", positive=True)
        close = finite_number(row.get("close"), f"{symbol} weekly close", positive=True)
        volume = finite_number(row.get("volume"), f"{symbol} weekly volume", nonnegative=True)
        if low > min(open_value, close) or high < max(open_value, close):
            if not sector_plate:
                raise BridgeError(503, f"OpenD weekly OHLC is inconsistent for {symbol}")
            # OpenD industry plates can rebase between sessions. Preserve every
            # reported endpoint while deriving an internally consistent range.
            high = max(high, open_value, close)
            low = min(low, open_value, close)
        bars.append({"session": week_end.isoformat(), "open": open_value, "high": high,
                     "low": low, "close": close, "volume": volume})
    bars.sort(key=lambda item: item["session"])
    if len({bar["session"] for bar in bars}) != len(bars):
        raise BridgeError(503, f"OpenD weekly history duplicated periods for {symbol}")
    return bars


def quant_history_capture(symbol: str, start_value: str, end_value: str, host: str, port: int) -> dict:
    if not re.fullmatch(r"HK\.\d{5}", symbol):
        raise BridgeError(400, "quant symbol must be canonical HK.<five digits>")
    start = real_date(start_value)
    end = real_date(end_value)
    if start.year != 2026 or end.year != 2026 or start > end:
        raise BridgeError(400, "quant history range must be ordered inside 2026")
    sessions = completed_sessions(end.isoformat())
    last_session = sessions[-1]
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    as_of = datetime.combine(date.fromisoformat(last_session), time(16, 10), HK_TZ).astimezone(timezone.utc) \
        .isoformat(timespec="milliseconds").replace("+00:00", "Z")

    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        captures = {}
        for name, autype, adjustment in (
            ("qfqBars", futu.AuType.QFQ, "forward"),
            ("unadjustedBars", futu.AuType.NONE, "none"),
        ):
            ret, frame, next_key = context.request_history_kline(
                symbol,
                start=start.isoformat(),
                end=end.isoformat(),
                ktype=futu.KLType.K_DAY,
                autype=autype,
                fields=[futu.KL_FIELD.ALL],
                max_count=1000,
                page_req_key=None,
                extended_time=False,
            )
            if ret != futu.RET_OK or frame is None or next_key is not None:
                raise BridgeError(503, f"OpenD {name} request failed or paginated")
            bars = []
            for row in frame.to_dict("records"):
                match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", str(row.get("time_key", "")))
                if row.get("code") != symbol or not match:
                    raise BridgeError(503, f"OpenD {name} returned mixed or malformed rows")
                volume = nonnegative_integer(row.get("volume"), f"{name} volume")
                if volume == 0:
                    raise BridgeError(503, f"OpenD {name} cannot prove suspension for a zero-volume row")
                bars.append({
                    "market": "HK",
                    "code": symbol[3:],
                    "tradeDate": match.group(1),
                    "open": finite_number(row.get("open"), f"{name} open", positive=True),
                    "high": finite_number(row.get("high"), f"{name} high", positive=True),
                    "low": finite_number(row.get("low"), f"{name} low", positive=True),
                    "close": finite_number(row.get("close"), f"{name} close", positive=True),
                    "volume": volume,
                    "turnover": finite_number(row.get("turnover"), f"{name} turnover", nonnegative=True),
                    "adjustment": adjustment,
                    "source": f"futu_request_history_kline_{'qfq' if adjustment == 'forward' else 'none'}",
                    "fetchedAt": fetched_at,
                })
            bars.sort(key=lambda row: row["tradeDate"])
            captures[name] = bars

        ret, rehab = context.get_rehab(symbol)
        if ret != futu.RET_OK or rehab is None:
            raise BridgeError(503, "OpenD corporate-action request failed")
        ret, basic = context.get_stock_basicinfo(
            futu.Market.HK, futu.SecurityType.STOCK, code_list=[symbol]
        )
        if ret != futu.RET_OK or basic is None or len(basic.index) != 1:
            raise BridgeError(503, "OpenD stock identity request failed")
        basic_row = basic.iloc[0].to_dict()
    finally:
        context.close()

    expected = [session for session in sessions if session >= start.isoformat()]
    qfq_dates = [bar["tradeDate"] for bar in captures["qfqBars"]]
    raw_dates = [bar["tradeDate"] for bar in captures["unadjustedBars"]]
    if qfq_dates != raw_dates or qfq_dates != expected:
        raise BridgeError(503, "QFQ, unadjusted, and completed-session identities are not exact")
    lot_size = nonnegative_integer(basic_row.get("lot_size"), "lot size")
    if lot_size <= 0:
        raise BridgeError(503, "OpenD omitted a positive lot size")
    rehab_rows = [json_safe(row) for row in rehab.to_dict("records")]
    return {
        "schemaVersion": "2026-08-08.futu-quant-opend-capture.v1",
        "provider": "futu_opend_read_only_quote_data",
        "symbol": symbol,
        "name": str(basic_row.get("name", "")),
        "lotSize": lot_size,
        "asOf": as_of,
        "fetchedAt": fetched_at,
        "dateRange": {"start": qfq_dates[0], "end": qfq_dates[-1]},
        "completedTradingDates": qfq_dates,
        "rights": history_use_authority(),
        "qfqBars": captures["qfqBars"],
        "unadjustedBars": captures["unadjustedBars"],
        "rehabRows": rehab_rows,
    }


def benchmark_bar_results(records: list[dict], symbol: str, fetched_at: str) -> list[dict]:
    bars = []
    for row in records:
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", str(row.get("time_key", "")))
        if row.get("code") != symbol or not match:
            raise BridgeError(503, "OpenD benchmark history returned mixed or malformed rows")
        bars.append({
            "symbol": symbol,
            "tradeDate": match.group(1),
            "open": finite_number(row.get("open"), "benchmark open", positive=True),
            "high": finite_number(row.get("high"), "benchmark high", positive=True),
            "low": finite_number(row.get("low"), "benchmark low", positive=True),
            "close": finite_number(row.get("close"), "benchmark close", positive=True),
            "volume": nonnegative_integer(row.get("volume"), "benchmark volume"),
            "turnover": finite_number(row.get("turnover"), "benchmark turnover", nonnegative=True),
            "adjustment": "none",
            "source": "futu_request_history_kline_none",
            "fetchedAt": fetched_at,
        })
    bars.sort(key=lambda row: row["tradeDate"])
    if len({bar["tradeDate"] for bar in bars}) != len(bars):
        raise BridgeError(503, "OpenD benchmark history duplicated sessions")
    return bars


def benchmark_history_capture(start_value: str, end_value: str, host: str, port: int) -> dict:
    symbol = "HK.800000"
    start = real_date(start_value)
    end = real_date(end_value)
    if start.year != 2026 or end.year != 2026 or start > end:
        raise BridgeError(400, "benchmark history range must be ordered inside 2026")
    sessions = [session for session in completed_sessions(end.isoformat()) if session >= start.isoformat()]
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, frame, next_key = context.request_history_kline(
            symbol, start=start.isoformat(), end=end.isoformat(), ktype=futu.KLType.K_DAY,
            autype=futu.AuType.NONE, fields=[futu.KL_FIELD.ALL], max_count=1000,
            page_req_key=None, extended_time=False,
        )
        if ret != futu.RET_OK or frame is None or next_key is not None:
            raise BridgeError(503, "OpenD benchmark history request failed or paginated")
        bars = benchmark_bar_results(frame.to_dict("records"), symbol, fetched_at)
    finally:
        context.close()
    if [bar["tradeDate"] for bar in bars] != sessions:
        raise BridgeError(503, "benchmark and completed-session identities are not exact")
    as_of = datetime.combine(date.fromisoformat(sessions[-1]), time(16, 10), HK_TZ).astimezone(timezone.utc) \
        .isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "schemaVersion": "2026-08-17.futu-quant-benchmark.v1",
        "provider": "futu_opend_read_only_quote_data",
        "symbol": symbol,
        "name": "恒生指数",
        "asOf": as_of,
        "fetchedAt": fetched_at,
        "dateRange": {"start": bars[0]["tradeDate"], "end": bars[-1]["tradeDate"]},
        "completedTradingDates": sessions,
        "rights": history_use_authority(),
        "bars": bars,
    }


def json_safe(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "item"):
        return json_safe(value.item())
    return value


def financial_json_safe(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): financial_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [financial_json_safe(item) for item in value]
    if hasattr(value, "item"):
        return financial_json_safe(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        raise BridgeError(503, "OpenD financial page contains a non-finite number")
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise BridgeError(503, "OpenD financial page contains an unsupported value")


def financial_statements_page(symbol: str, statement_type: int, num: int,
                              next_key: str | None, financial_type: int | None,
                              host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        ret, data = context.get_financials_statements(
            symbol, statement_type=statement_type, financial_type=financial_type,
            currency_code=None, next_key=next_key, num=num,
        )
    finally:
        context.close()
    if ret != futu.RET_OK or not isinstance(data, dict):
        raise BridgeError(503, "OpenD financial statements request failed")
    parsed = financial_json_safe(data)
    if (not isinstance(parsed, dict) or not isinstance(parsed.get("report_list"), list)
            or not isinstance(parsed.get("structure_list"), list)):
        raise BridgeError(503, "OpenD financial page structure is unavailable")
    cursor = parsed.get("next_key")
    if cursor == -1:
        cursor = "-1"
    if not isinstance(cursor, str) or not cursor or len(cursor) > 100:
        raise BridgeError(503, "OpenD financial page cursor is invalid")
    return {
        "ok": True,
        "source": "futu_opend_financial_statement_provider",
        "symbol": symbol,
        "statement_type": statement_type,
        "requested_financial_type": financial_type,
        "requested_next_key": next_key,
        "num": num,
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "structure_list": parsed["structure_list"],
        "report_list": parsed["report_list"],
        "next_key": cursor,
    }


def valuation_detail(symbol: str, valuation_type: str, host: str, port: int) -> dict:
    futu = load_futu()
    context = open_quote_context(futu, host, port)
    try:
        kind = futu.ValuationType.PE if valuation_type == "PE" else futu.ValuationType.PB
        ret, data = context.get_valuation_detail(
            symbol, valuation_type=kind, interval_type=futu.ValuationIntervalType.YEAR_5,
        )
    finally:
        context.close()
    if ret != futu.RET_OK or not isinstance(data, dict):
        raise BridgeError(503, "OpenD five-year valuation detail is unavailable")
    parsed = json_safe(data)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("trend"), dict):
        raise BridgeError(503, "OpenD valuation detail structure is unavailable")
    return {
        "ok": True,
        "source": "futu_opend_valuation_provider",
        "symbol": symbol,
        "valuation_type": valuation_type,
        "interval_type": "YEAR_5",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "data": parsed,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "InvestmentAssistantFutuBridge/1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/health":
                payload = bounded_open_d_call(
                    health, self.server.opend_host, self.server.opend_port,
                    timeout=OPEND_HEALTH_TIMEOUT_SECONDS,
                )
                if self.server.notice_available:
                    payload = advertise_notice_capability(payload)
                self.send_json(200, payload)
                return
            if parsed.path == "/quote":
                query = parse_qs(parsed.query)
                market = query.get("market", [None])[0]
                ticker = query.get("ticker", [None])[0]
                if market != "HK" or not isinstance(ticker, str) or not re.fullmatch(r"\d{5}", ticker):
                    raise BridgeError(400, "only canonical HK five-digit quotes are supported")
                self.send_json(200, bounded_open_d_call(
                    quote, f"HK.{ticker}", self.server.opend_host, self.server.opend_port,
                    timeout=OPEND_QUOTE_TIMEOUT_SECONDS,
                ))
                return
            if parsed.path == "/financial-statements":
                query = parse_qs(parsed.query, keep_blank_values=True)
                required = {"symbol", "statementType", "num"}
                if not required.issubset(query) or set(query) - required - {"nextKey", "financialType"} or any(len(values) != 1 for values in query.values()):
                    raise BridgeError(400, "one financial statement identity, size and optional cursor are required")
                symbol = query["symbol"][0]
                statement = query["statementType"][0]
                page_size = query["num"][0]
                cursor = query.get("nextKey", [None])[0]
                financial_type = query.get("financialType", [None])[0]
                if not re.fullmatch(r"HK\.[0-9]{5}", symbol) or statement not in {"1", "2", "3"}:
                    raise BridgeError(400, "canonical HK symbol and statement type 1/2/3 are required")
                if not re.fullmatch(r"[1-9][0-9]?", page_size) or not 1 <= int(page_size) <= 20:
                    raise BridgeError(400, "financial page size must be 1-20")
                if cursor is not None and (not re.fullmatch(r"[A-Za-z0-9_,.-]{1,100}", cursor) or cursor == "-1"):
                    raise BridgeError(400, "financial page cursor is invalid")
                if financial_type is not None and financial_type not in {"5", "7"}:
                    raise BridgeError(400, "financial report type must be annual or accumulated half-year")
                self.send_json(200, bounded_open_d_call(
                    financial_statements_page, symbol, int(statement), int(page_size), cursor,
                    int(financial_type) if financial_type is not None else None,
                    self.server.opend_host, self.server.opend_port,
                    timeout=OPEND_FINANCIAL_TIMEOUT_SECONDS,
                ))
                return
            if parsed.path == "/valuation-detail":
                query = parse_qs(parsed.query, keep_blank_values=True)
                if set(query) != {"symbol", "valuationType"} or any(len(values) != 1 for values in query.values()):
                    raise BridgeError(400, "one canonical valuation identity is required")
                symbol, valuation_type = query["symbol"][0], query["valuationType"][0]
                if not re.fullmatch(r"HK\.[0-9]{5}", symbol) or valuation_type not in {"PE", "PB"}:
                    raise BridgeError(400, "canonical HK symbol and PE/PB type are required")
                self.send_json(200, bounded_open_d_call(
                    valuation_detail, symbol, valuation_type,
                    self.server.opend_host, self.server.opend_port,
                    timeout=OPEND_VALUATION_TIMEOUT_SECONDS,
                ))
                return
            if parsed.path == "/stock-search":
                query = parse_qs(parsed.query).get("q", [""])[0]
                self.send_json(200, bounded_open_d_call(
                    stock_search, query, self.server.opend_host, self.server.opend_port
                ))
                return
            if parsed.path == "/notice-leads":
                query = parse_qs(parsed.query)
                symbol_values = query.get("symbol", [])
                limit_values = query.get("limit", [])
                if len(symbol_values) != 1 or len(limit_values) != 1:
                    raise BridgeError(400, "notice symbol and limit are required exactly once")
                symbol = symbol_values[0]
                try:
                    limit = int(limit_values[0])
                except ValueError as error:
                    raise BridgeError(400, "notice limit must be an integer") from error
                payload = bounded_open_d_call(
                    notice_leads, symbol, limit,
                    self.server.opend_host, self.server.opend_port,
                )
                self.server.notice_available = True
                self.send_json(200, payload)
                return
            if parsed.path == "/market-environment":
                query = parse_qs(parsed.query)
                market = query.get("market", [None])[0]
                ticker = query.get("ticker", [None])[0]
                if market != "HK" or not isinstance(ticker, str) or not re.fullmatch(r"\d{5}", ticker):
                    raise BridgeError(400, "only canonical HK five-digit selected stocks are supported")
                self.send_json(200, bounded_open_d_call(market_environment,
                    f"HK.{ticker}", self.server.opend_host, self.server.opend_port
                ))
                return
            if parsed.path == "/research-funding":
                query = parse_qs(parsed.query)
                if set(query) != {"symbol", "date"} or any(len(v) != 1 for v in query.values()):
                    raise BridgeError(400, "one symbol and research date required")
                self.send_json(200, bounded_open_d_call(research_funding,
                    query["symbol"][0], query["date"][0], self.server.opend_host, self.server.opend_port))
                return
            if parsed.path == "/research-peers":
                query = parse_qs(parsed.query)
                if set(query) != {"symbol", "limit"} or any(len(v) != 1 for v in query.values()):
                    raise BridgeError(400, "one symbol and research budget required")
                try:
                    limit = int(query["limit"][0])
                except ValueError as error:
                    raise BridgeError(400, "integer budget required") from error
                self.send_json(200, bounded_open_d_call(research_peers,
                    query["symbol"][0], limit, self.server.opend_host, self.server.opend_port))
                return
            if parsed.path == "/weinstein-weekly":
                query = parse_qs(parsed.query)
                market = query.get("market", [None])[0]
                ticker = query.get("ticker", [None])[0]
                analysis_as_of = query.get("analysisAsOf", [None])[0]
                if market != "HK" or not isinstance(ticker, str) or not re.fullmatch(r"\d{5}", ticker):
                    raise BridgeError(400, "only canonical HK five-digit Weinstein symbols are supported")
                self.send_json(200, bounded_open_d_call(weinstein_weekly_input,
                    f"HK.{ticker}", analysis_as_of, self.server.opend_host, self.server.opend_port
                ))
                return
            if parsed.path == "/weinstein-weekly-price":
                query = parse_qs(parsed.query)
                market = query.get("market", [None])[0]
                ticker = query.get("ticker", [None])[0]
                analysis_as_of = query.get("analysisAsOf", [None])[0]
                if market != "HK" or not isinstance(ticker, str) or not re.fullmatch(r"\d{5}", ticker):
                    raise BridgeError(400, "only canonical HK weekly price symbols are supported")
                self.send_json(200, bounded_open_d_call(historical_weekly_price,
                    f"HK.{ticker}", analysis_as_of, self.server.opend_host, self.server.opend_port
                ))
                return
            if parsed.path == "/stock-screen":
                query = parse_qs(parsed.query)
                symbols = query.get("symbol", [])
                if len(symbols) > 1:
                    raise BridgeError(400, "stock-screen symbol must appear at most once")
                self.send_json(200, bounded_open_d_call(stock_screen,
                    self.server.opend_host, self.server.opend_port,
                    symbols[0] if symbols else None,
                ))
                return
            raise BridgeError(404, "not found")
        except BridgeError as error:
            self.send_json(error.status, {"ok": False, "message": str(error)})
        except (AttributeError, OSError, TypeError, ValueError):
            self.send_json(503, {"ok": False, "message": "OpenD quote bridge unavailable"})

    def do_POST(self) -> None:
        try:
            if urlparse(self.path).path != "/history-kline":
                raise BridgeError(404, "not found")
            if self.headers.get_content_type() != "application/json":
                raise BridgeError(415, "application/json required")
            try:
                length = int(self.headers.get("content-length", "0"))
            except ValueError as error:
                raise BridgeError(400, "valid content-length required") from error
            if length < 2 or length > MAX_BODY_BYTES:
                raise BridgeError(400, "invalid request size")
            request = json.loads(self.rfile.read(length))
            payload = bounded_open_d_call(
                history_page, request, self.server.opend_host, self.server.opend_port,
                timeout=OPEND_HISTORY_TIMEOUT_SECONDS,
            )
            self.send_json(200, payload)
        except BridgeError as error:
            self.send_json(error.status, {"ok": False, "message": str(error)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "message": "valid JSON required"})
        except (AttributeError, OSError, TypeError, ValueError):
            self.send_json(503, {"ok": False, "message": "OpenD history bridge unavailable"})

    def send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_: str, *args: object) -> None:
        print(f"[futu-bridge] {format_ % args}")


def self_check() -> None:
    class HealthyFutu:
        @staticmethod
        def OpenQuoteContext(*, host: str, port: int):
            assert host == "127.0.0.1" and port == 11111
            return "context"

    class BrokenFutu:
        @staticmethod
        def OpenQuoteContext(*, host: str, port: int):
            raise OSError("unavailable")

    assert open_quote_context(HealthyFutu, "127.0.0.1", 11111) == "context"
    try:
        open_quote_context(BrokenFutu, "127.0.0.1", 11111)
    except BridgeError as error:
        assert error.status == 503
    else:
        raise AssertionError("OpenD connection failure must fail closed")
    assert set(bounded_open_d_call(history_use_authority, "confirmed", timeout=2).values()) == {"confirmed"}
    try:
        bounded_open_d_call(real_date, "invalid", timeout=2)
    except BridgeError as error:
        assert error.status == 400
    else:
        raise AssertionError("bounded child BridgeError must remain fail closed")
    assert advertise_notice_capability({
        "capabilities": ["quote"], "noticeLeadsStatus": "unavailable"
    }) == {
        "capabilities": ["quote", "notice_leads", "major_news_leads"],
        "noticeLeadsStatus": "available",
    }

    class NoticeApi:
        class NewsSubType:
            NOTICE = "NOTICE"
            NEWS = "NEWS"

        RET_OK = 0

    class NoticeContext:
        def get_search_news(self, symbol: str, *, max_count: int, news_sub_type: str):
            assert symbol == "HK.00175" and max_count == 1 and news_sub_type in {"NOTICE", "NEWS"}
            return 0, type("Frame", (), {"to_dict": lambda self, orientation: []})()

    assert notice_frame(NoticeContext(), NoticeApi, "HK.00175", 1) == []
    try:
        notice_frame(object(), NoticeApi, "HK.00175", 1)
    except BridgeError as error:
        assert error.status == 503
    else:
        raise AssertionError("missing NOTICE SDK capability must fail closed")
    sessions = completed_sessions("2026-08-02", datetime(2026, 8, 2, tzinfo=timezone.utc))
    assert sessions[-1] == "2026-07-31"
    assert "2026-07-01" not in sessions
    assert calendar_version("2026-08-02", sessions).startswith("hkex_completed_sessions_v1:2026-08-02:")
    assert set(history_use_authority("").values()) == {"unknown"}
    assert set(history_use_authority("confirmed").values()) == {"confirmed"}
    assert benchmark_bar_results([{
        "code": "HK.800000", "time_key": "2026-07-31 00:00:00",
        "open": 1, "high": 2, "low": 0.5, "close": 1.5,
        "volume": 0, "turnover": 100,
    }], "HK.800000", "2026-08-01T00:00:00.000Z")[0]["tradeDate"] == "2026-07-31"
    assert change_percent(102, 100) == 2
    assert normalize_market_state("AUCTION") == "PRE_OPEN"
    assert normalize_market_state("WAITING_OPEN") == "PRE_OPEN"
    assert normalize_market_state("MORNING") == "MORNING"
    assert percentage_points_from_ratio(-0.031, "test ratio") == -3.1
    assert last_completed_week_end(date(2026, 8, 12)) == date(2026, 8, 7)
    assert last_completed_week_end(date(2026, 8, 14)) == date(2026, 8, 7)
    assert hk_instant("2026-08-04 16:00:00", "test") == "2026-08-04T16:00:00+08:00"
    assert hk_news_instant("8/12", datetime(2026, 8, 12, 10, tzinfo=timezone.utc), "test") == "2026-08-12T00:00:00+08:00"
    assert has_exact_codes([{"code": "HK.LIST1"}, {"code": "HK.LIST2"}], {"HK.LIST1", "HK.LIST2"})
    assert not has_exact_codes([{"code": "HK.LIST1"}], {"HK.LIST1", "HK.LIST2"})
    industry_codes = [f"HK.LIST{index}" for index in range(10)]
    assert valid_industry_codes(industry_codes)
    assert not valid_industry_codes(industry_codes + ["invalid"])
    assert not valid_industry_codes(industry_codes + [industry_codes[0]])
    assert has_current_daily_history_window("2025-12-31")
    assert has_current_daily_history_window("2026-01-01")
    assert not has_current_daily_history_window("2026-02-13")
    assert not has_current_daily_history_window("not-a-date")
    search_rows = [
        {"code": "HK.00700", "name": "腾讯控股", "delisting": False},
        {"code": "HK.00175", "name": "吉利汽车", "delisting": False},
        {"code": "HK.810004", "name": "比特大陆(临时代码)", "delisting": False},
        {"code": "HK.09999", "name": "已退市样本", "delisting": True},
    ]
    assert stock_search_results("HK.00175", search_rows) == [
        {"market": "HK", "code": "00175", "symbol": "HK.00175", "name": "吉利汽车"}
    ]
    assert [item["symbol"] for item in stock_search_results("控股", search_rows)] == ["HK.00700"]
    fetched_at = datetime(2026, 8, 12, 10, tzinfo=timezone.utc)
    notice_rows = [{
        "title": "Issuer notice lead",
        "news_sub_type": "NOTICE",
        "source": "Futu",
        "publish_time": "2026-08-12 17:00:00",
        "related_securities": ["HK.00175"],
        "url": "https://news.example.test/notice/1",
    }]
    assert notice_lead_results("HK.00175", 10, notice_rows, fetched_at) == [{
        "kind": "notice",
        "title": "Issuer notice lead",
        "source": "Futu",
        "publish_time": "2026-08-12T17:00:00+08:00",
        "related_securities": ["HK.00175"],
        "url": "https://news.example.test/notice/1",
    }]
    assert len(notice_lead_results("HK.00175", 10, notice_rows * 2, fetched_at)) == 1
    news_rows = [{
        **notice_rows[0],
        "title": "Major company news lead",
        "news_sub_type": "NEWS",
        "publish_time": "2026-08-12 17:30:00",
        "url": "https://news.example.test/news/1",
    }]
    assert [lead["kind"] for lead in notice_lead_results(
        "HK.00175", 10, news_rows + notice_rows, fetched_at
    )] == ["notice", "major_news"]
    assert notice_lead_results("HK.00175", 10, [{
        **notice_rows[0], "related_securities": ["HK.00700"]
    }], fetched_at) == []
    assert notice_lead_results("HK.00175", 10, [{
        **news_rows[0], "related_securities": []
    }], fetched_at)[0]["related_securities"] == []
    sample_results = [
        {"type": "basic", "property": {"name": 1101}, "value_type": 1, "sval": "00175"},
        {"type": "cumulative", "property": {"name": 3102, "days": 5}, "value_type": 4, "dval": -0.031},
    ]
    assert screen_result(sample_results, "basic", 1101) == "00175"
    assert screen_result(sample_results, "cumulative", 3102, 5) == -0.031
    capital_row, capital_item_time, capital_last_valid_time = latest_valid_capital_flow_row([
        {"capital_flow_item_time": "2026-08-05 10:39:00", "last_valid_time": "2026-08-05 10:39:11"},
        {"capital_flow_item_time": "2026-08-05 10:40:00", "last_valid_time": "2026-08-05 10:39:11"},
    ])
    assert capital_row["capital_flow_item_time"] == "2026-08-05 10:39:00"
    assert capital_item_time == "2026-08-05T10:39:00+08:00"
    assert capital_last_valid_time == "2026-08-05T10:39:11+08:00"
    assert latest_valid_capital_flow_row([
        {"capital_flow_item_time": "2026-08-04 16:00:00", "last_valid_time": "2026-08-05 10:39:11"},
    ]) is None
    for invalid_fact in (
        lambda: index_fact({"code": "HK.800000", "index_valid": False}, "HK.800000"),
        lambda: sector_fact({"code": "HK.LIST1", "plate_valid": False}, {"HK.LIST1"}),
    ):
        try:
            invalid_fact()
        except BridgeError as error:
            assert error.status == 503
        else:
            raise AssertionError("invalid OpenD breadth flag was accepted")
    try:
        history_use_authority("invalid")
    except BridgeError as error:
        assert error.status == 503
    else:
        raise AssertionError("invalid history authority must fail closed")
    try:
        completed_sessions("2026-08-03", datetime(2026, 8, 2, tzinfo=timezone.utc))
    except BridgeError as error:
        assert error.status == 400 and "future" in str(error)
    else:
        raise AssertionError("future cutoff must fail closed")
    cross_year = completed_sessions("2025-01-03", datetime(2025, 1, 3, 9, tzinfo=timezone.utc),
                                    "2024-12-23")
    assert cross_year == ["2024-12-23", "2024-12-24", "2024-12-27", "2024-12-30",
                          "2024-12-31", "2025-01-02", "2025-01-03"]
    storm = completed_sessions("2024-09-06", datetime(2024, 9, 6, 9, tzinfo=timezone.utc),
                               "2024-09-05")
    assert storm == ["2024-09-05"]
    assert completed_sessions("2024-09-09", datetime(2024, 9, 9, 9, tzinfo=timezone.utc),
                              "2024-09-05") == ["2024-09-05", "2024-09-09"]
    print(json.dumps({"ok": True, "sessions": len(sessions), "lastCompletedSession": sessions[-1]}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--quant-export")
    parser.add_argument("--quant-benchmark-export")
    parser.add_argument("--quant-symbol", default="HK.00175")
    parser.add_argument("--quant-start", default="2026-01-01")
    parser.add_argument("--quant-end", default="2026-08-07")
    args = parser.parse_args()
    if args.self_check:
        self_check()
        return
    opend_host = os.environ.get("FUTU_OPEND_HOST", "127.0.0.1")
    opend_port = int(os.environ.get("FUTU_OPEND_PORT", "11111"))
    if args.quant_export and args.quant_benchmark_export:
        raise SystemExit("choose one quant export")
    if args.quant_benchmark_export:
        if opend_host not in LOOPBACK_HOSTS or not 1 <= opend_port <= 65535:
            raise SystemExit("quant benchmark export requires a loopback OpenD host and valid port")
        output = Path(args.quant_benchmark_export)
        if output.exists():
            raise SystemExit("quant benchmark export output already exists")
        payload = benchmark_history_capture(args.quant_start, args.quant_end, opend_host, opend_port)
        output.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2,
                                     allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "output": str(output), "bars": len(payload["bars"])}))
        return
    if args.quant_export:
        if opend_host not in LOOPBACK_HOSTS or not 1 <= opend_port <= 65535:
            raise SystemExit("quant export requires a loopback OpenD host and valid port")
        output = Path(args.quant_export)
        if output.exists():
            raise SystemExit("quant export output already exists")
        payload = quant_history_capture(
            args.quant_symbol, args.quant_start, args.quant_end, opend_host, opend_port
        )
        output.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2,
                                     allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "output": str(output), "bars": len(payload["qfqBars"])}))
        return
    bind_host = os.environ.get("FUTU_BRIDGE_HOST", "127.0.0.1")
    if bind_host not in LOOPBACK_HOSTS or opend_host not in LOOPBACK_HOSTS:
        raise SystemExit("bridge and OpenD hosts must be loopback")
    port = int(os.environ.get("FUTU_BRIDGE_PORT", "4300"))
    if not 1 <= port <= 65535 or not 1 <= opend_port <= 65535:
        raise SystemExit("ports must be between 1 and 65535")
    load_futu()
    server = ThreadingHTTPServer((bind_host, port), Handler)
    server.opend_host = opend_host
    server.opend_port = opend_port
    server.notice_available = False
    # ponytail: keep isolated request processes; add a persistent worker only if cold-start latency becomes material.
    print(f"Futu read-only market bridge listening on http://{bind_host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

# WealthCharts → TradeZella Converter

Live: **https://moochbuilds.github.io/wealthcharts-to-tradezella/**

A single static page that turns a WealthCharts order export into TradeZella's
generic **execution-based** import template. Everything runs in the browser —
the CSV never leaves the machine, and the page makes no network calls at all.

## Daily workflow

1. Export orders from WealthCharts.
2. Open the site, drop the CSV in.
3. Check the preview + warnings, click **Download TradeZella CSV**.
4. In TradeZella: Add Trades → Upload file → Generic Template.
   - **Time zone** = whatever you picked in the converter (default US/Eastern)
   - **Date Format** = `MM/DD/YY`
   - Upload under **Execution-based format**

## Field mapping

| TradeZella | WealthCharts | Notes |
| --- | --- | --- |
| `Date&Time` | — | left blank; `Date` + `Time` are used instead |
| `Date` | `mov_time` | converted to the chosen output time zone, `MM/DD/YY` |
| `Time` | `mov_time` | 24-hour `HH:MM:SS` |
| `Symbol` | `symbol` | exchange prefix stripped: `CM.MESU6` → `MESU6` |
| `Buy/Sell` | sign of `exec_qty` | positive → `Buy`, negative → `Sell` |
| `Quantity` | `abs(exec_qty)` | |
| `Price` | `price_done` | |
| `Spread` | — | `Future` by default |
| `Expiration` / `Strike` / `Call/Put` | — | blank (options only) |
| `Commission` / `Fees` | — | optional per-contract rate × quantity |

`mov_time` carries its own UTC offset (`GMT-0700 (Pacific Daylight Time)`), so
the conversion is unambiguous and DST-safe.

`mov_type`, `points`, and `profit` are deliberately **not** used. TradeZella
pairs the executions and recalculates P&L itself; passing WealthCharts' numbers
through would only be a chance to disagree with it. (`profit` also appears to be
per-contract rather than per-fill, which would be wrong on multi-contract exits.)

## Options

- **Output time zone** — must match the time zone selected in TradeZella.
- **Symbol style** — full contract (`MESU6`), root only (`MES`), or untouched.
  If TradeZella doesn't recognise a contract symbol, try root, or use the
  overrides box (`MESU6=MES`, one per line).
- **Commission / Fees per contract** — multiplied by quantity per fill.
- **Skip orders I've already exported** — records order IDs in browser
  localStorage when you download, so the next day's export only yields new
  fills. Per-browser; clear it any time.
- **Only include the most recent trading day** — for when WealthCharts dumps
  your whole history each export.

Settings persist in localStorage.

## Warnings the page raises

- Rows skipped for an unreadable timestamp, zero/non-numeric quantity, or a
  bad price — with the file and line number.
- A symbol that doesn't net back to flat (expected with an open position;
  otherwise the export is missing fills, and TradeZella will show a phantom
  open trade).
- Duplicate rows removed, and fills skipped via the exported-order ledger.

## Hosting

GitHub Pages, served straight from the `main` branch root — no build step, no
usage credits. To update the live site:

```
git add -A && git commit -m "..." && git push
```

Pages redeploys within a minute or two. GitHub Pages can't set response
headers, so the Content-Security-Policy that blocks outbound requests lives in
a `<meta>` tag in `index.html`.

`samples/` and `converted/` are git-ignored so real trade data stays local.

## Local test

`node test.js` re-runs the conversion checks (timezone/DST, dedupe, commission
math, malformed rows, filters) against the logic embedded in `index.html`.

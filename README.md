# WealthCharts & Tradesea → TradeZella Converter

Live: **https://moochbuilds.github.io/wealthcharts-to-tradezella/**

A single static page that turns a **WealthCharts** or **Tradesea** order export
into TradeZella's generic **execution-based** import template. The input format
is detected from the CSV header, and files from both platforms can be dropped in
together. Everything runs in the browser —
the CSV never leaves the machine, and the page makes no network calls at all.

## Daily workflow

1. Export orders from WealthCharts or Tradesea.
2. Open the site, drop the CSV in.
3. Check the preview + warnings, click **Download TradeZella CSV**.
4. In TradeZella: Add Trades → Upload file → Generic Template.
   - **Time zone** = whatever you picked in the converter (default US/Eastern)
   - **Date Format** = `MM/DD/YY`
   - Upload under **Execution-based format**

## Field mapping

### WealthCharts

| TradeZella | WealthCharts | Notes |
| --- | --- | --- |
| `Date&Time` | — | left blank; `Date` + `Time` are used instead |
| `Date` | `mov_time` | converted to the chosen output time zone, `MM/DD/YY` |
| `Time` | `mov_time` | 24-hour `HH:MM:SS` |
| `Symbol` | `symbol` | exchange prefix stripped: `CM.MESZ6` → `MESZ6` |
| `Buy/Sell` | sign of `exec_qty` | positive → `Buy`, negative → `Sell` |
| `Quantity` | `abs(exec_qty)` | |
| `Price` | `price_done` | |
| `Spread` | — | `Future` by default |
| `Expiration` / `Strike` / `Call/Put` | — | blank (options only) |
| `Commission` / `Fees` | — | optional per-contract rate × quantity |

`mov_time` carries its own UTC offset (`GMT-0700 (Pacific Daylight Time)`), so
the conversion is unambiguous and DST-safe.

### Tradesea

Tradesea's order export looks like:

```
"Time","Symbol","Qty","Side","Order Type","Limit Price","Stop Price","Avg Price","Commission","Status"
"10/7/2026, 8:49:04 AM PDT","CME:MES","1","Sell","Limit","7844","","7844","0.5","Filled"
```

| TradeZella | Tradesea | Notes |
| --- | --- | --- |
| `Date` / `Time` | `Time` | `M/D/YYYY, h:mm:ss AM/PM TZ`; the zone abbreviation (PDT, PST, EDT, CT, …) is honoured, then converted to the output zone. A zone-less time is read in the output zone and a warning is shown |
| `Symbol` | `Symbol` | exchange prefix stripped and the front-month code appended: `CME:MES` → `MESZ6`. TradeZella reads the expiration from a futures symbol and rejects a bare root with "Missing required column(s): Expiration", so in Contract style a quarterly H/M/U/Z code is added based on the trade date (rolls the Saturday after roll Thursday). Set **Contract month** to force a code (e.g. `Z6`), or use the overrides box for non-quarterly products |
| `Buy/Sell` | `Side` | `Buy` / `Sell` |
| `Quantity` | `Qty` | |
| `Price` | `Avg Price` | falls back to `Limit Price` if blank |
| `Spread` | — | `Future` by default |
| `Commission` | `Commission` | per-fill value passed through as-is; a non-blank "Commission per contract" setting overrides it |
| `Fees` | — | optional per-contract rate × quantity |

Only rows with `Status = Filled` are converted; cancelled, rejected and working
orders are counted and skipped. `Order Type`, `Limit Price` and `Stop Price`
are not needed by TradeZella.

Tradesea has no order-ID column, so two identical rows (same second, side,
quantity and price) are treated as two real fills — that happens when one order
fills in several parts. De-duplication still catches the same file being
dropped in twice.

`mov_type`, `points`, and `profit` are deliberately **not** used. TradeZella
pairs the executions and recalculates P&L itself; passing WealthCharts' numbers
through would only be a chance to disagree with it. (`profit` also appears to be
per-contract rather than per-fill, which would be wrong on multi-contract exits.)

## Options

- **Output time zone** — must match the time zone selected in TradeZella.
- **Symbol style** — full contract (`MESZ6`), root only (`MES`), or untouched.
  If TradeZella doesn't recognise a contract symbol, try root, or use the
  overrides box (`MESZ6=MES`, one per line).
- **Contract month for root-only symbols** — month code appended to a bare
  root such as Tradesea's `MES`. Blank picks the front quarterly month from the
  trade date.
- **Commission / Fees per contract** — multiplied by quantity per fill. Blank
  uses the export's own column when it has one (Tradesea does).
- **Skip orders I've already exported** — records order IDs (WealthCharts) or a
  fingerprint of each fill (Tradesea) in browser localStorage when you download,
  so the next day's export only yields new fills. Per-browser; clear it any time.
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
- Tradesea orders skipped because they were not filled, and timestamps that
  carried no time zone.

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
math, malformed rows, filters, Tradesea parsing) against the logic embedded in
`index.html`.

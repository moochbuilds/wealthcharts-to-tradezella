/*
 * Runs the conversion logic that lives inside index.html against a set of
 * fixtures.  The logic is extracted between the two marker comments rather
 * than duplicated here, so the page stays a single self-contained file and
 * these tests can never drift from what actually ships.
 *
 *   node test.js
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const START = '/* ---------- CSV ---------- */';
const END = '/* expose for tests */';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0) throw new Error('marker comments not found in index.html');

// The extracted slice expects a browser: a localStorage and the $() helper
// (only ever used by refreshLedgerCount, which is UI-only).
global.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] || null; },
  setItem(k, v) { this._s[k] = v; },
  removeItem(k) { delete this._s[k]; },
};
global.$ = () => ({ textContent: '' });

const M = new Function(
  html.slice(a, b) + '; return {convert,toCSV,parseWCTime,parseTime,fmtParts,cleanSymbol,ledgerAdd,detectSource,sniff};'
)();

const BASE = {
  tz: 'America/New_York', symstyle: 'contract', spread: 'Future',
  comm: 0, fees: 0, overrides: '', useLedger: false, todayOnly: false,
};
const HEAD = 'name,order_id,symbol,mov_time,mov_type,exec_qty,price_done,points,profit';
const wc = (rows) => HEAD + '\n' + rows.join('\n') + '\n';
const run = (text, opts) => M.convert([{ name: 't.csv', text }], Object.assign({}, BASE, opts));
const lines = (r) => M.toCSV(r.rows).trim().split('\r\n').slice(1);

let pass = 0, fail = 0;
function is(actual, expected, label) {
  const A = JSON.stringify(actual), E = JSON.stringify(expected);
  if (A === E) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         expected ' + E + '\n         actual   ' + A); }
}
function group(name) { console.log('\n' + name); }

const SAMPLE = wc([
  'DEMO000001,ORD-1003,CM.MESU6,Tue Aug 25 2026 08:28:43 GMT-0700 (Pacific Daylight Time),2,-2,7686,7.75,38.75',
  'DEMO000001,ORD-1002,CM.MESU6,Tue Aug 25 2026 08:19:47 GMT-0700 (Pacific Daylight Time),2,-1,7682,3.75,18.75',
  'DEMO000001,ORD-1001,CM.MESU6,Tue Aug 25 2026 07:52:22 GMT-0700 (Pacific Daylight Time),1,3,7678.25,,',
]);

group('real WealthCharts export');
{
  const r = run(SAMPLE);
  is(r.errors, [], 'no errors');
  is(r.warnings, [], 'nets flat, no warnings');
  is(lines(r), [
    ',08/25/26,10:52:22,MESU6,Buy,3,7678.25,Future,,,,,',
    ',08/25/26,11:19:47,MESU6,Sell,1,7682,Future,,,,,',
    ',08/25/26,11:28:43,MESU6,Sell,2,7686,Future,,,,,',
  ], 'rows match the TradeZella template, sorted entry-first');
}

group('time zones');
{
  const d = M.parseWCTime('Tue Aug 25 2026 08:28:43 GMT-0700 (Pacific Daylight Time)');
  is(d.toISOString(), '2026-08-25T15:28:43.000Z', 'PDT offset applied');
  is(M.fmtParts(d, 'America/New_York').time, '11:28:43', '08:28 PDT -> 11:28 ET');
  is(M.fmtParts(d, 'America/Chicago').time, '10:28:43', '08:28 PDT -> 10:28 CT');
  is(M.fmtParts(d, 'UTC').time, '15:28:43', '08:28 PDT -> 15:28 UTC');

  const w = run(wc(['X,D1,CM.MESZ5,Mon Jan 12 2026 06:30:00 GMT-0800 (Pacific Standard Time),1,1,7000,,']));
  is(lines(w)[0].slice(0, 18), ',01/12/26,09:30:00', 'winter date uses EST, not EDT');
}

group('symbols');
{
  is(M.cleanSymbol('CM.MESU6', 'contract', {}), 'MESU6', 'exchange prefix stripped');
  is(M.cleanSymbol('CM.MESU6', 'root', {}), 'MES', 'root only');
  is(M.cleanSymbol('CM.MESU6', 'raw', {}), 'CM.MESU6', 'untouched');
  is(M.cleanSymbol('CM.MESU6', 'contract', { MESU6: 'MES SEP26' }), 'MES SEP26', 'override applied');
  is(M.cleanSymbol('CM.MESZ6', 'contract', {}), 'MESZ6', 'December contract kept');
  is(M.cleanSymbol('CM.MNQZ6', 'root', {}), 'MNQ', 'December contract root only');
  is(run(SAMPLE, { symstyle: 'root' }).rows[0].symbol, 'MES', 'root style through convert()');
}

group('commission and fees');
{
  const r = run(SAMPLE, { comm: 0.62, fees: 0.35 });
  is([r.rows[0].commission, r.rows[0].fees], ['1.86', '1.05'], '3 contracts x 0.62 / 0.35');
  is([r.rows[1].commission, r.rows[1].fees], ['0.62', '0.35'], '1 contract');
  is(run(SAMPLE).rows[0].commission, '', 'blank when rate is zero');
}

group('deduplication');
{
  const r = M.convert([{ name: 'a', text: SAMPLE }, { name: 'b', text: SAMPLE }], BASE);
  is([r.rows.length, r.dupes], [3, 3], 'same file twice yields one set of rows');
}

group('malformed input');
{
  const r = run(wc([
    'X,A1,CM.MESU6,not a date,1,2,7000,,',
    'X,A2,CM.MESU6,Tue Aug 25 2026 08:00:00 GMT-0700 (PDT),1,0,7000,,',
    'X,A3,,Tue Aug 25 2026 08:00:00 GMT-0700 (PDT),1,2,7000,,',
    'X,A4,CM.MNQU6,Tue Aug 25 2026 08:00:00 GMT-0700 (PDT),1,2,"23,450.50",,',
  ]));
  is([r.rows.length, r.skippedBad], [1, 3], 'three bad rows dropped, good row kept');
  is(r.warnings[0].indexOf('line 2') > -1 && r.warnings[0].indexOf('timestamp') > -1, true, 'reports file + line + reason');
  is(r.rows[0].price, '23450.5', 'quoted price with a thousands separator parses');

  const bad = M.convert([{ name: 'nope.csv', text: 'a,b,c\n1,2,3\n' }], BASE);
  is(bad.errors.length, 1, 'unrecognised header is an error, not a silent empty result');
}

group('filters');
{
  const multi = wc([
    'X,B1,CM.MESU6,Mon Aug 24 2026 08:00:00 GMT-0700 (PDT),1,1,7600,,',
    'X,B2,CM.MESU6,Mon Aug 24 2026 09:00:00 GMT-0700 (PDT),2,-1,7610,,',
    'X,B3,CM.MESU6,Tue Aug 25 2026 08:00:00 GMT-0700 (PDT),1,2,7680,,',
    'X,B4,CM.MESU6,Tue Aug 25 2026 09:00:00 GMT-0700 (PDT),2,-2,7690,,',
  ]);
  is(run(multi).rows.length, 4, 'all days by default');
  const only = run(multi, { todayOnly: true });
  is(only.rows.map((x) => x.isoDay), ['2026-08-25', '2026-08-25'], 'most recent day only');

  M.ledgerAdd(['ORD-1001']);
  const led = run(SAMPLE, { useLedger: true });
  is([led.rows.length, led.skippedLedger], [2, 1], 'previously exported order skipped');
  localStorage.removeItem('wc2tz.exported.v1');
}

group('open position detection');
{
  const r = run(wc([
    'X,C1,CM.MESU6,Tue Aug 25 2026 08:00:00 GMT-0700 (PDT),1,3,7680,,',
    'X,C2,CM.MESU6,Tue Aug 25 2026 09:00:00 GMT-0700 (PDT),2,-1,7690,,',
  ]));
  is(r.warnings.length === 1 && r.warnings[0].indexOf('+2') > -1, true, 'flags the +2 that never got closed');
}

group('Tradesea export');
const TS_HEAD = '"Time","Symbol","Qty","Side","Order Type","Limit Price","Stop Price","Avg Price","Commission","Status"';
const ts = (rows) => TS_HEAD + '\n' + rows.join('\n') + '\n';
const TS_SAMPLE = ts([
  '"9/15/2026, 6:45:30 AM PDT","CME:MES","1","Sell","Limit","6510","","6510","0.5","Filled"',
  '"9/15/2026, 6:40:00 AM PDT","CME:MES","1","Sell","Limit","6504","","6504","0.5","Filled"',
  '"9/15/2026, 6:40:00 AM PDT","CME:MES","1","Sell","Limit","6504","","6504","0.5","Filled"',
  '"9/15/2026, 6:38:12 AM PDT","CME:MES","1","Buy","Limit","6490","","","","Cancelled"',
  '"9/15/2026, 6:31:10 AM PDT","CME:MES","3","Buy","Market","","","6500.25","1.5","Filled"',
]);
{
  is(M.sniff(TS_SAMPLE), 'tradesea', 'header is recognised as Tradesea');
  is(M.sniff(SAMPLE), 'wealthcharts', 'WealthCharts header still recognised');
  const r = run(TS_SAMPLE);
  is(r.errors, [], 'no errors');
  is(r.sources, ['tradesea'], 'source reported');
  is(lines(r), [
    ',09/15/26,09:31:10,MES,Buy,3,6500.25,Future,,,,1.5,',
    ',09/15/26,09:40:00,MES,Sell,1,6504,Future,,,,0.5,',
    ',09/15/26,09:40:00,MES,Sell,1,6504,Future,,,,0.5,',
    ',09/15/26,09:45:30,MES,Sell,1,6510,Future,,,,0.5,',
  ], 'PDT -> ET, CME: prefix stripped, Side column used, per-fill commission kept, twin fills both kept');
  is([r.skippedStatus, r.rows.length], [1, 4], 'cancelled order dropped');
  is(r.warnings.filter((w) => w.indexOf('net') > -1), [], 'nets flat');
  is(run(TS_SAMPLE, { comm: 0.62 }).rows[0].commission, '1.86', 'commission setting overrides the export column');
  is(run(TS_SAMPLE, { fees: 0.35 }).rows[0].fees, '1.05', 'fees setting applies when export has no Fees column');
  is(run(TS_SAMPLE, { symstyle: 'raw' }).rows[0].symbol, 'CME:MES', 'raw keeps exchange prefix');
  is(run(TS_SAMPLE, { symstyle: 'root' }).rows[0].symbol, 'MES', 'root style');
  is(M.cleanSymbol('CME:MES1!', 'contract', {}), 'MES', 'continuous-contract suffix stripped');

  const twice = M.convert([{ name: 'a', text: TS_SAMPLE }, { name: 'b', text: TS_SAMPLE }], BASE);
  is([twice.rows.length, twice.dupes], [4, 4], 'same file twice dedupes without an order id');

  const mixed = M.convert([{ name: 'wc', text: SAMPLE }, { name: 'ts', text: TS_SAMPLE }], BASE);
  is([mixed.rows.length, mixed.sources], [7, ['wealthcharts', 'tradesea']], 'WealthCharts + Tradesea in one run');

  const winter = run(ts(['"1/12/2026, 6:30:00 AM PST","CME:MNQ","1","Buy","Market","","","21000","0.5","Filled"']));
  is(lines(winter)[0].slice(0, 22), ',01/12/26,09:30:00,MNQ', 'PST -> EST in winter');

  const pm = run(ts(['"1/12/2026, 12:05:00 PM PST","CME:MNQ","1","Buy","Market","","","21000","0.5","Filled"']));
  is(pm.rows[0].time, '15:05:00', '12:05 PM handled');

  const naive = run(ts(['"9/15/2026, 6:31:10 AM","CME:MES","1","Buy","Market","","","6500","0.5","Filled"']));
  is(naive.rows[0].time, '06:31:10', 'zone-less time is read in the output zone');
  is(naive.warnings.some((w) => w.indexOf('no time zone') > -1), true, 'and a warning says so');

  const badSide = run(ts(['"9/15/2026, 6:31:10 AM PDT","CME:MES","1","Hold","Market","","","6500","0.5","Filled"']));
  is([badSide.rows.length, badSide.skippedBad], [0, 1], 'unknown side is skipped');
  is(badSide.warnings[0].indexOf('side') > -1, true, 'with a reason');

  const bom = run('﻿' + TS_SAMPLE);
  is(bom.rows.length, 4, 'UTF-8 BOM tolerated');

  M.ledgerAdd(run(TS_SAMPLE).rows.map((x) => x.key));
  const led = run(TS_SAMPLE, { useLedger: true });
  is([led.rows.length, led.skippedLedger], [0, 4], 'ledger works without order ids');
  const ledTz = run(TS_SAMPLE, { useLedger: true, tz: 'America/Chicago' });
  is(ledTz.skippedLedger, 4, 'ledger keys do not depend on the output time zone');
  localStorage.removeItem('wc2tz.exported.v1');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

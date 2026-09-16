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
  html.slice(a, b) + '; return {convert,toCSV,parseWCTime,fmtParts,cleanSymbol,ledgerAdd};'
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

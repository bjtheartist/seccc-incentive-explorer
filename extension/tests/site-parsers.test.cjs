const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const parsers = require(path.join(__dirname, '..', 'site-parsers.js'));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/assessor.html'), 'utf8');
const load = html => parseHTML(html).document;

const block = (pin, address, city) => `<!doctype html><html><body>
  <h2>PIN &amp; Address</h2>
  <div class="property-details-info">
    <div class="detail-row"><span class="detail-row--label">Pin</span><span class="detail-row--detail">${pin}</span></div>
    <div class="detail-row"><span class="detail-row--label">Address</span><span class="detail-row--detail">${address}</span></div>
    <div class="detail-row"><span class="detail-row--label">City</span><span class="detail-row--detail">${city}</span></div>
  </div></body></html>`;

test('the real assessor page yields the address, PIN and city', () => {
  const parsed = parsers.cookCountyAssessor(load(fixture));
  assert.deepEqual(parsed, { address: '639 E 90TH ST', pin: '25-03-226-014-0000', city: 'CHICAGO' });
});

test('parse() routes by hostname and ignores sites it does not know', () => {
  const document = load(fixture);
  assert.equal(parsers.parse(document, 'www.cookcountyassessor.com').address, '639 E 90TH ST');
  assert.equal(parsers.parse(document, 'cookcountyassessor.com').address, '639 E 90TH ST');
  assert.equal(parsers.parse(document, 'cookcountypropertyinfo.com'), null);
  assert.equal(parsers.parse(document, 'evil-cookcountyassessor.com.example'), null);
  assert.equal(parsers.parse(document).address, '639 E 90TH ST', 'no hostname tries every parser');
  assert.deepEqual(parsers.PARSERS.map(p => p.hostSuffixes), [['cookcountyassessor.com', 'cookcountyassessoril.gov']]);
});

test('labels match case-insensitively after trimming, and whitespace collapses', () => {
  const document = load(block('25-03-226-014-0000', '\n   639   E 90TH ST \n', ' chicago '));
  const parsed = parsers.cookCountyAssessor(document);
  assert.equal(parsed.address, '639 E 90TH ST');
  assert.equal(parsed.city, 'chicago');
  const upper = load(block('1', '100 W MADISON ST', 'CHICAGO').replace('>Address<', '> ADDRESS <'));
  assert.equal(parsers.cookCountyAssessor(upper).address, '100 W MADISON ST');
});

test('only Chicago proceeds; anything missing returns null', () => {
  assert.equal(parsers.cookCountyAssessor(load(block('1', '100 MAIN ST', 'EVANSTON'))), null);
  assert.equal(parsers.cookCountyAssessor(load(block('1', '100 MAIN ST', ''))), null);
  assert.equal(parsers.cookCountyAssessor(load(block('1', '', 'CHICAGO'))), null);
  assert.equal(parsers.cookCountyAssessor(load('<!doctype html><html><body><p>Not a PIN page</p></body></html>')), null);
  assert.equal(parsers.cookCountyAssessor(null), null);
});

test('a broken parser cannot throw out of parse()', () => {
  const original = parsers.PARSERS.slice();
  parsers.PARSERS.length = 0;
  parsers.PARSERS.push({ id: 'boom', hostSuffixes: ['example.com'], parse: () => { throw new Error('boom'); } });
  assert.equal(parsers.parse(load(fixture), 'example.com'), null);
  parsers.PARSERS.length = 0;
  parsers.PARSERS.push(...original);
});

test("routes the .gov Assessor hostname (the .com now redirects there)", () => {
  const { parseHTML } = require("linkedom");
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "assessor.html"), "utf8");
  const { document } = parseHTML(html);
  const parsers = require("../site-parsers.js");
  assert.equal(parsers.parse(document, "www.cookcountyassessoril.gov").address, "639 E 90TH ST");
  assert.equal(parsers.parse(document, "www.cookcountyassessor.com").address, "639 E 90TH ST");
  assert.equal(parsers.parse(document, "www.example.com"), null);
});

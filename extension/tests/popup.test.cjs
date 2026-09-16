const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const lookupSource = fs.readFileSync(path.join(root, 'lookup.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

const RESULT = {
  status: 'ok',
  address: '9300 S Drexel Ave',
  displayName: '9300, South Drexel Avenue, Chicago, Illinois',
  lat: 41.725637,
  lon: -87.601042,
  layers: [
    { key: 'tif', label: 'TIF District', state: 'matched', name: '87th/Cottage Grove' },
    { key: 'ssa', label: 'Special Service Area', state: 'matched', name: 'Chatham (SSA #51)' },
    { key: 'qct', label: 'Qualified Census Tract', state: 'not_matched', name: '' },
    { key: 'hubzone', label: 'HUBZone', state: 'not_matched', name: '' }
  ],
  matched: [
    { key: 'tif', label: 'TIF District', state: 'matched', name: '87th/Cottage Grove' },
    { key: 'ssa', label: 'Special Service Area', state: 'matched', name: 'Chatham (SSA #51)' }
  ],
  programs: [
    { id: 'tif', name: 'TIF Districts', level: 'City', zoneKey: 'tif', url: 'https://www.chicago.gov/tif' }
  ],
  reportUrl: 'https://chicagoincentiveexplorer.com/report?instant=true&lat=41.725637&lon=-87.601042&addr=9300%20S%20Drexel%20Ave&src=extension'
};

function popup(handlers = {}) {
  const { document, window } = parseHTML(markup);
  const sent = [];
  const sandbox = vm.createContext({
    document,
    setTimeout,
    clearTimeout,
    URL,
    chrome: {
      runtime: {
        sendMessage: async message => {
          sent.push(message);
          const handler = handlers[message.type];
          if (typeof handler === 'function') return handler(message);
          if (message.type === 'cie_recent') return { items: [] };
          return { result: RESULT };
        }
      }
    }
  });
  sandbox.globalThis = sandbox;
  // popup.html loads lookup.js first; the harness does the same.
  vm.runInContext(lookupSource, sandbox);
  vm.runInContext(source, sandbox);
  const $ = selector => document.querySelector(selector);
  // Messages cross the vm realm boundary, so compare plain copies.
  const plain = value => JSON.parse(JSON.stringify(value));
  return {
    document, sent, $, plain,
    async check(address) {
      $('#cie-address').value = address;
      $('#cie-form').dispatchEvent(new window.Event('submit'));
      await settle(); await settle(); await settle();
    },
    click(element) { element.dispatchEvent(new window.Event('click')); }
  };
}

test('a result renders the address, matched zones, program tag and report link', async () => {
  const view = popup();
  await view.check('9300 S Drexel Ave');
  assert.deepEqual(view.plain(view.sent[1]), { type: 'cie_lookup', address: '9300 S Drexel Ave' });
  assert.equal(view.$('#cie-result').hasAttribute('hidden'), false);
  assert.equal(view.$('#cie-status').hasAttribute('hidden'), true);
  assert.equal(view.$('.result-address').textContent, '9300 S Drexel Ave');

  const zones = [...view.document.querySelectorAll('.zone')].map(z => z.textContent.trim());
  assert.equal(zones.length, 2);
  assert.ok(zones[0].includes('TIF District') && zones[0].includes('87th/Cottage Grove'));
  assert.ok(zones[1].includes('Chatham (SSA #51)'));
  assert.equal(view.$('.note').textContent, '2 other layers checked, no match.');

  const program = view.$('.program a');
  assert.equal(program.textContent, 'TIF Districts');
  assert.equal(program.getAttribute('href'), 'https://www.chicago.gov/tif');
  assert.equal(view.$('.program .tag').textContent, 'City');
  assert.equal(view.$('.report').getAttribute('href'), RESULT.reportUrl);
});

test('an address with no zone matches says so instead of showing an empty list', async () => {
  const bare = { ...RESULT, matched: [], programs: [] };
  const view = popup({ cie_lookup: () => ({ result: bare }) });
  await view.check('9300 S Drexel Ave');
  assert.equal(view.document.querySelectorAll('.zone').length, 0);
  assert.equal(view.$('.note').textContent, 'No zone matches here. 4 layers checked.');
  assert.equal(view.document.querySelector('.programs'), null);
});

test('program and zone names are escaped, never parsed as markup', async () => {
  const hostile = {
    ...RESULT,
    address: '<b>9300</b> S Drexel Ave',
    programs: [{ id: 'x', name: '<img src=x onerror=alert(1)>Payload', level: '<script>', zoneKey: 'tif', url: 'https://www.chicago.gov/tif' }],
    matched: [{ key: 'tif', label: 'TIF District', state: 'matched', name: '<svg onload=alert(1)>' }]
  };
  const view = popup({ cie_lookup: () => ({ result: hostile }) });
  await view.check('anything');
  const html = view.$('#cie-result').innerHTML;
  assert.equal(view.document.querySelectorAll('#cie-result img, #cie-result svg, #cie-result script, #cie-result b').length, 0);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;Payload'));
  assert.ok(html.includes('&lt;svg onload=alert(1)&gt;'));
  assert.equal(view.$('.program a').textContent, '<img src=x onerror=alert(1)>Payload');
  assert.equal(view.$('.program a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(view.$('.program a').getAttribute('target'), '_blank');
  assert.equal(view.$('.result-address').textContent, '<b>9300</b> S Drexel Ave');
});

test('a program or report link that is not http(s) renders without an anchor', async () => {
  const unsafe = {
    ...RESULT,
    programs: [{ id: 'x', name: 'Bad Link Program', level: 'City', zoneKey: 'tif', url: 'javascript:alert(1)' }],
    reportUrl: 'javascript:alert(2)'
  };
  const view = popup({ cie_lookup: () => ({ result: unsafe }) });
  await view.check('9300 S Drexel Ave');
  assert.equal(view.document.querySelectorAll('#cie-result a').length, 0);
  assert.equal(view.$('.program-name').textContent, 'Bad Link Program');
  assert.equal(view.$('.program-name').tagName.toLowerCase(), 'span');
  assert.equal(view.document.querySelector('.report'), null);
});

test('errors show the service copy and clear the previous result', async () => {
  const outage = 'The address service is temporarily unavailable. Try again in a minute.';
  const view = popup({ cie_lookup: message => (message.address === 'bad' ? { error: outage } : { result: RESULT }) });
  await view.check('9300 S Drexel Ave');
  assert.equal(view.$('#cie-result').hasAttribute('hidden'), false);
  await view.check('bad');
  assert.equal(view.$('#cie-result').hasAttribute('hidden'), true);
  assert.equal(view.$('#cie-status').textContent, outage);
  assert.equal(view.$('#cie-status').className, 'status is-error');
  assert.equal(view.$('#cie-submit').disabled, false, 'the button comes back after a failure');

  const thrown = popup({ cie_lookup: () => { throw new Error('worker gone'); } });
  await thrown.check('9300 S Drexel Ave');
  assert.equal(thrown.$('#cie-status').textContent, outage);
});

test('recent lookups render up to eight rows and a click re-runs that address', async () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ address: `Addr ${i}`, matchedCount: i, usedAt: 1 }));
  const view = popup({ cie_recent: () => ({ items }) });
  await settle(); await settle();
  assert.equal(view.$('#cie-recent-section').hasAttribute('hidden'), false);
  const rows = [...view.document.querySelectorAll('.recent-item')];
  assert.equal(rows.length, 8);
  assert.equal(rows[1].querySelector('.recent-address').textContent, 'Addr 1');
  assert.equal(rows[1].querySelector('.recent-count').textContent, '1 zone');
  assert.equal(rows[2].querySelector('.recent-count').textContent, '2 zones');

  view.click(rows[3]);
  await settle(); await settle(); await settle();
  assert.equal(view.$('#cie-address').value, 'Addr 3');
  assert.deepEqual(view.plain(view.sent.filter(m => m.type === 'cie_lookup')), [{ type: 'cie_lookup', address: 'Addr 3' }]);
  assert.equal(view.$('.result-address').textContent, '9300 S Drexel Ave');
});

test('an empty recent list stays hidden and blank input is not looked up', async () => {
  const view = popup();
  await settle(); await settle();
  assert.equal(view.$('#cie-recent-section').hasAttribute('hidden'), true);
  await view.check('   ');
  assert.deepEqual(view.plain(view.sent.filter(m => m.type === 'cie_lookup')), []);
});

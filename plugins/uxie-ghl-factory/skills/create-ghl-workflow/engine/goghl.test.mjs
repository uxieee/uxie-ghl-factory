import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintBtn, lintList, lintSpintax, checkGoghlSyntax, GOGHL_ACTION_KEYS, GOGHL_TRIGGER_KEYS, GOGHL_WARMUP } from './goghl.mjs';

test('the vendor\'s own full example lints clean; structural mistakes are named', () => {
  assert.deepEqual(lintBtn('#btn|Welcome!|Choose an action|image*https://example.com/image.jpg|quick_reply*Get Started*start_btn|cta_url*Visit Website*https://example.com|cta_call*Call Me*+15551234567|cta_copy*Copy Coupon*blackfriday50'), []);
  assert.deepEqual(lintBtn('#btn|Hi! What brings you here today?|undefined|undefined|quick_reply*Get a Quote*quote|quick_reply*Book a Call*call|quick_reply*Just Browsing*browse'), []);
  assert.ok(lintBtn('#btn|Hello|undefined|undefined')[0].includes('no buttons') || lintBtn('#btn|Hello|undefined|undefined').length);
  assert.match(lintBtn('#btn|Hi|undefined|undefined|magic*X*y')[0], /not one of/);
  assert.match(lintBtn('#btn|Hi|undefined|undefined|cta_url*Site*ftp://x')[0], /http/);
  assert.match(lintBtn('#btn|Hi|undefined|undefined|cta_call*Call*banana')[0], /phone/);
  assert.match(lintBtn('#btn||undefined|undefined|quick_reply*A*a')[0], /title/);
  assert.match(lintBtn('#btn|Hi|undefined|imagehttps://x|quick_reply*A*a')[0], /media/);
});

test('the vendor\'s list example lints clean; the 6-segment rule and row shape are enforced', () => {
  assert.deepEqual(lintList('#list|Product Catalog|Choose your product|Powered by GoGHL|View Products|Electronics*iPhone 15*Latest iPhone model*iphone15/Electronics*Samsung Galaxy*Premium Android*galaxy01/Clothing*T-Shirt*Comfortable cotton*tshirt01/Clothing*Jeans*Classic denim*jeans01'), []);
  assert.deepEqual(lintList('#list|How can we help?|Select a topic below|undefined|Get Help|Billing*Payment Issue*Problem with payment*billing01/Technical*Login Problem*Cant access account*login01'), []);
  assert.match(lintList('#list|T|desc|undefined|Go')[0], /6 segments/);
  assert.match(lintList('#list|T|undefined|undefined|Go|A*B*C*d')[0], /REQUIRED/);
  assert.match(lintList('#list|T|d|undefined|Go|A*B*C')[0], /4 fields/);
  assert.match(lintList('#list|T|d|undefined|Go|A*B*C*x/A*E*F*x')[0], /unique/);
});

test('spintax: vendor example clean; >7 options, empties, nesting and imbalance flagged; merge tags never confuse it', () => {
  assert.deepEqual(lintSpintax('{Hello|Hi|Hey} {{contact.first_name}}, {how are you|hope you\'re well|how\'s it going}?'), []);
  assert.match(lintSpintax('{a|b|c|d|e|f|g|h}')[0], /8 options/);
  assert.match(lintSpintax('{a||b}')[0], /empty option/);
  assert.match(lintSpintax('{a|{b|c}}')[0], /nested/);
  assert.match(lintSpintax('hi } there')[0], /unbalanced/);
  assert.deepEqual(lintSpintax('plain {{contact.email}} text'), []);
});

test('checkGoghlSyntax warns per step, quotes the literal-text consequence, and the hatch skips', () => {
  const warns = [];
  const T = [
    { id: 'a', type: 'sms', name: 'WA blast', attributes: { body: '#btn|Hi|undefined|undefined|magic*X*y\nsecond line' } },
    { id: 'b', type: 'email', name: 'ok', attributes: { html: '<p>no syntax here</p>' } },
  ];
  const f = checkGoghlSyntax(T, { warn: (m) => warns.push(m) });
  assert.equal(f.length, 1);
  assert.match(warns[0], /LITERAL TEXT/);
  assert.deepEqual(checkGoghlSyntax(T, { skipGoghlCheck: true }), []);
});

test('the harvested registry is intact (10 actions, 11 triggers, 5 warm-up phases)', () => {
  assert.equal(GOGHL_ACTION_KEYS.size, 10);
  assert.equal(GOGHL_TRIGGER_KEYS.size, 11);
  assert.equal(GOGHL_WARMUP.length, 5);
  assert.equal(GOGHL_WARMUP[0].perDay, '10-15');
});

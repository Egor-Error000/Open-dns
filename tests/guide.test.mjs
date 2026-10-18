import assert from 'node:assert/strict';
import vm from 'node:vm';
import {rulesFor, render, catalog} from '../src/render.mjs';

const html = render(Object.keys(catalog))['setup.html'];
const start = html.indexOf('<script>') + '<script>'.length;
const end = html.indexOf('</script>', start);
assert(start >= '<script>'.length && end > start, 'inline script exists');
const nodes = new Map();
let copied;
const document = {getElementById(id) {
  if (!nodes.has(id)) nodes.set(id, {textContent: '', addEventListener(_type, callback) { this.callback = callback; }});
  return nodes.get(id);
}};
const context = {document, navigator: {clipboard: {writeText: async value => {copied = value;}}}, window: {prompt() { throw new Error('clipboard should work'); }}};
vm.runInNewContext(html.slice(start, end), context, {timeout: 1000});

const policy = rulesFor(['baseline', 'openai', 'cursor', 'claude', 'openrouter', 'grok']);
const expected = [...new Set([...policy.exact, ...policy.suffix.flatMap(name => [name, `*.${name}`])])].sort();
const list = nodes.get('domains').textContent.split('\n').sort();
assert.deepEqual(list, expected, 'guide hostname list matches service catalog');
assert.equal((html.match(/section class="card"/g) ?? []).length, 5, 'all instruction sections exist');
assert(!html.includes('<script src='), 'no external script dependencies');
assert(!/__DOH_URL__|__SERVER_IPV4__|__SERVICE_HOSTS__/.test(html), 'template fully rendered');
assert(!/30 дней|твой IP разрешён|срок доступа|адрес добавлен/.test(html), 'no obsolete IP registration instructions');
await nodes.get('copyDomains').callback();
assert.equal(copied, nodes.get('domains').textContent, 'copy button copies full hostname list');
console.log(`Guide validated: five sections, ${expected.length} YogaDNS masks, working copy action`);

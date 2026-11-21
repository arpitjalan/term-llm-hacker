import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  noteText, highlight, renderMarkdown, continueList, shiftLines, toggleTask, toggleTaskAt, wrapSelection, isListLine, toMarkdown,
} from '../../markdown.js';

const unescape = (s) => s.replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e]);
const textOf = (markup) => unescape(markup.replace(/<[^>]*>/g, ''));
const apply = (value, { from, to, insert }) => value.slice(0, from) + insert + value.slice(to);

test('titles and previews match the notes widget (shared fixture)', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/note-text.json', import.meta.url), 'utf8'));
  for (const { body, title, snippet } of cases) assert.deepEqual(noteText(body), { title, snippet }, JSON.stringify(body));
  assert.equal([...noteText('😀'.repeat(200)).title].length, 120, 'cut by characters, not UTF-16 units');
});

test('highlight keeps every character, so the coloured copy lines up with the textarea', () => {
  const samples = [
    '', '\n', 'plain', '# Title\n\nbody', '- [ ] task\n- [x] done **bold**\n  1. nested `code`',
    '```js\nconst a = "<b>";\n```\n> quote with [link](https://x.y/?a=1&b=2)', '***\n___', 'snake_case_name and _it_',
    '~~gone~~ https://example.com/path). <script>alert(1)</script>', '**unclosed and `unclosed', '\t\ttabs\r\nwindows',
    '#not-heading', '![alt](img.png) & "quotes" \'single\'', '~~~\n```\nstill code\n~~~\nafter',
  ];
  // And random mixes of the characters Markdown cares about.
  const alphabet = ['#', ' ', '*', '_', '`', '~', '[', ']', '(', ')', '-', '>', '\n', 'a', 'b', '1', '.', 'x', '<', '&', '"', 'h', 't', 'p', ':', '/'];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 400; n++) samples.push(Array.from({ length: Math.floor(rand() * 80) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join(''));
  for (const sample of samples) {
    const out = highlight(sample);
    assert.equal(textOf(out), sample, JSON.stringify(sample));
    assert.doesNotMatch(out, /<(?!\/?span\b)/, 'only spans');
  }
});

test('highlight marks the structure', () => {
  assert.match(highlight('# Title'), /^<span class="vn-md-heading"><span class="vn-md-mark">#<\/span> Title<\/span>$/);
  assert.match(highlight('- [x] done'), /vn-md-bullet.*vn-md-box-done.*vn-md-done/);
  assert.match(highlight('```\nx\n```'), /vn-md-fence[\s\S]*vn-md-codeblock">x[\s\S]*vn-md-fence/);
  assert.match(highlight('**b** _i_ `c` ~~s~~'), /vn-md-bold[\s\S]*vn-md-italic[\s\S]*vn-md-code[\s\S]*vn-md-strike/);
  assert.doesNotMatch(highlight('snake_case_name'), /italic/);
});

test('render escapes text and only links http(s) and mailto', () => {
  const out = renderMarkdown([
    '<script>alert(1)</script> <img src=x onerror=alert(1)>',
    '[x](javascript:alert(1)) [y](data:text/html,hi) [ok](https://a.example/?q=1&r="2")',
    '![photo](https://img.example/p.png) `<b>code</b>`',
    '\u0001 0 \u0002 placeholders are not user-controllable',
  ].join('\n'));
  // Every real tag and attribute is one the renderer means to write.
  const tags = { a: ['href', 'target', 'rel'], code: ['class'], input: ['type', 'data-line', 'checked'], li: ['class'], ol: ['start'] };
  for (const [, name, attrs] of out.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
    assert.ok(['a', 'p', 'br', 'code', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'input', 'blockquote', 'pre', 'hr'].includes(name), name);
    for (const [, attr] of attrs.matchAll(/\s([\w-]+)(?==|\s|$)/g)) assert.ok((tags[name] ?? []).includes(attr), `${name} ${attr}`);
  }
  for (const [, url] of out.matchAll(/href="([^"]*)"/g)) assert.match(url, /^(https?:\/\/|mailto:)/);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /<a href="https:\/\/a\.example\/\?q=1&amp;r=&quot;2&quot;" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.match(out, /<a href="https:\/\/img\.example\/p\.png"[^>]*>photo<\/a>/, 'images become links, never loads');
  assert.match(out, /<code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
  assert.doesNotMatch(out, /[\u0001\u0002]/);
});

test('render covers the blocks notes use', () => {
  const out = renderMarkdown('# Plan\n\nIntro **bold** and _em_\nsecond line\n\n- [ ] one\n- [x] two\n  - nested\n1. first\n2. second\n\n> quoted\n\n```sh\nls -la\n```\n---');
  assert.match(out, /^<h1>Plan<\/h1><p>Intro <strong>bold<\/strong> and <em>em<\/em><br>second line<\/p>/);
  assert.match(out, /<ul><li class="task-list-item"><input type="checkbox" data-line="5"> one<\/li><li class="task-list-item"><input type="checkbox" data-line="6" checked> two<ul><li>nested<\/li><\/ul><\/li><\/ul><ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(out, /<blockquote><p>quoted<\/p><\/blockquote><pre><code class="language-sh">ls -la<\/code><\/pre><hr>$/);
});

test('checkbox lines point at their source line, inside quotes too', () => {
  const body = 'intro\n> - [ ] quoted task\n- [ ] top task';
  const lines = [...renderMarkdown(body).matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(lines, [1, 2]);
  assert.equal(apply(body, toggleTask(body, 1)), 'intro\n> - [x] quoted task\n- [ ] top task');
  assert.equal(apply(body, toggleTask(body, 2)), 'intro\n> - [ ] quoted task\n- [x] top task');
  assert.equal(toggleTask(body, 0), null);
  const caret = body.indexOf('top');
  assert.equal(apply(body, toggleTaskAt(body, caret)), 'intro\n> - [ ] quoted task\n- [x] top task');
});

test('Enter continues lists and quotes, and an empty item ends the list', () => {
  const at = (value) => continueList(value, value.length);
  assert.equal(apply('- one', at('- one')), '- one\n- ');
  assert.equal(apply('  * one', at('  * one')), '  * one\n  * ');
  assert.equal(apply('9. nine', at('9. nine')), '9. nine\n10. ');
  assert.equal(apply('- [x] done', at('- [x] done')), '- [x] done\n- [ ] ');
  assert.equal(apply('> said', at('> said')), '> said\n> ');
  assert.equal(apply('a\n- ', at('a\n- ')), 'a\n', 'empty item: the marker goes');
  assert.equal(apply('- [ ] ', at('- [ ] ')), '');
  assert.equal(at('plain'), null);
  assert.equal(continueList('- one two', 3), null, 'not at the end of the line');
  const edit = at('- one');
  assert.deepEqual(edit.select, ['- one\n- '.length, '- one\n- '.length]);
  assert.equal(isListLine('x\n- item', 4), true);
  assert.equal(isListLine('x\n- item', 0), false);
});

test('Tab indents and Shift+Tab outdents the selected lines', () => {
  const value = '- a\n- b\n- c';
  const indented = shiftLines(value, 4, 9, false); // b and c
  assert.equal(apply(value, indented), '- a\n  - b\n  - c');
  assert.deepEqual(indented.select, [6, 13]);
  const back = apply(value, indented);
  assert.equal(apply(back, shiftLines(back, 6, 13, true)), value);
  assert.equal(apply('x', shiftLines('x', 1, 1, true)), 'x', 'nothing to outdent');
});

test('Mod+B and Mod+I wrap and unwrap', () => {
  assert.equal(apply('a word b', wrapSelection('a word b', 2, 6, '**')), 'a **word** b');
  assert.equal(apply('a **word** b', wrapSelection('a **word** b', 4, 8, '**')), 'a word b');
  assert.equal(apply('a **word** b', wrapSelection('a **word** b', 2, 10, '**')), 'a word b');
  assert.deepEqual(wrapSelection('ab', 1, 1, '_'), { from: 1, to: 1, insert: '__', select: [2, 2] });
});

/* ---------------------------------------------------- page to note (clip.js) */

// Enough of an HTML parser for these cases: nodes shaped like the page's
// (nodeType, nodeName, nodeValue, childNodes, getAttribute).
const VOID = new Set(['BR', 'HR', 'IMG', 'INPUT']);
function parse(markup) {
  const root = { nodeType: 11, nodeName: '#document-fragment', childNodes: [] };
  const stack = [root];
  for (const m of markup.matchAll(/<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      stack.pop();
    } else if (m[2]) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) attrs[a[1]] = a[2] ?? '';
      const node = { nodeType: 1, nodeName: m[2].toUpperCase(), childNodes: [], getAttribute: (name) => (name in attrs ? attrs[name] : null) };
      top.childNodes.push(node);
      if (!VOID.has(node.nodeName)) stack.push(node);
    } else {
      top.childNodes.push({ nodeType: 3, nodeName: '#text', nodeValue: unescape(m[4]) });
    }
  }
  return root;
}
const md = (markup, options) => toMarkdown(parse(markup), options);
const hasClass = (name) => (n) => (n.getAttribute('class') ?? '').split(/\s+/).includes(name);

test('selections keep inline marks, safe links and line breaks', () => {
  assert.equal(
    md('<p>Hello <strong>bold</strong>, <em>it</em>, <del>gone</del>, <code>x_y</code> and <a href="https://e.com/a?b=1">a link</a>.</p>'),
    'Hello **bold**, _it_, ~~gone~~, `x_y` and [a link](https://e.com/a?b=1).',
  );
  assert.equal(md('<p>a<b> b </b>c</p>'), 'a **b** c', 'spaces stay outside the markers');
  assert.equal(md('<p><a href="javascript:alert(1)">click</a> <a href="https://e.com">https://e.com</a></p>'), 'click https://e.com');
  assert.equal(md('<p>\n   spread\n   out   </p><p>line<br>next</p>'), 'spread out\n\nline\nnext');
  assert.equal(md('<p><code>a `tick` b</code></p>'), '`` a `tick` b ``');
  assert.equal(md('<p><img src="https://e.com/i.png" alt="pic"> <img src="blob:x" alt="local"></p>'), '![pic](https://e.com/i.png) local');
});

test('selections keep headings, lists, tasks, quotes, rules and tables', () => {
  assert.equal(md('<h2>Title</h2><p>one</p><hr><p>two</p>'), '## Title\n\none\n\n---\n\ntwo');
  assert.equal(
    md('<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol start="3"><li>x</li><li><p>y</p><p>more</p></li></ol>'),
    '- a\n- b\n  - c\n\n3. x\n4. y\n   more',
  );
  assert.equal(
    md('<ul><li class="task-list-item"><input type="checkbox" checked disabled> done</li><li><p><input type="checkbox"> todo</p></li></ul>'),
    '- [x] done\n- [ ] todo',
  );
  assert.equal(md('<blockquote><p>q1</p><p>q2</p></blockquote>'), '> q1\n>\n> q2');
  assert.equal(
    md('<table><thead><tr><th>a</th><th>b|c</th></tr></thead><tbody><tr><td>1</td><td><em>2</em></td></tr></tbody></table>'),
    '| a | b\\|c |\n| --- | --- |\n| 1 | _2_ |',
  );
});

test('code blocks keep their text and language, without the page controls', () => {
  const block = '<pre data-vn-code><div class="vn-code-head"><span>python</span><button>wrap</button></div>' +
    '<code class="hljs language-python">def f():\n    <span class="k">return</span> 1\n</code><button class="code-copy-btn">copy</button></pre>';
  assert.equal(md(block, { skip: hasClass('vn-code-head') }), '```python\ndef f():\n    return 1\n```');
  assert.equal(md('<pre><code>```\nnested\n```</code></pre>'), '````\n```\nnested\n```\n````');
});

test('controls, hidden parts and whatever skip() names are left out', () => {
  assert.equal(
    md('<div><p>kept</p><button>Copy</button><svg><text>icon</text></svg><p hidden>hidden</p><script>x()</script><p class="meta">12:04</p></div>',
      { skip: hasClass('meta') }),
    'kept',
  );
});

test('a selection: its ends cut, items keep their numbers, and a phrase comes without markers', () => {
  const root = parse('<ol><li>first item</li><li>second item</li><li>third item</li></ol>');
  const [first, second, third] = root.childNodes[0].childNodes;
  const cut = new Map([[second.childNodes[0], 'item'], [third.childNodes[0], 'third']]);
  assert.equal(
    toMarkdown(root, { skip: (n) => n === first, text: (n) => cut.get(n) ?? n.nodeValue }),
    '2. item\n3. third',
  );
  const heading = parse('<h3>A <em>heading</em></h3>').childNodes[0];
  assert.equal(toMarkdown(heading, { inline: true }), 'A _heading_');
  assert.equal(toMarkdown(heading), '### A _heading_');
  const pre = parse('<pre><code class="language-go">x := 1</code></pre>').childNodes[0];
  assert.equal(toMarkdown(pre, { inline: true }), '```go\nx := 1\n```', 'code stays a code block');
  const code = parse('<p>run <code>make test</code> now</p>').childNodes[0].childNodes[1];
  assert.equal(toMarkdown(code), '`make test`');
});

test('what the selection gives back previews the way it looked', () => {
  const back = md('<h2>Plan</h2><ul><li><input type="checkbox"> ship it</li></ul><pre><code class="language-sh">make</code></pre>');
  const html = renderMarkdown(back);
  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(html, /<input type="checkbox" data-line="2"> ship it/);
  assert.match(html, /<pre><code class="language-sh">make<\/code><\/pre>/);
});

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global.window || {};

const teacherAnnotationHelp = require("../teacher-annotation-help.js");

test("teacher annotation guide escapes custom code content", () => {
  const hostileCode = `<img src=x onerror="alert(1)">`;
  const hostileLabel = `Grammar <script>alert("x")</script>: help`;
  const html = teacherAnnotationHelp.renderGuide([{
    code: hostileCode,
    label: hostileLabel,
  }]);

  assert.match(html, /data-code-signature="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;:Grammar &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;: help"/);
  assert.match(html, /data-annotation-proxy-code="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.match(html, /title="Grammar &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;: help"/);
  assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror="alert\(1\)">/);
});

test("teacher annotation guide signatures change with the rendered codes", () => {
  assert.notEqual(
    teacherAnnotationHelp.buildCodeSignature([{ code: "CS", label: "Comma splice" }]),
    teacherAnnotationHelp.buildCodeSignature([{ code: "RO", label: "Run-on" }])
  );
});

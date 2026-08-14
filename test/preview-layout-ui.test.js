'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('preview toolbar can shrink within a narrow main grid column', () => {
  const js = fs.readFileSync('public/app.js', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');

  assert.match(css, /#main\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.preview-head\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.preview-actions\s*\{[^}]*flex:\s*0\s+1\s+auto[^}]*min-width:\s*0/s);
  assert.match(css, /@container\s*\(max-width:\s*420px\)\s*\{\s*\.preview-actions\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(js, /previewWRatio:\s*Number\(localStorage\.getItem\('fb_preview_w_ratio'\)\)/);
  assert.match(js, /previewHRatio:\s*Number\(localStorage\.getItem\('fb_preview_h_ratio'\)\)/);
  assert.match(js, /savedRatio\s*\|\|\s*\(span\s*&&\s*savedPx\s*\?\s*savedPx\s*\/\s*span\s*:\s*2\s*\/\s*3\)/);
  assert.match(js, /state\.previewWRatio\s*=\s*fm\.width\s*\?\s*state\.previewW\s*\/\s*fm\.width\s*:\s*0/);
  assert.match(js, /state\.previewHRatio\s*=\s*fm\.height\s*\?\s*state\.previewH\s*\/\s*fm\.height\s*:\s*0/);
  assert.match(js, /function bindPreviewResponsiveSize\(\)/);
  assert.match(js, /new ResizeObserver\([\s\S]*?\)\.observe\(fm\)/);
  assert.match(js, /bindPreviewResponsiveSize\(\);/);
});

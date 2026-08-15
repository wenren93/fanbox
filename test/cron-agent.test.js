'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCronOps, validCronAction } = require('../lib/cron-agent');

test('抽取 ClawBot 定时任务标记并移除协议内容', () => {
  const r = extractCronOps('我来设置。<cron action="save">{"name":"提醒吃药","schedule":{"type":"at","time":"2026-08-15T12:10"}}</cron>完成。');
  assert.equal(r.clean, '我来设置。完成。');
  assert.deepEqual(r.ops, [{
    action: 'save',
    data: { name: '提醒吃药', schedule: { type: 'at', time: '2026-08-15T12:10' } },
  }]);
});

test('兼容无 action 属性、拒绝未知操作', () => {
  const r = extractCronOps('<cron>{"action":"preview","schedule":{"type":"every","minutes":10}}</cron>');
  assert.equal(r.ops[0].action, 'preview');
  assert.equal(validCronAction(r.ops[0].action), true);
  assert.equal(validCronAction('exec-shell'), false);
});

test('非法 JSON 会被标记为无效而不是抛异常', () => {
  const r = extractCronOps('<cron action="save">not-json</cron>');
  assert.equal(r.ops[0].data._invalid, true);
});

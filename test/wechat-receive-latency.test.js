const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ilink = require('../electron/wechat/ilink');
const bridge = require('../electron/wechat/bridge');

test('getUpdates treats a client-side long-poll timeout as an empty response', async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests += 1;
      if (requests > 1) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ret: 0, msgs: [{ message_type: 1 }], get_updates_buf: 'next' }));
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: '' }));
      }, 60);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const { port } = server.address();
  const account = { baseUrl: `http://127.0.0.1:${port}`, token: 'test-token' };
  const started = Date.now();
  const timedOut = await ilink.getUpdates(account, 'cursor', 40);
  const result = await ilink.getUpdates(account, 'cursor', 1000);

  assert.deepEqual(timedOut, { ret: 0, msgs: [], get_updates_buf: 'cursor' });
  assert.equal(result.msgs.length, 1);
  assert.ok(Date.now() - started < 500, 'the receive path should not enter a retry delay');
});

test('enqueueMsg keeps receiving while the same conversation is busy', async (t) => {
  const originalOnWechatMsg = bridge.onWechatMsg;
  const from = 'latency-test-user';
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const handled = [];

  bridge.msgQueue[from] = [];
  delete bridge.draining[from];
  bridge.onWechatMsg = async (msg) => {
    handled.push(msg.seq);
    if (msg.seq === 1) await firstBlocked;
  };
  t.after(() => {
    bridge.onWechatMsg = originalOnWechatMsg;
    delete bridge.msgQueue[from];
    delete bridge.draining[from];
  });

  bridge.enqueueMsg({ message_type: 1, from_user_id: from, seq: 1 });
  bridge.enqueueMsg({ message_type: 1, from_user_id: from, seq: 2 });

  assert.deepEqual(handled, [1]);
  assert.equal(bridge.msgQueue[from].length, 1, 'the second message should already be received and queued');

  releaseFirst();
  for (let i = 0; i < 20 && bridge.draining[from]; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(handled, [1, 2]);
  assert.equal(bridge.draining[from], false);
});

test('sendTyping reuses the per-user typing ticket', async (t) => {
  let configRequests = 0;
  let typingRequests = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/ilink/bot/getconfig') configRequests += 1;
      if (req.url === '/ilink/bot/sendtyping') typingRequests += 1;
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(req.url.endsWith('/getconfig') ? { typing_ticket: 'ticket-1' } : { ret: 0 }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const { port } = server.address();
  const account = { baseUrl: `http://127.0.0.1:${port}`, accountId: 'test-account', token: 'test-token' };
  await ilink.sendTyping(account, 'typing-test-user', true);
  await ilink.sendTyping(account, 'typing-test-user', false);

  assert.equal(configRequests, 1);
  assert.equal(typingRequests, 2);
});

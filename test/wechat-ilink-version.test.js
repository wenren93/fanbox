const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ilink = require('../electron/wechat/ilink');

test('sendText uses the official iLink v2.4.6 request metadata', async (t) => {
  let request;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      request = {
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ ret: 0 }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const result = await ilink.sendText(
    { baseUrl: `http://127.0.0.1:${port}`, token: 'test-token' },
    'test-user',
    'hello',
  );

  assert.equal(result.status, 200);
  assert.equal(result.json.ret, 0);
  assert.equal(request.headers['ilink-app-id'], 'bot');
  assert.equal(request.headers['ilink-app-clientversion'], '132102');
  assert.equal(request.headers.authorization, 'Bearer test-token');
  assert.equal(request.body.base_info.channel_version, '2.4.6');
  assert.equal(request.body.base_info.bot_agent, 'FanBox');
  assert.equal(request.body.msg.context_token, undefined);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClefDecisionModel } from '../src/ClefDecisionModel.js';
import type { DecisionInput } from '../src/ConversationDecision.js';

class DecisionService
{
  static readonly accountID = '0123456789abcdef0123456789abcdef';
  static readonly token = 'test-only-token';
  static readonly greeting: DecisionInput = {
    assistantName: '小媧',
    history: [{ speaker: 'ASSISTANT (小媧)', text: '大家好，我是小媧。', time: Date.parse('2026-11-28T01:00:00Z') }],
    latest: { speaker: 'Human 1', text: '妳好啊，改天一起吃飯', time: Date.parse('2026-11-28T04:00:00Z') },
  };

  readonly requests: { url: string; options: RequestInit }[] = [];
  status = 200;
  response: unknown = { success: true, result: { answers: { addressed: { type: 'noul', noul: 0.9244 } } } };

  readonly model = new ClefDecisionModel(DecisionService.accountID, DecisionService.token, async (url, options) =>
  {
    this.requests.push({ url: String(url), options: options! });
    return Response.json(this.response, { status: this.status });
  });
}

test('a natural greeting traverses the authenticated Workers AI decision contract and yields its probability', async () =>
{
  const service = new DecisionService();

  assert.equal(await service.model.probabilityOfAddress(DecisionService.greeting), 0.9244);

  const request = service.requests[0]!;
  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/accounts/' + DecisionService.accountID + '/ai/run');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');

  assert.equal(new Headers(request.options.headers).get('Authorization'), 'Bearer ' + DecisionService.token);
  assert.ok(request.options.signal instanceof AbortSignal);

  const body = JSON.parse(String(request.options.body));
  assert.equal(body.model, '@cf/cloudflare/clef-flash');
  assert.equal(body.input.model, 'clef-flash');
  assert.equal(body.input.questions.addressed.type, 'noul');

  assert.match(body.input.state, /LATEST MESSAGE: \[2026-11-28T04:00:00.000Z\] Human 1: "妳好啊，改天一起吃飯"/);
  assert.ok(!JSON.stringify(body).includes(DecisionService.token));
});

test('an unavailable or malformed decision service never supplies an activation probability', async () =>
{
  const service = new DecisionService();
  service.status = 429;
  service.response = { secret: 'untrusted provider response' };

  await assert.rejects(service.model.probabilityOfAddress(DecisionService.greeting), /^BridgeError: Workers AI request failed \(HTTP 429\)\.$/);

  service.status = 200;

  for (const response of [
    { success: false, result: { answers: { addressed: { type: 'noul', noul: 1 } } } },
    { success: true, result: { answers: { addressed: { type: 'choice', noul: 1 } } } },
    { success: true, result: { answers: { addressed: { type: 'noul', noul: '1' } } } },
    { success: true, result: { answers: { addressed: { type: 'noul', noul: 1.01 } } } },
  ])
  {
    service.response = response;
    await assert.rejects(service.model.probabilityOfAddress(DecisionService.greeting), /Invalid Workers AI decision response/);
  }
});

// raw_request must be able to PUT back any document it can GET.
//
// A GHL workflow document legitimately carries SIGNED STORAGE URLS — `fileUrl` at the top
// level and `attributes.previewUrl` on email steps — each ending in `?…&token=<uuid>`. The
// credential guard read that `token=` as a secret and refused the PUT with
// `VALIDATION_FAILED: a tool argument contains a credential-looking value`, while
// scrubSecrets redacted the same URLs on the way OUT. Between them the escape hatch could
// not round-trip a single real workflow, and stripping the fields is a one-way door: once
// `fileUrl` is gone you cannot PUT it back either. (Found live on the UK account
// 2026-07-31, working around it with a local script so the URL never became a tool arg.)
//
// The exemption is narrow on purpose, and these tests hold that line: it covers the two
// Google storage hosts and ONLY the labelled-value rule. A real `Authorization: Bearer …`
// or an `ey…` JWT is still refused, including inside a storage-shaped URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';
import { containsSecrets, ok } from '../core/errors.mjs';

const LOC = 'LOC_FIXTURE_0000000001';
const WID = 'wf-1';
const FILE_URL = 'https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/'
  + 'workflows%2Fwf-1%2Fdata.json?alt=media&token=9f1d2c48-51ac-4c73-9a4e-0b2f7c6d3e11';
const PREVIEW_URL = 'https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/'
  + 'emails%2Fpreview.png?alt=media&token=1a2b3c4d-5e6f-4071-8899-aabbccddeeff';
const JWT_SHAPED = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';

// The shape the workflow GET actually returns (unwrapped — there is no {workflow:…} envelope).
const document = () => ({
  _id: WID,
  locationId: LOC,
  status: 'published',
  version: 14,
  fileUrl: FILE_URL,
  workflowData: {
    templates: [
      { id: 's1', type: 'email', name: 'Welcome', next: null, parentKey: null, order: 0, attributes: { previewUrl: PREVIEW_URL } },
    ],
  },
});

async function withClient(deps, fn) {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, deps, TOOLS.filter((t) => t.name === 'raw_request'));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await fn(client); } finally { await client.close(); await server.close(); }
}

const contractOf = (result) => JSON.parse(result.content[0].text);

function spyDeps() {
  const sent = [];
  return {
    sent,
    deps: {
      state: {},
      makeGw: () => ({
        call: async (method, path, body) => {
          sent.push({ method, path, body });
          return { ok: true, status: 200, json: { ...document(), version: 15 } };
        },
      }),
    },
  };
}

test('a document carrying signed storage URLs survives a full GET → PUT round trip', async () => {
  const { sent, deps } = spyDeps();
  await withClient(deps, async (client) => {
    const read = await client.callTool({
      name: 'raw_request',
      arguments: { locationId: LOC, method: 'GET', path: `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true` },
    });
    const readContract = contractOf(read);
    assert.equal(readContract.ok, true, JSON.stringify(readContract));
    // The READ side: the URLs come back intact, so there is something to PUT back.
    const body = readContract.data.body ?? readContract.data.json ?? readContract.data;
    const asText = JSON.stringify(body);
    assert.ok(asText.includes(FILE_URL), 'fileUrl was mangled on the way out — nothing left to round-trip');
    assert.ok(asText.includes(PREVIEW_URL), 'previewUrl was mangled on the way out');

    // The WRITE side: the same document goes back as a tool argument, unedited except for
    // the rename this whole exercise exists to support.
    const put = document();
    put.workflowData.templates[0].name = 'Welcome (renamed)';
    const write = await client.callTool({
      name: 'raw_request',
      arguments: { locationId: LOC, method: 'PUT', path: `/workflow/${LOC}/${WID}`, body: put, confirm: true },
    });
    const writeContract = contractOf(write);
    assert.equal(writeContract.ok, true, JSON.stringify(writeContract));
  });

  const sentPut = sent.find((r) => r.method === 'PUT');
  assert.ok(sentPut, 'the PUT never reached the gateway — the credential guard ate it');
  assert.equal(sentPut.body.fileUrl, FILE_URL, 'the signed fileUrl must reach the wire verbatim');
  assert.equal(sentPut.body.workflowData.templates[0].attributes.previewUrl, PREVIEW_URL);
});

test('the exemption does not extend to real credentials, inside a storage URL or out', async () => {
  const { deps } = spyDeps();
  const smuggled = `${FILE_URL}&x=${JWT_SHAPED}`;
  await withClient(deps, async (client) => {
    for (const [label, body] of [
      ['a bare JWT', { note: JWT_SHAPED }],
      ['an Authorization header value', { headers: { authorization: `Bearer ${JWT_SHAPED}` } }],
      ['a JWT smuggled into a storage-shaped URL', { fileUrl: smuggled }],
    ]) {
      const result = await client.callTool({
        name: 'raw_request',
        arguments: { locationId: LOC, method: 'PUT', path: `/workflow/${LOC}/${WID}`, body, confirm: true },
      });
      const contract = contractOf(result);
      assert.equal(contract.ok, false, label);
      assert.equal(contract.code, 'VALIDATION_FAILED', label);
      // refused by the CREDENTIAL guard specifically, not by some other validation
      assert.match(contract.detail, /credential-looking/, label);
      assert.ok(!JSON.stringify(result).includes(JWT_SHAPED), `${label} leaked into the transcript`);
    }
  });
});

test('containsSecrets exempts signed storage URLs but still flags labelled secrets beside them', () => {
  assert.equal(containsSecrets(FILE_URL), false);
  assert.equal(containsSecrets({ fileUrl: FILE_URL, previewUrl: PREVIEW_URL }), false);
  // a labelled secret sitting next to one in the same string is still caught
  assert.equal(containsSecrets(`${FILE_URL} , api_key=hunter2secretvalue`), true);
  // and a non-storage host gets no exemption at all
  assert.equal(containsSecrets('https://evil.example.com/x?token=9f1d2c48-51ac-4c73-9a4e-0b2f7c6d3e11'), true);
});

test('scrubSecrets leaves signed storage URLs readable in a tool RESULT', () => {
  const scrubbed = ok({ fileUrl: FILE_URL, note: `token-id: ${'opaque-id-value'}` });
  assert.equal(scrubbed.data.fileUrl, FILE_URL);
  assert.match(scrubbed.data.note, /<redacted>/);
});

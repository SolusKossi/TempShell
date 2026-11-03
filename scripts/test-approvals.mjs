import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Isolated databases and fake credentials: never use a configured live instance.
const dir = mkdtempSync(join(tmpdir(), 'tempshell-approvals-'));
process.env.DATA_DIR = dir;
process.env.OWNER_PASSWORD_HASH = 'test-only';
process.env.COOKIE_SECRET = 'test-cookie-secret';
process.env.API_TOKEN = 'assistant-token';
const { app } = await import('../dist/app/routes.js');
const store = await import('../dist/app/store.js');
const { grantJoin } = await import('../dist/auth.js');
const { Hono } = await import('hono');
const s = store.createSession('Approval regression', 'owner');
const token = store.armExecutor(s.id, store.enableAuto(s.id));
const headers = { Authorization: `Bearer ${token}` };
const request = (path, options = {}) => app.request(`/x/${s.slug}${path}`, { headers, ...options });
const held = () => store.addEntry(s.id, 'claude', 'command', "Write-Output 'not run by this test'", 'powershell', null, { risk: 'risky', intent: 'Test approval', why: 'Regression test' });
const poll = async (capable = true) => (await request(`/poll?timeout=0${capable ? '&approvals=1' : ''}`)).json();
const decide = (seq, approve, customHeaders = headers) => request(`/decision/${seq}`, { method: 'POST', headers: { ...customHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ approve }) });
const authApp = new Hono();
authApp.get('/', c => { grantJoin(c, s.id); return c.text('ok'); });
const cookie = (await authApp.request('/')).headers.get('set-cookie').split(';')[0];
const webDecide = (seq, action) => app.request(`/s/${s.slug}/${action}/${seq}`, { method: 'POST', headers: { cookie } });

// A held command arriving during an idle long poll must wake the console too.
const idlePoll = request('/poll?timeout=2&approvals=1');
await new Promise(resolve => setTimeout(resolve, 20));
const first = held();
assert.equal((await (await idlePoll).json()).awaiting_approval.seq, first.seq);
assert.equal((await poll(false)).timed_out, true, 'legacy clients never see held work');
assert.equal((await poll()).awaiting_approval.seq, first.seq);
assert.equal(store.claimNextCommand(s.id), null, 'held work is never claimed');
assert.equal((await decide(first.seq, true, { Authorization: 'Bearer assistant-token' })).status, 401);
assert.equal((await decide(first.seq, true, {})).status, 401);
const other = store.createSession('Other target', 'owner');
const otherToken = store.armExecutor(other.id, store.enableAuto(other.id));
assert.equal((await decide(first.seq, true, { Authorization: `Bearer ${otherToken}` })).status, 401);
assert.equal((await decide(first.seq, 'true')).status, 400);
assert.equal((await decide('NaN', true)).status, 409);
assert.equal((await decide(first.seq, true)).status, 200);
assert.equal(store.listEntries(s.id).find(e => e.seq === first.seq).decided_by, 'console');
assert.equal((await decide(first.seq, false)).status, 409, 'first decision wins');
assert.equal((await poll()).seq, first.seq);
assert.equal((await poll()).timed_out, true, 'approved command is claimed once');
store.markCommandDone(s.id, first.seq);

const denied = held();
assert.equal((await decide(denied.seq, false)).status, 200);
await webDecide(denied.seq, 'approve');
assert.equal((await decide(denied.seq, false)).status, 409);
const replies = store.listEntries(s.id).filter(e => e.reply_to === denied.seq);
assert.equal(replies.length, 1, 'one denial reply across both surfaces');
assert.equal(replies[0].run_status, 'denied');
assert.equal((await poll()).timed_out, true);

const web = held();
await webDecide(web.seq, 'approve');
assert.equal((await decide(web.seq, false)).status, 409, 'web decision wins too');
assert.equal((await poll()).seq, web.seq);
store.markCommandDone(s.id, web.seq);
const webDenied = held();
await webDecide(webDenied.seq, 'deny');
assert.equal((await decide(webDenied.seq, true)).status, 409);
assert.equal(store.listEntries(s.id).filter(e => e.reply_to === webDenied.seq).length, 1);

const pending = held();
const readonly = store.addEntry(s.id, 'claude', 'command', 'Get-Date', 'powershell');
assert.equal((await poll()).seq, readonly.seq, 'held commands do not block read-only checks');
store.markCommandDone(s.id, readonly.seq);
assert.equal((await poll()).awaiting_approval.seq, pending.seq);
store.setAutoApprove(s.id, true);
assert.equal((await poll()).seq, pending.seq, 'turning gate off releases pending request');
store.markCommandDone(s.id, pending.seq);
store.setAutoApprove(s.id, false);
const stopHeld = held();
store.haltAuto(s.id);
assert.equal((await poll()).stop, true);
assert.equal((await decide(stopHeld.seq, true)).status, 409, 'stopped agents cannot approve');
store.resumeAuto(s.id);

// Reporting a completed task must not disconnect the session or require re-arming.
const completed = await app.request(`/api/sessions/${s.slug}/complete`, {
  method: 'POST',
  headers: { Authorization: 'Bearer assistant-token', 'content-type': 'application/json' },
  body: JSON.stringify({ note: 'First task finished; keep the connection for follow-up.' }),
});
assert.equal(completed.status, 200);
assert.equal(store.getExecutor(s.id).stop, 0, 'completion is not a stop request');
assert.equal(store.getSession(s.slug).auto_enabled, 1);
const followup = store.addEntry(s.id, 'claude', 'command', 'Get-Date', 'powershell');
assert.equal((await poll()).seq, followup.seq, 'same executor token accepts follow-up work after completion');
store.markCommandDone(s.id, followup.seq);

// Validate the actual generated script with the Windows PowerShell 5.1 parser.
const agentResponse = await app.request(`/x/${s.slug}/agent.ps1`, { headers: { cookie } });
assert.equal(agentResponse.status, 200);
const agent = await agentResponse.text();
assert.match(agent, /function Show-Approval/);
assert.match(agent, /approvals=1/);
assert.match(agent, /ConsoleKey\]::Enter -and \$global:approvalSelection/);
const agentFile = join(dir, 'agent.ps1');
writeFileSync(agentFile, '\uFEFF' + agent, 'utf8');
if (process.platform === 'win32') {
  const parser = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$t=$null; $e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${agentFile.replaceAll("'", "''")}',[ref]$t,[ref]$e) | Out-Null; if($e.Count){$e | Format-List; exit 1}`], { encoding: 'utf8' });
  assert.equal(parser.status, 0, parser.stdout + parser.stderr);
}
console.log('Approval regression checks passed (auth, races, denial replies, legacy clients, queue, stop, generated agent).');

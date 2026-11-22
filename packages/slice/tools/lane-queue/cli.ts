/**
 * The GitHub half of `buildQueue`.
 *
 * ```
 * npm run queue           # the whole board: what to take, what needs her, what nobody here can move
 * npm run queue -- next   # one line: the issue to take, or the reason there is none
 * ```
 *
 * It reads and never writes. Claiming is assigning yourself the issue, and it
 * stays a separate step on purpose: a queue that claimed what it printed would
 * take an issue every time somebody looked at the board.
 *
 * Every open issue in the repository `origin` names, read through `gh api
 * graphql` so parents and open "blocked by" edges come with them. An issue's
 * priority is its `p0`..`p4` label, `status:in-progress` is in flight, and
 * `type:epic` is a container.
 */
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { LANE_LABEL, SERIAL_LABEL, buildQueue, nextUp, type Queue, type QueueIssue } from './queue';

const NodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  parent: z.object({ number: z.number() }).nullish(),
  blockedBy: z.object({ nodes: z.array(z.object({ number: z.number(), state: z.string() })) }),
});

const QUERY = `query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body
        labels(first: 50) { nodes { name } }
        parent { number }
        blockedBy(first: 50) { nodes { number state } }
      }
    }
  }
}`;

/** `owner/repo` from `origin`, which is where this checkout's issues live. */
function originRepo(): { readonly owner: string; readonly name: string } {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`origin is not a GitHub repository, so there are no issues to queue: ${url}`);
  }
  return { owner: match[1], name: match[2] };
}

const ref = (n: number): string => `#${String(n)}`;

/** Every open issue, and the open issues blocking each one. */
function readIssues(): { readonly issues: QueueIssue[]; readonly blockedBy: Map<string, string[]> } {
  const { owner, name } = originRepo();
  const out = execFileSync(
    'gh',
    [
      'api',
      'graphql',
      '--paginate',
      '-f',
      `query=${QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '--jq',
      '.data.repository.issues.nodes[]',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const issues: QueueIssue[] = [];
  const blockedBy = new Map<string, string[]>();
  for (const row of out.split('\n').filter((text) => text.trim() !== '')) {
    const parsed = NodeSchema.safeParse(JSON.parse(row));
    if (!parsed.success) {
      throw new Error(`gh did not answer with issues: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`);
    }
    const node = parsed.data;
    const labels = node.labels.nodes.map((label) => label.name);
    const priority = labels.map((label) => /^p([0-4])$/.exec(label)?.[1]).find((p) => p !== undefined);
    const id = ref(node.number);
    issues.push({
      id,
      title: node.title,
      // An issue with no priority label sorts after every one that has one.
      priority: priority === undefined ? 9 : Number(priority),
      status: labels.includes('status:in-progress') ? 'in_progress' : 'open',
      issueType: labels.includes('type:epic') ? 'epic' : 'issue',
      labels,
      parent: node.parent === null || node.parent === undefined ? null : ref(node.parent.number),
      body: node.body ?? '',
    });
    blockedBy.set(
      id,
      node.blockedBy.nodes
        .filter((blocker) => blocker.state === 'OPEN')
        .map((blocker) => ref(blocker.number)),
    );
  }
  return { issues, blockedBy };
}

/**
 * Whether `branch` is already an ancestor of `origin/main` -- the one-command check
 * `mtg-r7y1` names, and the one this queue was silently skipping.
 *
 * Reads only refs already fetched into this checkout; no network, no provider.
 */
function isLandedBranch(branch: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', branch, 'origin/main'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function line(issue: QueueIssue, note = ''): string {
  const serial = issue.labels.includes(SERIAL_LABEL) ? '[pixels]' : '';
  return `  P${issue.priority} ${issue.id.padEnd(16)}${serial.padEnd(10)}${issue.title.slice(0, 72)}${note}`;
}

function report(queue: Queue): void {
  if (queue.conflicted.length > 0) {
    console.log(
      `\nREFUSED — two admission labels, so the triage has to say which (${queue.conflicted.length})`,
    );
    for (const issue of queue.conflicted) console.log(line(issue));
  }
  if (queue.untriaged.length > 0) {
    console.log(`\nUNTRIAGED — in the lane, admitted by nobody (${queue.untriaged.length})`);
    for (const issue of queue.untriaged) console.log(line(issue));
  }
  if (queue.offLane.length > 0) {
    console.log(
      `\nMEASURING FROM OUTSIDE THE LANE — carries serial/pixels without the ${LANE_LABEL} label (${queue.offLane.length})`,
    );
    for (const issue of queue.offLane) console.log(line(issue));
  }
  if (queue.inFlight.length > 0) {
    console.log(`\nIN FLIGHT (${queue.inFlight.length})`);
    for (const issue of queue.inFlight) console.log(line(issue));
  }

  console.log(`\nREADY — takeable without asking (${queue.ready.length})`);
  for (const entry of queue.ready) {
    console.log(line(entry.issue, entry.held === null ? '' : `\n      held: ${entry.held}`));
  }

  console.log(
    `\nNEEDS THE PLAYTESTER — the decision sheet, each issue names its own choice (${queue.decisions.length})`,
  );
  for (const issue of queue.decisions) console.log(line(issue));

  console.log(`\nBLOCKED ON A DEVICE, THIS ENVIRONMENT, OR ANOTHER LANE (${queue.blocked.length})`);
  for (const issue of queue.blocked) console.log(line(issue));

  if (queue.staleLaneBlocks.length > 0) {
    console.log(
      `\nSTALE BLOCK — the named branch has landed on origin/main, re-triage (${queue.staleLaneBlocks.length})`,
    );
    for (const issue of queue.staleLaneBlocks) console.log(line(issue));
  }
  if (queue.unresolvedLaneBlocks.length > 0) {
    console.log(
      `\nUNRESOLVED LANE BLOCK — names no branch this queue can check (${queue.unresolvedLaneBlocks.length})`,
    );
    for (const issue of queue.unresolvedLaneBlocks) console.log(line(issue));
  }

  const next = nextUp(queue);
  console.log(
    `\nNEXT: ${next === null ? 'nothing takeable — every ready issue is held, so the queue is the decision sheet' : `${next.issue.id} ${next.issue.title}`}`,
  );
}

function main(): void {
  const { issues, blockedBy } = readIssues();
  const queue = buildQueue(issues, blockedBy, isLandedBranch);
  if (process.argv[2] === 'next') {
    const next = nextUp(queue);
    if (next === null) {
      console.log(
        `no ${LANE_LABEL} issue is takeable: ${String(queue.decisions.length)} wait on the playtester, ${String(queue.untriaged.length)} are untriaged`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${next.issue.id} P${String(next.issue.priority)} ${next.issue.title}`);
    return;
  }
  report(queue);
}

main();

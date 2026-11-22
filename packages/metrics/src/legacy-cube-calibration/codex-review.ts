/** Offline OAuth judgments only; any tool-bearing transcript is inadmissible evidence. */
import { mkdir, mkdtemp, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { runCodexProcess } from './codex-process';
import type { QualityReviewer } from './quality-run';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const configSchema = z
  .object({
    binary: z.string().refine(isAbsolute),
    model: z.string().min(1).max(200),
    archive: z.string().min(1),
    runtimeSha256: sha,
  })
  .strict();
const itemSchema = z.object({ type: z.enum(['reasoning', 'agent_message']), text: z.string().optional() });
const eventSchema = z.object({
  type: z.string(),
  thread_id: z.string().min(1).max(200).optional(),
  item: z.unknown().optional(),
});

export function readCodexReviewEvents(stdout: string): { runId: string; response: unknown } {
  let phase: 'thread' | 'start' | 'items' | 'done' = 'thread';
  let runId = '';
  let answer: { response: unknown } | null = null;
  for (const line of stdout.split('\n').filter((row) => row.trim().length > 0)) {
    const event = eventSchema.parse(JSON.parse(line));
    if (phase === 'thread' && event.type === 'thread.started' && event.thread_id) {
      runId = event.thread_id;
      phase = 'start';
    } else if (phase === 'start' && event.type === 'turn.started') phase = 'items';
    else if (phase === 'items' && ['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const parsed = itemSchema.safeParse(event.item);
      if (!parsed.success) throw new Error('Unsupported item or tool activity in Codex review');
      if (answer !== null) throw new Error('Unexpected activity after final answer');
      if (parsed.data.type === 'agent_message' && event.type === 'item.completed') {
        if (parsed.data.text === undefined) throw new Error('Missing Codex answer text');
        answer = { response: JSON.parse(parsed.data.text) as unknown };
      }
    } else if (phase === 'items' && event.type === 'turn.completed' && answer !== null) phase = 'done';
    else throw new Error(`Unsupported Codex review event or order: ${event.type}`);
  }
  if (phase !== 'done' || answer === null) throw new Error('Incomplete Codex review');
  return { runId, response: answer.response };
}

const DISABLED = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'hooks',
  'multi_agent',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'in_app_local_automation',
  'skill_search',
  'tool_suggest',
  'skill_mcp_dependency_install',
  'sleep_tool',
  'view_image',
  'memories',
];
function environment(): NodeJS.ProcessEnv {
  const keys = [
    'HOME',
    'PATH',
    'CODEX_HOME',
    'TMPDIR',
    'LANG',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  return Object.fromEntries(
    keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );
}

export function createCodexQualityReviewer(input: unknown): QualityReviewer {
  const config = configSchema.parse(input);
  const archive = resolve(config.archive);
  return {
    model: config.model,
    async review(task) {
      const taskSha256 = sha.parse(task.taskSha256);
      const prompt = task.prompt;
      const schema = JSON.stringify(task.schema);
      const root = join(archive, taskSha256);
      await mkdir(archive, { recursive: true, mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const cwd = await mkdtemp(join(tmpdir(), 'mtg-codex-review-'));
      const env = environment();
      const save = (name: string, value: string) =>
        writeFile(join(root, name), value, { flag: 'wx', mode: 0o600 });
      const execute = async (name: string, args: string[], input = '') => {
        const result = await runCodexProcess({
          binary: config.binary,
          args,
          cwd,
          env,
          input,
          timeoutMs: name === 'review' ? 600000 : 30000,
          outputLimit: 32 * 1024 * 1024,
        });
        await save(`${name}.stdout.txt`, result.stdout);
        await save(`${name}.stderr.txt`, result.stderr);
        await save(`${name}.result.json`, JSON.stringify(result));
        if (result.error !== null || result.exitCode !== 0 || result.signal !== null)
          throw new Error(`Codex ${name} failed: ${result.error ?? result.signal ?? result.exitCode}`);
        return result;
      };
      try {
        await save('schema.json', schema);
        await save('prompt.txt', prompt);
        const version = await execute('version', ['--version']);
        const status = await execute('login', ['login', 'status']);
        if (`${status.stdout}${status.stderr}`.trim() !== 'Logged in using ChatGPT')
          throw new Error('Codex review requires ChatGPT OAuth authentication');
        const result = await execute(
          'review',
          [
            '--ask-for-approval',
            'never',
            'exec',
            '--ignore-user-config',
            '--ignore-rules',
            '--ephemeral',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            '--model',
            config.model,
            '--config',
            'forced_login_method="chatgpt"',
            '--config',
            'web_search="disabled"',
            '--config',
            'project_doc_max_bytes=0',
            '--config',
            'suppress_unstable_features_warning=true',
            ...DISABLED.flatMap((name) => ['--disable', name]),
            '--enable',
            'skip_host_skill_discovery',
            '--output-schema',
            join(root, 'schema.json'),
            '--json',
            '-',
          ],
          `Return only the requested JSON judgment. Do not use tools or external context.\n\n${prompt}`,
        );
        const parsed = readCodexReviewEvents(result.stdout);
        return {
          response: parsed.response,
          provenance: {
            provider: 'codex-cli',
            authentication: 'chatgpt-oauth',
            cliVersion: version.stdout.trim(),
            requestedModel: config.model,
            resolvedModel: null,
            runId: parsed.runId,
            completedAt: new Date().toISOString(),
            generatorRuntimeSha256: config.runtimeSha256,
          },
        };
      } finally {
        await rmdir(cwd);
      }
    },
  };
}

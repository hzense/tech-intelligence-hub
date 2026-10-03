import type { Sandbox } from '@vercel/sandbox';

// A detached Command's metadata can still have exitCode=null after the process
// exits. wait() retrieves the actual terminal result without starting a command.
// Bound each observation so a Workflow step never waits for a whole AI call.
export async function observeSandboxCommandExit(
  sandbox: Pick<Sandbox, 'getCommand'>,
  commandId: string,
  signal: AbortSignal,
): Promise<number | null> {
  const command = await sandbox.getCommand(commandId, { signal });
  const observation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      command
        .wait({ signal: AbortSignal.any([signal, observation.signal]) })
        .then((finished) => finished.exitCode),
      new Promise<null>((resolve, reject) => {
        timer = setTimeout(() => {
          // The SDK can wrap abort errors while reading the response body.
          // Resolve our deadline explicitly, then cancel only the observation.
          // Outer cancellation and transport failures must remain errors.
          if (signal.aborted) reject(signal.reason);
          else resolve(null);
          observation.abort();
        }, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

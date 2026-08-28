import { execFile } from 'child_process';

export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    timeout?: number;
    maxBuffer?: number;
    posixLocale?: boolean;
    acceptExitCodes?: number[];
  } = {},
): Promise<string> {
  const timeout = options.timeout ?? 20_000;
  const maxBuffer = options.maxBuffer ?? 12 * 1024 * 1024;
  const acceptExitCodes = options.acceptExitCodes ?? [0, 1];

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout,
        maxBuffer,
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          ...(options.posixLocale === false
            ? {}
            : { LC_ALL: 'C', LANG: 'C' }),
        },
      },
      (error, stdout, stderr) => {
        const out = stdout ?? '';
        if (!error) {
          resolve(out);
          return;
        }

        const execError = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        const exitCode = typeof execError.code === 'number' ? execError.code : null;

        // lsof / ss / netstat often exit 1 when there are no matching sockets.
        if (exitCode !== null && acceptExitCodes.includes(exitCode)) {
          resolve(out);
          return;
        }

        reject(
          new CommandError(
            execError.killed
              ? `Timed out running ${command}`
              : execError.message,
            command,
            exitCode,
            out,
            stderr ?? '',
          ),
        );
      },
    );
  });
}

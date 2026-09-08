const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

/**
 * Prints an animated spinner next to `message` until the returned function is
 * called. Falls back to a single static line when stdout isn't a TTY (e.g.
 * piped output), so nothing relies on carriage-return redraws there.
 */
export function startSpinner(message: string): () => void {
  if (!process.stdout.isTTY) {
    console.log(message);
    return () => {};
  }

  let frame = 0;
  process.stdout.write(`${FRAMES[frame]} ${message}`);
  const interval = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    process.stdout.write(`\r${FRAMES[frame]} ${message}`);
  }, INTERVAL_MS);

  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${" ".repeat(message.length + 2)}\r`);
  };
}

export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const stop = startSpinner(message);
  try {
    return await task();
  } finally {
    stop();
  }
}

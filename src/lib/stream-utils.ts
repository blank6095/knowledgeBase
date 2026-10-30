/** 读取一个流 chunk；超时则取消 reader 并抛错，长流的每次成功 chunk 会重新计时。 */
export async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`流式响应静默超过 ${Math.round(timeoutMs / 1_000)} 秒，已中断`));
          void reader.cancel().catch(() => {});
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

export function sseResponse(start, { heartbeatMs = 0 } = {}) {
  let cleanup = () => {};
  let heartbeat;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const write = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const client = {
        send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        comment: (text) => write(`: ${text}\n\n`),
        get closed() {
          return closed;
        },
        close: () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
          }
        },
      };

      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => client.comment(`ping ${Date.now()}`), heartbeatMs);
        heartbeat.unref?.();
      }

      try {
        const result = await start(client);
        if (typeof result === 'function') cleanup = result;
        else client.close();
      } catch (err) {
        client.send('error', { message: err?.message ?? 'stream failed' });
        client.close();
      }
    },

    cancel() {
      clearInterval(heartbeat);
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export function sseJob(job) {
  return sseResponse(async (client) => {
    try {
      const result = await job((line) => client.send('line', line));
      client.send('done', { ok: result?.ok ?? true, ...result });
    } catch (err) {
      client.send('line', { stream: 'err', line: err.message });
      client.send('done', { ok: false, error: err.message });
    }
  });
}

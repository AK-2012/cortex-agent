// input:  stdin command objects, stdout chunks
// output: encodeCommand + createLineSplitter
// pos:    LF-only NDJSON encode/decode for PI RPC
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export function encodeCommand(cmd: unknown): string {
  // JSON.stringify escapes embedded \n / \r inside string values, so a single trailing LF is the only record delimiter per rpc.md §Framing.
  return JSON.stringify(cmd) + '\n';
}

export interface LineSplitter {
  push(chunk: string | Buffer): string[];
  flushRemainder(): string | null;
}

export function createLineSplitter(): LineSplitter {
  let buffer = '';
  return {
    push(chunk: string | Buffer): string[] {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines: string[] = [];
      while (true) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lines.push(line);
      }
      return lines;
    },
    flushRemainder(): string | null {
      if (buffer.length === 0) return null;
      const remainder = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      buffer = '';
      return remainder;
    },
  };
}

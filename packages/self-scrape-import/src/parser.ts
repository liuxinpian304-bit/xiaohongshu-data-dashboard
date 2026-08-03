import { createHash } from 'node:crypto';

import { normalizeSelfScrapeRecord, SelfScrapeValidationError, type NormalizedSelfScrapeRecord } from './schema';

export interface JsonlLimits { maxLineBytes: number; maxFileBytes: number; maxLines: number }
export interface ParseSuccess { lineNumber: number; ok: true; record: NormalizedSelfScrapeRecord }
export interface ParseFailure { lineNumber: number; ok: false; error: { code: 'invalid_json' | 'invalid_record'; message: string } }
export type ParseEntry = ParseSuccess | ParseFailure;
export interface DryRunSummary {
  sha256: string;
  totalBytes: number;
  totalLines: number;
  validLines: number;
  invalidLines: number;
  availability: { available: number; zero: number; not_provided: number };
}

export class SelfScrapeParseError extends Error {
  constructor(public readonly code: 'line_too_large' | 'file_too_large' | 'too_many_lines' | 'parse_cancelled' | 'parse_not_started', message: string) {
    super(message);
    this.name = 'SelfScrapeParseError';
  }
}

const DEFAULT_LIMITS: JsonlLimits = { maxLineBytes: 256 * 1024, maxFileBytes: 100 * 1024 * 1024, maxLines: 1_000_000 };

export function parseSelfScrapeJsonl(stream: AsyncIterable<Uint8Array | string>, supplied: Partial<JsonlLimits> = {}) {
  const limits = validateLimits({ ...DEFAULT_LIMITS, ...supplied });
  let resolveSummary!: (summary: DryRunSummary) => void;
  let rejectSummary!: (error: unknown) => void;
  const summary = new Promise<DryRunSummary>((resolve, reject) => { resolveSummary = resolve; rejectSummary = reject; });
  void summary.catch(() => undefined);
  let started = false;

  async function* entries(): AsyncGenerator<ParseEntry> {
    if (started) throw new Error('JSONL parser entries can only be consumed once');
    started = true;
    const hash = createHash('sha256');
    let lineParts: Buffer[] = [];
    let lineBytes = 0;
    let totalBytes = 0; let totalLines = 0; let validLines = 0; let invalidLines = 0;
    let summarySettled = false;
    const availability = { available: 0, zero: 0, not_provided: 0 };

    const parseLine = (raw: Buffer): ParseEntry => {
      totalLines += 1;
      if (totalLines > limits.maxLines) throw new SelfScrapeParseError('too_many_lines', 'JSONL line count exceeds the configured limit');
      const lineNumber = totalLines;
      const bytes = raw.at(-1) === 13 ? raw.subarray(0, -1) : raw;
      let input: unknown;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        input = JSON.parse(text);
      }
      catch {
        invalidLines += 1;
        const validUtf8 = (() => {
          try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; }
          catch { return false; }
        })();
        return { lineNumber, ok: false, error: { code: 'invalid_json', message: validUtf8 ? 'line is not valid JSON' : 'line is not valid UTF-8 JSON' } };
      }
      try {
        const record = normalizeSelfScrapeRecord(input);
        validLines += 1;
        for (const metric of record.metrics) availability[metric.availability] += 1;
        return { lineNumber, ok: true, record };
      } catch (error) {
        invalidLines += 1;
        const message = error instanceof SelfScrapeValidationError ? error.message : 'line failed contract validation';
        return { lineNumber, ok: false, error: { code: 'invalid_record', message } };
      }
    };

    const appendLinePart = (part: Buffer) => {
      if (lineBytes + part.byteLength > limits.maxLineBytes) {
        throw new SelfScrapeParseError('line_too_large', 'JSONL line exceeds the configured byte limit');
      }
      if (part.byteLength > 0) lineParts.push(part);
      lineBytes += part.byteLength;
    };

    const takeLine = () => {
      const line = lineParts.length === 1 ? lineParts[0]! : Buffer.concat(lineParts, lineBytes);
      lineParts = [];
      lineBytes = 0;
      return line;
    };

    try {
      for await (const chunk of stream) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes > limits.maxFileBytes) throw new SelfScrapeParseError('file_too_large', 'JSONL file exceeds the configured byte limit');
        hash.update(bytes);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const newline = bytes.indexOf(10, offset);
          if (newline === -1) {
            appendLinePart(bytes.subarray(offset));
            break;
          }
          appendLinePart(bytes.subarray(offset, newline));
          yield parseLine(takeLine());
          offset = newline + 1;
        }
      }
      if (lineBytes > 0) yield parseLine(takeLine());
      const result = { sha256: hash.digest('hex'), totalBytes, totalLines, validLines, invalidLines, availability };
      summarySettled = true;
      resolveSummary(result);
    } catch (error) {
      summarySettled = true;
      rejectSummary(error);
      throw error;
    } finally {
      if (!summarySettled) {
        rejectSummary(new SelfScrapeParseError('parse_cancelled', 'JSONL parsing was cancelled before completion'));
      }
    }
  }

  return {
    entries: entries(),
    get summary() {
      if (!started) {
        return Promise.reject(new SelfScrapeParseError('parse_not_started', 'consume entries before awaiting the JSONL summary'));
      }
      return summary;
    },
  };
}

function validateLimits(limits: JsonlLimits) {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${key} must be a positive safe integer`);
  }
  return limits;
}

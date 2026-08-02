import { BadRequestException } from '@nestjs/common';

export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid request body');
  return input as Record<string, unknown>;
}
export function stringField(input: Record<string, unknown>, key: string, options: { optional?: boolean; max?: number } = {}) {
  const value = input[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > (options.max ?? 500)) throw new BadRequestException(`invalid ${key}`);
  return value;
}
export function uuid(value: unknown, key = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`invalid ${key}`);
  return value;
}
export function booleanField(input: Record<string, unknown>, key: string, fallback: boolean) {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new BadRequestException(`invalid ${key}`);
  return value;
}

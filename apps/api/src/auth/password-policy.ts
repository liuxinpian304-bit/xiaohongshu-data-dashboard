export function validateAdminPasswordHash(hash: string | undefined): asserts hash is string {
  if (!hash?.startsWith('$argon2id$')) throw new Error('ADMIN_PASSWORD_HASH must be an Argon2id PHC string');
  const parameters = hash.split('$')[3];
  const values = Object.fromEntries(parameters.split(',').map((entry) => entry.split('=')));
  const m = Number(values.m); const t = Number(values.t); const p = Number(values.p);
  if (![m, t, p].every((value) => Number.isFinite(value) && Number.isInteger(value) && value > 0) || m < 65_536 || t < 3 || p < 1) throw new Error('ADMIN_PASSWORD_HASH Argon2id parameters are invalid or below minimum');
}

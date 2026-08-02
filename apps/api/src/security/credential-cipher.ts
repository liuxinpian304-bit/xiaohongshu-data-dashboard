import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CredentialCipher {
  private readonly key: Buffer;
  constructor(encodedKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '') {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  encrypt(plaintext: string, accountId: string, credentialId: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(`${accountId}:${credentialId}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }
  decrypt(payload: string, accountId: string, credentialId: string) {
    const fields = payload.split('.');
    if (fields.length !== 4) throw new Error('invalid encrypted credential');
    const [version, ivText, tagText, ciphertextText] = fields;
    const iv = Buffer.from(ivText, 'base64url'); const tag = Buffer.from(tagText, 'base64url'); const ciphertext = Buffer.from(ciphertextText, 'base64url');
    if (version !== 'v1' || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('invalid encrypted credential');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
      decipher.setAAD(Buffer.from(`${accountId}:${credentialId}`, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { throw new Error('invalid encrypted credential'); }
  }
}

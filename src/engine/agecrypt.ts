// age encryption (age-encryption.org) with typage (BSD-3-Clause): a passphrase (scrypt) or one or
// more X25519 public keys. Identities are AGE-SECRET-KEY-1... strings.
import { Encrypter, Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';

export async function ageEncrypt(data: Uint8Array, o: { passphrase?: string; recipients?: string[] }): Promise<Uint8Array> {
  const e = new Encrypter();
  if (o.recipients?.length) for (const r of o.recipients) e.addRecipient(r.trim());
  else if (o.passphrase) e.setPassphrase(o.passphrase);
  else throw new Error('age needs a passphrase or a public key');
  return e.encrypt(data);
}

export async function ageDecrypt(data: Uint8Array, o: { passphrase?: string; identities?: string[] }): Promise<Uint8Array> {
  const d = new Decrypter();
  if (o.passphrase) d.addPassphrase(o.passphrase);
  for (const id of o.identities ?? []) for (const line of id.split(/\r?\n/)) if (line.startsWith('AGE-SECRET-KEY-')) d.addIdentity(line.trim());
  try { return await d.decrypt(data); } catch (e) { throw new Error(/no identity|passphrase|incorrect|decrypt/i.test(String(e)) ? 'WRONG_PASSWORD' : String((e as Error).message || e)); }
}

/** A new key pair: the secret identity (keep it) and its public recipient (share it) */
export async function ageKeygen(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/** age's header starts with this line, or "-----BEGIN AGE" when armored */
export const looksLikeAge = (head: Uint8Array) => new TextDecoder().decode(head.slice(0, 32)).startsWith('age-encryption.org/v1') || new TextDecoder().decode(head.slice(0, 32)).startsWith('-----BEGIN AGE');

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("loads Firebase Auth and signs/verifies display tokens without require(ESM) support", async () => {
  // Vercel disables require(ESM). A plain Node subprocess avoids Vitest's
  // module interop, which hid the production startup failure.
  const script = `
    const assert = require('node:assert/strict');
    const { generateKeyPairSync, verify } = require('node:crypto');
    const { cert, initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const jwksClient = require('jwks-rsa');
    (async () => {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const email = 'test@seat-runtime-test.iam.gserviceaccount.com';
      const app = initializeApp({ credential: cert({
        projectId: 'seat-runtime-test', clientEmail: email,
        privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }) });
      const claims = { seatStatusDisplay: true, seatStatusExpiresAt: Date.now() + 60_000 };
      const token = await getAuth(app).createCustomToken('runtime-test-display', claims);
      const [header, payload, signature] = token.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(decoded.uid, 'runtime-test-display');
      assert.equal(decoded.iss, email);
      assert.deepEqual(decoded.claims, claims);
      assert.equal(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')), true);
      // Exercise the overridden jose API through jwks-rsa, without a network call.
      const client = jwksClient({
        jwksUri: 'https://unused.invalid/keys', cache: false,
        getKeysInterceptor: async () => [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }],
      });
      const key = await client.getSigningKey('test-key');
      assert.equal(verify('RSA-SHA256', Buffer.from(header + '.' + payload), key.getPublicKey(), Buffer.from(signature, 'base64url')), true);
      await deleteApp(app);
      console.log('runtime-auth-ok');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--no-experimental-require-module", "-e", script], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test" }, timeout: 15_000,
    });
  expect(stdout.trim()).toBe("runtime-auth-ok");
});

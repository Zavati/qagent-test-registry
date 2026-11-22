import { TestRegistryError } from '../domain/errors.js';

// Same wire protocol as Gateway/Generation Orchestrator. Only the additive UI routes
// use it; existing API Registry authentication is deliberately unchanged.
export const TEST_GENERATION_INTERNAL_AUTH_VERSION = 'qagent.project-test-generation.internal.v1';
const encoder = new TextEncoder();
const hex = buffer => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');

function reject(code, status, message) {
  throw new TestRegistryError(message, { code, status });
}
function canonicalQuery(params) {
  return [...params.entries()]
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}
export async function createTestGenerationInternalSignature({ secret, method, url, organizationId, projectId = '', timestamp, rawBody = '' }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    reject('UI_TEST_REGISTRY_AUTH_NOT_CONFIGURED', 503, 'UI Registry internal HMAC is not configured.');
  }
  const parsed = new URL(url);
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(rawBody)));
  const payload = [TEST_GENERATION_INTERNAL_AUTH_VERSION, method.toUpperCase(), parsed.pathname,
    canonicalQuery(parsed.searchParams), organizationId.trim(), projectId.trim(), String(timestamp).trim(), bodyHash].join('\n');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}
export async function verifyTestGenerationInternalRequest(request, env, { rawBody = '', now = Date.now() } = {}) {
  const organizationId = String(request.headers.get('X-QAgent-Organization-Id') || '').trim();
  const projectId = String(request.headers.get('X-QAgent-Project-Id') || '').trim();
  const timestamp = String(request.headers.get('X-QAgent-Test-Generation-Timestamp') || '').trim();
  const signature = String(request.headers.get('X-QAgent-Test-Generation-Signature') || '').trim().toLowerCase();
  const configuredSkew = Number(env.TEST_GENERATION_INTERNAL_MAX_SKEW_SECONDS ?? 60);
  const skew = Number.isSafeInteger(configuredSkew) ? Math.max(15, Math.min(300, configuredSkew)) : 60;
  if (!organizationId || !projectId || !/^\d{10,12}$/.test(timestamp)
    || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > skew || !/^[a-f0-9]{64}$/.test(signature)) {
    reject('UI_TEST_REGISTRY_UNAUTHORIZED', 401, 'UI Registry request is unauthorized.');
  }
  const expected = await createTestGenerationInternalSignature({ secret: env.TEST_GENERATION_INTERNAL_HMAC_SECRET,
    method: request.method, url: request.url, organizationId, projectId, timestamp, rawBody });
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  if (mismatch) reject('UI_TEST_REGISTRY_UNAUTHORIZED', 401, 'UI Registry request is unauthorized.');
  return { organizationId, projectId };
}

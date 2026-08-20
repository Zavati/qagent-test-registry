const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function buildStableTestDesignId({ organizationId, projectId, endpointId }) {
  const canonicalIdentity = JSON.stringify([organizationId, projectId, endpointId]);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalIdentity));
  return `td_${bytesToHex(new Uint8Array(digest))}`;
}

export function createTestDesignVersionId() {
  return `tdv_${crypto.randomUUID()}`;
}

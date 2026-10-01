import type { BrowserSigningSnapshot } from "../db/browser-signing-originals";
import { canonicalJson } from "../canonical-json";
import {
  OBSERVATION_AUDIENCE,
  OBSERVATION_PATH,
  OBSERVATION_CLOCK_PATH,
  OBSERVATION_WINDOW_MS,
  OBSERVATION_RESPONSE_LIMIT,
  ObservationElapsedGuard,
  observationUtcNow,
  recoverObservationProof,
  assertObservationRequestCurrent,
  observationRequestDigest,
  projectOriginalObservation,
  observationResponseSchema,
  observationClockSchema,
} from "./browser-original-observation-protocol";

export interface OriginalObservationReader {
  readExposedBrowserSigningSnapshotForSigner(
    signer: string,
    sessionId: string,
    requestId: string
  ): Promise<BrowserSigningSnapshot | null>;
}
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
const refused = () =>
  new Response('{"error":"original_observation_unavailable"}', {
    status: 503,
    headers,
  });
function json(value: unknown): Response {
  const text = canonicalJson(value);
  if (new TextEncoder().encode(text).byteLength > OBSERVATION_RESPONSE_LIMIT)
    return refused();
  return new Response(text, { status: 200, headers });
}
function localOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.origin !== value
  )
    throw new Error("Synthetic observation origin refused");
  return value;
}
/** Trusted installed backend composition only; this exports no Next route, origin credential or activation. */
export function createOriginalObservationServer(
  backend: OriginalObservationReader
) {
  return create(backend, OBSERVATION_AUDIENCE, OBSERVATION_WINDOW_MS);
}
export function createSyntheticOriginalObservationServer(
  backend: OriginalObservationReader,
  origin: string,
  totalMs = OBSERVATION_WINDOW_MS
) {
  return create(backend, localOrigin(origin), totalMs);
}
function create(
  backend: OriginalObservationReader,
  origin: string,
  totalMs: number
) {
  // A completed caller timeout does not release the slot of an abandoned underlying read.
  const read = backend.readExposedBrowserSigningSnapshotForSigner.bind(backend),
    starts: number[] = [];
  let outstanding = 0;
  return async function observe(request: Request): Promise<Response> {
    const life = new ObservationElapsedGuard(totalMs);
    try {
      const url = new URL(request.url),
        proof = request.headers.get("X-Keryx-Observation-Proof");
      if (
        request.method !== "GET" ||
        url.origin !== origin ||
        request.body !== null ||
        request.headers.has("Transfer-Encoding") ||
        Number(request.headers.get("Content-Length") ?? 0) !== 0
      )
        return refused();
      life.live();
      const current = performance.now();
      while (starts.length && current - starts[0] >= 1000) starts.shift();
      if (starts.length >= 8) return refused();
      starts.push(current);
      if (url.pathname === OBSERVATION_CLOCK_PATH) {
        const values = url.searchParams.getAll("challenge");
        if (
          proof !== null ||
          Array.from(url.searchParams.keys()).length !== 1 ||
          values.length !== 1
        )
          return refused();
        const serverTimeMs = observationUtcNow();
        const clock = observationClockSchema.parse({
          version: "1",
          challenge: values[0],
          serverTimeMs,
          expiresAtMs: serverTimeMs + OBSERVATION_WINDOW_MS,
        });
        life.live();
        return json(clock);
      }
      if (
        url.pathname !== OBSERVATION_PATH ||
        url.search !== "" ||
        outstanding >= 8
      )
        return refused();
      outstanding++;
      const work = (async () => {
        try {
          const auth = await recoverObservationProof(proof);
          life.live();
          const startedAtMs = observationUtcNow();
          const snapshot = await read(
            auth.signer,
            auth.request.sessionId,
            auth.request.requestId
          );
          const finishedAtMs = observationUtcNow();
          life.live();
          assertObservationRequestCurrent(auth.request);
          if (
            !snapshot ||
            snapshot.journal.sessionId !== auth.request.sessionId ||
            snapshot.journal.requestId !== auth.request.requestId ||
            snapshot.journal.signer.toLowerCase() !== auth.signer ||
            snapshot.namespace.signer !== auth.signer ||
            snapshot.original.authorization.from !== auth.signer
          )
            return refused();
          // The projector refuses prepared/cancelled before copying nonce or owner proofs to a response.
          const state = projectOriginalObservation(snapshot);
          const response = observationResponseSchema.parse({
            version: "1",
            readOnly: true,
            challenge: auth.request.challenge,
            requestDigest: observationRequestDigest(auth.request),
            readInterval: { startedAtMs, finishedAtMs },
            state,
          });
          life.live();
          assertObservationRequestCurrent(auth.request);
          return json(response);
        } catch {
          return refused();
        } finally {
          outstanding--;
        }
      })();
      return await Promise.race([
        work,
        new Promise<Response>((resolve) => {
          if (life.abort.signal.aborted) resolve(refused());
          else
            life.abort.signal.addEventListener(
              "abort",
              () => resolve(refused()),
              { once: true }
            );
        }),
      ]);
    } catch {
      return refused();
    } finally {
      life.close();
    }
  };
}

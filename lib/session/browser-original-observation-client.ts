import type { PrivateKeyAccount } from "viem/accounts";
import {
  OBSERVATION_AUDIENCE,
  OBSERVATION_PATH,
  OBSERVATION_CLOCK_PATH,
  OBSERVATION_RESPONSE_LIMIT,
  OBSERVATION_WINDOW_MS,
  ObservationElapsedGuard,
  observationLocatorSchema,
  observationClockSchema,
  observationTypedData,
  serializeObservationProof,
  validateOriginalObservation,
  type ObservationRequest,
  type OriginalObservation,
  refuseObservation,
} from "../payments/browser-original-observation-protocol";

const nativeFetch = globalThis.fetch.bind(globalThis);
async function readJson(
  response: Response,
  limit: number,
  life: ObservationElapsedGuard
): Promise<unknown> {
  life.live();
  if (
    response.status !== 200 ||
    response.redirected ||
    !/^application\/json(?:;|$)/i.test(
      response.headers.get("Content-Type") ?? ""
    )
  )
    refuseObservation();
  const length = response.headers.get("Content-Length");
  if (
    length !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)
  )
    refuseObservation();
  const reader = response.body?.getReader();
  if (!reader) return refuseObservation();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      life.live();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) refuseObservation();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  life.live();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
}
/** The concrete account must already belong to trusted worker-local custody. Its TypeScript type does not prove isolation. */
export function createOriginalObservationClient(account: PrivateKeyAccount) {
  return create(account, OBSERVATION_AUDIENCE, OBSERVATION_WINDOW_MS);
}
export function createSyntheticOriginalObservationClient(
  account: PrivateKeyAccount,
  origin: string,
  totalMs = OBSERVATION_WINDOW_MS
) {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.origin !== origin
  )
    refuseObservation();
  return create(account, origin, totalMs);
}
function create(account: PrivateKeyAccount, origin: string, totalMs: number) {
  const sign = account.signTypedData.bind(account),
    signer = account.address.toLowerCase();
  let running = false;
  return Object.freeze({
    async observe(value: {
      sessionId: string;
      requestId: string;
    }): Promise<OriginalObservation | null> {
      const life = new ObservationElapsedGuard(totalMs);
      if (running) {
        life.close();
        return null;
      }
      running = true;
      const work = (async (): Promise<OriginalObservation | null> => {
        try {
          const locator = observationLocatorSchema.parse(value);
          life.live();
          const random = crypto.getRandomValues(new Uint8Array(32)),
            challenge =
              "0x" +
              Array.from(random, (b) => b.toString(16).padStart(2, "0")).join(
                ""
              );
          const options = {
            credentials: "omit" as const,
            redirect: "error" as const,
            referrerPolicy: "no-referrer" as const,
            cache: "no-store" as const,
            signal: life.abort.signal,
          };
          const clock = observationClockSchema.parse(
            await readJson(
              await nativeFetch(
                origin + OBSERVATION_CLOCK_PATH + "?challenge=" + challenge,
                options
              ),
              1024,
              life
            )
          );
          if (clock.challenge !== challenge) refuseObservation();
          life.live();
          const request: ObservationRequest = {
            ...locator,
            audience: OBSERVATION_AUDIENCE,
            method: "GET",
            path: OBSERVATION_PATH,
            challenge,
            issuedAtMs: String(clock.serverTimeMs),
            expiresAtMs: String(clock.expiresAtMs),
          };
          const signature = await sign(observationTypedData(request));
          life.live();
          const response = await nativeFetch(origin + OBSERVATION_PATH, {
            ...options,
            headers: {
              "X-Keryx-Observation-Proof": serializeObservationProof(
                request,
                signature
              ),
            },
          });
          const payload = await readJson(
            response,
            OBSERVATION_RESPONSE_LIMIT,
            life
          );
          const verified = await validateOriginalObservation(
            payload,
            request,
            signer
          );
          life.live();
          return verified;
        } catch {
          return null;
        } finally {
          running = false;
        }
      })();
      try {
        return await Promise.race([
          work,
          new Promise<null>((resolve) => {
            if (life.abort.signal.aborted) resolve(null);
            else
              life.abort.signal.addEventListener("abort", () => resolve(null), {
                once: true,
              });
          }),
        ]);
      } finally {
        life.close();
      }
    },
  });
}

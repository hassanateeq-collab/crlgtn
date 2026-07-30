/**
 * Typed failures. Every Edge Function throws these rather than returning ad-hoc
 * responses, so the handler wrapper can map them to status codes in one place
 * and no function accidentally leaks a stack trace to a client.
 */

export class EdgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EdgeError";
  }
}

/** Malformed or missing input. */
export const badRequest = (message: string, details?: unknown) =>
  new EdgeError(400, "bad_request", message, details);

/** No valid JWT, or the token does not resolve to a known actor. */
export const unauthorized = (message = "Authentication required") =>
  new EdgeError(401, "unauthorized", message);

/** Authenticated, but not permitted. */
export const forbidden = (message = "Not permitted") =>
  new EdgeError(403, "forbidden", message);

export const notFound = (message = "Not found") =>
  new EdgeError(404, "not_found", message);

/**
 * The request is well-formed but the domain state forbids it — an offer already
 * booked, a window already expired. M5 leans on this heavily.
 */
export const conflict = (message: string, details?: unknown) =>
  new EdgeError(409, "conflict", message, details);

/** A business rule was violated, e.g. an RFQ addressed to more than 3 vendors. */
export const unprocessable = (message: string, details?: unknown) =>
  new EdgeError(422, "unprocessable", message, details);

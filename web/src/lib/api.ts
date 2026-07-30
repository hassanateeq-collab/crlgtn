import { supabase, SUPABASE_URL } from './supabase'

/**
 * The only write path. Every Edge Function answers with one of two shapes:
 *
 *   { ok: true,  data: ... }
 *   { ok: false, error: { code, message, details } }
 *
 * `callFunction` unwraps both and throws ApiError on the second, so callers can
 * treat a business-rule rejection the same way they treat a network failure.
 */

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

interface EnvelopeOk<T> {
  ok: true
  data: T
}
interface EnvelopeErr {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export async function callFunction<T>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new ApiError('unauthorized', 'Your session has ended. Sign in again.', 401)
  }

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('network_error', 'Could not reach the server.', 0)
  }

  let payload: EnvelopeOk<T> | EnvelopeErr
  try {
    payload = await res.json()
  } catch {
    throw new ApiError(
      'bad_response',
      `${name} returned a non-JSON response (${res.status}).`,
      res.status,
    )
  }

  if (!payload.ok) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      res.status,
      payload.error.details,
    )
  }

  return payload.data
}

/** Shape returned by ef_whoami. */
export interface WhoAmI {
  authUserId: string
  actorType: 'corporate_user' | 'ops_user' | 'vendor_user' | 'system'
  name: string
  email: string
  isOps: boolean
  opsRole: 'ops_agent' | 'ops_admin' | null
  corporateRole:
    | 'corp_admin'
    | 'corp_booker'
    | 'corp_approver'
    | 'corp_finance'
    | null
  corporate: { id: string; name: string; status: string } | null
  liveVendorCount: number
  serverTimeUtc: string
}

export const whoami = () => callFunction<WhoAmI>('ef_whoami')

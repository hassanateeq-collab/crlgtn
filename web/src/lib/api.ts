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
  vendor: { id: string; name: string; status: string } | null
  liveVendorCount: number
  serverTimeUtc: string
}

export const whoami = () => callFunction<WhoAmI>('ef_whoami')

// ---- M1: ops console --------------------------------------------------------

export interface VendorPayload {
  vendor: {
    id?: string
    name: string
    vendor_type?: string
    status?: string
    corridor_id?: string | null
    stars_assigned?: number | null
    price_bracket?: string | null
    commission_pct?: number | null
    notes?: string | null
    description?: string | null
    property_subtype?: string | null
    address?: string | null
    phone?: string | null
    checkin_time?: string | null
    checkout_time?: string | null
    cancellation_policy?: string | null
    noshow_policy?: string | null
    // Onboarding setup (migration 019)
    credit_tier?: 'HT1' | 'HT2' | 'HT3' | 'HT4'
    total_rooms?: number | null
    airport_transfer_included?: boolean
    courtesies?: string[]
  }
  listings?: {
    name: string
    category?: string | null
    max_occupancy?: number
    active?: boolean
    bed_config?: string | null
    size_sqm?: number | null
    description?: string | null
    rates?: Record<string, number>
  }[]
  amenities?: { code: string; verified: boolean }[]
  inclusions?: string[]
  addons?: { label: string; price_pkr: number; unit?: string }[]
  media?: {
    storage_path: string
    listing_name?: string | null
    caption?: string | null
    sort?: number
    is_cover?: boolean
    shot_type?: string | null
  }[]
  front_office?: { name?: string; whatsapp?: string | null; email?: string | null }[]
  agreement?: {
    tier?: string | null
    version?: string
    doc_url?: string | null
    signed_digital_at?: string | null
    signed_physical_at?: string | null
  }
}

export const onboardVendor = (payload: VendorPayload) =>
  callFunction<{ vendor: { id: string } }>(
    'ef_onboard_vendor',
    payload as unknown as Record<string, unknown>,
  )

export interface CorporatePayload {
  corporate: {
    id?: string
    name: string
    status?: string
    credit_limit_pkr?: number
    credit_terms?: string
    security_type?: string
    security_amount_pkr?: number
    fee_waived_until?: string | null
    approval_required?: boolean
    notes?: string | null
    // Onboarding setup (migration 019)
    tier?: 'A' | 'B' | 'C'
    official_email?: string | null
    countersign_required?: boolean
    countersign_threshold_pkr?: number | null
  }
  users?: { role: string; name: string; email: string; phone?: string }[]
  /** Create auth accounts for users without one (default true). */
  provision?: boolean
  agreement?: {
    tier?: string | null
    version?: string
    doc_url?: string | null
    signed_digital_at?: string | null
    signed_physical_at?: string | null
  }
}

export const upsertCorporate = (payload: CorporatePayload) =>
  callFunction<{
    corporate: { id: string }
    users: { id: string; role: string; name: string; email: string; phone: string | null; auth_user_id: string | null }[]
    provisioned: string[]
  }>(
    'ef_upsert_corporate',
    payload as unknown as Record<string, unknown>,
  )

// ---- Account management (ops admin) ----------------------------------------

export interface OpsUser {
  id: string
  name: string
  email: string
  role: 'ops_agent' | 'ops_admin'
  active: boolean
  auth_user_id: string | null
}

export const upsertOpsUser = (input: { name: string; email: string; role: string }) =>
  callFunction<{ ops_user: OpsUser }>('ef_manage_users', { action: 'upsert_ops', ...input })

export const setUserPassword = (email: string, password: string) =>
  callFunction<{ email: string; password_set: boolean }>('ef_manage_users', {
    action: 'set_password',
    email,
    password,
  })

export const setOpsActive = (id: string, active: boolean) =>
  callFunction<{ ops_user: OpsUser }>('ef_manage_users', { action: 'set_ops_active', id, active })

/** Create (or find) the auth account behind a vendor front-office contact. */
export const provisionVendorLogin = (vendorUserId: string) =>
  callFunction<{ vendor_user_id: string; email: string; provisioned: boolean }>('ef_manage_users', {
    action: 'provision_vendor',
    vendor_user_id: vendorUserId,
  })

// ---- Marketing leads (ops) --------------------------------------------------

export type LeadKind = 'corporate' | 'vendor'
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'rejected'

export interface Lead {
  id: string
  kind: LeadKind
  status: LeadStatus
  org: string
  person: string
  email: string
  phone: string
  city: string | null
  volume: string | null
  notes: string | null
  source_page: string | null
  ops_note: string | null
  handled_by: string | null
  handled_at: string | null
  created_at: string
}

export const updateLead = (input: { id: string; status?: LeadStatus; ops_note?: string }) =>
  callFunction<Lead>('ef_update_lead', input as unknown as Record<string, unknown>)

// ---- M2: booking files ------------------------------------------------------

export interface BookingFile {
  id: string
  ref: string
  corporate_id: string
  name: string
  service: 'hotel' | 'car'
  status: string
  check_in: string
  check_out: string
  rooms: { guests: number }[]
  dealbreakers: string[]
  corridor_id: string | null
  auto_accept: boolean
  window_minutes: number | null
  window_expires_at: string | null
  updated_at: string
}

export interface BookingFilePayload {
  file: {
    id?: string
    name: string
    service?: 'hotel' | 'car'
    check_in: string
    check_out: string
    rooms: { guests: number }[]
    dealbreakers: string[]
    corridor_id?: string | null
    auto_accept?: boolean
  }
  travelers?: { name: string; email?: string; phone?: string }[]
}

export const upsertBookingFile = (payload: BookingFilePayload) =>
  callFunction<{
    file: BookingFile
    travelers: { id: string; name: string; email: string | null; phone: string | null }[]
  }>('ef_upsert_booking_file', payload as unknown as Record<string, unknown>)

// ---- M4: RFQ engine ---------------------------------------------------------

export interface RfqOffer {
  id: string
  vendor_id: string
  listing_id: string
  package_code: string
  rate_pkr: number
  priority: number
  status: string
  sent_at: string
  viewed_at?: string | null
  responded_at?: string | null
  counter?: { listing_id: string | null; note: string | null } | null
}

export const sendRfq = (
  bookingFileId: string,
  selections: { vendor_id: string; listing_id: string; package_code: string; priority: number }[],
) =>
  callFunction<{ file: BookingFile; offers: RfqOffer[] }>('ef_send_rfq', {
    booking_file_id: bookingFileId,
    selections,
  })

export interface BookingResult {
  booking_id: string
  ref: string
  vendor_name: string
  listing_id: string
  rate_pkr: number
  nights: number
  rooms: number
  grand_total_pkr: number
}

export const bookOffer = (offerId: string) =>
  callFunction<BookingResult>('ef_book_offer', { offer_id: offerId })

// ---- Transfers (instant book, fixed route prices) ---------------------------

export interface TransferResult {
  transfer_id: string
  ref: string
  route: string
  vendor_name: string
  price_pkr: number
  invoice_number: string
  invoice_status: string
}

export const bookTransfer = (input: {
  listing_id: string
  direction: 'pickup' | 'dropoff'
  travel_at: string
  flight_no?: string
  passengers: number
  pickup_point?: string
  dropoff_point?: string
}) => callFunction<TransferResult>('ef_book_transfer', input)

export const opsOverrideAccept = (
  offerId: string,
  evidence: { wa_msg_id: string; email_msg_id: string },
) =>
  callFunction<{ offer_id: string; status: string; booking: BookingResult | null }>(
    'ef_ops_override_accept',
    { offer_id: offerId, evidence },
  )

/**
 * The vendor respond endpoint is public (token-authenticated, verify_jwt off),
 * so it bypasses callFunction's session requirement entirely.
 */
export interface VendorOfferView {
  ref: string
  hotel: string
  room: string
  bed_config: string | null
  package_code: string
  rate_pkr: number
  check_in: string
  check_out: string
  rooms: { guests: number }[]
  status: string
  counter: { listing_id: string | null; note: string | null } | null
  window_expires_at: string
  alternates?: { id: string; name: string; bed_config: string | null }[]
}

export async function vendorRespond(
  token: string,
  action: 'view' | 'accept' | 'counter' | 'decline',
  counter?: { listing_id?: string; note?: string },
): Promise<VendorOfferView> {
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ef_vendor_respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, ...(counter ? { counter } : {}) }),
    })
  } catch {
    throw new ApiError('network_error', 'Could not reach the server.', 0)
  }
  const payload = await res.json().catch(() => null)
  if (!payload) throw new ApiError('bad_response', `Unexpected response (${res.status})`, res.status)
  if (!payload.ok) {
    throw new ApiError(payload.error.code, payload.error.message, res.status)
  }
  return payload.data as VendorOfferView
}

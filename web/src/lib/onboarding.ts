/**
 * Onboarding rules shared by the Supply dashboard and the editors.
 *
 * The DB views vendor_onboarding / corporate_onboarding compute the same facts
 * server-side; the editors mirror them on live form state so the "plan" panel
 * updates as ops type. Keep the two in step when the rules change.
 */

export const SHOT_LIST = [
  { key: 'front_door', label: 'Front door', hint: 'The entrance a guest walks into' },
  { key: 'gate', label: 'Gate', hint: 'Compound gate or building entry' },
  { key: 'street_view', label: 'Street view', hint: 'The street outside, as it really looks' },
  { key: 'neighbourhood', label: 'Neighbourhood', hint: 'The locality around the property' },
  { key: 'reception', label: 'Reception', hint: 'Front desk and lobby seating' },
  { key: 'corridor_stairs', label: 'Corridors & stairs', hint: 'Passages, lift, stairwell' },
  { key: 'breakfast_area', label: 'Breakfast area', hint: 'Where breakfast is served' },
  { key: 'breakfast', label: 'The breakfast', hint: 'The spread itself — every item' },
] as const
export type ShotKey = (typeof SHOT_LIST)[number]['key']
export const SHOT_KEYS: string[] = SHOT_LIST.map((s) => s.key)

/** Per-room-category shots: 6+ labeled photos, the first four required. */
export const CATEGORY_SHOTS = [
  { key: 'bed', label: 'Bed' },
  { key: 'bedroom', label: 'Bedroom, complete' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'shower', label: 'Shower' },
  { key: 'living_room', label: 'Living room' },
  { key: 'detail', label: 'Amenity detail' },
] as const
export const CATEGORY_REQUIRED = ['bed', 'bedroom', 'bathroom', 'shower']
export const GALLERY_MIN = 6

export const CREDIT_TIERS = [
  { code: 'HT1', label: 'HT1 · Open', hint: 'Credit for tiers A, B and C' },
  { code: 'HT2', label: 'HT2 · Standard', hint: 'Credit for A and B · C prepays' },
  { code: 'HT3', label: 'HT3 · Selective', hint: 'Credit for A only' },
  { code: 'HT4', label: 'HT4 · Prepaid', hint: 'Everyone prepays or draws deposit' },
] as const

export const CORP_TIERS = ['A', 'B', 'C'] as const
/** The cash-flow rule: corporate ceilings sit below the 30-day hotel settlement. */
export const TERMS_BY_TIER: Record<string, string[]> = {
  A: ['on_checkout', 'd7', 'd15', 'd20'],
  B: ['on_checkout', 'd7', 'd15'],
  C: ['on_checkout', 'd7'],
}
export const TERM_LABEL: Record<string, string> = {
  on_checkout: 'On checkout',
  d7: 'd7 — 7 days from checkout',
  d15: 'd15 — 15 days from checkout',
  d20: 'd20 — 20 days from checkout',
  d30: 'd30 (abolished)',
}

export const VENDOR_TYPES = [
  { code: 'hotel', label: 'Hotel' },
  { code: 'rent_a_car', label: 'Rent-a-car operator' },
  { code: 'property', label: 'Apartments / serviced' },
] as const

export const CATEGORIES: Record<string, string[]> = {
  hotel: ['A · Standard', 'B · Superior', 'C · Suite'],
  rent_a_car: ['Sedan', 'SUV', 'Premium'],
  property: ['Studio', '1-Bed', '2-Bed', 'Serviced'],
}

export const PACKAGES: Record<string, { code: string; label: string; unit: string }[]> = {
  hotel: [
    { code: 'P1', label: 'Room only', unit: 'per room · night' },
    { code: 'P2', label: 'Room + breakfast', unit: 'per room · night' },
    { code: 'P3', label: 'Half board (breakfast + dinner)', unit: 'per room · night' },
  ],
  property: [
    { code: 'P1', label: 'Unit only', unit: 'per unit · night' },
    { code: 'P2', label: '+ housekeeping', unit: 'per unit · night' },
    { code: 'P3', label: 'All-in (utilities)', unit: 'per unit · night' },
  ],
  rent_a_car: [
    { code: 'V1', label: 'Self-drive', unit: 'per day' },
    { code: 'V2', label: 'With driver', unit: 'per day' },
    { code: 'V3', label: 'Driver + fuel', unit: 'per day' },
  ],
}

export const COURTESIES = [
  'Pressing (2 items/day)',
  'Printing up to 5 pages',
  'Evening tea',
  'Bottled water daily',
  'Late checkout 2 pm',
  'Pool & gym',
  'Iron in room',
  'Early check-in when free',
]

export const PKG_LABEL: Record<string, string> = {
  P1: 'Room only',
  P2: 'Room + breakfast',
  P3: 'Half board',
  V1: 'Self-drive',
  V2: 'With driver',
  V3: 'Driver + fuel',
}

export const CORRIDOR_NOTE = 'Every property is filed under exactly one area.'

// ---- progress -------------------------------------------------------------

export interface Step {
  key: string
  label: string
  done: boolean
  detail: string
}

/** Row shape of public.vendor_onboarding (migration 019). */
export interface VendorProgressRow {
  vendor_id: string
  name: string
  vendor_type: string
  status: string
  credit_tier: string
  corridor_id: string | null
  stars_assigned: number | null
  price_bracket: string | null
  total_rooms: number | null
  profile_complete: boolean
  has_front_office: boolean
  agreement_signed: boolean
  listings_active: number
  listings_priced: number
  amenities_verified: number
  shots_done: number
  shot_types: string[] | null
  photos_total: number
  listings_with_gallery: number
  cover_path: string | null
  updated_at: string
}

/** Facts the editor derives from live form state; same keys as the view. */
export type VendorFacts = Pick<
  VendorProgressRow,
  | 'vendor_type'
  | 'profile_complete'
  | 'has_front_office'
  | 'agreement_signed'
  | 'listings_active'
  | 'listings_priced'
  | 'amenities_verified'
  | 'shots_done'
  | 'photos_total'
  | 'listings_with_gallery'
>

export function vendorSteps(f: VendorFacts): Step[] {
  const car = f.vendor_type === 'rent_a_car'
  const noun = car ? 'vehicle class' : 'room category'
  const nouns = car ? 'vehicle classes' : 'room categories'
  const steps: Step[] = [
    {
      key: 'profile',
      label: 'Profile',
      done: f.profile_complete,
      detail: f.profile_complete ? 'Description, address, area set' : 'Needs description, address and area',
    },
    {
      key: 'front_office',
      label: 'Front office contact',
      done: f.has_front_office,
      detail: f.has_front_office ? 'Magic links have somewhere to go' : 'WhatsApp or email for the reservations desk',
    },
    {
      key: 'agreement',
      label: 'Agreement signed',
      done: f.agreement_signed,
      detail: f.agreement_signed ? 'Signed copy on file' : 'Record the signed agreement',
    },
    {
      key: 'rates',
      label: 'Rate card',
      done: f.listings_active > 0 && f.listings_priced === f.listings_active,
      detail:
        f.listings_active === 0
          ? `Add at least one ${noun}`
          : `${f.listings_priced} of ${f.listings_active} ${nouns} priced`,
    },
  ]
  if (!car) {
    steps.push({
      key: 'amenities',
      label: 'Verified amenities',
      done: f.amenities_verified > 0,
      detail: f.amenities_verified > 0 ? `${f.amenities_verified} verified on site` : 'Verify at least one on the site visit',
    })
    steps.push({
      key: 'shots',
      label: 'Property shot list',
      done: f.shots_done >= SHOT_LIST.length,
      detail: `${f.shots_done} of ${SHOT_LIST.length} required photos`,
    })
    steps.push({
      key: 'galleries',
      label: 'Room-type galleries',
      done: f.listings_active > 0 && f.listings_with_gallery === f.listings_active,
      detail: `${f.listings_with_gallery} of ${f.listings_active} room types with ${GALLERY_MIN}+ labeled photos`,
    })
  } else {
    steps.push({
      key: 'photos',
      label: 'Fleet photos',
      done: f.photos_total >= 3,
      detail: `${f.photos_total} photos — 3 or more, real vehicles`,
    })
  }
  return steps
}

/** Row shape of public.corporate_onboarding (migration 019). */
export interface CorporateProgressRow {
  corporate_id: string
  name: string
  status: string
  tier: string
  credit_terms: string
  credit_limit_pkr: number
  official_email: string | null
  countersign_required: boolean
  countersign_threshold_pkr: number | null
  security_type: string
  security_amount_pkr: number
  has_official_email: boolean
  credit_set: boolean
  users_total: number
  users_linked: number
  agreement_signed: boolean
  files_total: number
  updated_at: string
}

export type CorporateFacts = Pick<
  CorporateProgressRow,
  'tier' | 'credit_terms' | 'credit_set' | 'has_official_email' | 'users_total' | 'users_linked' | 'agreement_signed'
>

export function termsWithinCeiling(tier: string, terms: string): boolean {
  return (TERMS_BY_TIER[tier] ?? []).includes(terms)
}

export function corporateSteps(f: CorporateFacts): Step[] {
  const ok = termsWithinCeiling(f.tier, f.credit_terms)
  return [
    {
      key: 'credit',
      label: 'Tier & credit',
      done: f.credit_set && ok,
      detail: !ok
        ? `Terms exceed the tier ${f.tier} ceiling`
        : f.credit_set
          ? `Tier ${f.tier} · ${f.credit_terms.replace('_', ' ')}`
          : 'Set a credit limit',
    },
    {
      key: 'official_email',
      label: 'Official email',
      done: f.has_official_email,
      detail: f.has_official_email ? 'Countersign and invoices have an address' : 'Address of record — not a booker login',
    },
    {
      key: 'agreement',
      label: 'Agreement signed',
      done: f.agreement_signed,
      detail: f.agreement_signed ? 'Signed copy on file' : 'Record the signed agreement',
    },
    {
      key: 'bookers',
      label: 'Bookers provisioned',
      done: f.users_total > 0 && f.users_linked === f.users_total,
      detail:
        f.users_total === 0
          ? 'Add at least one booker'
          : `${f.users_linked} of ${f.users_total} accounts can sign in`,
    },
  ]
}

export const nextStep = (steps: Step[]) => steps.find((s) => !s.done) ?? null
export const allDone = (steps: Step[]) => steps.every((s) => s.done)

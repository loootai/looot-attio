import type {FetchLike} from "./looot"

export const ATTIO_API_BASE_URL = "https://api.attio.com"

export type AttioDeps = {fetch: FetchLike; attioToken: string}

type AttioValue = Record<string, unknown>
export type AttioRecord = {values: Record<string, AttioValue[] | undefined>}

/** An error from Attio's REST API, with the HTTP status. */
export class AttioApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
        super(message)
        this.name = "AttioApiError"
        this.status = status
    }
}

const attioRequest = async (
    deps: AttioDeps,
    method: string,
    path: string,
    body?: unknown
): Promise<{ok: boolean; status: number; body: Record<string, unknown>}> => {
    const response = await deps.fetch(`${ATTIO_API_BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${deps.attioToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    })
    const parsed = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    return {ok: response.ok, status: response.status, body: parsed}
}

const describe = (body: Record<string, unknown>, status: number): string =>
    typeof body.message === "string" ? body.message : `Attio answered HTTP ${status}`

/** Reads one record through GET /v2/objects/{object}/records/{record_id}. */
export const getRecord = async (
    deps: AttioDeps,
    object: "people" | "companies",
    recordId: string
): Promise<AttioRecord> => {
    const answer = await attioRequest(deps, "GET", `/v2/objects/${object}/records/${recordId}`)
    if (!answer.ok) throw new AttioApiError(describe(answer.body, answer.status), answer.status)
    const data = (answer.body.data ?? {}) as {values?: AttioRecord["values"]}
    return {values: data.values ?? {}}
}

/**
 * Writes values through PATCH /v2/objects/{object}/records/{record_id}. PATCH adds to a
 * multiselect attribute such as email_addresses and never removes a value that is there.
 */
export const patchRecord = async (
    deps: AttioDeps,
    object: "people" | "companies",
    recordId: string,
    values: Record<string, unknown>
): Promise<void> => {
    const answer = await attioRequest(deps, "PATCH", `/v2/objects/${object}/records/${recordId}`, {
        data: {values},
    })
    if (!answer.ok) throw new AttioApiError(describe(answer.body, answer.status), answer.status)
}

export type TextAttribute = {slug: string; title: string; description: string}

/**
 * Makes sure a text attribute exists on an object. Attio answers 409 slug_conflict when it is
 * already there, which counts as success.
 */
export const ensureTextAttribute = async (
    deps: AttioDeps,
    object: "people" | "companies",
    attribute: TextAttribute
): Promise<void> => {
    const answer = await attioRequest(deps, "POST", `/v2/objects/${object}/attributes`, {
        data: {
            title: attribute.title,
            description: attribute.description,
            api_slug: attribute.slug,
            type: "text",
            is_required: false,
            is_unique: false,
            is_multiselect: false,
            config: {},
        },
    })
    if (answer.ok || answer.status === 409) return
    throw new AttioApiError(describe(answer.body, answer.status), answer.status)
}

const firstActive = (record: AttioRecord, slug: string): AttioValue | null =>
    (record.values[slug] ?? []).find((value) => value !== null && typeof value === "object") ?? null

/** Reads one property of an attribute's first value as a trimmed string, or null. */
export const readValue = (record: AttioRecord, slug: string, property: string): string | null => {
    const raw = firstActive(record, slug)?.[property]
    if (typeof raw !== "string") return null
    const trimmed = raw.trim()
    return trimmed === "" ? null : trimmed
}

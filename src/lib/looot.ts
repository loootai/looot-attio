import {sha256Hex} from "./sha256"

export const LOOOT_BASE_URL = "https://api.looot.ai"
export const JOB_FIND_WORK_EMAIL = "job:people.email.find"
export const JOB_VERIFY_EMAIL = "job:people.email.verify"
export const JOB_ENRICH_COMPANY = "job:company.enrich"

/** Attio stops a server function after 30 seconds, so looot gets 20 to answer inline. */
export const WAIT_SECONDS = 20

/** The most one lookup may spend across every provider looot tries. */
export const MAX_COST_PER_LOOKUP_USD = 0.05

export type FetchLike = (
    url: string,
    init?: {method?: string; headers?: Record<string, string>; body?: string}
) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>

export type LoootInput = Record<string, string>

export type LoootRun = {
    runId: string
    status: string
    actualCost?: number
    servedProviderId?: string
    result?: unknown
    normalized?: {fields?: Record<string, unknown>}
    error?: {code?: string; message?: string}
}

/** An error looot or this app raised, with a message written for the person using Attio. */
export class LoootError extends Error {
    readonly code: string

    constructor(message: string, code: string) {
        super(message)
        this.name = "LoootError"
        this.code = code
    }
}

/** Drops empty values and trims the rest, so looot only reads the fields that were filled. */
export const cleanInput = (input: Record<string, string | null | undefined>): LoootInput =>
    Object.fromEntries(
        Object.entries(input)
            .map(([key, value]): [string, string] => [
                key,
                typeof value === "string" ? value.trim() : "",
            ])
            .filter(([, value]) => value !== "")
    )

/** Serializes a value with sorted keys, so the same input always gives the same string. */
export const toStableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(toStableJson).join(",")}]`
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${toStableJson(record[key])}`)
            .join(",")}}`
    }
    return JSON.stringify(value ?? null)
}

/**
 * Builds the idempotency key from the job, the input and the UTC date. Running the same lookup
 * twice on one day replays the first looot run and pays once; the next day it runs fresh.
 */
export const buildIdempotencyKey = (
    endpointId: string,
    input: LoootInput,
    now: Date = new Date()
): string => {
    const day = now.toISOString().slice(0, 10)
    return `attio-${sha256Hex(`${endpointId}|${toStableJson(input)}|${day}`).slice(0, 40)}`
}

export type LoootDeps = {fetch: FetchLike; token: string; now?: Date}

/**
 * Runs one looot job with fallback across providers and waits up to 20 seconds. Returns the run
 * as looot answered it, which can still be queued or running. Throws a LoootError when looot
 * refuses the call or the run ends failed, blocked or stopped.
 */
export const runLoootJob = async (
    endpointId: string,
    input: LoootInput,
    deps: LoootDeps
): Promise<LoootRun> => {
    const response = await deps.fetch(`${LOOOT_BASE_URL}/v1/runs`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${deps.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            endpointId,
            input,
            idempotencyKey: buildIdempotencyKey(endpointId, input, deps.now),
            wait: WAIT_SECONDS,
            fallback: {enabled: true, maxCostUsd: MAX_COST_PER_LOOKUP_USD},
        }),
    })
    const body = ((await response.json().catch(() => ({}))) ?? {}) as LoootRun & {
        topUp?: {dashboardUrl?: string}
    }
    if (!response.ok) {
        const message = body.error?.message ?? `looot answered HTTP ${response.status}`
        if (response.status === 401) {
            throw new LoootError(
                "The looot token is not valid. Replace it in the looot app's connection in Attio.",
                "unauthorized"
            )
        }
        if (response.status === 402) {
            throw new LoootError(
                `${message} Nothing was charged. Top up at ${body.topUp?.dashboardUrl ?? "https://looot.ai"}`,
                "insufficient_balance"
            )
        }
        throw new LoootError(message, body.error?.code ?? "looot_error")
    }
    if (["failed", "blocked", "stopped"].includes(body.status)) {
        throw new LoootError(
            `looot run ${body.runId} ended ${body.status}: ${body.error?.message ?? "no message"}. A failed run costs nothing.`,
            body.error?.code ?? `run_${body.status}`
        )
    }
    return body
}

/** True while looot has not finished the run within the wait window. */
export const isPending = (run: LoootRun): boolean => run.status !== "completed"

/** Reads one normalized field as a string, or null when the provider has no field map. */
export const readField = (run: LoootRun, name: string): string | null => {
    const value = run.normalized?.fields?.[name]
    if (value === null || value === undefined || value === "") return null
    return String(value)
}

/** Formats a dollar amount with enough digits for prices below one cent. */
export const formatUsd = (amount: number): string =>
    `$${amount.toFixed(amount < 0.01 ? 4 : 2).replace(/(\.\d{2,}?)0+$/, "$1")}`

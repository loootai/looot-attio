import type {FetchLike} from "./looot"
import {LOOOT_BASE_URL} from "./looot"

export type LookupKind = "enrich-company" | "find-work-email" | "verify-email"

export const JOB_ID_BY_KIND: Record<LookupKind, string> = {
    "enrich-company": "company.enrich",
    "find-work-email": "people.email.find",
    "verify-email": "people.email.verify",
}

/** Cheapest provider per call in the public catalog on FALLBACK_PRICE_DATE. Used only when the live read fails. */
export const FALLBACK_PRICES_USD: Record<LookupKind, number> = {
    "enrich-company": 0.0019,
    "find-work-email": 0.003598,
    "verify-email": 0.00145,
}
export const FALLBACK_PRICE_DATE = "2026-10-09"

export type Quote = {priceUsd: number; source: "catalog" | "fallback"}

type Overview = {
    categories?: Array<{
        platforms?: Array<{jobs?: Array<{id?: string; cheapestPerCall?: number | null}>}>
    }>
}

/** Finds a job's cheapest price per call in the catalog overview, or null when it is not listed. */
export const findCheapestPerCall = (overview: unknown, jobId: string): number | null => {
    for (const category of (overview as Overview)?.categories ?? []) {
        for (const platform of category.platforms ?? []) {
            for (const job of platform.jobs ?? []) {
                if (job.id === jobId && typeof job.cheapestPerCall === "number") {
                    return job.cheapestPerCall
                }
            }
        }
    }
    return null
}

/**
 * Reads the "from" price of one lookup from looot's public catalog. The read needs no token and
 * costs nothing. Falls back to the dated constants when the catalog cannot be read.
 */
export const getQuote = async (kind: LookupKind, fetchImpl: FetchLike): Promise<Quote> => {
    try {
        const response = await fetchImpl(`${LOOOT_BASE_URL}/v1/catalog/overview?depth=jobs`, {
            method: "GET",
            headers: {Accept: "application/json"},
        })
        if (response.ok) {
            const price = findCheapestPerCall(await response.json(), JOB_ID_BY_KIND[kind])
            if (price !== null) return {priceUsd: price, source: "catalog"}
        }
    } catch {
        // fall through to the dated constants
    }
    return {priceUsd: FALLBACK_PRICES_USD[kind], source: "fallback"}
}

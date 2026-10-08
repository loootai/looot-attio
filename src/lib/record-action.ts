import type {Outcome, Prepared} from "./actions"
import {formatUsd, MAX_COST_PER_LOOKUP_USD} from "./looot"
import type {LookupKind} from "./prices"
import {FALLBACK_PRICE_DATE} from "./prices"

export const CONFIRM_TITLES: Record<LookupKind, string> = {
    "enrich-company": "Enrich company with looot",
    "find-work-email": "Find work email with looot",
    "verify-email": "Verify email with looot",
}

const WHAT: Record<LookupKind, string> = {
    "enrich-company": "Look up the industry and size of",
    "find-work-email": "Look up the work email of",
    "verify-email": "Check whether this email can receive mail:",
}

/** The text of the confirmation: what runs, on what, and what it costs. */
export const buildConfirmText = (
    kind: LookupKind,
    prepared: Extract<Prepared, {ready: true}>
): string => {
    const price =
        prepared.quote.source === "catalog"
            ? `from ${formatUsd(prepared.quote.priceUsd)} (cheapest provider in the looot catalog right now)`
            : `from ${formatUsd(prepared.quote.priceUsd)} (catalog price on ${FALLBACK_PRICE_DATE}, the live price could not be read)`
    return `${WHAT[kind]} ${prepared.subject}. One lookup costs ${price} and never more than ${formatUsd(MAX_COST_PER_LOOKUP_USD)}. It is paid from your looot balance. A lookup that fails costs nothing.`
}

type ToastVariant = "neutral" | "warning" | "error" | "success"

const VARIANTS: Record<Outcome["outcome"], ToastVariant> = {
    updated: "success",
    not_found: "neutral",
    pending: "warning",
    skipped: "neutral",
    error: "error",
}

/** The parts of Attio's client SDK and of this app's server functions the flow needs. */
export type RecordActionDeps = {
    prepare: (kind: LookupKind, recordId: string) => Promise<Prepared>
    run: (kind: LookupKind, recordId: string) => Promise<Outcome>
    confirm: (options: {
        title: string
        text: string
        confirmLabel?: string
        cancelLabel?: string
    }) => Promise<boolean>
    showToast: (options: {
        variant: ToastVariant
        title: string
        text?: string
        durationMs?: number
    }) => Promise<{hideToast: () => Promise<void>}>
}

/**
 * The flow behind every record action: read the record and the price, ask the user to confirm,
 * run the lookup, show what happened. No lookup runs without a confirmation.
 */
export const triggerRecordAction = async (
    kind: LookupKind,
    recordId: string,
    deps: RecordActionDeps
): Promise<void> => {
    let prepared: Prepared
    try {
        prepared = await deps.prepare(kind, recordId)
    } catch (error) {
        await deps.showToast({
            variant: "error",
            title: "looot could not read this record",
            text: error instanceof Error ? error.message : undefined,
        })
        return
    }
    if (!prepared.ready) {
        await deps.showToast({variant: "neutral", title: prepared.title, text: prepared.text})
        return
    }
    const confirmed = await deps.confirm({
        title: CONFIRM_TITLES[kind],
        text: buildConfirmText(kind, prepared),
        confirmLabel: "Run lookup",
        cancelLabel: "Cancel",
    })
    if (!confirmed) return

    const loading = await deps.showToast({
        variant: "neutral",
        title: "looot is running the lookup",
        durationMs: 30_000,
    })
    let outcome: Outcome
    try {
        outcome = await deps.run(kind, recordId)
    } catch (error) {
        outcome = {
            outcome: "error",
            title: "The lookup did not finish",
            text: error instanceof Error ? error.message : "Unknown error",
            costUsd: 0,
        }
    }
    await loading.hideToast()
    await deps.showToast({
        variant: VARIANTS[outcome.outcome],
        title: outcome.title,
        text: outcome.text,
        durationMs: 8_000,
    })
}

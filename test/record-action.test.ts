import {describe, expect, it, vi} from "vitest"

import type {Outcome, Prepared} from "../src/lib/actions"
import type {RecordActionDeps} from "../src/lib/record-action"
import {buildConfirmText, triggerRecordAction} from "../src/lib/record-action"

const READY: Prepared = {
    ready: true,
    subject: "Ada Lovelace at example.com",
    quote: {priceUsd: 0.003598, source: "catalog"},
}
const UPDATED: Outcome = {
    outcome: "updated",
    title: "Added ada@example.com",
    text: "Charged $0.0036.",
    costUsd: 0.003598,
}

const depsWith = (overrides: Partial<RecordActionDeps> = {}) => {
    const hideToast = vi.fn(async () => {})
    const deps = {
        prepare: vi.fn(async () => READY),
        run: vi.fn(async () => UPDATED),
        confirm: vi.fn(async () => true),
        showToast: vi.fn(async () => ({hideToast})),
        ...overrides,
    }
    return {deps, hideToast}
}

describe("buildConfirmText", () => {
    it("names the record, the live price, the cap and who pays", () => {
        expect(buildConfirmText("find-work-email", READY as Extract<Prepared, {ready: true}>)).toBe(
            "Look up the work email of Ada Lovelace at example.com. One lookup costs from $0.0036 (cheapest provider in the looot catalog right now) and never more than $0.05. It is paid from your looot balance. A lookup that fails costs nothing."
        )
    })
    it("says so when the price is the dated fallback", () => {
        const text = buildConfirmText("enrich-company", {
            ready: true,
            subject: "example.com",
            quote: {priceUsd: 0.0019, source: "fallback"},
        })
        expect(text).toContain(
            "from $0.0019 (catalog price on 2026-10-09, the live price could not be read)"
        )
    })
})

describe("triggerRecordAction", () => {
    it("shows the price, asks to confirm, runs, then shows the result", async () => {
        const {deps, hideToast} = depsWith()
        await triggerRecordAction("find-work-email", "rec_1", deps)
        expect(deps.prepare).toHaveBeenCalledWith("find-work-email", "rec_1")
        expect(deps.confirm).toHaveBeenCalledWith({
            title: "Find work email with looot",
            text: expect.stringContaining("from $0.0036"),
            confirmLabel: "Run lookup",
            cancelLabel: "Cancel",
        })
        expect(deps.run).toHaveBeenCalledWith("find-work-email", "rec_1")
        expect(hideToast).toHaveBeenCalledTimes(1)
        expect(deps.showToast).toHaveBeenLastCalledWith({
            variant: "success",
            title: "Added ada@example.com",
            text: "Charged $0.0036.",
            durationMs: 8000,
        })
    })

    it("runs nothing when the user cancels", async () => {
        const {deps} = depsWith({confirm: vi.fn(async () => false)})
        await triggerRecordAction("verify-email", "rec_1", deps)
        expect(deps.run).not.toHaveBeenCalled()
        expect(deps.showToast).not.toHaveBeenCalled()
    })

    it("does not ask to confirm when there is nothing to run", async () => {
        const {deps} = depsWith({
            prepare: vi.fn(async (): Promise<Prepared> => ({
                ready: false,
                title: "This person already has an email",
                text: "Nothing was run and nothing was charged.",
            })),
        })
        await triggerRecordAction("find-work-email", "rec_1", deps)
        expect(deps.confirm).not.toHaveBeenCalled()
        expect(deps.run).not.toHaveBeenCalled()
        expect(deps.showToast).toHaveBeenCalledWith({
            variant: "neutral",
            title: "This person already has an email",
            text: "Nothing was run and nothing was charged.",
        })
    })

    it("shows an error toast when the record cannot be read or the run throws", async () => {
        const failing = depsWith({prepare: vi.fn(async () => Promise.reject(new Error("boom")))})
        await triggerRecordAction("enrich-company", "rec_1", failing.deps)
        expect(failing.deps.confirm).not.toHaveBeenCalled()
        expect(failing.deps.showToast).toHaveBeenCalledWith({
            variant: "error",
            title: "looot could not read this record",
            text: "boom",
        })

        const crashing = depsWith({run: vi.fn(async () => Promise.reject(new Error("timeout")))})
        await triggerRecordAction("enrich-company", "rec_1", crashing.deps)
        expect(crashing.deps.showToast).toHaveBeenLastCalledWith({
            variant: "error",
            title: "The lookup did not finish",
            text: "timeout",
            durationMs: 8000,
        })
    })

    it.each([
        ["not_found", "neutral"],
        ["pending", "warning"],
        ["skipped", "neutral"],
        ["error", "error"],
    ] as const)("maps a %s outcome to a %s toast", async (outcome, variant) => {
        const {deps} = depsWith({
            run: vi.fn(async (): Promise<Outcome> => ({
                outcome,
                title: "t",
                text: "x",
                costUsd: 0,
            })),
        })
        await triggerRecordAction("verify-email", "rec_1", deps)
        expect(deps.showToast).toHaveBeenLastCalledWith(expect.objectContaining({variant}))
    })
})

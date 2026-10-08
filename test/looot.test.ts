import {createHash} from "node:crypto"

import {describe, expect, it} from "vitest"

import {
    buildIdempotencyKey,
    cleanInput,
    formatUsd,
    LoootError,
    readField,
    runLoootJob,
    toStableJson,
} from "../src/lib/looot"
import {sha256Hex} from "../src/lib/sha256"
import {fakeFetch, NOW, on} from "./helpers"

describe("sha256Hex", () => {
    it.each([
        "",
        "abc",
        "looot",
        "é ü 日本語 🙂",
        "a".repeat(55),
        "a".repeat(56),
        "a".repeat(64),
        "x".repeat(1000),
    ])("matches node:crypto for %j", (text) => {
        expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"))
    })
})

describe("idempotency key", () => {
    const input = {domain: "example.com", name: "Ada Lovelace"}

    it("is the same for the same lookup on the same UTC day, whatever the key order", () => {
        const first = buildIdempotencyKey("job:people.email.find", input, NOW)
        const second = buildIdempotencyKey(
            "job:people.email.find",
            {name: "Ada Lovelace", domain: "example.com"},
            new Date("2026-10-09T23:59:59Z")
        )
        expect(first).toBe(second)
        expect(first).toMatch(/^attio-[0-9a-f]{40}$/)
    })

    it("changes the next day, for another job and for another input", () => {
        const base = buildIdempotencyKey("job:people.email.find", input, NOW)
        expect(
            buildIdempotencyKey("job:people.email.find", input, new Date("2026-10-10T00:00:00Z"))
        ).not.toBe(base)
        expect(buildIdempotencyKey("job:people.email.verify", input, NOW)).not.toBe(base)
        expect(
            buildIdempotencyKey("job:people.email.find", {...input, domain: "example.org"}, NOW)
        ).not.toBe(base)
    })
})

describe("helpers", () => {
    it("cleanInput trims and drops empty values", () => {
        expect(cleanInput({a: " x ", b: "", c: null, d: undefined, e: "  "})).toEqual({a: "x"})
    })
    it("toStableJson sorts keys at every level", () => {
        expect(toStableJson({b: 1, a: {d: [2, {z: 1, y: 2}], c: null}})).toBe(
            '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}'
        )
    })
    it("formatUsd keeps sub-cent prices readable", () => {
        expect(formatUsd(0.003598)).toBe("$0.0036")
        expect(formatUsd(0.0019)).toBe("$0.0019")
        expect(formatUsd(0.05)).toBe("$0.05")
        expect(formatUsd(1.5)).toBe("$1.50")
    })
    it("readField returns null when normalized fields are missing", () => {
        expect(readField({runId: "r", status: "completed"}, "email")).toBeNull()
        expect(
            readField({runId: "r", status: "completed", normalized: {fields: {email: ""}}}, "email")
        ).toBeNull()
    })
})

describe("runLoootJob", () => {
    it("posts the documented body with the bearer token and a cost cap", async () => {
        const {fetch, calls} = fakeFetch([
            on("POST", "/v1/runs", {
                status: 201,
                body: {runId: "run_1", status: "completed", actualCost: 0.004},
            }),
        ])
        const run = await runLoootJob(
            "job:people.email.find",
            {name: "Ada Lovelace", domain: "example.com"},
            {fetch, token: "test-token", now: NOW}
        )
        expect(run.runId).toBe("run_1")
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe("https://api.looot.ai/v1/runs")
        expect(calls[0].headers.Authorization).toBe("Bearer test-token")
        expect(calls[0].body).toEqual({
            endpointId: "job:people.email.find",
            input: {name: "Ada Lovelace", domain: "example.com"},
            idempotencyKey: buildIdempotencyKey(
                "job:people.email.find",
                {name: "Ada Lovelace", domain: "example.com"},
                NOW
            ),
            wait: 20,
            fallback: {enabled: true, maxCostUsd: 0.05},
        })
    })

    it("explains a rejected token", async () => {
        const {fetch} = fakeFetch([
            on("POST", "/v1/runs", {status: 401, body: {error: {message: "no"}}}),
        ])
        await expect(
            runLoootJob("job:company.enrich", {domain: "example.com"}, {fetch, token: "bad"})
        ).rejects.toMatchObject({
            code: "unauthorized",
            message: expect.stringContaining("connection in Attio"),
        })
    })

    it("explains an empty balance and says nothing was charged", async () => {
        const {fetch} = fakeFetch([
            on("POST", "/v1/runs", {
                status: 402,
                body: {
                    error: {message: "Balance too low."},
                    topUp: {dashboardUrl: "https://looot.ai/billing"},
                },
            }),
        ])
        const error = await runLoootJob(
            "job:company.enrich",
            {domain: "example.com"},
            {fetch, token: "t"}
        ).catch((caught) => caught)
        expect(error).toBeInstanceOf(LoootError)
        expect(error.code).toBe("insufficient_balance")
        expect(error.message).toBe(
            "Balance too low. Nothing was charged. Top up at https://looot.ai/billing"
        )
    })

    it("treats a 201 that carries a failed run as a failure", async () => {
        const {fetch} = fakeFetch([
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_2",
                    status: "failed",
                    error: {code: "validation_error", message: "domain is required"},
                },
            }),
        ])
        await expect(
            runLoootJob("job:company.enrich", {name: "x"}, {fetch, token: "t"})
        ).rejects.toMatchObject({
            code: "validation_error",
            message: expect.stringContaining("run_2 ended failed: domain is required"),
        })
    })
})

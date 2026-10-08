import {describe, expect, it} from "vitest"

import type {ActionDeps} from "../src/lib/actions"
import {prepareLookup, runLookup} from "../src/lib/actions"
import {getQuote} from "../src/lib/prices"
import type {Call} from "./helpers"
import {COMPANY_ID, fakeFetch, NOW, on, OVERVIEW, PERSON_ID, record} from "./helpers"

const person = (extra: Record<string, unknown[]> = {}) =>
    record({
        name: [{first_name: "Ada", last_name: "Lovelace", full_name: "Ada Lovelace"}],
        company: [{target_object: "companies", target_record_id: COMPANY_ID}],
        email_addresses: [],
        ...extra,
    })
const company = (extra: Record<string, unknown[]> = {}) =>
    record({
        name: [{value: "Example Inc"}],
        domains: [{domain: "example.com", root_domain: "example.com"}],
        ...extra,
    })

const depsFor = (fetch: ActionDeps["fetch"]): ActionDeps & {tokenReads: number} => {
    const deps = {
        fetch,
        attioToken: "attio-app-token",
        now: NOW,
        tokenReads: 0,
        getLoootToken: () => {
            deps.tokenReads += 1
            return "looot-secret"
        },
    }
    return deps
}

const paid = (calls: Call[]) => calls.filter((call) => call.url.includes("/v1/runs"))
const writes = (calls: Call[]) => calls.filter((call) => call.method === "PATCH")

describe("getQuote", () => {
    it("reads the live price from the public catalog without a token", async () => {
        const {fetch, calls} = fakeFetch([on("GET", "/v1/catalog/overview", {body: OVERVIEW})])
        expect(await getQuote("find-work-email", fetch)).toEqual({
            priceUsd: 0.004,
            source: "catalog",
        })
        expect(calls[0].url).toBe("https://api.looot.ai/v1/catalog/overview?depth=jobs")
        expect(calls[0].headers.Authorization).toBeUndefined()
    })
    it("falls back to the dated price when the catalog is down or the job is missing", async () => {
        const down = fakeFetch([on("GET", "/v1/catalog/overview", {status: 503, body: {}})])
        expect(await getQuote("verify-email", down.fetch)).toEqual({
            priceUsd: 0.00145,
            source: "fallback",
        })
        const empty = fakeFetch([on("GET", "/v1/catalog/overview", {body: {categories: []}})])
        expect(await getQuote("enrich-company", empty.fetch)).toEqual({
            priceUsd: 0.0019,
            source: "fallback",
        })
        const broken = fakeFetch([])
        expect(await getQuote("find-work-email", broken.fetch)).toEqual({
            priceUsd: 0.003598,
            source: "fallback",
        })
    })
})

describe("prepareLookup", () => {
    it("returns the subject and the price and calls no paid endpoint", async () => {
        const {fetch, calls} = fakeFetch([
            on("GET", `/people/records/${PERSON_ID}`, person()),
            on("GET", `/companies/records/${COMPANY_ID}`, company()),
            on("GET", "/v1/catalog/overview", {body: OVERVIEW}),
        ])
        const deps = depsFor(fetch)
        expect(await prepareLookup("find-work-email", PERSON_ID, deps)).toEqual({
            ready: true,
            subject: "Ada Lovelace at example.com",
            quote: {priceUsd: 0.004, source: "catalog"},
        })
        expect(paid(calls)).toHaveLength(0)
        expect(deps.tokenReads).toBe(0)
        expect(calls[0].url).toBe(`https://api.attio.com/v2/objects/people/records/${PERSON_ID}`)
        expect(calls[0].headers.Authorization).toBe("Bearer attio-app-token")
    })

    it("stops before the price when the person already has an email", async () => {
        const {fetch, calls} = fakeFetch([
            on(
                "GET",
                `/people/records/${PERSON_ID}`,
                person({email_addresses: [{email_address: "ada@example.com"}]})
            ),
        ])
        const prepared = await prepareLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(prepared).toMatchObject({ready: false, title: "This person already has an email"})
        expect(calls).toHaveLength(1)
    })

    it("asks for a name or a company when the person has neither", async () => {
        const noName = fakeFetch([
            on("GET", "/people/records/", record({name: [], company: [], email_addresses: []})),
        ])
        expect(
            await prepareLookup("find-work-email", PERSON_ID, depsFor(noName.fetch))
        ).toMatchObject({ready: false, title: "This person needs a name"})
        const noCompany = fakeFetch([on("GET", "/people/records/", person({company: []}))])
        expect(
            await prepareLookup("find-work-email", PERSON_ID, depsFor(noCompany.fetch))
        ).toMatchObject({ready: false, title: "This person needs a company"})
    })

    it("refuses to verify a person with no email and to enrich a company with nothing to send", async () => {
        const noEmail = fakeFetch([on("GET", "/people/records/", person())])
        expect(
            await prepareLookup("verify-email", PERSON_ID, depsFor(noEmail.fetch))
        ).toMatchObject({ready: false, title: "This person has no email to verify"})
        const blank = fakeFetch([on("GET", "/companies/records/", record({name: [], domains: []}))])
        expect(
            await prepareLookup("enrich-company", COMPANY_ID, depsFor(blank.fetch))
        ).toMatchObject({ready: false, title: "This company needs a domain or a name"})
    })
})

describe("runLookup: find work email", () => {
    const base = [
        on(
            "GET",
            `/people/records/${PERSON_ID}`,
            person({linkedin: [{value: "https://www.linkedin.com/in/ada"}]})
        ),
        on("GET", `/companies/records/${COMPANY_ID}`, company()),
    ]

    it("runs the job with the record's fields and appends the email to the person", async () => {
        const {fetch, calls} = fakeFetch([
            ...base,
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_1",
                    status: "completed",
                    actualCost: 0.0041,
                    normalized: {fields: {email: "ada@example.com"}},
                },
            }),
            on("PATCH", `/people/records/${PERSON_ID}`, {body: {data: {}}}),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toEqual({
            outcome: "updated",
            title: "Added ada@example.com",
            text: "Charged $0.0041.",
            costUsd: 0.0041,
        })
        expect(paid(calls)).toHaveLength(1)
        expect(paid(calls)[0].headers.Authorization).toBe("Bearer looot-secret")
        expect(paid(calls)[0].body).toMatchObject({
            endpointId: "job:people.email.find",
            input: {
                first_name: "Ada",
                last_name: "Lovelace",
                name: "Ada Lovelace",
                domain: "example.com",
                company: "Example Inc",
                linkedin_url: "https://www.linkedin.com/in/ada",
            },
        })
        expect(writes(calls)).toHaveLength(1)
        expect(writes(calls)[0].url).toBe(
            `https://api.attio.com/v2/objects/people/records/${PERSON_ID}`
        )
        expect(writes(calls)[0].body).toEqual({
            data: {values: {email_addresses: ["ada@example.com"]}},
        })
    })

    it("skips with no charge when someone filled the email between confirm and run", async () => {
        const {fetch, calls} = fakeFetch([
            on(
                "GET",
                "/people/records/",
                person({email_addresses: [{email_address: "ada@example.com"}]})
            ),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toMatchObject({outcome: "skipped", costUsd: 0})
        expect(paid(calls)).toHaveLength(0)
    })

    it("reports not found when the provider has no field map, and writes nothing", async () => {
        const {fetch, calls} = fakeFetch([
            ...base,
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_2",
                    status: "completed",
                    actualCost: 0,
                    result: {anything: true},
                },
            }),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toEqual({
            outcome: "not_found",
            title: "No work email found",
            text: "Nothing was charged.",
            costUsd: 0,
        })
        expect(writes(calls)).toHaveLength(0)
    })

    it("tells the user to retry when the run is still running after the wait", async () => {
        const {fetch, calls} = fakeFetch([
            ...base,
            on("POST", "/v1/runs", {status: 201, body: {runId: "run_3", status: "running"}}),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome.outcome).toBe("pending")
        expect(outcome.text).toContain("run_3")
        expect(outcome.text).toContain("not charged twice")
        expect(writes(calls)).toHaveLength(0)
    })

    it("keeps the found email in the message when Attio refuses the write", async () => {
        const {fetch} = fakeFetch([
            ...base,
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_4",
                    status: "completed",
                    actualCost: 0.004,
                    normalized: {fields: {email: "ada@example.com"}},
                },
            }),
            on("PATCH", "/people/records/", {
                status: 403,
                body: {message: "Missing scope record_permission:read-write"},
            }),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome.outcome).toBe("error")
        expect(outcome.costUsd).toBe(0.004)
        expect(outcome.text).toBe(
            "looot found ada@example.com. Charged $0.004. Attio said: Missing scope record_permission:read-write"
        )
    })

    it("turns looot errors into an outcome instead of throwing", async () => {
        const {fetch} = fakeFetch([
            ...base,
            on("POST", "/v1/runs", {status: 402, body: {error: {message: "Balance too low."}}}),
        ])
        const outcome = await runLookup("find-work-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toEqual({
            outcome: "error",
            title: "The lookup did not run",
            text: "Balance too low. Nothing was charged. Top up at https://looot.ai",
            costUsd: 0,
        })
    })
})

describe("runLookup: verify email", () => {
    const withEmail = on(
        "GET",
        `/people/records/${PERSON_ID}`,
        person({email_addresses: [{email_address: "ada@example.com"}]})
    )

    it("creates the status attribute before paying, then writes the status", async () => {
        const {fetch, calls} = fakeFetch([
            withEmail,
            on("POST", "/v2/objects/people/attributes", {
                status: 409,
                body: {code: "slug_conflict"},
            }),
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_5",
                    status: "completed",
                    actualCost: 0.00145,
                    normalized: {fields: {status: "valid", deliverable: true}},
                },
            }),
            on("PATCH", "/people/records/", {body: {data: {}}}),
        ])
        const outcome = await runLookup("verify-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toMatchObject({
            outcome: "updated",
            title: "ada@example.com is valid",
            costUsd: 0.00145,
        })
        const order = calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)
        expect(order.indexOf("POST /v2/objects/people/attributes")).toBeLessThan(
            order.indexOf("POST /v1/runs")
        )
        expect(calls.find((call) => call.url.endsWith("/attributes"))?.body).toEqual({
            data: {
                title: "Email status (looot)",
                description: "Result of the last looot email verification for this person.",
                api_slug: "looot_email_status",
                type: "text",
                is_required: false,
                is_unique: false,
                is_multiselect: false,
                config: {},
            },
        })
        expect(paid(calls)[0].body).toMatchObject({
            endpointId: "job:people.email.verify",
            input: {email: "ada@example.com"},
        })
        expect(writes(calls)[0].body).toEqual({data: {values: {looot_email_status: "valid"}}})
    })

    it("does not pay when the attribute cannot be created", async () => {
        const {fetch, calls} = fakeFetch([
            withEmail,
            on("POST", "/v2/objects/people/attributes", {
                status: 403,
                body: {message: "Missing scope object_configuration:read-write"},
            }),
        ])
        const outcome = await runLookup("verify-email", PERSON_ID, depsFor(fetch))
        expect(outcome).toEqual({
            outcome: "error",
            title: "The lookup did not run",
            text: "Missing scope object_configuration:read-write",
            costUsd: 0,
        })
        expect(paid(calls)).toHaveLength(0)
    })

    it("uses the deliverable flag when the provider gives no status text", async () => {
        const {fetch, calls} = fakeFetch([
            withEmail,
            on("POST", "/v2/objects/people/attributes", {body: {data: {}}}),
            on("POST", "/v1/runs", {
                status: 201,
                body: {
                    runId: "run_6",
                    status: "completed",
                    actualCost: 0.002,
                    normalized: {fields: {deliverable: false}},
                },
            }),
            on("PATCH", "/people/records/", {body: {data: {}}}),
        ])
        expect((await runLookup("verify-email", PERSON_ID, depsFor(fetch))).title).toBe(
            "ada@example.com is undeliverable"
        )
        expect(writes(calls)[0].body).toEqual({
            data: {values: {looot_email_status: "undeliverable"}},
        })
    })
})

describe("runLookup: enrich company", () => {
    const attributes = on("POST", "/v2/objects/companies/attributes", {
        status: 409,
        body: {code: "slug_conflict"},
    })
    const completed = (fields: Record<string, unknown>) =>
        on("POST", "/v1/runs", {
            status: 201,
            body: {runId: "run_7", status: "completed", actualCost: 0.0019, normalized: {fields}},
        })

    it("writes industry and size to the two app attributes", async () => {
        const {fetch, calls} = fakeFetch([
            on("GET", `/companies/records/${COMPANY_ID}`, company()),
            attributes,
            completed({industry: "Software", size: "51-200", name: "Example Inc"}),
            on("PATCH", `/companies/records/${COMPANY_ID}`, {body: {data: {}}}),
        ])
        const outcome = await runLookup("enrich-company", COMPANY_ID, depsFor(fetch))
        expect(outcome).toEqual({
            outcome: "updated",
            title: "Company enriched",
            text: "Industry (looot): Software. Company size (looot): 51-200. Charged $0.0019.",
            costUsd: 0.0019,
        })
        expect(calls.filter((call) => call.url.endsWith("/attributes"))).toHaveLength(2)
        expect(paid(calls)[0].body).toMatchObject({
            endpointId: "job:company.enrich",
            input: {domain: "example.com", name: "Example Inc"},
        })
        expect(writes(calls)[0].body).toEqual({
            data: {values: {looot_industry: "Software", looot_company_size: "51-200"}},
        })
    })

    it("fills empty attributes only and never overwrites a value", async () => {
        const {fetch, calls} = fakeFetch([
            on("GET", "/companies/records/", company({looot_industry: [{value: "Fintech"}]})),
            attributes,
            completed({industry: "Software", size: "51-200"}),
            on("PATCH", "/companies/records/", {body: {data: {}}}),
        ])
        await runLookup("enrich-company", COMPANY_ID, depsFor(fetch))
        expect(writes(calls)[0].body).toEqual({data: {values: {looot_company_size: "51-200"}}})
    })

    it("skips before any charge when both attributes are filled", async () => {
        const {fetch, calls} = fakeFetch([
            on(
                "GET",
                "/companies/records/",
                company({
                    looot_industry: [{value: "Fintech"}],
                    looot_company_size: [{value: "11-50"}],
                })
            ),
        ])
        expect(await runLookup("enrich-company", COMPANY_ID, depsFor(fetch))).toMatchObject({
            outcome: "skipped",
            title: "This company is already enriched",
        })
        expect(calls).toHaveLength(1)
    })

    it("reports not found when looot returns neither field", async () => {
        const {fetch, calls} = fakeFetch([
            on("GET", "/companies/records/", company()),
            attributes,
            completed({name: "Example Inc"}),
        ])
        expect(await runLookup("enrich-company", COMPANY_ID, depsFor(fetch))).toMatchObject({
            outcome: "not_found",
            title: "No company data found",
        })
        expect(writes(calls)).toHaveLength(0)
    })

    it("reports an Attio read failure without paying", async () => {
        const {fetch, calls} = fakeFetch([
            on("GET", "/companies/records/", {status: 404, body: {message: "Record not found"}}),
        ])
        expect(await runLookup("enrich-company", COMPANY_ID, depsFor(fetch))).toMatchObject({
            outcome: "error",
            text: "Record not found",
        })
        expect(paid(calls)).toHaveLength(0)
    })
})

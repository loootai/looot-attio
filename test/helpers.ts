import type {FetchLike} from "../src/lib/looot"

export type Call = {url: string; method: string; headers: Record<string, string>; body: unknown}

type Reply = {status?: number; body?: unknown}
type Route = (call: Call) => Reply | undefined

/** A fetch stand-in: records every call and answers from the first route that matches. */
export const fakeFetch = (routes: Route[]): {fetch: FetchLike; calls: Call[]} => {
    const calls: Call[] = []
    const fetch: FetchLike = async (url, init) => {
        const call: Call = {
            url,
            method: init?.method ?? "GET",
            headers: init?.headers ?? {},
            body: init?.body === undefined ? undefined : JSON.parse(init.body),
        }
        calls.push(call)
        for (const route of routes) {
            const reply = route(call)
            if (reply) {
                const status = reply.status ?? 200
                return {ok: status >= 200 && status < 300, status, json: async () => reply.body}
            }
        }
        throw new Error(`unexpected request: ${call.method} ${url}`)
    }
    return {fetch, calls}
}

export const on =
    (method: string, urlPart: string, reply: Reply | ((call: Call) => Reply)): Route =>
    (call) =>
        call.method === method && call.url.includes(urlPart)
            ? typeof reply === "function"
                ? reply(call)
                : reply
            : undefined

export const record = (values: Record<string, unknown[]>) => ({body: {data: {values}}})

export const OVERVIEW = {
    categories: [
        {
            platforms: [
                {
                    jobs: [
                        {id: "people.email.find", cheapestPerCall: 0.004},
                        {id: "people.email.verify", cheapestPerCall: 0.0015},
                    ],
                },
                {jobs: [{id: "company.enrich", cheapestPerCall: 0.002}]},
            ],
        },
    ],
}

export const PERSON_ID = "11111111-1111-4111-8111-111111111111"
export const COMPANY_ID = "22222222-2222-4222-8222-222222222222"
export const NOW = new Date("2026-10-09T10:00:00Z")

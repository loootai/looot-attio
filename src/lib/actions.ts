import type {AttioDeps, AttioRecord, TextAttribute} from "./attio-records"
import {ensureTextAttribute, getRecord, patchRecord, readValue} from "./attio-records"
import type {LoootInput} from "./looot"
import {
    cleanInput,
    formatUsd,
    isPending,
    JOB_ENRICH_COMPANY,
    JOB_FIND_WORK_EMAIL,
    JOB_VERIFY_EMAIL,
    readField,
    runLoootJob,
} from "./looot"
import type {LookupKind, Quote} from "./prices"
import {getQuote} from "./prices"

export const EMAIL_STATUS_ATTRIBUTE: TextAttribute = {
    slug: "looot_email_status",
    title: "Email status (looot)",
    description: "Result of the last looot email verification for this person.",
}
export const INDUSTRY_ATTRIBUTE: TextAttribute = {
    slug: "looot_industry",
    title: "Industry (looot)",
    description: "Industry of the company, filled by looot.",
}
export const COMPANY_SIZE_ATTRIBUTE: TextAttribute = {
    slug: "looot_company_size",
    title: "Company size (looot)",
    description: "Size of the company, filled by looot.",
}

export type ActionDeps = AttioDeps & {
    /** Reads the workspace's looot token. Called only when a lookup is about to run. */
    getLoootToken: () => string
    now?: Date
}

/** What the confirmation shows, or the reason no lookup can run. Nothing is charged to build it. */
export type Prepared =
    {ready: true; subject: string; quote: Quote} | {ready: false; title: string; text: string}

export type Outcome = {
    outcome: "updated" | "not_found" | "pending" | "skipped" | "error"
    title: string
    text: string
    costUsd: number
}

type Plan =
    | {ready: true; subject: string; input: LoootInput; record: AttioRecord}
    | {ready: false; title: string; text: string}

const planFindWorkEmail = async (deps: ActionDeps, recordId: string): Promise<Plan> => {
    const person = await getRecord(deps, "people", recordId)
    if (readValue(person, "email_addresses", "email_address") !== null) {
        return {
            ready: false,
            title: "This person already has an email",
            text: "Nothing was run and nothing was charged.",
        }
    }
    const companyId = readValue(person, "company", "target_record_id")
    const company = companyId === null ? null : await getRecord(deps, "companies", companyId)
    const input = cleanInput({
        first_name: readValue(person, "name", "first_name"),
        last_name: readValue(person, "name", "last_name"),
        name: readValue(person, "name", "full_name"),
        domain: company === null ? null : readValue(company, "domains", "domain"),
        company: company === null ? null : readValue(company, "name", "value"),
        linkedin_url: readValue(person, "linkedin", "value"),
    })
    const hasName = Boolean(input.name) || (Boolean(input.first_name) && Boolean(input.last_name))
    if (!hasName && !input.linkedin_url) {
        return {
            ready: false,
            title: "This person needs a name",
            text: "Add a first and last name or a LinkedIn URL, then run the action again.",
        }
    }
    if (!input.domain && !input.company && !input.linkedin_url) {
        return {
            ready: false,
            title: "This person needs a company",
            text: "Link a company with a domain or a name, or add a LinkedIn URL, then run the action again.",
        }
    }
    const who =
        input.name ??
        ([input.first_name, input.last_name].filter(Boolean).join(" ") || "this person")
    const where = input.domain ?? input.company
    return {ready: true, subject: where ? `${who} at ${where}` : who, input, record: person}
}

const planVerifyEmail = async (deps: ActionDeps, recordId: string): Promise<Plan> => {
    const person = await getRecord(deps, "people", recordId)
    const email = readValue(person, "email_addresses", "email_address")
    if (email === null) {
        return {
            ready: false,
            title: "This person has no email to verify",
            text: 'Run "Find work email" first, or add an email address.',
        }
    }
    return {ready: true, subject: email, input: {email}, record: person}
}

const planEnrichCompany = async (deps: ActionDeps, recordId: string): Promise<Plan> => {
    const company = await getRecord(deps, "companies", recordId)
    if (
        readValue(company, INDUSTRY_ATTRIBUTE.slug, "value") !== null &&
        readValue(company, COMPANY_SIZE_ATTRIBUTE.slug, "value") !== null
    ) {
        return {
            ready: false,
            title: "This company is already enriched",
            text: "Industry and company size are filled. Nothing was run and nothing was charged.",
        }
    }
    const input = cleanInput({
        domain: readValue(company, "domains", "domain"),
        name: readValue(company, "name", "value"),
    })
    if (!input.domain && !input.name) {
        return {
            ready: false,
            title: "This company needs a domain or a name",
            text: "Add one of them, then run the action again.",
        }
    }
    return {ready: true, subject: input.domain ?? input.name, input, record: company}
}

const PLANNERS: Record<LookupKind, (deps: ActionDeps, recordId: string) => Promise<Plan>> = {
    "enrich-company": planEnrichCompany,
    "find-work-email": planFindWorkEmail,
    "verify-email": planVerifyEmail,
}

/** Reads the record and the price so the user can confirm. Calls no paid endpoint. */
export const prepareLookup = async (
    kind: LookupKind,
    recordId: string,
    deps: ActionDeps
): Promise<Prepared> => {
    const plan = await PLANNERS[kind](deps, recordId)
    if (!plan.ready) return plan
    return {ready: true, subject: plan.subject, quote: await getQuote(kind, deps.fetch)}
}

const spent = (costUsd: number): string =>
    costUsd > 0 ? `Charged ${formatUsd(costUsd)}.` : "Nothing was charged."

const pendingOutcome = (runId: string): Outcome => ({
    outcome: "pending",
    title: "looot is still working on it",
    text: `Run ${runId} did not finish in 20 seconds. Run the action again in a minute: the same lookup on the same day reuses this run and is not charged twice.`,
    costUsd: 0,
})

const runFindWorkEmail = async (
    deps: ActionDeps,
    recordId: string,
    input: LoootInput
): Promise<Outcome> => {
    const run = await runLoootJob(JOB_FIND_WORK_EMAIL, input, {
        fetch: deps.fetch,
        token: deps.getLoootToken(),
        now: deps.now,
    })
    if (isPending(run)) return pendingOutcome(run.runId)
    const costUsd = run.actualCost ?? 0
    const email = readField(run, "email")
    if (email === null) {
        return {
            outcome: "not_found",
            title: "No work email found",
            text: spent(costUsd),
            costUsd,
        }
    }
    try {
        await patchRecord(deps, "people", recordId, {email_addresses: [email]})
    } catch (error) {
        return {
            outcome: "error",
            title: "Found an email but Attio refused the write",
            text: `looot found ${email}. ${spent(costUsd)} Attio said: ${error instanceof Error ? error.message : "unknown error"}`,
            costUsd,
        }
    }
    return {outcome: "updated", title: `Added ${email}`, text: spent(costUsd), costUsd}
}

const runVerifyEmail = async (
    deps: ActionDeps,
    recordId: string,
    input: LoootInput
): Promise<Outcome> => {
    await ensureTextAttribute(deps, "people", EMAIL_STATUS_ATTRIBUTE)
    const run = await runLoootJob(JOB_VERIFY_EMAIL, input, {
        fetch: deps.fetch,
        token: deps.getLoootToken(),
        now: deps.now,
    })
    if (isPending(run)) return pendingOutcome(run.runId)
    const costUsd = run.actualCost ?? 0
    const deliverable = run.normalized?.fields?.deliverable
    const status =
        readField(run, "status") ??
        (typeof deliverable === "boolean" ? (deliverable ? "deliverable" : "undeliverable") : null)
    if (status === null) {
        return {
            outcome: "not_found",
            title: "No verification result",
            text: `The provider that answered returned no status looot could read. ${spent(costUsd)}`,
            costUsd,
        }
    }
    try {
        await patchRecord(deps, "people", recordId, {[EMAIL_STATUS_ATTRIBUTE.slug]: status})
    } catch (error) {
        return {
            outcome: "error",
            title: "Verified but Attio refused the write",
            text: `${input.email} is ${status}. ${spent(costUsd)} Attio said: ${error instanceof Error ? error.message : "unknown error"}`,
            costUsd,
        }
    }
    return {
        outcome: "updated",
        title: `${input.email} is ${status}`,
        text: `Saved to "${EMAIL_STATUS_ATTRIBUTE.title}". ${spent(costUsd)}`,
        costUsd,
    }
}

const runEnrichCompany = async (
    deps: ActionDeps,
    recordId: string,
    input: LoootInput,
    company: AttioRecord
): Promise<Outcome> => {
    await ensureTextAttribute(deps, "companies", INDUSTRY_ATTRIBUTE)
    await ensureTextAttribute(deps, "companies", COMPANY_SIZE_ATTRIBUTE)
    const run = await runLoootJob(JOB_ENRICH_COMPANY, input, {
        fetch: deps.fetch,
        token: deps.getLoootToken(),
        now: deps.now,
    })
    if (isPending(run)) return pendingOutcome(run.runId)
    const costUsd = run.actualCost ?? 0
    const found: Array<[TextAttribute, string | null]> = [
        [INDUSTRY_ATTRIBUTE, readField(run, "industry")],
        [COMPANY_SIZE_ATTRIBUTE, readField(run, "size")],
    ]
    if (found.every(([, value]) => value === null)) {
        return {
            outcome: "not_found",
            title: "No company data found",
            text: spent(costUsd),
            costUsd,
        }
    }
    // Fill empty attributes only. A value someone typed is never overwritten.
    const values: Record<string, string> = {}
    for (const [attribute, value] of found) {
        if (value !== null && readValue(company, attribute.slug, "value") === null) {
            values[attribute.slug] = value
        }
    }
    const summary = found
        .filter(([attribute]) => attribute.slug in values)
        .map(([attribute, value]) => `${attribute.title}: ${value}`)
        .join(". ")
    if (summary === "") {
        return {
            outcome: "skipped",
            title: "Nothing new to write",
            text: `looot only returned values for attributes that are already filled. ${spent(costUsd)}`,
            costUsd,
        }
    }
    try {
        await patchRecord(deps, "companies", recordId, values)
    } catch (error) {
        return {
            outcome: "error",
            title: "Enriched but Attio refused the write",
            text: `${summary}. ${spent(costUsd)} Attio said: ${error instanceof Error ? error.message : "unknown error"}`,
            costUsd,
        }
    }
    return {
        outcome: "updated",
        title: "Company enriched",
        text: `${summary}. ${spent(costUsd)}`,
        costUsd,
    }
}

/**
 * Runs one lookup on one record and writes the result to its attributes. The record is read
 * again first, so a lookup that is no longer needed is skipped before any charge. Never throws:
 * every failure comes back as an outcome the client can show.
 */
export const runLookup = async (
    kind: LookupKind,
    recordId: string,
    deps: ActionDeps
): Promise<Outcome> => {
    try {
        const plan = await PLANNERS[kind](deps, recordId)
        if (!plan.ready) return {outcome: "skipped", title: plan.title, text: plan.text, costUsd: 0}
        if (kind === "find-work-email") return await runFindWorkEmail(deps, recordId, plan.input)
        if (kind === "verify-email") return await runVerifyEmail(deps, recordId, plan.input)
        return await runEnrichCompany(deps, recordId, plan.input, plan.record)
    } catch (error) {
        return {
            outcome: "error",
            title: "The lookup did not run",
            text: error instanceof Error ? error.message : "Unknown error",
            costUsd: 0,
        }
    }
}

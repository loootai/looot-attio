import {ATTIO_API_TOKEN, getWorkspaceConnection} from "attio/server"
import type {Outcome} from "../lib/actions"
import {runLookup} from "../lib/actions"
import type {LookupKind} from "../lib/prices"

/**
 * Runs one looot lookup for one record and writes the result to the record. The looot token is
 * the workspace connection secret: it stays on the server and is never logged or returned.
 */
export default async function runLookupOnServer(
    kind: LookupKind,
    recordId: string
): Promise<Outcome> {
    const connection = getWorkspaceConnection()
    return runLookup(kind, recordId, {
        fetch,
        attioToken: ATTIO_API_TOKEN,
        getLoootToken: () => connection.value,
    })
}

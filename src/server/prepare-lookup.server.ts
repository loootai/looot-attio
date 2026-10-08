import {ATTIO_API_TOKEN, getWorkspaceConnection} from "attio/server"
import type {Prepared} from "../lib/actions"
import {prepareLookup} from "../lib/actions"
import type {LookupKind} from "../lib/prices"

/**
 * Reads the record and the current looot price so the client can ask for a confirmation.
 * Calls no paid endpoint. Reading the connection first makes Attio prompt an admin to add the
 * looot token when the workspace has none yet.
 */
export default async function prepareLookupOnServer(
    kind: LookupKind,
    recordId: string
): Promise<Prepared> {
    const connection = getWorkspaceConnection()
    return prepareLookup(kind, recordId, {
        fetch,
        attioToken: ATTIO_API_TOKEN,
        getLoootToken: () => connection.value,
    })
}

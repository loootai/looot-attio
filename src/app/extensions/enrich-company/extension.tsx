import {confirm, Extensions, showToast} from "attio/client"
import {triggerRecordAction} from "../../../lib/record-action"
import prepareLookupOnServer from "../../../server/prepare-lookup.server"
import runLookupOnServer from "../../../server/run-lookup.server"

export default Extensions.defineExtension({
    type: "record-action",
    id: "enrich-company",
    label: "Enrich company with looot",
    icon: "Company",
    objects: "companies",
    onTrigger: async ({recordId}) => {
        await triggerRecordAction("enrich-company", recordId, {
            prepare: prepareLookupOnServer,
            run: runLookupOnServer,
            confirm,
            showToast,
        })
    },
})

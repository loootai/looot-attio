import {confirm, Extensions, showToast} from "attio/client"
import {triggerRecordAction} from "../../../lib/record-action"
import prepareLookupOnServer from "../../../server/prepare-lookup.server"
import runLookupOnServer from "../../../server/run-lookup.server"

export default Extensions.defineExtension({
    type: "record-action",
    id: "find-work-email",
    label: "Find work email",
    icon: "EmailPlus",
    objects: "people",
    onTrigger: async ({recordId}) => {
        await triggerRecordAction("find-work-email", recordId, {
            prepare: prepareLookupOnServer,
            run: runLookupOnServer,
            confirm,
            showToast,
        })
    },
})

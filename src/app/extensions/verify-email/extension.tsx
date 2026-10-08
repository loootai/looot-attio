import {confirm, Extensions, showToast} from "attio/client"
import {triggerRecordAction} from "../../../lib/record-action"
import prepareLookupOnServer from "../../../server/prepare-lookup.server"
import runLookupOnServer from "../../../server/run-lookup.server"

export default Extensions.defineExtension({
    type: "record-action",
    id: "verify-email",
    label: "Verify email",
    icon: "CheckCircle",
    objects: "people",
    onTrigger: async ({recordId}) => {
        await triggerRecordAction("verify-email", recordId, {
            prepare: prepareLookupOnServer,
            run: runLookupOnServer,
            confirm,
            showToast,
        })
    },
})

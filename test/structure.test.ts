import {readdirSync, readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

const root = join(__dirname, "..")
const extensionsDir = join(root, "src/app/extensions")

const walk = (dir: string): string[] =>
    readdirSync(dir, {withFileTypes: true}).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    )

describe("Attio discovery rules (docs.attio.com/sdk/extensions/overview)", () => {
    const folders = readdirSync(extensionsDir)

    it("has the three record actions", () => {
        expect(folders.sort()).toEqual(["enrich-company", "find-work-email", "verify-email"])
    })

    it.each(folders)("%s default-exports defineExtension with literal id and type", (folder) => {
        const source = readFileSync(join(extensionsDir, folder, "extension.tsx"), "utf8")
        expect(source).toMatch(/export default Extensions\.defineExtension\(\{/)
        expect(source).toContain('type: "record-action"')
        expect(source).toContain(`id: "${folder}"`)
        expect(folder).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
        expect(source).toMatch(
            folder === "enrich-company" ? /objects: "companies"/ : /objects: "people"/
        )
    })
})

describe("secrets and network stay on the server", () => {
    const sources = walk(join(root, "src")).filter((file) => /\.tsx?$/.test(file))

    it("only .server.ts files import attio/server", () => {
        const offenders = sources.filter(
            (file) =>
                readFileSync(file, "utf8").includes('"attio/server"') &&
                !file.endsWith(".server.ts")
        )
        expect(offenders).toEqual([])
    })

    it("no source file logs to the console, so no token or email reaches the logs", () => {
        const offenders = sources.filter((file) =>
            /console\.(log|info|warn|error)/.test(readFileSync(file, "utf8"))
        )
        expect(offenders).toEqual([])
    })

    it("every server function file default-exports an async function", () => {
        const servers = sources.filter((file) => file.endsWith(".server.ts"))
        expect(servers).toHaveLength(2)
        for (const file of servers)
            expect(readFileSync(file, "utf8")).toMatch(/export default async function/)
    })
})

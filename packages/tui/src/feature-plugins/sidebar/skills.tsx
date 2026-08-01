import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createResource, createSignal, For, Show } from "solid-js"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "node:path"
import { access, mkdir, writeFile } from "node:fs/promises"

const id = "internal:sidebar-skills"

export function sanitizeSkillName(input: string) {
  const name = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) ? name : undefined
}

export function skillDirNameFromUrl(url: string) {
  try {
    const parsed = new URL(url.trim())
    const name = parsed.pathname.replace(/\.git$/i, "").replace(/\/+$/, "").split("/").pop()
    return name ? sanitizeSkillName(name) : undefined
  } catch {
    return undefined
  }
}

export function skillTemplate(name: string) {
  return [
    "---",
    `name: ${name}`,
    "description: Describe when to use this skill.",
    "---",
    "",
    "Instructions for the model. Edit this file to define the skill.",
    "",
  ].join("\n")
}

function projectDir(api: TuiPluginApi) {
  return api.state.path.directory || api.state.path.worktree || process.cwd()
}

async function openCodeDirs(api: TuiPluginApi) {
  const { worktree, directory } = api.state.path
  const dirs: string[] = []
  let current = directory || worktree || process.cwd()
  for (;;) {
    const dir = path.join(current, ".opencode")
    try {
      await access(dir)
      dirs.push(dir)
    } catch {}
    if (!worktree || current === worktree) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

async function scanProjectSkills(api: TuiPluginApi) {
  const found: string[] = []
  for (const dir of await openCodeDirs(api)) {
    const matches = await Glob.scan("{skill,skills}/**/SKILL.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })
    for (const match of matches) found.push(path.basename(path.dirname(match)))
  }
  return Array.from(new Set(found)).toSorted()
}

function prompt(api: TuiPluginApi, title: string, placeholder?: string) {
  return new Promise<string | null>((resolve) => {
    api.ui.dialog.replace(
      () =>
        api.ui.DialogPrompt({
          title,
          placeholder,
          onConfirm: (value) => resolve(value),
          onCancel: () => resolve(null),
        }),
      () => resolve(null),
    )
  })
}

async function createSkill(api: TuiPluginApi, name: string) {
  return createSkillAt(projectDir(api), name)
}

export async function createSkillAt(root: string, name: string) {
  const file = path.join(root, ".opencode", "skills", name, "SKILL.md")
  if (await Bun.file(file).exists()) return `Skill "${name}" already exists`
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, skillTemplate(name))
  return undefined
}

async function cloneSkill(api: TuiPluginApi, url: string) {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({ title: "Cloning...", busy: true, busyText: `Cloning ${url}` }),
  )
  const error = await cloneSkillAt(projectDir(api), url)
  if (!error) return undefined
  api.ui.dialog.replace(() => api.ui.DialogPrompt({ title: "Cloning failed", value: error }))
  return error
}

export async function cloneSkillAt(root: string, url: string) {
  const name = skillDirNameFromUrl(url)
  if (!name) return "Could not parse a repo name from that URL"
  const dir = path.join(root, ".opencode", "skills", name)
  if (await Bun.file(path.join(dir, "SKILL.md")).exists()) return `Skill "${name}" already exists`

  const proc = await Bun.spawn(["git", "clone", "--depth", "1", url, dir], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text()
    return `git clone failed: ${stderr.trim().split("\n").at(-1) || "unknown error"}`
  }
  return undefined
}

function toast(api: TuiPluginApi, variant: "success" | "error" | "warning", message: string) {
  api.ui.toast({ variant, message })
}

async function fromName(api: TuiPluginApi, refresh: () => void) {
  const input = await prompt(api, "New skill", "skill-name")
  if (!input) return
  const name = sanitizeSkillName(input)
  if (!name) {
    toast(api, "error", `"${input}" is not a valid skill name. Use letters, numbers and dashes.`)
    return
  }
  const error = await createSkill(api, name)
  api.ui.dialog.clear()
  if (error) {
    toast(api, "error", error)
    return
  }
  toast(api, "success", `Created skill "${name}"`)
  refresh()
}

async function fromGithub(api: TuiPluginApi, refresh: () => void) {
  const url = await prompt(api, "GitHub repo URL", "https://github.com/owner/repo")
  if (!url) return
  const error = await cloneSkill(api, url.trim())
  api.ui.dialog.clear()
  if (error) {
    toast(api, "error", error)
    return
  }
  toast(api, "success", `Cloned skills from ${url.trim()}`)
  refresh()
}

function showAddSkill(api: TuiPluginApi, refresh: () => void) {
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect({
      title: "Add skill",
      options: [
        {
          title: "New skill",
          category: "Create",
          description: "Create a skill from a name",
          value: "new",
          onSelect: () => {
            void fromName(api, refresh)
          },
        },
        {
          title: "From GitHub",
          category: "Clone",
          description: "Clone a skills repo from a GitHub URL",
          value: "github",
          onSelect: () => {
            void fromGithub(api, refresh)
          },
        },
      ],
    }),
  )
}

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const [skills, { refetch }] = createResource(() => scanProjectSkills(props.api))

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text} onMouseDown={() => setOpen((x) => !x)}>
          <b>Skills</b>
        </text>
        <text fg={theme().text} onMouseDown={() => showAddSkill(props.api, refetch)}>
          <b>(+)</b>
        </text>
      </box>
      <Show when={open()}>
        <For each={skills() ?? []}>
          {(name) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme().text}>•</text>
              <text fg={theme().text}>{name}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
  api.keymap.registerLayer({
    commands: [
      {
        name: "skills.add",
        title: "Add skill",
        category: "Skills",
        namespace: "palette",
        run() {
          showAddSkill(api, () => {})
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("skills.palette", ["skills.add"]),
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

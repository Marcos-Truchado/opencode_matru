import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  cloneSkillAt,
  createSkillAt,
  sanitizeSkillName,
  skillDirNameFromUrl,
  skillTemplate,
} from "../../src/feature-plugins/sidebar/skills"

describe("skill add helpers", () => {
  test("sanitizeSkillName normalizes valid names and rejects invalid ones", () => {
    expect(sanitizeSkillName("My Cool Skill!")).toBe("my-cool-skill")
    expect(sanitizeSkillName("  foo  ")).toBe("foo")
    expect(sanitizeSkillName("foo_bar")).toBe("foo-bar")
    expect(sanitizeSkillName("")).toBeUndefined()
    expect(sanitizeSkillName("!!!")).toBeUndefined()
    expect(sanitizeSkillName("-")).toBeUndefined()
  })

  test("skillDirNameFromUrl extracts a valid repo name", () => {
    expect(skillDirNameFromUrl("https://github.com/obra/superpowers")).toBe("superpowers")
    expect(skillDirNameFromUrl("https://github.com/obra/superpowers.git")).toBe("superpowers")
    expect(skillDirNameFromUrl("https://github.com/obra/superpowers/")).toBe("superpowers")
    expect(skillDirNameFromUrl("https://github.com/My-Org/Awesome-Skills.git")).toBe("awesome-skills")
    expect(skillDirNameFromUrl("")).toBeUndefined()
    expect(skillDirNameFromUrl("https://")).toBeUndefined()
  })

  test("skillTemplate emits frontmatter with the skill name", () => {
    const template = skillTemplate("foo")
    expect(template).toContain("---")
    expect(template).toContain("name: foo")
  })

  test("createSkillAt writes a SKILL.md and refuses duplicates", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skills-test-"))
    const error = await createSkillAt(root, "mi-skill")
    expect(error).toBeUndefined()
    const file = path.join(root, ".opencode", "skills", "mi-skill", "SKILL.md")
    const content = await readFile(file, "utf8")
    expect(content).toContain("name: mi-skill")
    expect(await createSkillAt(root, "mi-skill")).toContain("already exists")
  })

  test("cloneSkillAt clones a git repo with skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skills-test-"))
    const repo = path.join(root, "repo")
    await mkdir(path.join(repo, "skills", "demo-skill"), { recursive: true })
    await writeFile(path.join(repo, "skills", "demo-skill", "SKILL.md"), skillTemplate("demo-skill"))
    await Bun.$`git init -q -b main ${repo}`
    await Bun.$`git -C ${repo} add -A && git -C ${repo} -c user.email=test@test -c user.name=test commit -q -m init`
    await writeFile(path.join(repo, "skills", "demo-skill", "SKILL.md"), "uncommitted-change")

    const error = await cloneSkillAt(root, `file://${repo}`)
    expect(error).toBeUndefined()
    const cloned = path.join(root, ".opencode", "skills", "repo", "skills", "demo-skill", "SKILL.md")
    const content = await readFile(cloned, "utf8")
    expect(content).toContain("name: demo-skill")
    expect(content).not.toContain("uncommitted-change")
    expect(await cloneSkillAt(root, `file://${repo}`)).toContain("already exists")
  })
})

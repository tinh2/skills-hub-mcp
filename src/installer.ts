import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  atomicWriteSkillFiles,
  buildSkillMarkdown,
  readLocalFile,
  validateSlug,
  writeSkillFiles,
  type SkillFileEntry,
} from "@skills-hub-ai/skill-installer";
import {
  fetchSkillFile,
  fetchSkillFileManifest,
  getSkillDetail,
  recordInstall,
  type SkillDetailResult,
} from "./api.js";
import { skillPageUrl } from "./urls.js";

const LEARNINGS_PATTERN = /^LEARNINGS(\.md)?$/i;

function getSkillsDir(target: "claude-code" | "cursor"): string {
  const home = homedir();
  return target === "cursor"
    ? join(home, ".cursor", "skills")
    : join(home, ".claude", "skills");
}

function getCommandsDir(target: "claude-code" | "cursor"): string {
  const home = homedir();
  return target === "cursor"
    ? join(home, ".cursor", "skills")
    : join(home, ".claude", "commands");
}

/**
 * Build the slash command body for claude-code. The format differs from
 * SKILL.md: no `---` delimiters, just frontmatter style fields followed
 * by the body. Kept inline here because it is claude-code specific and
 * not part of the shared installer API.
 */
function buildClaudeCommandContent(skill: {
  name: string;
  description: string;
  latestVersion: string;
  category: { slug: string };
  instructions: string;
}): string {
  return [
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.latestVersion}`,
    `category: ${skill.category.slug}`,
    "",
    skill.instructions,
    "",
  ].join("\n");
}

export interface InstallResult {
  slug: string;
  version: string;
  path: string;
  /** Public page for the installed skill on skills-hub.ai. */
  url: string;
  dependencies: string[];
  /** Pages for each installed dependency, in the same order as `dependencies`. */
  dependencyUrls: string[];
}

/**
 * Write a skill's file tree to `skillDir`.
 *
 * Prefers the multi-file manifest when available (fetches every file and
 * writes atomically). Falls back to a single generated SKILL.md for older
 * skills that pre-date multi-file ingest. Preserves any existing LEARNINGS.md
 * in both paths — it is user state, not part of the published skill.
 */
async function writeSkillTree(
  skill: SkillDetailResult,
  skillDir: string,
): Promise<void> {
  const manifest = await fetchSkillFileManifest(
    skill.slug,
    skill.latestVersion,
  );

  if (manifest && manifest.length > 0) {
    const learnings = readLocalFile(skillDir, "LEARNINGS.md");

    const files: SkillFileEntry[] = await Promise.all(
      manifest
        .filter((entry) => !LEARNINGS_PATTERN.test(entry.relativePath))
        .map(async (entry) => ({
          relativePath: entry.relativePath,
          content: await fetchSkillFile(
            skill.slug,
            skill.latestVersion,
            entry.relativePath,
          ),
        })),
    );

    if (learnings !== null) {
      files.push({ relativePath: "LEARNINGS.md", content: learnings });
    }

    atomicWriteSkillFiles(skillDir, files);
  } else {
    const skillMd = buildSkillMarkdown(
      {
        name: skill.name,
        description: skill.description,
        version: skill.latestVersion,
        category: skill.category.slug,
      },
      skill.instructions,
    );
    writeSkillFiles(skillDir, [{ relativePath: "SKILL.md", content: skillMd }]);
  }
}

/** Install a single skill from the API to the local skills directory */
export async function installSkill(
  slug: string,
  target: "claude-code" | "cursor" = "claude-code",
): Promise<InstallResult> {
  validateSlug(slug);
  const skill = await getSkillDetail(slug);
  const skillDir = join(getSkillsDir(target), slug);

  await writeSkillTree(skill, skillDir);

  // Register as slash command (Claude Code reads from ~/.claude/commands/)
  if (target === "claude-code") {
    const commandsDir = getCommandsDir(target);
    writeSkillFiles(commandsDir, [
      {
        relativePath: `${slug}.md`,
        content: buildClaudeCommandContent(skill),
      },
    ]);
  }

  // Install composition dependencies
  const deps: string[] = [];
  if (skill.composition?.children.length) {
    await installDependencies(skill, target, deps);
  }

  // Record the install so it counts toward installCount and shows up as an MCP
  // install in analytics. Best-effort — never blocks a successful local write.
  await recordInstall(slug, target);

  return {
    slug,
    version: skill.latestVersion,
    path: skillDir,
    url: skillPageUrl(slug),
    dependencies: deps,
    dependencyUrls: deps.map(skillPageUrl),
  };
}

/** BFS install of composition children (max depth 5) */
async function installDependencies(
  skill: SkillDetailResult,
  target: "claude-code" | "cursor",
  installed: string[],
  visited = new Set<string>(),
  depth = 0,
): Promise<void> {
  if (depth > 5 || !skill.composition?.children.length) return;

  const skillsDir = getSkillsDir(target);

  for (const child of skill.composition.children) {
    const childSlug = child.skill.slug;
    if (visited.has(childSlug)) continue;
    visited.add(childSlug);

    try {
      validateSlug(childSlug);
    } catch {
      continue;
    }

    // Skip if already installed locally
    if (existsSync(join(skillsDir, childSlug, "SKILL.md"))) continue;

    try {
      const childDetail = await getSkillDetail(childSlug);
      const childDir = join(skillsDir, childSlug);

      await writeSkillTree(childDetail, childDir);

      // Register child as slash command too
      if (target === "claude-code") {
        const commandsDir = getCommandsDir(target);
        writeSkillFiles(commandsDir, [
          {
            relativePath: `${childSlug}.md`,
            content: buildClaudeCommandContent(childDetail),
          },
        ]);
      }

      installed.push(childSlug);

      // Recurse if this child is also a composition
      await installDependencies(
        childDetail,
        target,
        installed,
        visited,
        depth + 1,
      );
    } catch {
      // Skip failed children, don't block the parent install
    }
  }
}

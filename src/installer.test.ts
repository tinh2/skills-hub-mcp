import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { installSkill } from "./installer.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("./api.js", () => ({
  getSkillDetail: vi.fn(),
  recordInstall: vi.fn(),
  fetchSkillFileManifest: vi.fn(),
  fetchSkillFile: vi.fn(),
}));

import {
  getSkillDetail,
  recordInstall,
  fetchSkillFileManifest,
  fetchSkillFile,
} from "./api.js";

const mockGetSkillDetail = vi.mocked(getSkillDetail);
const mockRecordInstall = vi.mocked(recordInstall);
const mockFetchSkillFileManifest = vi.mocked(fetchSkillFileManifest);
vi.mocked(fetchSkillFile);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

const baseSkill = {
  slug: "review-code",
  name: "Review Code",
  description: "AI code review",
  instructions: "Review all code changes carefully.",
  qualityScore: 92,
  installCount: 150,
  avgRating: 4.8,
  latestVersion: "1.2.0",
  category: { name: "Review", slug: "review" },
  platforms: ["CLAUDE_CODE"],
  tags: ["review"],
  isComposition: false,
  composition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  // Default: no multi-file manifest, fall back to single SKILL.md path
  mockFetchSkillFileManifest.mockResolvedValue(null);
});

describe("installSkill", () => {
  it("installs a simple skill", async () => {
    mockGetSkillDetail.mockResolvedValue(baseSkill);

    const result = await installSkill("review-code");

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("review-code"),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("SKILL.md"),
      expect.stringContaining("name: Review Code"),
    );
    expect(result.slug).toBe("review-code");
    expect(result.version).toBe("1.2.0");
    expect(result.dependencies).toEqual([]);
    // Records the install so it counts toward installCount + MCP analytics.
    expect(mockRecordInstall).toHaveBeenCalledWith(
      "review-code",
      "claude-code",
    );
  });

  it("writes SKILL.md and command file", async () => {
    mockGetSkillDetail.mockResolvedValue(baseSkill);

    await installSkill("review-code");

    // SKILL.md (with frontmatter fences) + command .md (without fences)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);

    const skillContent = mockWriteFileSync.mock.calls[0][1] as string;
    expect(skillContent).toContain("---");
    expect(skillContent).toContain("name: Review Code");
    expect(skillContent).toContain("Review all code changes carefully.");

    const commandPath = mockWriteFileSync.mock.calls[1][0] as string;
    const commandContent = mockWriteFileSync.mock.calls[1][1] as string;
    expect(commandPath).toContain("commands/review-code.md");
    expect(commandContent).not.toContain("---");
    expect(commandContent).toContain("name: Review Code");
    expect(commandContent).toContain("Review all code changes carefully.");
  });

  it("installs to cursor directory without command file", async () => {
    mockGetSkillDetail.mockResolvedValue(baseSkill);

    const result = await installSkill("review-code", "cursor");

    expect(result.path).toContain(".cursor");
    expect(result.path).toContain("skills");
    // Cursor only writes SKILL.md, no command file
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it("installs composition dependencies", async () => {
    const parentSkill = {
      ...baseSkill,
      slug: "full-review",
      name: "Full Review",
      isComposition: true,
      composition: {
        children: [
          {
            skill: { slug: "lint-check", name: "Lint Check", qualityScore: 85 },
            sortOrder: 0,
            isParallel: false,
          },
          {
            skill: {
              slug: "test-coverage",
              name: "Test Coverage",
              qualityScore: 80,
            },
            sortOrder: 1,
            isParallel: false,
          },
        ],
      },
    };

    const childSkill1 = {
      ...baseSkill,
      slug: "lint-check",
      name: "Lint Check",
      instructions: "Run lint",
    };
    const childSkill2 = {
      ...baseSkill,
      slug: "test-coverage",
      name: "Test Coverage",
      instructions: "Check coverage",
    };

    mockGetSkillDetail
      .mockResolvedValueOnce(parentSkill)
      .mockResolvedValueOnce(childSkill1)
      .mockResolvedValueOnce(childSkill2);

    const result = await installSkill("full-review");

    expect(result.dependencies).toEqual(["lint-check", "test-coverage"]);
    // Parent + 2 children = 3 SKILL.md + 3 command files = 6 writes
    expect(mockWriteFileSync).toHaveBeenCalledTimes(6);
  });

  it("skips already-installed children", async () => {
    const parentSkill = {
      ...baseSkill,
      slug: "full-review",
      isComposition: true,
      composition: {
        children: [
          {
            skill: { slug: "lint-check", name: "Lint Check", qualityScore: 85 },
            sortOrder: 0,
            isParallel: false,
          },
        ],
      },
    };

    mockGetSkillDetail.mockResolvedValueOnce(parentSkill);

    // lint-check already exists
    mockExistsSync.mockReturnValue(true);

    const result = await installSkill("full-review");

    // Only parent installed (SKILL.md + command), child skipped
    expect(result.dependencies).toEqual([]);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });

  it("continues if a child fails", async () => {
    const parentSkill = {
      ...baseSkill,
      slug: "full-review",
      isComposition: true,
      composition: {
        children: [
          {
            skill: { slug: "broken-skill", name: "Broken", qualityScore: null },
            sortOrder: 0,
            isParallel: false,
          },
          {
            skill: { slug: "good-skill", name: "Good", qualityScore: 90 },
            sortOrder: 1,
            isParallel: false,
          },
        ],
      },
    };

    const goodSkill = {
      ...baseSkill,
      slug: "good-skill",
      name: "Good",
      instructions: "Do good",
    };

    mockGetSkillDetail
      .mockResolvedValueOnce(parentSkill)
      .mockRejectedValueOnce(new Error("Not found"))
      .mockResolvedValueOnce(goodSkill);

    const result = await installSkill("full-review");

    // broken-skill failed but good-skill still installed
    expect(result.dependencies).toEqual(["good-skill"]);
  });
});

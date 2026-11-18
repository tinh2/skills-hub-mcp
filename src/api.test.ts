import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSkills, getSkillDetail } from "./api.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth header", () => {
  it("omits Authorization header when SKILLS_HUB_API_TOKEN is not set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await searchSkills("test");

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(
      (opts.headers as Record<string, string>)["Authorization"],
    ).toBeUndefined();
  });

  it("omits Authorization header on getSkillDetail when token not set", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ slug: "test" }),
    });

    await getSkillDetail("test-skill");

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(
      (opts.headers as Record<string, string>)["Authorization"],
    ).toBeUndefined();
  });
});

describe("searchSkills", () => {
  it("calls search API with query", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              slug: "review-code",
              name: "Review Code",
              description: "AI code review",
              qualityScore: 92,
              installCount: 150,
              avgRating: 4.8,
              latestVersion: "1.0.0",
              category: { name: "Review", slug: "review" },
              isComposition: false,
              tags: ["review"],
            },
          ],
        }),
    });

    const results = await searchSkills("code review");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/search?"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("q=code+review"),
      expect.anything(),
    );
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("review-code");
  });

  it("passes category filter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await searchSkills("test", "build");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("category=build"),
      expect.anything(),
    );
  });

  it("passes limit", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await searchSkills("test", undefined, 5);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=5"),
      expect.anything(),
    );
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(searchSkills("fail")).rejects.toThrow("Search failed: 500");
  });

  it("returns empty array when no data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const results = await searchSkills("nothing");
    expect(results).toEqual([]);
  });

  it("passes org query parameter when provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await searchSkills("testing", undefined, 10, "my-org");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("org=my-org"),
      expect.anything(),
    );
  });

  it("omits org query parameter when not provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await searchSkills("testing");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("org=");
  });
});

describe("getSkillDetail", () => {
  it("fetches skill by slug", async () => {
    const mockSkill = {
      slug: "review-code",
      name: "Review Code",
      description: "AI code review",
      instructions: "Review the code",
      qualityScore: 92,
      installCount: 150,
      avgRating: 4.8,
      latestVersion: "1.0.0",
      category: { name: "Review", slug: "review" },
      platforms: ["CLAUDE_CODE"],
      tags: ["review"],
      isComposition: false,
      composition: null,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSkill),
    });

    const result = await getSkillDetail("review-code");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/skills/review-code"),
      expect.anything(),
    );
    expect(result.slug).toBe("review-code");
    expect(result.instructions).toBe("Review the code");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(getSkillDetail("nonexistent")).rejects.toThrow(
      "Skill not found: nonexistent",
    );
  });

  it("URL-encodes the slug", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ slug: "my-skill" }),
    });

    await getSkillDetail("my-skill");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/skills/my-skill"),
      expect.anything(),
    );
  });
});

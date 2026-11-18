import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSkill } from "@skills-hub-ai/skill-parser";

vi.mock("./discover.js", () => ({
  discoverSkills: vi.fn(),
}));

vi.mock("./api.js", () => ({
  searchSkills: vi.fn(),
  getSkillDetail: vi.fn(),
}));

vi.mock("./installer.js", () => ({
  installSkill: vi.fn(),
}));

// Mock the MCP SDK — we test the handler logic, not the transport
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  const handlers = new Map<string, (req: unknown) => Promise<unknown>>();
  return {
    Server: vi.fn().mockImplementation(function () {
      return {
        setRequestHandler: vi.fn(
          function (
            schema: { method: string },
            handler: (req: unknown) => Promise<unknown>,
          ) {
            handlers.set(schema.method, handler);
          },
        ),
        connect: vi.fn(),
        _handlers: handlers,
      };
    }),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListPromptsRequestSchema: { method: "prompts/list" },
  GetPromptRequestSchema: { method: "prompts/get" },
  ListToolsRequestSchema: { method: "tools/list" },
  CallToolRequestSchema: { method: "tools/call" },
  ErrorCode: {
    InvalidRequest: -32600,
    InvalidParams: -32602,
    MethodNotFound: -32601,
    InternalError: -32603,
  },
  McpError: class McpError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { discoverSkills } from "./discover.js";
import { searchSkills, getSkillDetail } from "./api.js";
import { installSkill } from "./installer.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const mockDiscoverSkills = vi.mocked(discoverSkills);
const mockSearchSkills = vi.mocked(searchSkills);
const mockGetSkillDetail = vi.mocked(getSkillDetail);
const mockInstallSkill = vi.mocked(installSkill);

function makeSkill(
  name: string,
  description: string,
  instructions: string,
): ParsedSkill {
  return {
    name,
    description,
    version: "1.0.0",
    category: undefined,
    platforms: [],
    permissions: [],
    instructions,
    raw: "",
  };
}

let handlers: Map<string, (req: unknown) => Promise<unknown>>;

beforeEach(async () => {
  vi.clearAllMocks();

  // Re-import to trigger module-level server creation
  vi.resetModules();

  // Re-mock after resetModules
  vi.doMock("./discover.js", () => ({
    discoverSkills: mockDiscoverSkills,
  }));

  vi.doMock("./api.js", () => ({
    searchSkills: mockSearchSkills,
    getSkillDetail: mockGetSkillDetail,
  }));

  vi.doMock("./installer.js", () => ({
    installSkill: mockInstallSkill,
  }));

  vi.doMock("@modelcontextprotocol/sdk/server/index.js", () => {
    const h = new Map<string, (req: unknown) => Promise<unknown>>();
    handlers = h;
    return {
      Server: vi.fn().mockImplementation(function () {
        return {
          setRequestHandler: vi.fn(
            function (
              schema: { method: string },
              handler: (req: unknown) => Promise<unknown>,
            ) {
              h.set(schema.method, handler);
            },
          ),
          connect: vi.fn(),
        };
      }),
    };
  });

  vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: vi.fn().mockImplementation(function () { return {}; }),
  }));

  vi.doMock("@modelcontextprotocol/sdk/types.js", () => ({
    ListPromptsRequestSchema: { method: "prompts/list" },
    GetPromptRequestSchema: { method: "prompts/get" },
    ListToolsRequestSchema: { method: "tools/list" },
    CallToolRequestSchema: { method: "tools/call" },
    ErrorCode: {
      InvalidRequest: -32600,
      InvalidParams: -32602,
      MethodNotFound: -32601,
      InternalError: -32603,
    },
    McpError: class McpError extends Error {
      code: number;
      constructor(code: number, message: string) {
        super(message);
        this.code = code;
      }
    },
  }));

  // Suppress console.error from main()
  vi.spyOn(console, "error").mockImplementation(() => {});

  await import("./index.js");
});

describe("MCP server", () => {
  it("registers prompts/list and prompts/get handlers", () => {
    expect(handlers.has("prompts/list")).toBe(true);
    expect(handlers.has("prompts/get")).toBe(true);
  });

  it("listPrompts returns discovered skills", async () => {
    const skills = new Map<string, ParsedSkill>();
    skills.set(
      "code-review",
      makeSkill("Code Review", "Review code quality", "Review carefully"),
    );
    skills.set(
      "security-scan",
      makeSkill("Security Scan", "Find vulnerabilities", "Check OWASP"),
    );
    mockDiscoverSkills.mockReturnValue(skills);

    const handler = handlers.get("prompts/list")!;
    const result = (await handler({})) as {
      prompts: Array<{ name: string; description: string }>;
    };

    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0].name).toBe("code-review");
    expect(result.prompts[0].description).toBe("Review code quality");
    expect(result.prompts[1].name).toBe("security-scan");
  });

  it("listPrompts returns empty array when no skills installed", async () => {
    mockDiscoverSkills.mockReturnValue(new Map());

    const handler = handlers.get("prompts/list")!;
    const result = (await handler({})) as { prompts: unknown[] };

    expect(result.prompts).toEqual([]);
  });

  it("getPrompt returns skill instructions", async () => {
    const skills = new Map<string, ParsedSkill>();
    skills.set(
      "code-review",
      makeSkill("Code Review", "Review code quality", "Review carefully"),
    );
    mockDiscoverSkills.mockReturnValue(skills);

    const handler = handlers.get("prompts/get")!;
    const result = (await handler({
      params: { name: "code-review", arguments: {} },
    })) as {
      description: string;
      messages: Array<{
        role: string;
        content: { type: string; text: string };
      }>;
    };

    expect(result.description).toBe("Review code quality");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content.text).toBe("Review carefully");
  });

  it("getPrompt appends input argument to instructions", async () => {
    const skills = new Map<string, ParsedSkill>();
    skills.set(
      "code-review",
      makeSkill("Code Review", "Review code quality", "Review carefully"),
    );
    mockDiscoverSkills.mockReturnValue(skills);

    const handler = handlers.get("prompts/get")!;
    const result = (await handler({
      params: {
        name: "code-review",
        arguments: { input: "Focus on error handling" },
      },
    })) as { messages: Array<{ content: { text: string } }> };

    expect(result.messages[0].content.text).toBe(
      "Review carefully\n\nFocus on error handling",
    );
  });

  it("getPrompt throws McpError for unknown skill", async () => {
    mockDiscoverSkills.mockReturnValue(new Map());

    const handler = handlers.get("prompts/get")!;

    await expect(
      handler({ params: { name: "nonexistent", arguments: {} } }),
    ).rejects.toThrow("Unknown skill: nonexistent");
  });

  it("registers tools/list and tools/call handlers", () => {
    expect(handlers.has("tools/list")).toBe(true);
    expect(handlers.has("tools/call")).toBe(true);
  });

  it("listTools returns all four tools", async () => {
    const handler = handlers.get("tools/list")!;
    const result = (await handler({})) as { tools: Array<{ name: string }> };

    const names = result.tools.map((t) => t.name);
    expect(names).toContain("search_skills");
    expect(names).toContain("get_skill_detail");
    expect(names).toContain("install_skill");
    expect(names).toContain("list_installed_skills");
    expect(result.tools).toHaveLength(4);
  });

  it("search_skills tool calls API and returns results", async () => {
    mockSearchSkills.mockResolvedValue([
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
    ]);

    const handler = handlers.get("tools/call")!;
    const result = (await handler({
      params: { name: "search_skills", arguments: { query: "code review" } },
    })) as { content: Array<{ text: string }> };

    expect(mockSearchSkills).toHaveBeenCalledWith(
      "code review",
      undefined,
      10,
      undefined,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe("review-code");
  });

  it("search_skills passes organization parameter to searchSkills", async () => {
    mockSearchSkills.mockResolvedValue([]);

    const handler = handlers.get("tools/call")!;
    await handler({
      params: {
        name: "search_skills",
        arguments: { query: "deploy", organization: "my-org" },
      },
    });

    expect(mockSearchSkills).toHaveBeenCalledWith(
      "deploy",
      undefined,
      10,
      "my-org",
    );
  });

  it("search_skills throws when query is missing", async () => {
    const handler = handlers.get("tools/call")!;

    await expect(
      handler({ params: { name: "search_skills", arguments: {} } }),
    ).rejects.toThrow("query is required");
  });

  it("get_skill_detail tool returns skill info", async () => {
    mockGetSkillDetail.mockResolvedValue({
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
    });

    const handler = handlers.get("tools/call")!;
    const result = (await handler({
      params: { name: "get_skill_detail", arguments: { slug: "review-code" } },
    })) as { content: Array<{ text: string }> };

    expect(mockGetSkillDetail).toHaveBeenCalledWith("review-code");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slug).toBe("review-code");
    expect(parsed.instructionsPreview).toContain("Review all code");
  });

  it("install_skill tool calls installer and returns result", async () => {
    mockInstallSkill.mockResolvedValue({
      slug: "review-code",
      version: "1.2.0",
      path: "/home/.claude/skills/review-code",
      dependencies: [],
    });

    const handler = handlers.get("tools/call")!;
    const result = (await handler({
      params: { name: "install_skill", arguments: { slug: "review-code" } },
    })) as { content: Array<{ text: string }> };

    expect(mockInstallSkill).toHaveBeenCalledWith("review-code", "claude-code");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.slug).toBe("review-code");
    expect(parsed.version).toBe("1.2.0");
  });

  it("list_installed_skills returns discovered skills", async () => {
    const skills = new Map<string, ParsedSkill>();
    skills.set(
      "code-review",
      makeSkill("Code Review", "Review code quality", "Review carefully"),
    );
    mockDiscoverSkills.mockReturnValue(skills);

    const handler = handlers.get("tools/call")!;
    const result = (await handler({
      params: { name: "list_installed_skills", arguments: {} },
    })) as { content: Array<{ text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe("code-review");
    expect(parsed[0].name).toBe("Code Review");
  });

  it("callTool throws for unknown tool", async () => {
    const handler = handlers.get("tools/call")!;

    await expect(
      handler({ params: { name: "nonexistent_tool", arguments: {} } }),
    ).rejects.toThrow("Unknown tool: nonexistent_tool");
  });
});

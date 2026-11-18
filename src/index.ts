#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { discoverSkills } from "./discover.js";
import { searchSkills, getSkillDetail } from "./api.js";
import { installSkill } from "./installer.js";
import { skillPageUrl } from "./urls.js";

const server = new Server(
  { name: "skills-hub", version: "0.1.0" },
  { capabilities: { prompts: { listChanged: true }, tools: {} } },
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const skills = discoverSkills();

  return {
    prompts: Array.from(skills.entries()).map(([slug, skill]) => ({
      name: slug,
      description: skill.description,
      arguments: [
        {
          name: "input",
          description: "Context or instructions for the skill",
          required: false,
        },
      ],
    })),
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const skills = discoverSkills();
  const skill = skills.get(name);

  if (!skill) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Unknown skill: ${name}. Run "skills-hub install ${name}" to install it.`,
    );
  }

  let text = skill.instructions;
  if (args?.input) {
    text += `\n\n${args.input}`;
  }

  return {
    description: skill.description,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
});

/* ------------------------------------------------------------------ */
/*  Tools — catalog search, skill detail, install, list installed       */
/* ------------------------------------------------------------------ */

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_skills",
      description:
        "Search the skills-hub.ai catalog for skills matching a query. Supports org-scoped search to include organization-private skills (requires SKILLS_HUB_API_TOKEN). Each result includes a `url` to the skill's page on skills-hub.ai; show that link to the user alongside each skill you mention.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'code review', 'testing React')",
          },
          category: {
            type: "string",
            description:
              "Filter by category slug (e.g. 'review', 'test', 'build')",
          },
          limit: { type: "number", description: "Max results (default 10)" },
          organization: {
            type: "string",
            description:
              "Organization slug to include org-private skills in results (requires authentication)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_skill_detail",
      description:
        "Get full details about a skill including instructions, composition children, and metadata. The result includes a `url` to the skill's page on skills-hub.ai; show that link to the user.",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: {
            type: "string",
            description: "Skill slug (e.g. 'review-code')",
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "install_skill",
      description:
        "Install a skill from skills-hub.ai to the local skills directory",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: { type: "string", description: "Skill slug to install" },
          target: {
            type: "string",
            enum: ["claude-code", "cursor"],
            description: "Install target (default: claude-code)",
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "list_installed_skills",
      description: "List all locally installed skills",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_skills": {
        const query = args?.query as string;
        if (!query)
          throw new McpError(ErrorCode.InvalidParams, "query is required");
        const limit = Math.min(Math.max((args?.limit as number) || 10, 1), 100);
        const results = await searchSkills(
          query,
          args?.category as string | undefined,
          limit,
          args?.organization as string | undefined,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                results.map((s) => ({
                  slug: s.slug,
                  name: s.name,
                  url: skillPageUrl(s.slug),
                  description: s.description,
                  qualityScore: s.qualityScore,
                  installCount: s.installCount,
                  avgRating: s.avgRating,
                  category: s.category.name,
                  isComposition: s.isComposition,
                  tags: s.tags,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_skill_detail": {
        const slug = args?.slug as string;
        if (!slug)
          throw new McpError(ErrorCode.InvalidParams, "slug is required");
        const detail = await getSkillDetail(slug);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  slug: detail.slug,
                  name: detail.name,
                  url: skillPageUrl(detail.slug),
                  description: detail.description,
                  qualityScore: detail.qualityScore,
                  installCount: detail.installCount,
                  avgRating: detail.avgRating,
                  latestVersion: detail.latestVersion,
                  category: detail.category,
                  platforms: detail.platforms,
                  tags: detail.tags,
                  isComposition: detail.isComposition,
                  composition: detail.composition,
                  instructionsPreview:
                    detail.instructions?.slice(0, 500) +
                    (detail.instructions?.length > 500 ? "..." : ""),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "install_skill": {
        const slug = args?.slug as string;
        if (!slug)
          throw new McpError(ErrorCode.InvalidParams, "slug is required");
        const target =
          (args?.target as "claude-code" | "cursor") || "claude-code";
        const result = await installSkill(slug, target);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_installed_skills": {
        const skills = discoverSkills();
        const list = Array.from(skills.entries()).map(([slug, skill]) => ({
          slug,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          category: skill.category || null,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(list, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new McpError(ErrorCode.InternalError, message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP JSON-RPC stream
  console.error("skills-hub MCP server running");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

const API_URL = process.env.SKILLS_HUB_API_URL || "https://api.skills-hub.ai";
const API_TOKEN = process.env.SKILLS_HUB_API_TOKEN || "";
const TIMEOUT_MS = 30_000;

function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (API_TOKEN) {
    headers["Authorization"] = `ApiKey ${API_TOKEN}`;
  }
  return fetch(url, { ...init, signal: controller.signal, headers }).finally(
    () => clearTimeout(timer),
  );
}

export interface SkillSearchResult {
  slug: string;
  name: string;
  description: string;
  qualityScore: number | null;
  installCount: number;
  avgRating: number | null;
  latestVersion: string;
  category: { name: string; slug: string };
  isComposition: boolean;
  tags: string[];
}

export interface SkillDetailResult {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  qualityScore: number | null;
  installCount: number;
  avgRating: number | null;
  latestVersion: string;
  category: { name: string; slug: string };
  platforms: string[];
  tags: string[];
  isComposition: boolean;
  composition: {
    children: Array<{
      skill: { slug: string; name: string; qualityScore: number | null };
      sortOrder: number;
      isParallel: boolean;
    }>;
  } | null;
}

export async function searchSkills(
  query: string,
  category?: string,
  limit = 10,
  org?: string,
): Promise<SkillSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    sort: "relevance",
  });
  if (category) params.set("category", category);
  if (org) params.set("org", org);

  const res = await fetchWithTimeout(`${API_URL}/api/v1/search?${params}`);
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { data?: SkillSearchResult[] };
  return data.data || [];
}

export async function getSkillDetail(slug: string): Promise<SkillDetailResult> {
  const res = await fetchWithTimeout(
    `${API_URL}/api/v1/skills/${encodeURIComponent(slug)}`,
  );
  if (!res.ok) {
    throw new Error(`Skill not found: ${slug} (${res.status})`);
  }

  return (await res.json()) as SkillDetailResult;
}

export interface SkillFileManifestEntry {
  relativePath: string;
  bytes: number;
  lines: number;
  sha256: string;
}

/**
 * Fetch the full file manifest for a skill version. Returns null when the
 * version has no file tree (skills synced before multi-file ingest). Callers
 * should fall back to the `instructions` field in that case.
 */
export async function fetchSkillFileManifest(
  slug: string,
  version: string,
): Promise<SkillFileManifestEntry[] | null> {
  const res = await fetchWithTimeout(
    `${API_URL}/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/files`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { files: SkillFileManifestEntry[] };
  return data.files;
}

/**
 * Fetch the content of a single file from a skill version. The relativePath
 * must match exactly what the manifest returned.
 */
export async function fetchSkillFile(
  slug: string,
  version: string,
  relativePath: string,
): Promise<string> {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  const res = await fetchWithTimeout(
    `${API_URL}/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/files/${encoded}`,
  );
  if (!res.ok) {
    throw new Error(
      `File fetch failed: ${relativePath} (${res.status} ${res.statusText})`,
    );
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}

/**
 * Record a completed install so it counts toward the skill's installCount and
 * shows up as an MCP install in analytics. Best-effort: a tracking failure must
 * never break an install that already wrote files locally, so this swallows all
 * errors. Anonymous (no API token) installs are deduped server-side by IP.
 */
export async function recordInstall(
  slug: string,
  target: "claude-code" | "cursor",
): Promise<void> {
  const platform = target === "cursor" ? "CURSOR" : "CLAUDE_CODE";
  try {
    await fetchWithTimeout(
      `${API_URL}/api/v1/skills/${encodeURIComponent(slug)}/install`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      },
    );
  } catch {
    // Swallow — install already succeeded locally; tracking is best-effort.
  }
}

const DEFAULT_WEB_URL = "https://skills-hub.ai";

/** Base URL of the skills-hub.ai website. Override with SKILLS_HUB_WEB_URL. */
export function webBaseUrl(): string {
  return (process.env.SKILLS_HUB_WEB_URL || DEFAULT_WEB_URL).replace(/\/+$/, "");
}

/** Public page for a skill on skills-hub.ai, e.g. https://skills-hub.ai/skills/review-code */
export function skillPageUrl(slug: string): string {
  return `${webBaseUrl()}/skills/${encodeURIComponent(slug)}`;
}

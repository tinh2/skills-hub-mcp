import { describe, it, expect, afterEach } from "vitest";
import { skillPageUrl, webBaseUrl } from "./urls.js";

const original = process.env.SKILLS_HUB_WEB_URL;

afterEach(() => {
  if (original === undefined) delete process.env.SKILLS_HUB_WEB_URL;
  else process.env.SKILLS_HUB_WEB_URL = original;
});

describe("skillPageUrl", () => {
  it("defaults to https://skills-hub.ai/skills/<slug>", () => {
    delete process.env.SKILLS_HUB_WEB_URL;
    expect(webBaseUrl()).toBe("https://skills-hub.ai");
    expect(skillPageUrl("review-code")).toBe(
      "https://skills-hub.ai/skills/review-code",
    );
  });

  it("URL-encodes the slug", () => {
    delete process.env.SKILLS_HUB_WEB_URL;
    expect(skillPageUrl("a b/c?d")).toBe(
      "https://skills-hub.ai/skills/a%20b%2Fc%3Fd",
    );
  });

  it("honors SKILLS_HUB_WEB_URL and strips trailing slashes", () => {
    process.env.SKILLS_HUB_WEB_URL = "http://localhost:3000/";
    expect(skillPageUrl("x")).toBe("http://localhost:3000/skills/x");
  });
});

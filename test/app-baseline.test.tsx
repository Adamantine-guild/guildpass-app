import { describe, expect, it } from "vitest";

import HomePage from "../app/page";

describe("GuildPass App V2 baseline", () => {
  it("renders the GuildPass home page", () => {
    const page = HomePage();

    expect(page.type).toBe("main");
    expect(page.props.children).toBeDefined();
  });
});
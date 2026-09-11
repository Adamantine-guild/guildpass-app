import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GuildsListState from "../components/GuildsListState";
import IntegrationsListState from "../components/IntegrationsListState";

describe("Guilds page list states", () => {
  test("renders the loading skeleton", () => {
    const html = renderToStaticMarkup(
      createElement(GuildsListState, {
        status: "loading",
        isEmpty: false,
        canWrite: true,
      })
    );

    assert.match(html, /aria-label="Loading guilds"/);
    assert.match(html, /animate-pulse/);
  });

  test("renders the shared error state", () => {
    const html = renderToStaticMarkup(
      createElement(GuildsListState, {
        status: "error",
        isEmpty: false,
        canWrite: true,
      })
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Unable to load guilds/);
  });

  test("renders the guild-specific empty state", () => {
    const html = renderToStaticMarkup(
      createElement(GuildsListState, {
        status: "loaded",
        isEmpty: true,
        canWrite: true,
      })
    );

    assert.match(html, /No guilds yet/);
    assert.match(html, /Create your first guild/);
  });
});

describe("Integrations page list states", () => {
  test("renders the loading skeleton", () => {
    const html = renderToStaticMarkup(
      createElement(IntegrationsListState, {
        status: "loading",
      })
    );

    assert.match(html, /aria-label="Loading integrations"/);
    assert.match(html, /animate-pulse/);
  });

  test("renders the shared error state", () => {
    const html = renderToStaticMarkup(
      createElement(IntegrationsListState, {
        status: "error",
      })
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /Unable to load integrations/);
  });

  test("renders the integration-specific empty state", () => {
    const html = renderToStaticMarkup(
      createElement(IntegrationsListState, {
        status: "loaded",
        isEmpty: true,
      })
    );

    assert.match(html, /No integrations configured/);
    assert.match(html, /available for this workspace/);
  });
});

// @ts-check
const config = {
  title: "GuildPass Integrations",
  url: "https://example.com",
  baseUrl: "/",
  // favicon: "img/favicon.ico", // commented out because we don't have this file yet
  organizationName: "GuildPass",
  projectName: "guildpass-integrations",
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      {
        docs: { sidebarPath: require.resolve("./sidebars.js") },
        theme: { customCss: require.resolve("./src/css/custom.css") }
      }
    ]
  ],
  themeConfig: {
    navbar: {
      title: "GuildPass Integrations",
      items: [{ type: "doc", docId: "overview", position: "left", label: "Docs" }, { href: "https://github.com/guildpass", label: "GitHub", position: "right" }]
    },
    footer: { style: "dark", copyright: `© ${new Date().getFullYear()} GuildPass` }
  }
};
module.exports = config;

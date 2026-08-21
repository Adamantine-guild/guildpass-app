# Architecture

The internal workspace dependencies of the `GuildPass` monorepo are visualized below. 
There are no circular dependencies.

```mermaid
graph TD
    %% Apps
    accessAPI["@guildpass/access-api"]
    dashboard["@guildpass/dashboard"]
    discordBot["@guildpass/discord-bot"]
    docs["@guildpass/docs"]

    %% Packages
    contracts["@guildpass/contracts"]
    env["@guildpass/env"]
    integrationClient["@guildpass/integration-client"]
    metrics["@guildpass/metrics"]
    webhookUtils["@guildpass/webhook-utils"]

    %% Dependencies
    accessAPI --> contracts
    dashboard --> integrationClient
    dashboard --> webhookUtils
    dashboard --> metrics
    dashboard --> env
    
    %% Note: discord-bot links via a relative file path but effectively depends on it
    discordBot -.-> integrationClient
```

## Known Discrepancies
- `@guildpass/discord-bot` specifies its dependency on `@guildpass/integration-client` using a `file:../../packages/integration-client` resolution rather than `workspace:*`. This is intentional or legacy, but effectively functions as an internal dependency.

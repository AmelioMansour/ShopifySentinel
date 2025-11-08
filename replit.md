# Shopify Zero Price Scanner Discord Bot

## Overview
A Discord bot designed to scan Shopify stores for products priced at $0.00. It supports scanning individual stores or batch processing multiple stores. The bot aims to provide users with tools to quickly identify, access, and add zero-price products to their cart, while also offering administrative oversight through logging and database integration. The business vision is to provide a valuable tool for users looking to capitalize on pricing errors or promotional offers on Shopify stores.

## User Preferences
I prefer detailed explanations and clear communication. I want the agent to use iterative development and ask before making major changes. The agent should prioritize robust error handling and efficient resource usage, especially concerning external APIs and proxy management. Do not make changes to the folder `Z` and do not make changes to the file `Y`.

## System Architecture

### UI/UX Decisions
- Discord embeds are used for presenting scan results, including store name, product details, pagination controls, and bulk add-to-cart options.
- Real-time progress bars are implemented for batch scans to provide live updates.
- Interactive navigation (Previous/Next buttons) is provided for paginating through products within a store and for navigating between stores in batch scan results.
- A summarized table view is sent to an admin channel for easy oversight of all scans.
- Results are delivered via Direct Message (DM) to the user for privacy and clarity.

### Technical Implementations
- **Core Logic:** The bot fetches product data from `https://[store-domain]/products.json?limit=250&page=[N]`, filtering for `price === "0.00"` and `available === true`.
- **Add-to-Cart Links:** Generates direct add-to-cart URLs in the format `https://[store-domain]/cart/[variantId]:1`.
- **Bulk Add-to-Cart:** Supports adding multiple products to the cart via a single URL, with automatic URL splitting to bypass length limits.
- **Headless Shopify Detection:** Automatically attempts `shop.` subdomain if the primary domain scan fails.
- **Rate Limiting & Performance:** Uses a rolling concurrent queue with 10 workers - when any store finishes, the next one immediately starts (no batch waiting). Direct connections (proxies disabled for speed). Each request has an 8-second timeout with 1 retry on failure. Limits scanning to 5000 products per store (20 pages) to prevent massive stores from blocking progress. **Parallel pagination** - fetches all 20 pages simultaneously instead of sequentially, reducing large store scan times from 40s to 2-4s. Progress updates throttled to max 1 per second to avoid Discord rate limits.
- **Background Scanning:** New system for scanning massive store lists (600k+ stores). Reads store URLs from `server/stores.txt` and processes them in the background. Triggered manually via `/startscan` command in admin channel only. Can be stopped gracefully with `/stopscan` command. Sends progress updates to admin channel every 1000 stores. Tracks all stats in `background_scans` database table. Memory-efficient streaming design saves only stores with free products.
- **Discord Interaction Handling:** Uses deferred replies to handle long-running scan operations, extending the response window beyond the default 3 seconds.
- **Error Handling:** Comprehensive error handling for invalid URLs, network issues, non-Shopify sites, and API failures. Error messages now accurately reflect whether proxies are enabled or disabled.
- **Role-Based Permissions:** Commands require a specific Discord role (ID: 1434562069893746698).
- **Admin Channel Logging:** All scan results are summarized and sent to a designated admin channel (ID: 1434557891318124798).

### System Design Choices
- **Backend:** Node.js with TypeScript, Express for server, and Discord.js for bot interactions.
- **Database:** PostgreSQL with Drizzle ORM for storing scan results. The `scan_results` table stores unique store URLs, free product counts, and scan metadata, with an upsert mechanism to update existing records. Only scans finding free products are saved. The `background_scans` table tracks long-running background scan jobs with progress stats.
- **Modular Design:** Separation of concerns with dedicated modules for Discord interactions (`bot.ts`, `discord-client.ts`), Shopify scanning logic (`shopify-scanner.ts`), background scanning (`background-scanner.ts`), and database operations (`storage.ts`, `db.ts`).
- **Proxy System:** Proxies are disabled by default for maximum speed and reliability. PyProxy proxies available in `server/proxies.txt` and IPRoyal in `server/proxies-iproyal.txt` if rate limiting becomes an issue. Can be re-enabled by setting `proxyEnabled = true` in shopify-scanner.ts.

## External Dependencies
- **Discord API:** Used for bot interactions, command registration, message sending, and user authentication via Replit's Discord connector.
- **PostgreSQL:** Database for storing scan history and results.
- **PyProxy:** A third-party proxy service used for rotating residential proxies, activated only when Shopify rate limits are encountered. Proxies are loaded from a local `server/proxies.txt` file.
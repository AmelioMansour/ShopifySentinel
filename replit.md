# Shopify Zero Price Scanner Discord Bot

## Overview
A Discord bot that scans Shopify stores to identify products priced at $0.00. Users can scan individual stores or batch multiple stores using slash commands. Features include headless Shopify detection, pagination, add-to-cart links, and bulk cart functionality.

## Features
- `/scan` - Scan a single Shopify store for zero-price products with pagination
- `/scanbatch` - Scan multiple Shopify stores at once (text file upload, max 25 URLs)
- **Role-Based Permissions** - Commands require specific Discord role (ID: 1434562069893746698)
- **Admin Channel Logging** - All scan results are sent to admin channel (ID: 1434557891318124798)
- **Real-Time Progress Bar** - Live updates showing scan progress during batch operations
- **Headless Shopify Auto-Detection** - Automatically tries `shop.` subdomain for headless stores
- **Add-to-Cart Links** - Direct links to add products to cart instead of product pages
- **Pagination** - Navigate through results with Previous/Next buttons (5 products per page)
- **Bulk Add-to-Cart** - Get links to add all zero-price products at once with URL splitting
- **Out-of-Stock Filtering** - Only shows in-stock zero-price products
- Beautiful Discord embeds showing scan results
- Support for both myshopify.com domains and custom domains
- Error handling for invalid URLs and failed scans

## Architecture

### Backend (`server/`)
- **bot.ts** - Discord bot initialization, command registration, and interaction handlers
- **discord-client.ts** - Discord authentication using Replit connector
- **shopify-scanner.ts** - Core scanning logic to fetch and parse /products.json
- **storage.ts** - Database interface for saving and retrieving scan results
- **db.ts** - PostgreSQL database connection using Drizzle ORM
- **index.ts** - Express server and bot startup

### Database (`shared/schema.ts`)
- **scan_results** table - Stores scan history (only scans with free products)
  - `id` - Auto-incrementing primary key
  - `storeUrl` - The Shopify store URL scanned
  - `storeName` - Store name extracted from scan
  - `freeProductCount` - Number of free products found (in stock)
  - `totalProductsScanned` - Total products scanned in the store
  - `discordUsername` - Discord username who initiated the scan
  - `scannedAt` - Timestamp of when the scan was performed
  - **Note**: Only scans with at least 1 free product are saved to the database

### Data Flow
1. User invokes slash command in Discord
2. Bot handler receives interaction
3. Scanner fetches /products.json from Shopify store
4. Parser filters for variants with price = "0.00"
5. Results formatted as Discord embeds and sent to user's DM
6. If free products found: Scan results saved to PostgreSQL database
7. If free products found: Summarized table view sent to admin channel

### Discord Integration
- Uses Replit Discord connector for authentication
- Bot token managed via OAuth connection
- Slash commands registered globally

## Usage

### Commands
```
/scan url:https://store-name.myshopify.com
/scanbatch file:[upload .txt file with one URL per line, max 25 URLs]
```

**Example batch file format (stores.txt):**
```
store1.myshopify.com
store2.myshopify.com
shop.hatch.co
```

**When to use each command:**
- `/scan` - Quick single store check
- `/scanbatch` - Batch scan of 1-25 stores

**Permission Requirements:**
- Users must have the required Discord role (ID: 1434562069893746698) to use any bot commands
- Commands can only be used in Discord servers (not DMs)
- Permission check is performed before any scan operation begins

**Results Delivery:**
- All scan results are sent via **Direct Message (DM)** to the user
- An ephemeral confirmation appears in the channel when you run a command
- Batch scans show real-time progress updates in your DMs
- If you have DMs disabled, you'll receive an error message asking you to enable them

### Example Scan Result

**Single Store Scan (`/scan`):**
The bot sends a paginated embed to your DMs showing:
- Store name
- Number of in-stock zero-price products found
- Total products scanned
- Product details (title, add-to-cart link)
- Page navigation buttons (Previous/Next)
- Bulk add-to-cart button for all products
- Timestamp of scan

**Batch Scan (`/scanbatch`):**
The bot sends progress updates and results to your DMs with interactive dual-level navigation:
- Real-time progress bar showing current store being scanned
- Overall scan statistics (total stores, success/failed counts, total products found)
- **Store Navigation**: Browse between different stores using Previous/Next Store buttons
- **Product Navigation**: Scroll through products within a store using Previous/Next Products buttons (shown when store has >5 products)
- Each product shows with a green 🟢 **FREE** indicator
- Bulk add-to-cart button for each store
- Footer showing store position and product range (e.g., "Store 2/5 • Products 6-10 of 18")

**Admin Channel Summary:**
All scan results are automatically sent to the admin channel (ID: 1434557891318124798) in a summarized table format:
```
📊 Scan Summary - Initiated by @username

Store                                      Free  Total
────────────────────────────────────────────────────────
example-store.myshopify.com                  12    450
another-shop.com                              5    230
────────────────────────────────────────────────────────
TOTAL                                        17    680

✅ 2 store(s) scanned | 17 free products found
```
- Shows store names, free product counts, and total products scanned
- Includes user attribution
- All scans are saved to the database for historical tracking

### Headless Shopify Detection
For stores like hatch.co that use headless Shopify:
1. Try scanning the main domain first
2. If 404, automatically try `shop.` subdomain
3. Example: `hatch.co` → auto-tries `shop.hatch.co`
4. Works seamlessly without user intervention

## Technical Details

### Shopify API
- Endpoint: `https://[store-domain]/products.json?limit=250&page=[N]`
- No authentication required (public endpoint)
- Pagination: Fetches up to 250 products per page, continues until all products scanned
- Returns all products with variants and pricing
- Filters variants where `price === "0.00"` AND `available === true`
- Add-to-cart URL format: `https://[store-domain]/cart/[variantId]:1`
- Bulk cart URL format: `https://[store-domain]/cart/[variantId1]:1,[variantId2]:1,...`

### URL Splitting
- Discord and browsers have URL length limits (~2000 chars)
- Bot automatically splits bulk cart URLs into multiple links
- Each link contains as many products as possible
- User gets numbered links (Link 1, Link 2, etc.)
- Response messages are also split to avoid Discord's 2000 character message limit
- Multiple follow-up messages are sent when needed to deliver all links

### Error Handling
- Invalid URLs
- Network failures
- Non-Shopify websites
- Deactivated/temporarily unavailable Shopify stores
- Headless Shopify auto-detection fallback
- Invalid file uploads (non-text files)
- File URL limit validation (max 25 URLs)
- Rate limiting (future enhancement)

## Development
The bot starts automatically when the server runs. It registers slash commands on startup and listens for interactions.

## Deployment

### Prerequisites
Before deploying, you need to configure your Discord bot token as a deployment secret.

### Step 1: Add Discord Bot Token to Deployment Secrets
1. Navigate to the **Deployments** pane in your Replit workspace
2. Click on the **Configuration** tab
3. Scroll to the **Secrets** section
4. Click **Add Secret**
5. Add the following secret:
   - **Name:** `DISCORD_BOT_TOKEN`
   - **Value:** Your Discord bot token (from the Discord Developer Portal)

### Step 2: Deploy
1. Click the **Deploy** button in the Deployments pane
2. The server will start on port 5000 (configured automatically)
3. Check deployment logs - you should see:
   - `✅ Bot logged in as [YOUR BOT NAME]`
   - `✅ Bot is running and listening for commands`

### Graceful Degradation
The application is designed to handle missing configuration gracefully:
- If `DISCORD_BOT_TOKEN` is not set, the server will still start successfully
- You'll see warning messages in the logs indicating the bot couldn't start
- This allows you to deploy the Express server even if you're not ready to configure the Discord bot yet

### Troubleshooting
**Bot not responding to commands:**
- Verify `DISCORD_BOT_TOKEN` is set correctly in deployment secrets
- Check deployment logs for connection errors
- Ensure your bot has proper permissions in your Discord server

**Deployment fails:**
- Check that the application is binding to `0.0.0.0:5000` (already configured)
- Review deployment logs for specific error messages

## Recent Updates (November 2, 2025)
- ✅ **Database Integration** - All scan results now saved to PostgreSQL database for historical tracking
- ✅ **Admin Summary View** - Admin channel receives summarized table view showing all stores scanned
- ✅ **Changed to DM delivery** - all scan results now sent via Direct Message instead of in-channel
- ✅ Added role-based permissions - users must have specific role (ID: 1434562069893746698) to use commands
- ✅ Implemented admin channel logging - all scan results sent to channel (ID: 1434557891318124798)
- ✅ Removed `/scansuperbulk` command - simplified to just `/scan` and `/scanbatch`
- ✅ Added graceful error handling for missing bot token during deployment
- ✅ Implemented headless Shopify auto-detection (shop. subdomain)
- ✅ Changed to add-to-cart links instead of product page links
- ✅ Added pagination with Previous/Next buttons
- ✅ Implemented out-of-stock filtering
- ✅ Added bulk add-to-cart functionality with URL splitting
- ✅ Fixed product scanning pagination - now scans entire store catalogs (250 products per page)
- ✅ Updated `/scanbatch` to accept text file uploads (one URL per line, max 25 URLs)
- ✅ Added real-time progress bar for batch scans showing current store and percentage complete
- ✅ Implemented interactive store navigation for batch results with Previous/Next buttons to browse stores
- ✅ Optimized batch scanning with 10 parallel stores for better performance
- ✅ Reduced progress update frequency to minimize Discord API calls and improve reliability
- ✅ Fixed bulk cart link response message splitting to handle Discord's 2000 character limit

## Future Enhancements
- Historical tracking of price changes
- Scheduled automated scans
- Filtering by product type/vendor
- Email notifications for new zero-price items

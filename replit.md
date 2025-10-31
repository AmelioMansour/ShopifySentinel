# Shopify Zero Price Scanner Discord Bot

## Overview
A Discord bot that scans Shopify stores to identify products priced at $0.00. Users can scan individual stores or batch multiple stores using slash commands. Features include headless Shopify detection, pagination, add-to-cart links, and bulk cart functionality.

## Features
- `/scan` - Scan a single Shopify store for zero-price products with pagination
- `/scanbatch` - Scan multiple Shopify stores at once (comma-separated URLs)
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
- **index.ts** - Express server and bot startup

### Data Flow
1. User invokes slash command in Discord
2. Bot handler receives interaction
3. Scanner fetches /products.json from Shopify store
4. Parser filters for variants with price = "0.00"
5. Results formatted as Discord embeds
6. Response sent to user

### Discord Integration
- Uses Replit Discord connector for authentication
- Bot token managed via OAuth connection
- Slash commands registered globally

## Usage

### Commands
```
/scan url:https://store-name.myshopify.com
/scanbatch urls:store1.myshopify.com, store2.myshopify.com, store3.myshopify.com
```

### Example Scan Result
The bot returns a paginated embed showing:
- Store name
- Number of in-stock zero-price products found
- Total products scanned
- Product details (title, variant, add-to-cart link)
- Page navigation buttons (Previous/Next)
- Bulk add-to-cart button for all products
- Timestamp of scan

### Headless Shopify Detection
For stores like hatch.co that use headless Shopify:
1. Try scanning the main domain first
2. If 404, automatically try `shop.` subdomain
3. Example: `hatch.co` → auto-tries `shop.hatch.co`
4. Works seamlessly without user intervention

## Technical Details

### Shopify API
- Endpoint: `https://[store-domain]/products.json`
- No authentication required (public endpoint)
- Returns all products with variants and pricing
- Filters variants where `price === "0.00"` AND `available === true`
- Add-to-cart URL format: `https://[store-domain]/cart/[variantId]:1`
- Bulk cart URL format: `https://[store-domain]/cart/[variantId1]:1,[variantId2]:1,...`

### URL Splitting
- Discord and browsers have URL length limits (~2000 chars)
- Bot automatically splits bulk cart URLs into multiple links
- Each link contains as many products as possible
- User gets numbered links (Link 1, Link 2, etc.)

### Error Handling
- Invalid URLs
- Network failures
- Non-existent stores
- Rate limiting (future enhancement)

## Development
The bot starts automatically when the server runs. It registers slash commands on startup and listens for interactions.

## Recent Updates (October 31, 2025)
- ✅ Implemented headless Shopify auto-detection (shop. subdomain)
- ✅ Changed to add-to-cart links instead of product page links
- ✅ Added pagination with Previous/Next buttons
- ✅ Implemented out-of-stock filtering
- ✅ Added bulk add-to-cart functionality with URL splitting

## Future Enhancements
- Historical tracking of price changes
- Scheduled automated scans
- Filtering by product type/vendor
- Email notifications for new zero-price items
- Batch scan pagination support

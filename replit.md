# Shopify Zero Price Scanner Discord Bot

## Overview
A Discord bot that scans Shopify stores to identify products priced at $0.00. Users can scan individual stores or batch multiple stores using slash commands.

## Features
- `/scan` - Scan a single Shopify store for zero-price products
- `/scanbatch` - Scan multiple Shopify stores at once (comma-separated URLs)
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
The bot returns an embed showing:
- Store name
- Number of zero-price products found
- Total products scanned
- Product details (title, variant, URL)
- Timestamp of scan

## Technical Details

### Shopify API
- Endpoint: `https://[store-domain]/products.json`
- No authentication required (public endpoint)
- Returns all products with variants and pricing
- Filters variants where `price === "0.00"`

### Error Handling
- Invalid URLs
- Network failures
- Non-existent stores
- Rate limiting (future enhancement)

## Development
The bot starts automatically when the server runs. It registers slash commands on startup and listens for interactions.

## Future Enhancements
- Historical tracking of price changes
- Scheduled automated scans
- Product availability status
- Filtering by product type/vendor
- Email notifications for new zero-price items

import { Bot, Search, ListChecks } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 space-y-6">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-full">
            <Bot className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Shopify Scanner Discord Bot
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            This is a Discord bot, not a web application
          </p>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Search className="w-5 h-5" />
            How to Use
          </h2>
          
          <div className="space-y-3">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                1. Add the bot to your Discord server
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Make sure the bot is invited to your Discord server with the appropriate permissions.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                2. Use the slash commands
              </h3>
              <div className="space-y-2 mt-3">
                <div className="bg-white dark:bg-gray-800 rounded p-3">
                  <code className="text-sm text-blue-600 dark:text-blue-400">/scan url:https://store-name.myshopify.com</code>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Scan a single Shopify store for $0.00 products
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3">
                  <code className="text-sm text-blue-600 dark:text-blue-400">/scanbatch urls:store1.myshopify.com, store2.myshopify.com</code>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Scan multiple stores at once (comma-separated)
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                3. View results in Discord
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                The bot will respond with beautiful embeds showing all products priced at $0.00
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <ListChecks className="w-5 h-5" />
            Features
          </h2>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Scan single or multiple Shopify stores</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Find all products with $0.00 pricing</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Detailed product information with direct links</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Batch scanning with rate limiting</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>Comprehensive error reporting</span>
            </li>
          </ul>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Note:</strong> This application runs as a Discord bot service. There is no web interface to interact with. 
            All functionality is accessed through Discord slash commands.
          </p>
        </div>
      </div>
    </div>
  );
}

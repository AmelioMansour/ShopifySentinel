# Design Guidelines: Shopify Product Scanner

## Design Approach

**Selected Approach:** Design System with Modern Data Tool References

This is a utility-focused application prioritizing efficiency and data clarity. Draw inspiration from modern data tools like Retool, Airtable, and Linear that excel at presenting complex information clearly while maintaining visual polish.

**Key Design Principles:**
- **Data First:** Information hierarchy that makes scan results immediately actionable
- **Efficient Workflows:** Minimize steps between input and results
- **Visual Clarity:** Clean presentation of tabular data with strong contrast
- **Professional Polish:** Enterprise-grade feel that instills confidence in accuracy

## Typography

**Font Stack:** Inter (Google Fonts) for its exceptional readability in data-dense interfaces

**Hierarchy:**
- Page Title: text-3xl font-bold (36px)
- Section Headers: text-xl font-semibold (20px)
- Table Headers: text-sm font-medium uppercase tracking-wide (14px)
- Body/Data: text-base font-normal (16px)
- Labels: text-sm font-medium (14px)
- Helper Text: text-xs (12px)

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, and 8 consistently throughout
- Component padding: p-4 or p-6
- Section spacing: gap-6 or gap-8
- Tight groupings: space-y-2
- Related sections: space-y-4

**Container Strategy:**
- Main container: max-w-7xl mx-auto px-4 sm:px-6 lg:px-8
- Form sections: max-w-3xl
- Results table: Full width within container
- No hero section needed - utility dashboard layout

## Component Library

### 1. Header Section
- Logo/App title on left
- Simple navigation (if needed for multiple features)
- Height: h-16
- Border bottom for definition

### 2. Input & Control Panel
**URL Input Card:**
- Prominent input field with label "Shopify Store URL"
- Placeholder: "https://store-name.myshopify.com"
- Primary action button: "Scan Store" with loading states
- Batch input toggle to switch to textarea for multiple URLs
- Help text: "Enter a Shopify store URL to scan for $0.00 products"

**Batch Input Mode:**
- Textarea for multiple URLs (one per line)
- Character counter
- "Scan All Stores" button
- Clear/Reset button

### 3. Status & Progress Indicators
- Real-time status badges (Scanning, Complete, Error)
- Progress bar for batch scans showing X of Y completed
- Scan timestamp display

### 4. Results Table
**Table Structure:**
- Sticky header row
- Columns: Store Name, Product Title, Product Handle, Variant, Price, Actions
- Alternating row backgrounds for readability
- Hover state on rows
- Empty state with clear messaging when no results

**Table Features:**
- Sort by any column
- Filter/search within results
- Pagination for large result sets (show 50 per page)
- Row selection for bulk actions

### 5. Action Buttons
**Primary Actions:**
- Export to CSV (icon + text)
- Export to JSON (icon + text)
- Download Report (combines both)

**Secondary Actions:**
- Clear Results
- New Scan
- Copy to Clipboard (for individual items)

### 6. Cards/Panels
- Scan history card showing recent scans
- Statistics panel: Total scans, Total $0.00 items found, Last scan time
- Border: border rounded-lg
- Shadow: shadow-sm for subtle elevation

### 7. Error States
- Error banner for failed scans with retry button
- Inline validation errors for URL input
- Network error messaging with troubleshooting tips

### 8. Icons
**Library:** Heroicons (via CDN)
- Search icon for scan button
- Download icon for export actions
- Alert icons for error states
- Check/X icons for status indicators
- External link icon for "View Product" actions

## Page Structure

**Main Dashboard Layout:**

1. **Header Bar** (full-width, fixed)
   - App branding
   - Quick stats counter

2. **Control Panel** (centered, max-w-3xl)
   - URL input section with clear visual weight
   - Mode toggle (Single/Batch)
   - Scan button with prominent placement

3. **Active Scan Indicator** (when scanning)
   - Progress visualization
   - Current store being scanned
   - Cancel option

4. **Statistics Dashboard** (3-column grid on desktop, stacked on mobile)
   - Total Stores Scanned
   - $0.00 Products Found
   - Last Scan Time

5. **Results Section** (full-width table)
   - Export actions in header
   - Data table with all findings
   - Pagination controls

6. **Footer** (minimal)
   - Export options
   - Clear results option

## Data Presentation

**Table Design Best Practices:**
- Fixed-width columns for prices and dates
- Flexible-width for product titles
- Right-align numerical data
- Truncate long text with tooltips
- Badge components for status (Active, Draft, etc.)

**Color Usage for Data:**
- Success states: Use for "Scan Complete"
- Error states: For failed scans
- Warning: For products with suspicious pricing
- Neutral: Default table rows
- Accent: Selected rows

## Responsive Behavior

**Desktop (lg+):**
- Full table view with all columns
- 3-column statistics grid
- Side-by-side controls

**Tablet (md):**
- Scrollable table or hide less critical columns
- 2-column statistics grid
- Stacked input controls

**Mobile:**
- Card-based results instead of table
- Single column layout
- Sticky action buttons
- Simplified statistics (vertical stack)

## Accessibility

- Form labels properly associated with inputs
- Table headers with scope attributes
- ARIA labels for icon-only buttons
- Keyboard navigation for table rows
- Focus indicators on all interactive elements
- Status announcements for screen readers during scans

## Images

**No hero image required** - This is a dashboard/utility application where immediate access to functionality is prioritized over visual marketing elements.
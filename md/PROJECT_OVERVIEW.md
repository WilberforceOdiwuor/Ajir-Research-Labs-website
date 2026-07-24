# Ajir Research Labs Web Project Overview

## What This Project Is

This repository is a static website for **Ajir Research Labs**. It presents the lab's public identity, research writing, legal pages, and shared site navigation without a frontend framework or backend runtime.

The site currently does four main things:

1. Publishes a landing page for Ajir Research Labs and the early concept for **AskNoema**.
2. Publishes a research index backed by a local JSON file and renders research entries client-side.
3. Publishes individual long-form research articles as static HTML pages.
4. Publishes legal and policy pages for privacy, terms, and AI policy.

## Project Structure

### Top-Level Files

- `index.html`
  The public homepage.
- `CNAME`
  Indicates intended custom-domain deployment for static hosting.

### Content Directories

- `Research/`
  Static research landing page plus individual article pages.
- `legals/`
  Static legal and policy pages.
- `data/indexes/research.json`
  Source data for the research listing.
- `md/`
  Project documentation.

### Presentation Assets

- `css/`
  Shared styling for layout, typography, content presentation, and legal content.
- `assets/icons/`
  Menu open/close icons for the mobile navigation.
- `assets/images/research/`
  Research page imagery.

### Behavior and Shared Rendering

- `js/core.js`
  Header visibility and mobile-menu behavior.
- `js/behavior.js`
  Research-index loading, filtering, safe-path validation, and rendering.
- `templates/header.html`
  Shared header markup used across pages.
- `templates/footer.html`
  Shared footer markup used across pages.
- `scripts/render_shared_chrome.py`
  Rebuilds the shared header/footer blocks into each static HTML page.

## What Each Page Does

### Homepage

`index.html` functions as the main public identity page for the lab. It:

- States the lab mission and philosophy.
- Describes the `AskNoema` concept and intended product direction.
- Explains design principles and operating ideas.
- Lists current focus areas.
- Provides a join/collaboration section.
- Links users to the research section and external X profile.

### Research Index

`Research/index.html` is a client-rendered listing page. It:

- Loads `../data/indexes/research.json`.
- Sorts entries by date descending in the browser.
- Renders article cards dynamically.
- Supports tag-based filtering using buttons and a `?tag=` URL parameter.
- Preserves the current filter in the address bar with `history.replaceState`.

### Research Articles

The article pages in `Research/` are static long-form HTML documents. They:

- Present article content directly in markup.
- Link citations to on-page references.
- Reuse the shared site header and footer.
- Load the same shared CSS and JS as the rest of the site.

Current article pages:

- `Research/algorithmic-abdication.html`
- `Research/algorithmic-radicalization.html`
- `Research/epistemic-passivity.html`
- `Research/intellectual-abdication-effect-of-ai.html`

### Legal and Policy Pages

The legal pages in `legals/` are static HTML documents. They:

- Publish a privacy notice.
- Publish terms of service.
- Publish a draft AI policy.
- Reuse the same shared chrome and JS runtime as the rest of the site.

## Frontend Behavior

### Shared Header and Mobile Menu

`js/core.js` initializes the shared header. It:

- Finds the shared header, menu toggle, navigation list, and nav links.
- Toggles the mobile menu open and closed.
- Adds and removes `body.menu-open` to lock page scrolling while the menu is open.
- Updates `aria-expanded` on the menu button.
- Closes the menu when a nav link is clicked.
- Closes the menu on `Escape`.
- Closes the menu on window resize above desktop width.
- Toggles a `visible` class on the header after the user scrolls beyond 250px.

### Research Index Rendering

`js/behavior.js` handles research-list behavior. It:

- Formats article dates for display.
- Restricts rendered article links to local `Research/` and `legals/` paths.
- Normalizes filter tags to lowercase for matching.
- Creates the article card DOM structure in JavaScript.
- Applies active/inactive state to filter buttons.
- Re-renders the list when a filter changes.
- Updates the query string when the active filter changes.
- Fetches and validates the JSON index before rendering.

## Styling System

The CSS is organized by concern rather than components:

- `css/base.css`
  Global reset-style rules, root fonts, body defaults, and scroll behavior.
- `css/layout.css`
  Header, navigation, footer, and responsive layout rules.
- `css/content.css`
  Shared content formatting, research cards, lists, typography, and article content.
- `css/theme.css`
  Additional theme-level styling.
- `css/legal.css`
  Intended legal-page styling layer.

## Shared Chrome Workflow

The project uses a simple template injection workflow instead of server-side includes or a static-site generator.

`scripts/render_shared_chrome.py`:

- Defines the set of pages that should receive shared chrome.
- Reads `templates/header.html` and `templates/footer.html`.
- Replaces the `{{root}}` placeholder with `.` or `..` depending on page depth.
- Rewrites the shared header and footer blocks into each target HTML file.
- Ensures output files end with a newline.

This makes the site easier to maintain while keeping the final output as plain static HTML.

## Data Flow

The only runtime data fetch in the project is the research index:

1. `Research/index.html` declares `data-research-index` and `data-source="../data/indexes/research.json"`.
2. `js/behavior.js` fetches that JSON on `DOMContentLoaded`.
3. The script validates that `data.items` is an array.
4. The items are sorted by date descending.
5. The list is rendered into the page.
6. Clicking a filter button re-renders a filtered subset of those same items.

There is no backend API, database, authentication layer, form handling, or build step in the current repo.

## Security and Safety Measures Present

Every published HTML page includes a Content Security Policy using a meta tag. The current policy:

- Restricts scripts to self.
- Restricts images to self and data URLs.
- Restricts network connections to self.
- Blocks plugins with `object-src 'none'`.
- Restricts `base-uri` and `form-action` to self.

The research index renderer also protects article links with `isSafeResearchPath()` so the JSON file cannot inject arbitrary external navigation.

## What The Project Does Not Yet Include

The repository does not currently implement:

- A JavaScript build pipeline.
- A package manager setup.
- Automated tests.
- A backend service.
- CMS authoring.
- Search.
- Analytics integration in code.
- Form submission handling.
- User accounts.
- Product runtime for AskNoema itself.

## Operational Summary

At its current stage, this repository is a **static public web presence** for Ajir Research Labs. It provides:

- Brand and mission presentation.
- Research publication and browsing.
- Shared navigation and footer rendering.
- Basic client-side filtering of research content.
- Legal and policy publishing.

It does not yet contain the application runtime for AskNoema, but it does describe that product direction and expose the lab's research/public-facing materials.

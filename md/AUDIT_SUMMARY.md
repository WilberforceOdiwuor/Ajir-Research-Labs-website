# Ajir Research Labs Web Project Audit Summary

## Scope

Audit type: static code and content review of the current repository.

Areas reviewed:

- Shared HTML templates
- Homepage, research pages, and legal pages
- CSS and JavaScript behavior
- Research-index data
- Shared chrome rendering script

## Findings

### Medium

#### 1. Every published page renders two `h1` elements

**Classification:** Accessibility / semantic HTML / SEO

The shared header template uses an `h1` for the site name, and each page also defines its own document-level `h1`. That leaves every rendered page with two top-level headings.

References:

- `templates/header.html:3`
- `index.html:46`
- `Research/index.html:45`
- `legals/terms.html:41`

Impact:

- Weakens document outline semantics.
- Makes the true page title less clear to assistive technologies.
- Reduces heading quality for SEO and page structure.

Recommendation:

- Change the shared site title in the header from `h1` to a non-document heading element such as `div`, `p`, or a lower heading level.

### Low

#### 2. Invalid CSS declarations in shared layout/base styles

**Classification:** CSS syntax / styling reliability

There are two concrete syntax issues in shared CSS:

- `padding: 14px auto;` is invalid because `auto` is not allowed for padding.
- `body.menu-open { overflow: hidden; },` leaves a stray trailing comma after the rule.

References:

- `css/layout.css:16`
- `css/base.css:25`

Impact:

- Browsers will ignore the invalid `padding` declaration.
- The stray comma is parse noise and makes stylesheet quality brittle.

Recommendation:

- Replace invalid padding with explicit numeric values.
- Remove the trailing comma after the `body.menu-open` rule.

#### 3. Header scroll-state logic is effectively dead

**Classification:** Frontend behavior / dead code

`js/core.js` toggles a `visible` class after the user scrolls 250px, but both the default and `.visible` header states use `transform: translateY(0)`. The class change therefore has no visible effect.

References:

- `js/core.js:12`
- `css/layout.css:7`
- `css/layout.css:10`

Impact:

- Extra event handling runs on scroll with no user-visible outcome.
- The code suggests an intended sticky-hide or reveal behavior that is not actually implemented.

Recommendation:

- Either remove the scroll listener and class toggle, or implement distinct hidden/visible header states in CSS.

#### 4. Most pages are missing meta descriptions

**Classification:** SEO / discoverability

The homepage has a meta description, but the research index, research articles, and legal pages do not.

Representative references:

- `index.html:10`
- `Research/index.html`
- `Research/algorithmic-abdication.html`
- `legals/privacy.html`

Impact:

- Search engines and social previews have less reliable summary text.
- Published research pages are harder to present cleanly in external indexing.

Recommendation:

- Add page-specific `<meta name="description">` tags to all content pages.

#### 5. Content-integrity errors are present in published copy

**Classification:** Editorial correctness / trust quality

The published content contains several visible text errors, including:

- Citation label mismatch: the article links to `#ref-12` but displays `[13]`.
- Typographical error: `8s` appears in the privacy notice.
- Multiple grammar/spelling errors in published article copy such as `theoritical`, `percieve`, and `more deeper`.

References:

- `Research/algorithmic-abdication.html:92`
- `Research/algorithmic-abdication.html:139`
- `Research/algorithmic-abdication.html:148`
- `Research/algorithmic-abdication.html:202`
- `legals/privacy.html:52`

Impact:

- Reduces credibility on research and legal pages.
- Creates citation confusion for readers.

Recommendation:

- Run an editorial cleanup pass on all published documents, starting with research and legal pages.

## Residual Risks

- There is no automated test suite, so regressions in shared chrome, page semantics, or research-index rendering will currently be caught only by manual review.
- The empty files in `js/components/` suggest unused or incomplete component scaffolding; they are not currently breaking anything, but they add maintenance ambiguity.

## Summary

The project is structurally simple and mostly coherent as a static site. The issues found are concentrated in three areas:

1. Semantic/accessibility quality in shared markup.
2. Shared CSS/JS polish issues.
3. Editorial accuracy in published content.

No high-severity security flaw or broken internal-link issue was found in this pass.

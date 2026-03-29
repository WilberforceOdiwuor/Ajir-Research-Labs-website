# Ajir-Research-site
Ajir Research Labs
# Ajir Research

Ajir Research is an independent research and systems lab focused on
structured intelligence, knowledge integrity, and reasoning augmentation
in high-velocity media environments.

## About

The lab is developing **Noema**, an AI-augmented social intelligence
platform designed to transform raw short-form media into structured,
verifiable knowledge at the point of consumption.

Noema emphasizes:
- Multimodal analysis (video, audio, text, metadata)
- Contextual credibility assessment
- Feed-level reasoning interfaces
- Knowledge persistence over engagement-driven ephemerality

## Philosophy

Ajir Research operates from the premise that:
- Social media has outpaced human cognition
- Generative AI risks increasing epistemic passivity
- Intelligence systems should augment reasoning, not replace it

The goal is not automation of thought, but restoration of
context, friction, and understanding where they matter.

## Status

This repository currently hosts the public identity page for Ajir Research.

System architecture, research notes, and experimental prototypes
will be added incrementally as development progresses.

There is no public product release at this time.

## Shared Chrome Workflow

The site header and footer are maintained in:
- `templates/header.html`
- `templates/footer.html`

After editing either template, regenerate the embedded chrome blocks in the
static pages with:

```bash
python3 scripts/render_shared_chrome.py
```

This updates the homepage, research pages, and legal pages listed in
`scripts/render_shared_chrome.py` so shared navigation stays consistent.

## Contact

X: https://x.com/ajir_research

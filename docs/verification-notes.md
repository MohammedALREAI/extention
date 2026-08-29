# Verification Notes

## Extension performance release 1.0.8

Visual verification on August 27, 2026 confirmed that the valid tutorial route is `/tutorial` and it renders the Chrome MV3 version 1.0.8 status, updated performance copy, and extension download action. The attempted `/tutorial-start` route returned the expected application 404 because it is not a registered route; no production route change was required.

## Extension flow diagram

The rendered Arabic Mermaid diagram was reviewed on August 27, 2026. It visibly separates browser-local matching and scheduling from the semantic and visual server checks, shows the three image outcomes, and includes the privacy boundary. The editable Mermaid source remains the canonical diagram.

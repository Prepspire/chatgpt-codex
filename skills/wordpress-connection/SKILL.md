---
name: wordpress-connection
description: "Use the Prepspire WordPress MCP connector to inspect and safely edit self-hosted WordPress sites through the REST API."
---

# WordPress Connection

Use this skill when the user asks Codex/ChatGPT to connect to, inspect, edit, or manage a self-hosted WordPress site through the `wordpress-mcp` connector in this repository.

## Connection

- Prefer WordPress Application Password authentication.
- Never ask the user to commit or paste credentials into repository files.
- Credentials belong in deployment secrets or a local `.env` file ignored by Git.
- Run `wp_connection_test` before the first site mutation in a session.

## Safe workflow

1. Identify the intended site and confirm the connector is pointed at it.
2. Inspect before editing. Use `wp_list_content` to find the correct post/page ID, then `wp_get_content` to retrieve the current editable content.
3. Make the smallest requested change.
4. Preserve unrelated content and layout markup unless the user explicitly asks for a redesign.
5. Prefer drafts and reviewable changes.
6. Publishing is allowed only when the connector has `WP_ALLOW_PUBLISH=true` and the user has asked for publishing.
7. Deletion is allowed only when `WP_ALLOW_DELETE=true` and the user has explicitly requested deletion.

## Elementor and page-builder content

WordPress REST content may contain page-builder shortcodes, blocks, HTML, or generated markup. Do not rewrite an entire builder document just to change one text fragment. Locate the smallest safe editable field or relevant REST representation first. If the site's builder data is not exposed through the standard REST API, explain that a site-specific WordPress extension/tool may be needed instead of guessing.

## Media

Use `wp_upload_media_base64` for supported media uploads, then use the returned attachment ID for fields such as `featured_media` when appropriate.

## Plugins and themes

Use `wp_list_plugins` and `wp_list_themes` for inspection. Treat plugin/theme activation, installation, update, deletion, and arbitrary admin commands as higher-risk capabilities that should only be added to the connector when explicitly needed.

## Reporting changes

After a mutation, report:

- Site
- Content type and ID
- What changed
- Resulting status (draft/pending/published)
- Link when WordPress returns one

Do not claim a change succeeded unless the MCP tool returned success.

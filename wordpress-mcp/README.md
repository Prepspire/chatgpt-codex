# Prepspire WordPress MCP Connector

A reusable MCP server for connecting ChatGPT/Codex to a self-hosted WordPress site through the WordPress REST API.

## What it can do

- Test the WordPress connection and authenticated user.
- List posts and pages.
- Read full editable post/page content.
- Create new drafts.
- Update existing posts/pages.
- Upload media from base64 data.
- Inspect installed plugins and themes when the WordPress account has permission.
- Delete/trash content only when explicitly enabled.
- Publish content only when explicitly enabled.

## Safety defaults

Publishing and deletion are disabled by default:

```env
WP_ALLOW_PUBLISH=false
WP_ALLOW_DELETE=false
```

Keep them disabled unless a workflow genuinely needs those actions.

## WordPress setup

1. Sign in to WordPress as the account you want ChatGPT/Codex to use.
2. Go to **Users > Profile**.
3. Find **Application Passwords**.
4. Create a new password named something like `ChatGPT MCP`.
5. Copy the generated password immediately.

Application Passwords are preferable to storing the user's normal WordPress password.

The WordPress site must expose the standard REST API at:

```text
https://YOUR-SITE/wp-json/
```

## Local setup

```bash
git clone https://github.com/Prepspire/chatgpt-codex.git
cd chatgpt-codex/wordpress-mcp
npm install
cp .env.example .env
```

Edit `.env`:

```env
WP_BASE_URL=https://example.com
WP_USERNAME=your-wordpress-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
WP_ALLOW_PUBLISH=false
WP_ALLOW_DELETE=false
PORT=3000
```

Then start the server:

```bash
npm start
```

Health check:

```text
GET http://localhost:3000/health
```

MCP endpoint:

```text
http://localhost:3000/mcp
```

## Connecting from ChatGPT/Codex

For a remote ChatGPT connection, deploy this server to an HTTPS-accessible host and use:

```text
https://YOUR-MCP-HOST/mcp
```

For local Codex workflows, run the server locally and configure the MCP client to point to the local `/mcp` endpoint according to the current Codex MCP configuration method.

Do not expose the `.env` file or Application Password publicly.

## Tools exposed

### `wp_connection_test`
Verifies authentication and returns the connected site and WordPress user.

### `wp_list_content`
Lists posts/pages with IDs, titles, slugs and statuses.

### `wp_get_content`
Reads editable post/page fields including raw content.

### `wp_create_draft`
Creates a post or page. Always creates it as `draft`.

### `wp_update_content`
Updates an existing post/page. A `publish` status is rejected unless `WP_ALLOW_PUBLISH=true`.

### `wp_upload_media_base64`
Uploads a media file from base64 and returns the WordPress media attachment ID and URL.

### `wp_list_plugins`
Lists plugins if the authenticated account has the required capability.

### `wp_list_themes`
Lists themes if the authenticated account has the required capability.

### `wp_delete_content`
Deletes/trashes a post/page only when `WP_ALLOW_DELETE=true`.

## Recommended first test

Keep both safety switches false, start the server, and call:

```text
wp_connection_test
```

Then try:

```text
wp_list_content(type="pages", per_page=10)
```

Only after those work should you try editing a known draft page.

## Multi-site use

The current server connects to one WordPress site per running instance. To manage several sites, deploy separate instances with separate environment variables. This prevents credentials and permissions from being mixed between sites.

## Security notes

- Never commit `.env`.
- Use a dedicated WordPress account if practical.
- Give that account only the capabilities needed for the intended workflow.
- Keep `WP_ALLOW_DELETE=false` unless deletion is specifically required.
- Keep `WP_ALLOW_PUBLISH=false` if you want ChatGPT/Codex changes to remain reviewable drafts.
- Rotate the WordPress Application Password if it is ever exposed.

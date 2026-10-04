import http from "node:http";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Minimal ESM-safe .env loader. Existing process env values take precedence.
if (existsSync(".env")) {
  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const WP_BASE_URL = (process.env.WP_BASE_URL || "").replace(/\/$/, "");
const WP_USERNAME = process.env.WP_USERNAME || "";
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || "";
const ALLOW_PUBLISH = /^true$/i.test(process.env.WP_ALLOW_PUBLISH || "false");
const ALLOW_DELETE = /^true$/i.test(process.env.WP_ALLOW_DELETE || "false");
const PORT = Number(process.env.PORT || 3000);

function assertConfig() {
  if (!WP_BASE_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error("Missing WP_BASE_URL, WP_USERNAME, or WP_APP_PASSWORD environment variables.");
  }
}

function authHeader() {
  return `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString("base64")}`;
}

async function wp(path, options = {}) {
  assertConfig();
  const headers = {
    Authorization: authHeader(),
    Accept: "application/json",
    ...(options.headers || {}),
  };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const response = await fetch(`${WP_BASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = typeof data === "object" && data?.message ? data.message : text;
    throw new Error(`WordPress ${response.status}: ${message}`);
  }
  return data;
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function endpoint(type) {
  if (!["posts", "pages"].includes(type)) throw new Error("type must be posts or pages");
  return `/wp-json/wp/v2/${type}`;
}

function createMcpServer() {
  const server = new McpServer({ name: "prepspire-wordpress", version: "0.1.1" });

  server.registerTool(
    "wp_connection_test",
    {
      description: "Verify WordPress REST API authentication and return the connected user/site details.",
      inputSchema: {},
    },
    async () => {
      const [user, site] = await Promise.all([
        wp("/wp-json/wp/v2/users/me?context=edit"),
        wp("/wp-json"),
      ]);
      return textResult({
        connected: true,
        site: { name: site.name, url: site.url, home: site.home },
        user: { id: user.id, name: user.name, roles: user.roles },
      });
    },
  );

  server.registerTool(
    "wp_list_content",
    {
      description: "List WordPress posts or pages. Useful for finding IDs before editing.",
      inputSchema: {
        type: z.enum(["posts", "pages"]),
        search: z.string().optional(),
        status: z.string().default("any"),
        per_page: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ type, search, status, per_page }) => {
      const params = new URLSearchParams({ context: "edit", per_page: String(per_page), status });
      if (search) params.set("search", search);
      const items = await wp(`${endpoint(type)}?${params}`);
      return textResult(
        items.map(({ id, date, modified, slug, status: itemStatus, link, title }) => ({
          id,
          date,
          modified,
          slug,
          status: itemStatus,
          link,
          title: title?.raw ?? title?.rendered,
        })),
      );
    },
  );

  server.registerTool(
    "wp_get_content",
    {
      description: "Read one WordPress post or page including editable title, content, excerpt and status.",
      inputSchema: { type: z.enum(["posts", "pages"]), id: z.number().int().positive() },
    },
    async ({ type, id }) => {
      const item = await wp(`${endpoint(type)}/${id}?context=edit`);
      return textResult({
        id: item.id,
        slug: item.slug,
        status: item.status,
        link: item.link,
        title: item.title?.raw,
        content: item.content?.raw,
        excerpt: item.excerpt?.raw,
        featured_media: item.featured_media,
        modified: item.modified,
      });
    },
  );

  server.registerTool(
    "wp_create_draft",
    {
      description: "Create a new WordPress post or page as a draft. This tool never publishes directly.",
      inputSchema: {
        type: z.enum(["posts", "pages"]),
        title: z.string().min(1),
        content: z.string().default(""),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
      },
    },
    async ({ type, title, content, excerpt, slug }) => {
      const body = { title, content, status: "draft" };
      if (excerpt !== undefined) body.excerpt = excerpt;
      if (slug) body.slug = slug;
      const item = await wp(endpoint(type), { method: "POST", body: JSON.stringify(body) });
      return textResult({ created: true, id: item.id, status: item.status, link: item.link, slug: item.slug });
    },
  );

  server.registerTool(
    "wp_update_content",
    {
      description: "Update an existing WordPress post or page. Publishing is blocked unless WP_ALLOW_PUBLISH=true.",
      inputSchema: {
        type: z.enum(["posts", "pages"]),
        id: z.number().int().positive(),
        title: z.string().optional(),
        content: z.string().optional(),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
        status: z.enum(["draft", "pending", "private", "publish"]).optional(),
        featured_media: z.number().int().nonnegative().optional(),
      },
    },
    async ({ type, id, ...changes }) => {
      if (changes.status === "publish" && !ALLOW_PUBLISH) {
        throw new Error("Publishing is disabled. Set WP_ALLOW_PUBLISH=true only when you intentionally want publish permission.");
      }
      const body = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(body).length) throw new Error("No changes supplied.");
      const item = await wp(`${endpoint(type)}/${id}`, { method: "POST", body: JSON.stringify(body) });
      return textResult({ updated: true, id: item.id, status: item.status, link: item.link, modified: item.modified });
    },
  );

  server.registerTool(
    "wp_upload_media_base64",
    {
      description: "Upload a media file to WordPress from base64 data and return the attachment ID/URL.",
      inputSchema: {
        filename: z.string().min(1),
        mime_type: z.string().min(1),
        base64_data: z.string().min(1),
        title: z.string().optional(),
        alt_text: z.string().optional(),
      },
    },
    async ({ filename, mime_type, base64_data, title, alt_text }) => {
      assertConfig();
      const response = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/media`, {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": mime_type,
          "Content-Disposition": `attachment; filename=\"${filename.replace(/\"/g, "")}\"`,
          Accept: "application/json",
        },
        body: Buffer.from(base64_data, "base64"),
      });
      const raw = await response.text();
      let item;
      try {
        item = JSON.parse(raw);
      } catch {
        item = raw;
      }
      if (!response.ok) throw new Error(`WordPress ${response.status}: ${item?.message || raw}`);
      if (title !== undefined || alt_text !== undefined) {
        item = await wp(`/wp-json/wp/v2/media/${item.id}`, {
          method: "POST",
          body: JSON.stringify({
            ...(title !== undefined ? { title } : {}),
            ...(alt_text !== undefined ? { alt_text } : {}),
          }),
        });
      }
      return textResult({
        uploaded: true,
        id: item.id,
        url: item.source_url,
        mime_type: item.mime_type,
        title: item.title?.raw ?? item.title?.rendered,
      });
    },
  );

  server.registerTool(
    "wp_list_plugins",
    {
      description: "Inspect installed WordPress plugins. Requires a WordPress account with plugin-management permission.",
      inputSchema: {},
    },
    async () => textResult(await wp("/wp-json/wp/v2/plugins?context=edit")),
  );

  server.registerTool(
    "wp_list_themes",
    {
      description: "Inspect installed WordPress themes. Requires appropriate WordPress permissions.",
      inputSchema: {},
    },
    async () => textResult(await wp("/wp-json/wp/v2/themes?context=edit")),
  );

  server.registerTool(
    "wp_delete_content",
    {
      description: "Delete or trash a post/page. Disabled unless WP_ALLOW_DELETE=true.",
      inputSchema: {
        type: z.enum(["posts", "pages"]),
        id: z.number().int().positive(),
        force: z.boolean().default(false),
      },
    },
    async ({ type, id, force }) => {
      if (!ALLOW_DELETE) {
        throw new Error("Deletion is disabled. Set WP_ALLOW_DELETE=true only when deletion is intentionally required.");
      }
      const item = await wp(`${endpoint(type)}/${id}?force=${force ? "true" : "false"}`, { method: "DELETE" });
      return textResult({ deleted: true, force, result: item });
    },
  );

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const pathname = (req.url || "").split("?")[0];

  try {
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "prepspire-wordpress-mcp",
          version: "0.1.1",
          wordpressConfigured: Boolean(WP_BASE_URL && WP_USERNAME && WP_APP_PASSWORD),
        }),
      );
      return;
    }

    if (pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    let body;
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : undefined;
    }

    // Stateless Streamable HTTP: a fresh MCP server + transport per request.
    // This avoids request/session collisions and matches the SDK's stateless pattern.
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    let closed = false;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      try {
        await transport.close();
      } catch {}
      try {
        await server.close();
      } catch {}
    };

    res.on("close", cleanup);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`WordPress MCP server listening on http://0.0.0.0:${PORT}/mcp`);
});

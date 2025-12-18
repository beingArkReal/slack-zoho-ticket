# Slack → Zoho Projects Ticket Creator

One-click ticket creation from Slack messages. Free forever.

## Overview

```
Right-click Slack message → "Create Ticket" → AI summarizes → Modal to edit → Creates Zoho task
```

---

## Setup Steps (30 minutes)

### Step 1: Deploy Cloudflare Worker (5 min)

1. Install Wrangler CLI (if not installed):
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy the worker:
   ```bash
   cd /Users/areeb/Documents/work/slack-zoho-ticket
   wrangler deploy
   ```

4. Note the worker URL (looks like `https://slack-zoho-ticket.<your-subdomain>.workers.dev`)

---

### Step 2: Create Zoho API Credentials (10 min)

1. Go to [Zoho API Console](https://api-console.zoho.com/)

2. Click **"Add Client"** → Select **"Server-based Applications"**

3. Fill in:
   - Client Name: `Slack Ticket Creator`
   - Homepage URL: `https://slack-zoho-ticket.workers.dev` (your worker URL)
   - Authorized Redirect URI: `https://slack-zoho-ticket.workers.dev/oauth/callback`

4. Click **Create** → Note down:
   - `Client ID`
   - `Client Secret`

5. Generate Refresh Token - Go to this URL in browser (replace YOUR_CLIENT_ID):
   ```
   https://accounts.zoho.com/oauth/v2/auth?scope=ZohoProjects.tasks.CREATE,ZohoProjects.tasks.READ,ZohoProjects.projects.READ&client_id=YOUR_CLIENT_ID&response_type=code&access_type=offline&redirect_uri=https://slack-zoho-ticket.workers.dev/oauth/callback&prompt=consent
   ```

6. After authorizing, you'll get a `code` in the URL. Exchange it for tokens:
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "code=YOUR_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=https://slack-zoho-ticket.workers.dev/oauth/callback" \
     -d "grant_type=authorization_code"
   ```

7. Note the `refresh_token` from the response.

8. Get your Portal ID and Project ID from your URL:
   - Your URL: `https://projects.7thpillar.com/portal/7thpillar#allprojects/2043894000000045725/`
   - Portal ID: `7thpillar`
   - Project ID: `2043894000000045725`

---

### Step 3: Create Slack App (10 min)

1. Go to [Slack API Apps](https://api.slack.com/apps)

2. Click **"Create New App"** → **"From scratch"**
   - App Name: `Zoho Ticket Creator`
   - Workspace: Select your workspace

3. **Add Bot Token Scopes** (OAuth & Permissions → Scopes):
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `commands`
   - `groups:history`
   - `groups:read`
   - `users:read`

4. **Install to Workspace** → Click "Install to Workspace" → Authorize

5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

6. **Enable Interactivity** (Interactivity & Shortcuts):
   - Toggle ON
   - Request URL: `https://slack-zoho-ticket.<your-subdomain>.workers.dev`

7. **Create Message Shortcut** (Interactivity & Shortcuts → Shortcuts):
   - Click **"Create New Shortcut"**
   - Select **"On messages"**
   - Name: `Create Zoho Ticket`
   - Short Description: `Create a ticket in Zoho Projects from this message`
   - Callback ID: `create_ticket`

8. **Get Signing Secret** (Basic Information → App Credentials):
   - Copy the **Signing Secret**

---

### Step 4: Add Secrets to Cloudflare Worker (5 min)

Run each command and paste the value when prompted:

```bash
cd /Users/areeb/Documents/work/slack-zoho-ticket

# Slack credentials
wrangler secret put SLACK_BOT_TOKEN
# Paste: xoxb-your-token

wrangler secret put SLACK_SIGNING_SECRET
# Paste: your-signing-secret

# Zoho credentials
wrangler secret put ZOHO_CLIENT_ID
# Paste: your-client-id

wrangler secret put ZOHO_CLIENT_SECRET
# Paste: your-client-secret

wrangler secret put ZOHO_REFRESH_TOKEN
# Paste: your-refresh-token

wrangler secret put ZOHO_PORTAL_ID
# Paste: 7thpillar

wrangler secret put ZOHO_PROJECT_ID
# Paste: 2043894000000045725
```

---

## Usage

1. Find any message in Slack
2. Click the **three dots (⋮)** or right-click
3. Select **"Create Zoho Ticket"**
4. Modal appears with AI-generated summary
5. Edit title/description if needed
6. Click **"Create Ticket"**
7. ✅ Confirmation posts in channel with link to Zoho

---

## Troubleshooting

### "dispatch_failed" error
- Make sure worker is deployed: `wrangler deploy`
- Check worker URL is correct in Slack app settings

### "not_authed" from Slack
- Regenerate Bot Token and update: `wrangler secret put SLACK_BOT_TOKEN`

### "invalid_token" from Zoho
- Refresh token may have expired (rare). Generate new one following Step 2.

### Messages not found
- Make sure bot is added to the channel
- Invite bot: `/invite @Zoho Ticket Creator`

---

## Cost

| Service | Free Tier |
|---------|-----------|
| Cloudflare Workers | 100,000 requests/day |
| Cloudflare Workers AI | 10,000 neurons/day |
| Slack App | Unlimited |
| Zoho API | Included in your plan |

**Total: $0/month** for typical team usage

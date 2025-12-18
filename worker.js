/**
 * Slack to Zoho Projects Ticket Creator
 * Cloudflare Worker - Free Tier
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      const body = await request.clone().text();
      const payload = parsePayload(body);

      if (payload.type === 'url_verification') {
        return new Response(payload.challenge, { status: 200 });
      }

      if (payload.type === 'shortcut' || payload.type === 'message_action') {
        ctx.waitUntil(processTicketCreation(payload, env));
        return new Response('', { status: 200 });
      }

      if (payload.type === 'view_submission') {
        return await handleModalSubmission(payload, env);
      }
    }

    return new Response('Slack-Zoho Ticket Creator Active', { status: 200 });
  }
};

function parsePayload(body) {
  if (body.startsWith('{')) {
    return JSON.parse(body);
  }
  const params = new URLSearchParams(body);
  const payloadStr = params.get('payload');
  return payloadStr ? JSON.parse(payloadStr) : {};
}

async function processTicketCreation(payload, env) {
  try {
    const messageTs = payload.message?.ts || payload.message_ts;
    const channelId = payload.channel?.id || payload.channel_id;
    const triggerId = payload.trigger_id;

    // Get message text directly from payload (faster than API call)
    const messageText = payload.message?.text || '';

    // Run ALL async operations in parallel for speed
    const [permalink, summary, projects] = await Promise.all([
      getSlackPermalink(channelId, messageTs, env.SLACK_BOT_TOKEN),
      summarizeThread(messageText, env.AI),
      fetchZohoProjects(env)
    ]);

    await openModal(triggerId, summary, permalink, channelId, messageTs, projects, env.SLACK_BOT_TOKEN);

  } catch (error) {
    console.error('Error:', error.message);
    const channelId = payload.channel?.id || payload.channel_id;
    if (channelId) {
      await postSlackMessage(channelId, `❌ Error: ${error.message}`, env.SLACK_BOT_TOKEN);
    }
  }
}

async function getSlackPermalink(channelId, messageTs, token) {
  const res = await fetch(`https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  return data.permalink || `https://slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`;
}

async function summarizeThread(messageText, ai) {
  // Strip Slack markdown from input
  const cleanText = messageText
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .substring(0, 1200);

  const prompt = `Extract a title and description from this message. Output ONLY in this exact format, nothing else:

TITLE: <short title>
DESCRIPTION:
<bullet points>

Message:
${cleanText}`;

  const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt: prompt,
    max_tokens: 250
  });

  const output = response.response || '';

  // Try to extract title, fallback to first line of message
  let title = cleanText.split('\n')[0].substring(0, 80);
  let description = cleanText;

  // Try parsing TITLE: format
  const titleMatch = output.match(/TITLE:\s*(.+?)(?:\n|$)/i);
  if (titleMatch && titleMatch[1].trim()) {
    title = titleMatch[1].trim().substring(0, 80);
  }

  // Try parsing DESCRIPTION: format
  const descMatch = output.match(/DESCRIPTION:\s*([\s\S]+)/i);
  if (descMatch && descMatch[1].trim()) {
    description = descMatch[1].trim();
  }

  return { title, description };
}

async function fetchZohoProjects(env) {
  const CACHE_KEY = 'zoho_projects';
  const CACHE_TTL = 3600;

  const cached = await env.CACHE.get(CACHE_KEY, 'json');
  if (cached) return cached;

  const accessToken = await getZohoAccessToken(env);
  const res = await fetch(
    `https://projectsapi.zoho.com/restapi/portal/${env.ZOHO_PORTAL_ID}/projects/?status=active`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
  );
  const data = await res.json();

  if (!data.projects) throw new Error('Failed to fetch projects');

  const projects = data.projects.map(p => ({ id: p.id_string, name: p.name }));
  await env.CACHE.put(CACHE_KEY, JSON.stringify(projects), { expirationTtl: CACHE_TTL });

  return projects;
}

async function openModal(triggerId, summary, permalink, channelId, messageTs, projects, token) {
  const { title, description } = summary;
  const fullDescription = `${description}\n\n---\nSlack Thread: ${permalink}`;

  const modal = {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'create_ticket_modal',
      title: { type: 'plain_text', text: 'Create Zoho Ticket' },
      submit: { type: 'plain_text', text: 'Create Ticket' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ channelId, messageTs, permalink }),
      blocks: [
        {
          type: 'input',
          block_id: 'project_block',
          element: {
            type: 'static_select',
            action_id: 'project_input',
            placeholder: { type: 'plain_text', text: 'Select a project' },
            options: projects.slice(0, 100).map(p => ({
              text: { type: 'plain_text', text: p.name.substring(0, 75) },
              value: p.id
            }))
          },
          label: { type: 'plain_text', text: 'Project' }
        },
        {
          type: 'input',
          block_id: 'title_block',
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            initial_value: title,
            placeholder: { type: 'plain_text', text: 'Ticket title' }
          },
          label: { type: 'plain_text', text: 'Title' }
        },
        {
          type: 'input',
          block_id: 'description_block',
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            initial_value: fullDescription,
            placeholder: { type: 'plain_text', text: 'Ticket description' }
          },
          label: { type: 'plain_text', text: 'Description' }
        },
        {
          type: 'input',
          block_id: 'priority_block',
          element: {
            type: 'static_select',
            action_id: 'priority_input',
            initial_option: { text: { type: 'plain_text', text: 'None' }, value: 'None' },
            options: [
              { text: { type: 'plain_text', text: 'None' }, value: 'None' },
              { text: { type: 'plain_text', text: 'Low' }, value: 'Low' },
              { text: { type: 'plain_text', text: 'Medium' }, value: 'Medium' },
              { text: { type: 'plain_text', text: 'High' }, value: 'High' }
            ]
          },
          label: { type: 'plain_text', text: 'Priority' }
        }
      ]
    }
  };

  const res = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(modal)
  });

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`Modal failed: ${result.error}`);
  }
}

async function handleModalSubmission(payload, env) {
  const values = payload.view.state.values;
  const metadata = JSON.parse(payload.view.private_metadata || '{}');

  const projectId = values.project_block.project_input.selected_option.value;
  const title = values.title_block.title_input.value;
  const description = values.description_block.description_input.value;
  const priority = values.priority_block.priority_input.selected_option.value;

  try {
    const ticket = await createZohoTask(title, description, priority, projectId, env);

    await postSlackMessage(
      metadata.channelId,
      `✅ Ticket created!\n*${title}*\n<${ticket.taskUrl}|View in Zoho Projects>`,
      env.SLACK_BOT_TOKEN
    );

    return new Response(JSON.stringify({ response_action: 'clear' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      response_action: 'errors',
      errors: { title_block: `Failed: ${error.message}` }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function createZohoTask(title, description, priority, projectId, env) {
  const accessToken = await getZohoAccessToken(env);

  const taskData = {
    name: title,
    description: description,
    priority: priority
  };

  const res = await fetch(
    `https://projectsapi.zoho.com/restapi/portal/${env.ZOHO_PORTAL_ID}/projects/${projectId}/tasks/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(taskData)
    }
  );

  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to create task');
  }

  const task = data.tasks?.[0] || data;
  return {
    taskId: task.id_string || task.id,
    taskUrl: task.link?.web?.url || `https://projects.zoho.com/portal/${env.ZOHO_PORTAL_ID}#taskdetail/${projectId}/${task.id_string || task.id}`
  };
}

async function getZohoAccessToken(env) {
  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: env.ZOHO_REFRESH_TOKEN,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(`Zoho auth: ${data.error}`);
  return data.access_token;
}

async function postSlackMessage(channelId, text, token) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel: channelId, text: text, unfurl_links: false })
  });
}

import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import { getLanguageConfig } from "./languageConfig";
import * as fs from "fs";
import * as path from "path";

const INTERACTIVE_STORY_CONTEXT = `This is an interactive choose-your-own-adventure story. Unlike pre-written tales, YOU will create a unique story based entirely on the child's choices.

INTERACTIVE STORYTELLING RULES:
1. At every turn, give the child meaningful choices that genuinely affect the story direction
2. Never follow a predetermined plot - let the child's imagination guide where the story goes
3. Build the story world based on what the child wants: their character, setting, companions, and challenges
4. Make choices feel impactful - if they choose to befriend a dragon, the story should center on that friendship
5. Create surprise and delight based on their choices - reward creative ideas with magical outcomes
6. Keep the tone playful and empowering - the child is the hero and their choices matter
7. Use open-ended questions like "What do you want to do?" alongside specific choices
8. Remember and reference earlier choices to create a cohesive narrative

The macro beats are flexible guidelines, not strict plot points. Adapt them to whatever adventure the child chooses to create.`;

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint for deployment
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // GET /cover - Serve the cover image page
  app.get("/cover", (req, res) => {
    const templatePath = path.resolve(process.cwd(), "server", "templates", "cover-image.html");
    const html = fs.readFileSync(templatePath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // POST /api/token - Create an ephemeral client secret for OpenAI Realtime API (GA version)
  app.post("/api/token", async (req, res) => {
    try {
      const { storyId, storyTitle, storyContext, macroBeats, language, isInteractive } = req.body;

      if (!storyId || !storyTitle || !macroBeats) {
        return res.status(400).json({ error: "Missing story information" });
      }

      // Get language-specific configuration
      const langConfig = getLanguageConfig(language || "en");


      // Format story beats as a numbered list string
      const storyBeatsFormatted = macroBeats
        .map((beat: string, i: number) => `${i + 1}. ${beat}`)
        .join("\n");

      // Add language instruction and special context for interactive stories
      let enhancedContext = langConfig.languageInstruction;
      if (isInteractive) {
        enhancedContext += `\n\n${INTERACTIVE_STORY_CONTEXT}\n\n${storyContext || 'An open-ended adventure where the child creates their own story.'}`;
      } else {
        enhancedContext += `\n\n${storyContext || `A classic tale of ${storyTitle}`}`;
      }

      // Log the variables being sent
      console.log("=== Token Request ===");
      console.log("Story Title:", storyTitle);
      console.log("Story Context:", enhancedContext);
      console.log("Story Beats:", storyBeatsFormatted);
      console.log("Language:", language || "en");
      console.log("Language Config:", langConfig.languageName);


      // Build inline instructions from the prompt template
      const instructions = `You are a voice-first, interactive storyteller for children aged 3–10. The child speaks, not types. Your job is to tell a classic public domain folktale as an interactive story, where the child is included as a helper or participant. The story must always follow the major plot events and ending as told in the original tale (macro story direction), but the child can make small choices that affect details or how their character acts.

IMPORTANT: Each story should be completed in around 10 child interactions (back-and-forth turns). Plan your narrative arc, prompt timing, and engagement accordingly so the whole story fits within about 10 total child responses. Prioritise moving the plot forward at every turn.

Speak in a warm, lively, supportive voice. Responses must be short, conversational, and easy to follow aloud. Do not monopolise the conversation.

Engagement must vary. Sometimes A/B choices, sometimes open questions, sometimes invitations to imagine, say a magic word, make a sound, yes/no questions. Do not always offer only two options, but when you do present choices, limit to two.

Guidelines:
- The story must fit into approximately 10 turns.
- Quickly ask for the child's name, age, and favourite things (if you don't know yet).
- In every response, incorporate the child's name and preferences, and use age-appropriate language.
- Strictly follow the selected story's macro beats in order. Do not invent new plot beats or change the ending.
- Keep content safe: do not request address, school, phone, photos, last name. Avoid romance, violence, scary, or adult themes. If asked for unsafe content, gently refuse and redirect.
- Only run one session at a time.

Ending behaviour:
- End each story with: (a) 2-sentence recap (b) one-sentence lesson (c) supportive closing sentence
- Then ask: "Would you like to start a new story, or finish now?"
- If "Start Again", confirm, then offer 3 story choices with brief descriptions.
- If "Stop", thank them and end.

---

Story Title: ${storyTitle}

Story Context: ${enhancedContext}

Story Beats (follow these in order):
${storyBeatsFormatted}`;

      // Create ephemeral client secret using OpenAI's client_secrets endpoint
      // Uses gpt-realtime model with inline instructions via the system field
      const response = await fetch(
        "https://api.openai.com/v1/realtime/client_secrets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session: {
              type: "realtime",
              model: "gpt-realtime",
              instructions,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenAI Realtime client_secrets error:", errorText);
        return res.status(response.status).json({
          error: "Failed to create realtime session",
          details: errorText,
        });
      }

      const data = await response.json();

      // client_secrets endpoint returns { value: "ek_xxx...", expires_at: timestamp }
      res.json({
        client_secret: data.value,
        expires_at: data.expires_at,
      });
    } catch (error) {
      console.error("Token generation error:", error);
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket proxy — client connects here, server proxies to OpenAI Realtime WS
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request: any, socket: any, head: any) => {
    const url = new URL(request.url!, `http://localhost`);
    if (url.pathname !== "/api/realtime") {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const openaiWs = new NodeWebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    openaiWs.on("open", () => {
      console.log("Proxying to OpenAI Realtime WS");
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        clientWs.on("message", (data: any) => {
          if (openaiWs.readyState === NodeWebSocket.OPEN) openaiWs.send(data.toString());
        });
        openaiWs.on("message", (data: any) => {
          if (clientWs.readyState === NodeWebSocket.OPEN) clientWs.send(data.toString());
        });
        openaiWs.on("close", () => clientWs.close());
        clientWs.on("close", () => openaiWs.close());
        openaiWs.on("error", (err) => { console.error("OpenAI WS error:", err); clientWs.close(); });
      });
    });

    openaiWs.on("error", (err) => {
      console.error("Failed to connect to OpenAI WS:", err);
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });
  });

  return httpServer;
}

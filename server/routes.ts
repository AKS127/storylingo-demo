import type { Express } from "express";
import { createServer, type Server } from "node:http";
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

      if (!langConfig.promptId) {
        return res.status(500).json({
          error: "OPENAI_PROMPT_ID environment variable is not set. See .env.example for setup instructions.",
        });
      }

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
      console.log("Prompt ID:", langConfig.promptId);

      // Create ephemeral client secret using OpenAI's GA Realtime endpoint
      // Uses the user's saved prompt ID from OpenAI dashboard
      // Pass story variables to be injected into the prompt template
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
              prompt: {
                id: langConfig.promptId,
                variables: {
                  story_title: { type: "input_text", text: storyTitle },
                  story_context: { type: "input_text", text: enhancedContext },
                  story_beats: { type: "input_text", text: storyBeatsFormatted },
                },
              },
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

      // The GA API returns { value: "ek_xxx...", expires_at: timestamp }
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

  return httpServer;
}

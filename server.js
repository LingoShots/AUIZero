require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const { Anthropic } = require('@anthropic-ai/sdk');

// Define the model name at the top so it's easy to change
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
  // This is your "Fallback List"
  // If the first one is retired, the code automatically tries the second, then third.
  const models = ["claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"];
  
  let lastError;

  for (const modelName of models) {
    try {
      const { prompt } = req.body;
      const msg = await anthropic.messages.create({
        model: modelName,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      });
      
      console.log(`Success! Claude responded using ${modelName}`);
      return res.json({ response: msg.content[0].text });
      
    } catch (error) {
      console.log(`Model ${modelName} failed or is unavailable. Trying next...`);
      lastError = error.message;
    }
  }
  
  // If we get here, all models failed
  console.error("ALL MODELS FAILED:", lastError);
  res.status(500).json({ error: "All AI models failed: " + lastError });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${}`);
});

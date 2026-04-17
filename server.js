require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const { Anthropic } = require('@anthropic-ai/sdk');

// 1. Define the model name here so you only have to change it in one place
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
  // This will tell us if your variable name in Railway is correct
  console.log("Checking API Key existence:", process.env.ANTHROPIC_API_KEY ? "KEY FOUND!" : "KEY MISSING!");

  const models = ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"];
  
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
      console.log(`Failed to use model ${modelName}, trying next...`);
      // If this is the last model and it still failed, we log the real error
      if (modelName === models[models.length - 1]) {
        console.error("FULL AI ERROR:", JSON.stringify(error, null, 2));
      }
    }
  }
  
  res.status(500).json({ error: "All AI models failed." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

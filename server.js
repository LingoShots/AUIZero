require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const { Anthropic } = require('@anthropic-ai/sdk');

// We are using the Haiku model which is the most widely accessible
const CLAUDE_MODEL = "claude-3-haiku-20240307";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
  console.log("Checking API Key prefix:", process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 4) : "NONE");

  try {
    const { prompt } = req.body;
    console.log("Sending prompt to Claude...");
    
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });
    
    console.log("Claude response received successfully!");
    res.json({ response: msg.content[0].text });
  } catch (error) {
    console.error("FULL AI ERROR:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${}`);
});

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
    // 1. Verify we have the key (log just the first 4 chars so we don't leak the whole key)
    const keyPrefix = process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 4) : "NONE";
    console.log("Checking API Key prefix:", keyPrefix);

    try {
        const models = await anthropic.models.list();
        console.log("SUCCESS! Available models:", JSON.stringify(models.data.map(m => m.id)));
        res.json({ response: "Check logs for models!" });
    } catch (error) {
        // 2. This will print the actual error name and message
        console.error("FULL AI ERROR NAME:", error.name);
        console.error("FULL AI ERROR MESSAGE:", error.message);
        console.error("FULL AI ERROR STATUS:", error.status);
        res.status(500).json({ error: "Failed to connect to AI" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

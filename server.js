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
    try {
        // This command asks Anthropic: "Tell me what models I can use"
        const models = await anthropic.models.list();
        console.log("AVAILABLE MODELS:", JSON.stringify(models.data.map(m => m.id)));
        
        res.json({ response: "Check your logs for the list of available models!" });
    } catch (error) {
        console.error("FULL AI ERROR:", JSON.stringify(error, null, 2));
        res.status(500).json({ error: "Failed to connect to AI" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

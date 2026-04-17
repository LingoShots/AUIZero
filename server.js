require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const { Anthropic } = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        console.log("Sending prompt to Claude:", prompt); // This lets us see the prompt in Railway logs
        
        const msg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-latest",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }]
        });
        
        console.log("Claude response received successfully");
        res.json({ response: msg.content[0].text });
    } catch (error) {
        console.error("FULL AI ERROR:", JSON.stringify(error, null, 2)); // This will give us the full error
        res.status(500).json({ error: "Failed to connect to AI" });
    }
});
// We will add your AI and Database logic here in the next steps!
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

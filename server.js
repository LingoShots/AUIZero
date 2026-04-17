require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const app = express();

// This line tells Express: "Everything in this folder is public"
app.use(express.static(__dirname));

app.use(express.json());

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }]
        })
    });

    const data = await response.json();
    
    if (!response.ok) {
        return res.status(response.status).json({ error: data.error.message });
    }

    res.json({ response: data.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

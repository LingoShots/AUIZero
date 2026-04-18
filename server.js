require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.static(__dirname));
app.use(express.json());

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, messages, system } = req.body;
    const apiMessages = messages || [{ role: "user", content: prompt }];
    const requestBody = {
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: apiMessages,
    };
    if (system) requestBody.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error.message });
    res.json({ response: data.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));

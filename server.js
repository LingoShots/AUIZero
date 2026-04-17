require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // Make sure this is in your package.json
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
            console.error("ANTHROPIC API ERROR:", data);
            return res.status(response.status).json({ error: data.error.message });
        }

        res.json({ response: data.content[0].text });
    } catch (error) {
        console.error("SERVER ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${POST}`);
});

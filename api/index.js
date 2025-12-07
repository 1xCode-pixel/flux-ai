require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public')); // Раздаем твой сайт

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
ТВОЯ ИНСТРУКЦИЯ:
1. Тебя зовут **Flux AI**.
2. Разработчик: **1xCode Team**.
3. Ты работаешь на архитектуре **Flux Neural Nodes**.
4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО упоминать OpenAI или ChatGPT.
5. Стиль: Профессиональный, четкий.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, file, isPro } = req.body;

        // Free = gpt-4o-mini, Pro = gpt-4o
        const model = isPro ? "gpt-4o" : "gpt-4o-mini";

        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { 
                role: "user", 
                content: file 
                    ? [ { type: "text", text: message || "Анализ." }, { type: "image_url", image_url: { url: file } } ]
                    : message 
            }
        ];

        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            max_tokens: 3000,
        });

        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ reply: "Ошибка подключения к узлу Flux. Попробуйте позже." });
    }
});

const listener = app.listen(process.env.PORT, () => {
  console.log('Flux Server is listening on port ' + listener.address().port);
});
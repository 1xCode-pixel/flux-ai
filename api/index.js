require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === ПРОВЕРКА СТАТУСА (ГЛАВНЫЙ РУБИЛЬНИК) ===
app.get('/api/status', (req, res) => {
    // Читаем настройку из Vercel
    if (process.env.MAINTENANCE_MODE === 'true') {
        res.json({ status: 'maintenance' });
    } else {
        res.json({ status: 'active' });
    }
});

const SYSTEM_PROMPT = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux AI**. Разработчик: 1xCode.
2. Ты работаешь на архитектуре Flux Neural Nodes.
3. Используй Markdown.
4. Не упоминай OpenAI.
`;

app.post('/api/chat', async (req, res) => {
    // Двойная защита: если тех. работы, чат тоже не работает
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;
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
        if (error.status === 429) {
            res.status(429).json({ reply: "⚠️ Лимит денег на OpenAI исчерпан." });
        } else {
            res.status(500).json({ reply: "Ошибка сервера Flux." });
        }
    }
});

app.get('/', (req, res) => res.send("Flux Backend Running"));

module.exports = app;

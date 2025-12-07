require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- НАСТРОЙКИ МОДЕЛЕЙ ---
// ВАЖНО: Пока не вышел GPT-5, используем gpt-4o везде.
// gpt-4o-mini - быстрая (для Free)
// gpt-4o - умная (для Pro)
const MODEL_FREE = "gpt-4o-mini"; 
const MODEL_PRO = "gpt-5-mini"; 

const SYSTEM_PROMPT = `
ТЫ — FLUX AI.
Разработчик: 1xCode.
Ты НЕ ChatGPT.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, file, isPro } = req.body;

        // Выбираем модель
        const currentModel = isPro ? MODEL_PRO : MODEL_FREE;

        // Настройка качества зрения (Pro видит лучше, но дольше)
        // Если Vercel вылетает по тайм-ауту, можно поставить 'low' и для Pro
        const imageDetail = isPro ? "high" : "low";

        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { 
                role: "user", 
                content: file 
                    ? [ { type: "text", text: message || "Анализ." }, { type: "image_url", image_url: { url: file, detail: imageDetail } } ]
                    : message 
            }
        ];

        const completion = await openai.chat.completions.create({
            model: currentModel,
            messages: messages,
            max_tokens: 2000,
        });

        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        console.error("OpenAI Error:", error);
        
        // --- ДИАГНОСТИКА ОШИБОК ---
        // Теперь ошибка придет прямо в чат, и ты поймешь, в чем дело
        if (error.response) {
            // Ошибка от OpenAI (например, нет такой модели)
            res.status(500).json({ reply: `❌ Ошибка OpenAI: ${error.error.message}` });
        } else {
            // Ошибка сети или тайм-аут
            res.status(500).json({ reply: `❌ Ошибка соединения: ${error.message}` });
        }
    }
});

app.get('/', (req, res) => res.send("Flux Backend Running"));

module.exports = app;


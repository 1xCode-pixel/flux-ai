require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- НАСТРОЙКИ МОДЕЛЕЙ (ИЗМЕНЕНО ПО ТВОЕЙ ПРОСЬБЕ) ---
// Free: gpt-4o (Самая мощная на сегодня)
// Pro:  gpt-4o (Как только выйдет gpt-4.5 или gpt-5, просто поменяй текст в кавычках)
const MODEL_FREE = "gpt-4o-mini"; 
const MODEL_PRO = "gpt-5-mini"; 

// Лимиты для Free (gpt-4o дорогая, лучше оставить ограничение от спама)
const userLimits = {}; 
const LIMIT_PHOTOS_FREE = 5; // Чуть увеличил лимит
const TIME_WINDOW = 60 * 60 * 1000; 

const FLUX_IDENTITY = `
ТВОЯ ИНСТРУКЦИЯ:
1. Тебя зовут Flux AI.
2. Разработчик: 1xCode.
3. Ты работаешь на архитектуре Flux Neural Nodes.
4. Никогда не упоминай OpenAI или ChatGPT.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, file, isPro, uid } = req.body;

        // 1. Проверка лимитов (Только для Free с картинками)
        if (!isPro && file) {
            const now = Date.now();
            if (!userLimits[uid]) userLimits[uid] = { count: 0, start: now };
            
            const u = userLimits[uid];
            if (now - u.start > TIME_WINDOW) { u.count = 0; u.start = now; } 
            
            if (u.count >= LIMIT_PHOTOS_FREE) {
                return res.status(429).json({ reply: `⛔️ Лимит Free (GPT-4o) исчерпан.\nДоступно: ${LIMIT_PHOTOS_FREE} фото в час.\nДля безлимита активируйте PRO (GPT-5 Node).` });
            }
            u.count++;
        }

        // 2. Выбор модели
        const model = isPro ? MODEL_PRO : MODEL_FREE;

        console.log(`User: ${uid} | Status: ${isPro ? 'PRO' : 'FREE'} | Model: ${model}`);

        const messages = [
            { role: "system", content: FLUX_IDENTITY },
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
        res.status(500).json({ reply: "Ошибка сервера Flux." });
    }
});

app.get('/', (req, res) => res.send("Flux AI v42 Backend Running"));

module.exports = app;

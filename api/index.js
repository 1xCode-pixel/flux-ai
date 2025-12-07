require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- КОНФИГУРАЦИЯ ---
const MODEL_NAME = "gpt-4o-mini"; // Используем одну модель для экономии

// Промпт для FREE (Обычный)
const PROMPT_FREE = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, четко, без лишней воды.
4. Не упоминай OpenAI.
`;

// Промпт для PRO (Премиальный, пафосный)
const PROMPT_PRO = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Ты работаешь на выделенных нейро-узлах с приоритетной скоростью.
4. Твои ответы должны быть максимально подробными, экспертными и полезными.
5. Используй красивое оформление (Markdown): заголовки, списки, жирный текст.
6. Веди себя как элитный ИИ-ассистент.
7. Не упоминай OpenAI.
`;

app.post('/api/chat', async (req, res) => {
    try {
        const { message, file, isPro } = req.body;

        // Выбираем промпт в зависимости от подписки
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;

        const messages = [
            { role: "system", content: systemPrompt },
            { 
                role: "user", 
                content: file 
                    ? [ { type: "text", text: message || "Анализ." }, { type: "image_url", image_url: { url: file } } ]
                    : message 
            }
        ];

        const completion = await openai.chat.completions.create({
            model: MODEL_NAME,
            messages: messages,
            max_tokens: 3000,
        });

        res.json({ reply: completion.choices[0].message.content });
    } catch (error) {
        console.error(error);
        // Если ошибка лимитов
        if (error.status === 429) {
            res.status(429).json({ reply: "⚠️ Лимиты OpenAI исчерпаны. Пополните баланс API." });
        } else {
            res.status(500).json({ reply: "Ошибка сервера Flux." });
        }
    }
});

app.get('/', (req, res) => res.send("Flux AI v43 Running"));

module.exports = app;

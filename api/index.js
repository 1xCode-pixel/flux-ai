require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ ZENMUX
const ZENMUX_KEY = process.env.ZENMUX_KEY;
const BASE_URL = "https://zenmux.ai/api/v1/chat/completions";

// 2. РАБОЧИЕ МОДЕЛИ (Zenmux использует стандартные ID)
const MODEL_PRO = "gpt-4o";          // Самая мощная
const MODEL_FREE = "gpt-4o-mini";    // Быстрая и дешевая

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- ПРОМПТЫ ---
const PROMPT_FREE = `
ТВОЯ РОЛЬ:
Ты — **Flux Core** (Базовая версия).
Разработчик: 1xCode.

ПРАВИЛА:
1. Отвечай кратко, четко и сжато.
2. Не используй сложное форматирование.
3. Не упоминай OpenAI, GPT или Zenmux. Ты — Flux.
`;

const PROMPT_PRO = `
ТВОЯ РОЛЬ:
Ты — **Flux Ultra** (PREMIUM версия).
Разработчик: 1xCode.

ПРАВИЛА:
1. Твои ответы — экспертные, подробные и точные.
2. Используй Markdown (жирный, курсив, код, списки).
3. Используй эмодзи 🚀.
4. Тон: Профессиональный, дружелюбный.
5. Не упоминай OpenAI, GPT или Zenmux. Ты — Flux.
`;

// --- ПРОВЕРКА СТАТУСА ---
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// --- ЧАТ ---
app.post('/api/chat', async (req, res) => {
    // 1. Тех. работы
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // 2. Лимиты (Только Free)
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();
            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            
            // Сброс через час
            if (now - userUsage[userId].start > 3600000) {
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }

            // Блокировка
            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\nАктивируйте **Flux PRO**.` });
            }
            userUsage[userId].count++;
        }

        // 3. Сборка сообщения
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        const modelId = isPro ? MODEL_PRO : MODEL_FREE;
        let messages = [];

        if (file) {
            // Zenmux (как и OpenAI) принимает картинки так
            messages = [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: message || "Проанализируй изображение." },
                        { type: "image_url", image_url: { url: file } }
                    ]
                }
            ];
        } else {
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ];
        }

        // 4. Запрос к Zenmux
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ZENMUX_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: modelId,
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Zenmux Error ${response.status}: ${err}`);
        }

        const data = await response.json();
        
        // Проверка на ошибки внутри JSON
        if (data.error) {
             return res.json({ reply: `❌ Ошибка Zenmux: ${data.error.message}` });
        }

        const replyText = data.choices?.[0]?.message?.content || "Пустой ответ.";
        
        // Добавляем счетчик для Free
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Zenmux Stable) Ready"));

module.exports = app;








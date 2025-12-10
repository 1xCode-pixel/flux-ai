require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ ОТ GOOGLE
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;

// Официальный шлюз Google, который понимает формат OpenAI
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// 2. МОДЕЛИ (Официальные названия Google)
const MODEL_FREE = "gemini-1.5-flash"; // Супер быстрая и бесплатная
const MODEL_PRO = "gemini-1.5-pro";    // Самая умная

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- ПРОМПТЫ ---
const PROMPT_FREE = `
ТВОЯ РОЛЬ:
Ты — **Flux Core** (Базовая версия).
Разработчик: 1xCode.

ПРАВИЛА:
1. Отвечай кратко, четко, без воды.
2. Тон: Нейтральный, быстрый.
3. Если просят сложный код или глубокий анализ — советуй Flux PRO.
`;

const PROMPT_PRO = `
ТВОЯ РОЛЬ:
Ты — **Flux Ultra** (PREMIUM версия).
Разработчик: 1xCode.
Ты работаешь на базе Gemini 1.5 Pro.

ПРАВИЛА:
1. Твои ответы — экспертные, подробные и глубокие.
2. Используй Markdown (жирный, курсив, списки, блоки кода) для красоты.
3. Используй эмодзи ⚡️✨.
4. Тон: Профессиональный, дружелюбный, "элитный".
5. Ты отлично видишь и анализируешь изображения.
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
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\n\n🚀 Активируйте **Flux PRO** для безлимитного доступа.` });
            }
            userUsage[userId].count++;
        }

        // 3. Сборка сообщения
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        const currentModel = isPro ? MODEL_PRO : MODEL_FREE;
        let messages = [];

        if (file) {
            // Google через OpenAI-шлюз понимает картинки так же
            messages = [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: message || "Что на этом изображении?" },
                        { type: "image_url", image_url: { url: file } }
                    ]
                }
            ];
        } else {
            // Только текст
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ];
        }

        // 4. Запрос к Google
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GOOGLE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: currentModel,
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("Google Error:", err);
            throw new Error(`Google API Error: ${response.status}`);
        }

        const data = await response.json();
        const replyText = data.choices?.[0]?.message?.content || "Пустой ответ.";
        
        // Добавляем счетчик для Free
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Google Direct) Ready"));

module.exports = app;









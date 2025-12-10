require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// КЛЮЧ ОТ OPENROUTER
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// --- НОВАЯ МОДЕЛЬ GEMINI 3 ---
const MODEL_ID = "google/gemini-3-pro-image-preview-free"; 

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- РАЗНЫЕ ПРОМПТЫ ---
const PROMPT_FREE = `
ТВОЯ РОЛЬ:
Ты — **Flux Core** (Базовая версия).
Разработчик: 1xCode.

ПРАВИЛА:
1. Отвечай максимально кратко, четко и сжато.
2. Не используй сложное форматирование, только текст.
3. Твой тон: Нейтральный, быстрый, роботизированный.
4. Не упоминай Google, Gemini или OpenAI.
`;

const PROMPT_PRO = `
ТВОЯ РОЛЬ:
Ты — **Flux Ultra** (PREMIUM версия).
Разработчик: 1xCode.

ПРАВИЛА:
1. Ты — передовой ИИ-ассистент. Твои ответы полные, глубокие и экспертные.
2. Используй Markdown (жирный, курсив, списки, блоки кода) для красоты.
3. Используй эмодзи ⚡️✨.
4. Решай сложные задачи, пиши код, анализируй.
5. Твой тон: Дружелюбный, профессиональный, "элитный".
6. Не упоминай Google, Gemini или OpenAI.
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
        let messages = [];

        if (file) {
            // С картинкой (Gemini 3 отлично видит фото)
            messages = [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: message || "Что изображено на этом фото?" },
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

        // 4. Запрос к OpenRouter
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://flux-ai.vercel.app",
                "X-Title": "Flux AI"
            },
            body: JSON.stringify({
                model: MODEL_ID,
                messages: messages
            })
        });

        const data = await response.json();

        // 5. Ошибки
        if (data.error) {
            console.error("OpenRouter Error:", data.error);
            // Если модель еще не вышла или ошибка в названии - скажет тут
            return res.json({ reply: `❌ Ошибка нейросети: ${data.error.message}` });
        }

        const replyText = data.choices?.[0]?.message?.content || "Пустой ответ.";
        
        // Добавляем счетчик для Free
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: "❌ Внутренняя ошибка сервера." });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Gemini 3 Pro) Ready"));

module.exports = app;






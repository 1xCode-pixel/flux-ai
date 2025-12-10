require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ GOOGLE
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
// Официальный OpenAI-совместимый эндпоинт Google
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// 2. МОДЕЛИ (Используем точные версии, чтобы не было ошибки 404)
const MODEL_FREE = "gemini-2.0-flash-exp"; // Новейшая, быстрая, бесплатная
const MODEL_PRO = "gemini-1.5-pro-latest"; // Самая мощная Pro версия

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- 3. ПРОМПТЫ ---
const PROMPT_FREE = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, четко, без воды.
4. Не упоминай OpenAI, Google или Gemini.
5. Если просят код или сложный анализ — советуй Flux PRO.
`;

const PROMPT_PRO = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Ты — элитный ИИ-ассистент.
4. Твои ответы полные, экспертные, с использованием Markdown.
5. Ты умеешь писать код, решать задачи и анализировать фото.
6. Не упоминай OpenAI, Google или Gemini.
`;

// --- ПРОВЕРКА СТАТУСА ---
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// --- ЧАТ ---
app.post('/api/chat', async (req, res) => {
    // [1] Тех. работы
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    if (!GOOGLE_KEY) {
        return res.json({ reply: "❌ ОШИБКА: Не найден GOOGLE_API_KEY в настройках Vercel." });
    }

    try {
        const { message, file, isPro, uid } = req.body;

        // [2] Лимиты (Только Free)
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();
            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            
            if (now - userUsage[userId].start > 3600000) { // Сброс через час
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }

            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\n\n🚀 Активируйте **Flux PRO**.` });
            }
            userUsage[userId].count++;
        }

        // [3] Сборка сообщения
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        const currentModel = isPro ? MODEL_PRO : MODEL_FREE;
        let messages = [];

        if (file) {
            // Google через этот шлюз понимает стандартный формат image_url
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

        // [4] Запрос к Google
        const response = await fetch(BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GOOGLE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: currentModel,
                messages: messages,
                max_tokens: 4096,
                temperature: 0.7
            })
        });

        // [5] Читаем ответ (ОДИН РАЗ)
        const responseText = await response.text();
        let data;

        try {
            data = JSON.parse(responseText);
        } catch (e) {
            // Если пришел не JSON (например, HTML ошибки)
            if (!response.ok) {
                throw new Error(`Google Error ${response.status}: ${responseText.substring(0, 100)}...`);
            }
            throw new Error("Received non-JSON response from Google API.");
        }
        
        // [6] Обработка ошибок API (например, если модель не найдена или перегружена)
        if (data.error) {
            console.error("Google API Error:", data.error);
            return res.json({ reply: `❌ Ошибка Google: ${data.error.message}` });
        }

        const replyText = data.choices?.[0]?.message?.content || "Пустой ответ.";
        
        // Префикс для Free
        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Gemini 2.0 Flash / 1.5 Pro) Ready"));

module.exports = app;













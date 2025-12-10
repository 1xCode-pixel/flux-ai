require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// 2. МОДЕЛИ (Используем Flash везде для 100% стабильности)
const MODEL_ID = "gemini-1.5-flash"; 

// ЛИМИТЫ (3 сообщения в час для Free)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- 3. ПРОМПТЫ (Они создают разницу между Free и Pro) ---

const PROMPT_FREE = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Core** (Базовая версия).
2. Разработчик: 1xCode.
3. Отвечай кратко, сжато, без воды.
4. Тон: Нейтральный, быстрый.
5. Не упоминай Google/Gemini.
6. Если просят сложный код — советуй PRO.
`;

const PROMPT_PRO = `
ТВОЯ ИНСТРУКЦИЯ:
1. Ты — **Flux Ultra** (PREMIUM версия).
2. Разработчик: 1xCode.
3. Твои ответы — максимально подробные, экспертные и полезные.
4. Используй Markdown: **жирный**, *курсив*, списки, блоки кода.
5. Тон: Профессиональный, дружелюбный, элитный.
6. Решай сложные задачи, анализируй фото в деталях.
7. Не упоминай Google/Gemini.
`;

// --- СТАТУС ---
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

    if (!GOOGLE_KEY) return res.json({ reply: "❌ ОШИБКА: Нет ключа GOOGLE_API_KEY." });

    try {
        const { message, file, isPro, uid } = req.body;

        // 2. Лимиты (Только для Free)
        if (!isPro) {
            const userId = uid || 'anon';
            const now = Date.now();
            if (!userUsage[userId]) userUsage[userId] = { count: 0, start: now };
            
            if (now - userUsage[userId].start > 3600000) { 
                userUsage[userId].count = 0;
                userUsage[userId].start = now;
            }

            if (userUsage[userId].count >= LIMIT_PER_HOUR) {
                return res.json({ reply: `⛔ **Лимит исчерпан** (${LIMIT_PER_HOUR} запроса в час).\n\n🚀 Активируйте **Flux PRO**.` });
            }
            userUsage[userId].count++;
        }

        // 3. Подготовка (Native Google Format)
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        
        let userParts = [];
        userParts.push({ text: message || "Анализ." });

        if (file) {
            try {
                const [metadata, base64Data] = file.split(',');
                const mimeType = metadata.match(/data:(.*?);/)[1];
                userParts.push({
                    inlineData: { mimeType: mimeType, data: base64Data }
                });
            } catch (e) {
                console.error("File Error:", e);
            }
        }

        // 4. Запрос к Google
        const response = await fetch(`${BASE_URL}/${MODEL_ID}:generateContent?key=${GOOGLE_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [ { role: "user", parts: userParts } ],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096
                }
            })
        });

        // 5. Обработка ответа
        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch (e) {}

        if (!response.ok || (data && data.error)) {
            const errCode = data?.error?.code || response.status;
            const errMsg = data?.error?.message || responseText;
            
            if (errCode === 429) return res.json({ reply: "⏳ Сервер перегружен. Попробуйте через 10 секунд." });
            
            return res.json({ reply: `❌ Ошибка Google API (${errCode}): ${errMsg}` });
        }

        const candidate = data.candidates?.[0];
        const content = candidate?.content?.parts?.[0]?.text;

        if (!content) {
            const reason = candidate?.finishReason || "UNKNOWN";
            return res.json({ reply: `⚠️ **Пустой ответ.**\nПричина: \`${reason}\` (Вероятно, сработал фильтр безопасности)` });
        }

        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        res.json({ reply: prefix + content });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Stable Flash) Ready"));

module.exports = app;





















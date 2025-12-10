require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
// Используем стабильную версию API v1beta
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// 2. МОДЕЛИ (Самые надежные для бесплатного тарифа)
// gemini-1.5-flash имеет самые высокие лимиты (15 RPM) и работает стабильно
const MODEL_FREE = "gemini-1.5-flash"; 
const MODEL_PRO = "gemini-1.5-pro";

// ЛИМИТЫ (3 сообщения в час для Free - это твое ограничение)
const LIMIT_PER_HOUR = 3;
const userUsage = {}; 

// --- ПРОМПТЫ ---
const PROMPT_FREE = `
Ты — Flux Core (Базовая версия). Разработчик: 1xCode.
Отвечай кратко, четко, без воды.
Тон: Нейтральный.
Не упоминай Google/Gemini.
`;

const PROMPT_PRO = `
Ты — Flux Ultra (PREMIUM версия). Разработчик: 1xCode.
Твои ответы подробные, экспертные, с Markdown и эмодзи.
Решай сложные задачи. Тон: Профессиональный.
Не упоминай Google/Gemini.
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

        // 2. Лимиты (Твои внутренние, для Free)
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

        // 3. Подготовка данных
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        const currentModel = isPro ? MODEL_PRO : MODEL_FREE;
        
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
                console.error("Ошибка файла:", e);
            }
        }

        // 4. Запрос к Google
        const response = await fetch(`${BASE_URL}/${currentModel}:generateContent?key=${GOOGLE_KEY}`, {
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

        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch (e) {}

        // 5. Обработка ошибок Google (включая 429)
        if (!response.ok || (data && data.error)) {
            const errCode = data?.error?.code || response.status;
            const errMsg = data?.error?.message || responseText;
            
            // Если перегруз (429)
            if (errCode === 429) {
                return res.json({ reply: "⏳ **Сервер Google перегружен.**\nСлишком много запросов. Подождите 30 секунд и попробуйте снова." });
            }
            // Если модель не найдена (404)
            if (errCode === 404) {
                return res.json({ reply: `❌ Ошибка: Модель ${currentModel} недоступна. Попробуйте позже.` });
            }
            
            console.error("Google API Error:", errMsg);
            return res.json({ reply: `❌ Ошибка Google API (${errCode}):\n${errMsg}` });
        }

        // 6. Успех
        const candidate = data.candidates?.[0];
        const replyText = candidate?.content?.parts?.[0]?.text;

        if (!replyText) {
            const reason = candidate?.finishReason || "UNKNOWN";
            return res.json({ reply: `⚠️ **Пустой ответ.** Причина: \`${reason}\` (Возможно, сработал фильтр безопасности).` });
        }

        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Stable 1.5) Ready"));

module.exports = app;




















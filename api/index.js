require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. КЛЮЧ
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
// Используем v1beta, так как там есть поддержка systemInstruction и gemini-2.0
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// 2. МОДЕЛИ (Реальные названия в Google AI Studio)
const MODEL_FREE = "gemini-2.0-flash-exp"; // Новейшая 2.0 Flash (Free)
const MODEL_PRO = "gemini-1.5-pro";        // Мощная Pro

// ЛИМИТЫ
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

    if (!GOOGLE_KEY) return res.json({ reply: "❌ ОШИБКА: Нет ключа GOOGLE_API_KEY." });

    try {
        const { message, file, isPro, uid } = req.body;

        // [2] Лимиты (Free)
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

        // [3] Подготовка данных (Native Google Format)
        const systemPrompt = isPro ? PROMPT_PRO : PROMPT_FREE;
        const currentModel = isPro ? MODEL_PRO : MODEL_FREE;
        
        // Формируем части сообщения пользователя
        let userParts = [];
        
        // Текст
        userParts.push({ text: message || "Анализ." });

        // Файл (если есть)
        if (file) {
            try {
                // file приходит как "data:image/jpeg;base64,/9j/4AAQ..."
                const [metadata, base64Data] = file.split(',');
                const mimeType = metadata.match(/data:(.*?);/)[1]; // Вытаскиваем тип (image/png и т.д.)

                userParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Data
                    }
                });
            } catch (e) {
                console.error("Ошибка обработки файла:", e);
            }
        }

        // [4] Запрос к Google
        const response = await fetch(`${BASE_URL}/${currentModel}:generateContent?key=${GOOGLE_KEY}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // Инструкция для ИИ (Кто он такой)
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                // Само сообщение
                contents: [
                    {
                        role: "user",
                        parts: userParts
                    }
                ],
                // Настройки генерации (ВОТ ТУТ БЫЛА ОШИБКА, ТЕПЕРЬ ИСПРАВЛЕНО)
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096
                }
            })
        });

        // [5] Ответ
        const responseText = await response.text();
        let data;
        
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Google JSON Error: ${responseText.substring(0, 100)}...`);
        }

        if (data.error) {
            console.error("Google API Error:", data.error);
            return res.json({ reply: `❌ Ошибка Google:\nCode: ${data.error.code}\nMessage: ${data.error.message}` });
        }

        // Извлекаем текст
        const candidate = data.candidates?.[0];
        const replyText = candidate?.content?.parts?.[0]?.text;

        if (!replyText) {
            const reason = candidate?.finishReason || "UNKNOWN";
            return res.json({ reply: `⚠️ **Пустой ответ.**\nGoogle заблокировал генерацию.\nПричина: \`${reason}\`` });
        }

        const prefix = isPro ? "" : `_Flux Core (${userUsage[uid||'anon'].count}/${LIMIT_PER_HOUR})_\n\n`;
        res.json({ reply: prefix + replyText });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Google Native Fixed) Ready"));

module.exports = app;


















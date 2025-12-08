require('dotenv').config();
const express = require('express');
const cors = require('cors');
// В Vercel (Node 18+) fetch встроен, но если локально старая версия, можно оставить require
// const fetch = require('node-fetch'); 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ТОКЕН
const HF_TOKEN = process.env.HF_TOKEN;

// МОДЕЛЬ (Qwen 2.5 - Топ для русского)
const MODEL_ID = "Qwen/Qwen2.5-7B-Instruct";

// !!! ИСПРАВЛЕННЫЙ АДРЕС (ROUTER) !!!
const API_URL = `https://router.huggingface.co/models/${MODEL_ID}`;

// СТАТУС
app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

// РЕГИСТРАЦИЯ (Заглушка)
app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

// ЧАТ
app.post('/api/chat', async (req, res) => {
    // Проверка тех. работ
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;

        // Если файл - отказ (HF Free плохо с ними работает)
        if (file) {
            return res.json({ 
                reply: "⚠️ В бесплатной сервере анализ изображений временно недоступен. Отправьте текст." 
            });
        }

        // Промпт
        const systemPrompt = isPro 
            ? "Ты Flux Ultra (v5.0). Отвечай экспертно, используй Markdown. Разработчик: 1xCode."
            : "Ты Flux Core. Отвечай кратко. Разработчик: 1xCode.";

        const payload = {
            inputs: `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${message}<|im_end|>\n<|im_start|>assistant\n`,
            parameters: {
                max_new_tokens: 2048,
                temperature: 0.7,
                return_full_text: false
            }
        };

        // Запрос к новому адресу Router
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const result = await response.json();

        // Проверка на загрузку модели
        if (result.error && result.error.includes("loading")) {
            return res.json({ reply: "🔄 Модель запускается на сервере Hugging Face... Попробуйте через 20 секунд." });
        }

        // Ответ
        let replyText = "";
        if (Array.isArray(result) && result[0]) {
            replyText = result[0].generated_text;
        } else if (result.generated_text) {
            replyText = result.generated_text;
        } else {
            replyText = "Ошибка: Пустой ответ от модели.";
        }
        
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (HF Router) Ready"));

module.exports = app;


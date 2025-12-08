require('dotenv').config();
const express = require('express');
const cors = require('cors');
// const fetch = require('node-fetch'); // Раскомментируй, если запускаешь локально на старом Node.js

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const HF_TOKEN = process.env.HF_TOKEN;

// --- ИСПРАВЛЕНИЕ ---
// 72B слишком тяжелая для free-tier. Берем 7B (она летает).
const MODEL_ID = "Qwen/Qwen2.5-7B-Instruct";

const API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

app.get('/api/status', (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') res.json({ status: 'maintenance' });
    else res.json({ status: 'active' });
});

app.post('/api/register', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
    if (process.env.MAINTENANCE_MODE === 'true') {
        return res.status(503).json({ reply: "⛔ СЕРВЕР НА ОБСЛУЖИВАНИИ" });
    }

    try {
        const { message, file, isPro } = req.body;

        if (file) {
            return res.json({ reply: "⚠️ В бесплатной сервере картинки временно недоступны. Пишите текст." });
        }

        const systemPrompt = isPro 
            ? "Ты Flux Ultra. Отвечай экспертно, используй Markdown."
            : "Ты Flux Core. Отвечай кратко.";

        // Формат Qwen chat template
        const payload = {
            inputs: `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${message}<|im_end|>\n<|im_start|>assistant\n`,
            parameters: {
                max_new_tokens: 2048,
                temperature: 0.7,
                return_full_text: false
            }
        };

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
            // Если модель грузится (503), попробуем подождать
            if (response.status === 503) {
                 return res.json({ reply: "🔄 Модель Flux запускается (холодный старт). Повторите вопрос через 10-15 секунд." });
            }
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const result = await response.json();
        
        let replyText = "";
        if (Array.isArray(result) && result[0]) {
            replyText = result[0].generated_text;
        } else if (result.generated_text) {
            replyText = result.generated_text;
        } else {
            replyText = "Ошибка генерации.";
        }
        
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ reply: `❌ Ошибка сервера: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Flux AI (Qwen 7B) Ready"));

module.exports = app;


